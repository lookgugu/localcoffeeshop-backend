/**
 * Integration Tests — scripts/review-submissions.js --postgres
 *
 * Runs the real CLI as a child process against a throwaway Postgres database
 * (tests/helpers/pgTestDb.js) migrated by the real runner. The CLI connects
 * through REVIEW_DATABASE_URL with real LOGIN roles, because a subprocess
 * cannot inherit SET ROLE: one in lcs_reviewer, one in lcs_app, and the
 * superuser that owns the tables.
 *
 * The SQLite mode's argument validation and output escaping are covered by
 * review-submissions.test.js; this suite covers what differs on Postgres.
 */

const crypto = require('crypto');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { Pool } = require('pg');

const { describePg, createPgTestDatabase, PG_URL } = require('../helpers/pgTestDb');
const { migratePostgres } = require('../../src/queue/postgres-migrate');

const ROOT = path.join(__dirname, '..', '..');
const CLI = path.join(ROOT, 'scripts', 'review-submissions.js');

/** The documented digest, restated independently (numbers, not BIGINT strings). */
function expectedDigest(row) {
    return crypto.createHash('sha256').update(JSON.stringify([
        'lcs-shop-submission-v1', row.id, row.kind, row.target_shop_id, row.name, row.address, row.state,
        row.price_level, row.phone_number, row.website, row.description, row.language_code, row.created_at,
    ])).digest('hex');
}

const SUBMISSION_1 = {
    id: 1, kind: 'create', target_shop_id: null, name: 'New Cafe', address: '10 Bean Rd', state: 'CA',
    price_level: 'PRICE_LEVEL_INEXPENSIVE', phone_number: '+1 555 0100', website: 'https://new.example',
    description: 'Line one\nLine two', language_code: 'en', created_at: 1000,
};

function envFor(url, extra = {}) {
    // Start from a clean slate so a developer's own DATABASE_URL never leaks in.
    const env = { ...process.env };
    delete env.DATABASE_URL;
    delete env.DATABASE_CA_CERT;
    delete env.REVIEW_DATABASE_CA_CERT;
    delete env.REVIEW_DATABASE_URL;
    if (url !== undefined) env.REVIEW_DATABASE_URL = url;
    return { ...env, ...extra };
}

function cli(args, env) {
    const res = spawnSync(process.execPath, [CLI, ...args], { cwd: ROOT, encoding: 'utf8', env });
    return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

function cliAsync(args, env) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [CLI, ...args], { cwd: ROOT, env });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (d) => { stdout += d; });
        child.stderr.on('data', (d) => { stderr += d; });
        child.on('error', reject);
        child.on('close', (status) => resolve({ status, stdout, stderr }));
    });
}

describePg('scripts/review-submissions.js --postgres', () => {
    const suffix = `${process.pid}_${crypto.randomBytes(3).toString('hex')}`;
    const logins = {
        reviewer: { name: `lcs_rev_${suffix}`, role: 'lcs_reviewer' },
        app: { name: `lcs_appl_${suffix}`, role: 'lcs_app' },
    };
    const password = crypto.randomBytes(12).toString('hex');
    let admin;
    let pg;

    function loginUrl(dbUrl, user) {
        const url = new URL(dbUrl);
        url.username = user;
        url.password = password;
        return url.toString();
    }

    beforeAll(async () => {
        admin = new Pool({ connectionString: PG_URL, max: 1 });
        // The group roles come from the migration; create them up front so
        // the logins can join them before any suite database is migrated.
        await admin.query(`DO $$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lcs_app') THEN CREATE ROLE lcs_app NOLOGIN; END IF;
            IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lcs_reviewer') THEN CREATE ROLE lcs_reviewer NOLOGIN; END IF;
        END $$`);
        for (const { name, role } of Object.values(logins)) {
            await admin.query(`CREATE ROLE ${name} LOGIN PASSWORD '${password}' IN ROLE ${role}`);
        }
    });

    afterAll(async () => {
        for (const { name } of Object.values(logins)) {
            await admin.query(`DROP ROLE IF EXISTS ${name}`);
        }
        await admin.end();
    });

    let reviewerEnv;
    let reviewerPool;

    beforeEach(async () => {
        pg = await createPgTestDatabase();
        await migratePostgres(pg.pool);
        // Seed as the owner: 1 and 2 pending, 3 already rejected.
        await pg.pool.query(`INSERT INTO shop_submissions
            (kind, target_shop_id, name, address, state, price_level, phone_number, website, description, language_code, created_at)
            VALUES ('create', NULL, $1, $2, $3, $4, $5, $6, $7, $8, $9),
                   ('update', 7, 'Published Renamed', '1 Main St', 'NY', NULL, NULL, NULL, NULL, 'en', 2000),
                   ('create', NULL, 'Old Rejected', '3 Gone St', 'TX', NULL, NULL, NULL, NULL, 'en', 500)`,
        [SUBMISSION_1.name, SUBMISSION_1.address, SUBMISSION_1.state, SUBMISSION_1.price_level,
            SUBMISSION_1.phone_number, SUBMISSION_1.website, SUBMISSION_1.description, SUBMISSION_1.language_code,
            SUBMISSION_1.created_at]);
        await pg.pool.query("UPDATE shop_submissions SET status = 'rejected' WHERE id = 3");
        reviewerEnv = envFor(loginUrl(pg.url, logins.reviewer.name));
        reviewerPool = new Pool({ connectionString: loginUrl(pg.url, logins.reviewer.name), max: 1 });
        reviewerPool.on('error', () => {});
    });

    afterEach(async () => {
        await reviewerPool.end().catch(() => {});
        await pg.drop();
    });

    async function state() {
        const submissions = (await pg.pool.query('SELECT id, status FROM shop_submissions ORDER BY id')).rows
            .map((r) => ({ id: Number(r.id), status: r.status }));
        const reviews = (await pg.pool.query(
            'SELECT submission_id, old_status, new_status, reviewer, reason, payload_sha256 FROM submission_reviews ORDER BY id',
        )).rows.map((r) => ({ ...r, submission_id: Number(r.submission_id) }));
        return { submissions, reviews };
    }

    function shownDigest(id) {
        const res = cli(['--postgres', 'show', String(id)], reviewerEnv);
        expect(res.stderr).toBe('');
        expect(res.status).toBe(0);
        return JSON.parse(res.stdout).payloadSha256;
    }

    function decision({ command = 'approve', id = '1', sha, reviewer = 'op-alice', reason = 'checked listing' } = {}) {
        return ['--postgres', command, id, '--expect-sha256', sha, '--reviewer', reviewer, '--reason', reason];
    }

    describe('connection and login selection', () => {
        it('needs REVIEW_DATABASE_URL and never falls back to DATABASE_URL', () => {
            const res = cli(['--postgres', 'list'], envFor(undefined, { DATABASE_URL: loginUrl(pg.url, logins.reviewer.name) }));
            expect(res.status).toBe(2);
            expect(res.stderr).toMatch(/--postgres needs REVIEW_DATABASE_URL/);
            expect(res.stdout).toBe('');
        });

        it('refuses a REVIEW_DATABASE_URL identical to the app\'s DATABASE_URL', () => {
            const url = loginUrl(pg.url, logins.reviewer.name);
            const res = cli(['--postgres', 'list'], envFor(url, { DATABASE_URL: url }));
            expect(res.status).toBe(1);
            expect(res.stderr).toMatch(/same as DATABASE_URL/);
        });

        it('rejects --db together with --postgres', () => {
            const res = cli(['--postgres', '--db', '/tmp/x.db', 'list'], reviewerEnv);
            expect(res.status).toBe(2);
            expect(res.stderr).toMatch(/either --db or --postgres, not both/);
        });

        it('rejects a non-Postgres URL before connecting', () => {
            const res = cli(['--postgres', 'list'], envFor('mysql://u:p@localhost/db'));
            expect(res.status).toBe(2);
            expect(res.stderr).toMatch(/must be a postgres:\/\/ or postgresql:\/\/ URL/);
        });

        it('reports an unreachable server without echoing the password', () => {
            const url = new URL(loginUrl(pg.url, logins.reviewer.name));
            url.hostname = '127.0.0.1';
            url.port = '1';
            const res = cli(['--postgres', 'list'], envFor(url.toString()));
            expect(res.status).toBe(1);
            expect(res.stderr).toMatch(/could not connect to REVIEW_DATABASE_URL/);
            expect(res.stderr).not.toContain(password);
        });

        it('refuses the table owner / superuser: it holds more than lcs_reviewer, and writes nothing', async () => {
            const before = await state();
            const sha = shownDigest(1);
            for (const args of [['--postgres', 'list'], [...decision({ sha }), '--apply']]) {
                const res = cli(args, envFor(pg.url));
                expect(res.status).toBe(1);
                expect(res.stderr).toMatch(/has more than lcs_reviewer privileges/);
                expect(res.stdout).toBe('');
            }
            expect(await state()).toEqual(before);
        });

        it('refuses an lcs_app login (the public API): it cannot decide', async () => {
            const before = await state();
            const sha = shownDigest(1);
            const res = cli([...decision({ sha }), '--apply'], envFor(loginUrl(pg.url, logins.app.name)));
            expect(res.status).toBe(1);
            expect(res.stderr).toMatch(/lacks lcs_reviewer privileges/);
            expect(await state()).toEqual(before);
        });

        it('refuses an unmigrated database and does not migrate it', async () => {
            const empty = await createPgTestDatabase();
            try {
                const res = cli(['--postgres', 'list'], envFor(loginUrl(empty.url, logins.reviewer.name)));
                expect(res.status).toBe(1);
                expect(res.stderr).toMatch(/missing table\(s\) shop_submissions, submission_reviews; run the Postgres migrations/);
                const { rows } = await empty.pool.query(
                    "SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public'",
                );
                expect(rows[0].n).toBe(0);
            } finally {
                await empty.drop();
            }
        });
    });

    describe('reading (list / show)', () => {
        it('lists pending by default, as numbers, with allowlisted fields only', () => {
            const res = cli(['--postgres', 'list'], reviewerEnv);
            expect(res.status).toBe(0);
            const { submissions } = JSON.parse(res.stdout);
            expect(submissions).toEqual([
                { id: 1, kind: 'create', targetShopId: null, state: 'CA', status: 'pending', createdAt: 1000, name: 'New Cafe' },
                { id: 2, kind: 'update', targetShopId: 7, state: 'NY', status: 'pending', createdAt: 2000, name: 'Published Renamed' },
            ]);
            const all = JSON.parse(cli(['--postgres', 'list', '--status', 'all', '--limit', '2'], reviewerEnv).stdout);
            expect(all.submissions.map((s) => s.id)).toEqual([3, 1]);
        });

        it('show prints the same digest the SQLite mode would for the same content', () => {
            const res = cli(['--postgres', 'show', '1'], reviewerEnv);
            expect(res.status).toBe(0);
            const out = JSON.parse(res.stdout);
            expect(out.payloadSha256).toBe(expectedDigest(SUBMISSION_1));
            expect(out.submission).toEqual(expect.objectContaining({ id: 1, createdAt: 1000, description: 'Line one\nLine two' }));
            expect(out).toEqual(expect.objectContaining({ review: null, published: false }));
        });

        it('show of an unknown id fails cleanly', () => {
            const res = cli(['--postgres', 'show', '999'], reviewerEnv);
            expect(res.status).toBe(1);
            expect(res.stderr).toMatch(/submission 999 not found/);
        });
    });

    describe('deciding', () => {
        it.each(['approve', 'reject'])('%s without --apply is a dry run and writes nothing', async (command) => {
            const before = await state();
            const res = cli(decision({ command, sha: shownDigest(1) }), reviewerEnv);
            expect(res.stderr).toBe('');
            expect(res.status).toBe(0);
            expect(JSON.parse(res.stdout)).toEqual(expect.objectContaining({ dryRun: true, submissionId: 1, published: false }));
            expect(await state()).toEqual(before);
        });

        it('--apply records the audit row and the status together; approved is not published', async () => {
            const sha = shownDigest(1);
            const res = cli([...decision({ sha: sha.toUpperCase() }), '--apply'], reviewerEnv);
            expect(res.stderr).toBe('');
            expect(res.status).toBe(0);
            expect(JSON.parse(res.stdout)).toEqual(expect.objectContaining({
                applied: true, submissionId: 1, oldStatus: 'pending', newStatus: 'approved', payloadSha256: sha, published: false,
            }));
            expect(await state()).toEqual({
                submissions: [{ id: 1, status: 'approved' }, { id: 2, status: 'pending' }, { id: 3, status: 'rejected' }],
                reviews: [{
                    submission_id: 1, old_status: 'pending', new_status: 'approved',
                    reviewer: 'op-alice', reason: 'checked listing', payload_sha256: sha,
                }],
            });
            const shown = JSON.parse(cli(['--postgres', 'show', '1'], reviewerEnv).stdout);
            expect(shown.review).toEqual(expect.objectContaining({ newStatus: 'approved', reviewer: 'op-alice', payloadSha256: sha }));
            expect(typeof shown.review.decidedAt).toBe('number');
        });

        it('refuses a digest from another submission (stale review), dry run and --apply', async () => {
            const before = await state();
            const other = shownDigest(2);
            for (const extra of [[], ['--apply']]) {
                const res = cli([...decision({ sha: other }), ...extra], reviewerEnv);
                expect(res.status).toBe(1);
                expect(res.stderr).toMatch(/stale review/);
            }
            expect(await state()).toEqual(before);
        });

        it('refuses a submission that is not pending; a replay keeps the first decision', async () => {
            const rejected = shownDigest(3);
            const res3 = cli([...decision({ id: '3', sha: rejected }), '--apply'], reviewerEnv);
            expect(res3.status).toBe(1);
            expect(res3.stderr).toMatch(/submission 3 is rejected, not pending/);

            const sha = shownDigest(1);
            expect(cli([...decision({ sha }), '--apply'], reviewerEnv).status).toBe(0);
            const replay = cli([...decision({ command: 'reject', sha, reviewer: 'op-bob' }), '--apply'], reviewerEnv);
            expect(replay.status).toBe(1);
            expect(replay.stderr).toMatch(/submission 1 is approved, not pending/);
            const { reviews } = await state();
            expect(reviews).toHaveLength(1);
            expect(reviews[0]).toEqual(expect.objectContaining({ new_status: 'approved', reviewer: 'op-alice' }));
        });

        it('unknown id with --apply writes nothing', async () => {
            const before = await state();
            const res = cli([...decision({ id: '999', sha: 'a'.repeat(64) }), '--apply'], reviewerEnv);
            expect(res.status).toBe(1);
            expect(res.stderr).toMatch(/submission 999 not found/);
            expect(await state()).toEqual(before);
        });
    });

    describe('atomicity', () => {
        // Test-only fault injection, installed by the owner.
        const faults = {
            'the audit insert': ['submission_reviews', 'BEFORE INSERT', 'injected audit failure'],
            'the status update, after the audit insert': ['shop_submissions', 'BEFORE UPDATE', 'injected status failure'],
        };

        it.each(Object.keys(faults))('a failure at %s rolls back both writes and is reported clearly', async (where) => {
            const [table, timing, message] = faults[where];
            const sha = shownDigest(1);
            await pg.pool.query(`CREATE FUNCTION inject_fault() RETURNS trigger AS $$
                BEGIN RAISE EXCEPTION '${message}'; END; $$ LANGUAGE plpgsql`);
            await pg.pool.query(`CREATE TRIGGER inject_fault ${timing} ON ${table} FOR EACH ROW EXECUTE FUNCTION inject_fault()`);
            const before = await state();

            const res = cli([...decision({ sha }), '--apply'], reviewerEnv);
            expect(res.status).toBe(1);
            expect(res.stderr).toMatch(new RegExp(`database refused the decision: ${message}; nothing recorded`));
            expect(res.stdout).toBe('');
            expect(await state()).toEqual(before);

            await pg.pool.query(`DROP TRIGGER inject_fault ON ${table}`);
            expect(cli([...decision({ sha }), '--apply'], reviewerEnv).status).toBe(0);
            expect((await state()).reviews).toHaveLength(1);
        });
    });

    describe('concurrency', () => {
        it('racing approve/reject processes: exactly one decision lands, the rest fail closed', async () => {
            const sha = shownDigest(1);
            const results = await Promise.all(Array.from({ length: 8 }, (_, i) => cliAsync([
                ...decision({ command: i % 2 ? 'reject' : 'approve', sha, reviewer: `op-${i}` }), '--apply',
            ], reviewerEnv)));

            const winners = results.filter((r) => r.status === 0);
            const losers = results.filter((r) => r.status !== 0);
            expect(winners).toHaveLength(1);
            expect(losers).toHaveLength(7);
            for (const loser of losers) {
                expect(loser.status).toBe(1);
                expect(loser.stderr).toMatch(/submission 1 is (approved|rejected), not pending/);
            }
            const won = JSON.parse(winners[0].stdout);
            const { submissions, reviews } = await state();
            expect(reviews).toEqual([expect.objectContaining({ submission_id: 1, new_status: won.newStatus, reviewer: won.reviewer })]);
            expect(submissions[0]).toEqual({ id: 1, status: won.newStatus });
        });
    });

    describe('the reviewer login itself (grants and triggers, not the CLI)', () => {
        it('cannot edit submission content, insert, delete, or rewrite the audit', async () => {
            const sha = shownDigest(1);
            expect(cli([...decision({ sha }), '--apply'], reviewerEnv).status).toBe(0);
            const attempts = [
                "UPDATE shop_submissions SET name = 'Hijacked' WHERE id = 2",
                "INSERT INTO shop_submissions (kind, name, address, state, created_at) VALUES ('create', 'x', 'y', 'CA', 1)",
                'DELETE FROM shop_submissions WHERE id = 2',
                "UPDATE submission_reviews SET reason = 'rewritten'",
                'DELETE FROM submission_reviews',
                'SELECT * FROM idempotency_keys',
            ];
            for (const sql of attempts) {
                await expect(reviewerPool.query(sql)).rejects.toMatchObject({ code: '42501' });
            }
            // Status-only UPDATE is granted, but the trigger keeps decisions final.
            await expect(reviewerPool.query("UPDATE shop_submissions SET status = 'pending' WHERE id = 1"))
                .rejects.toThrow(/status may only move from pending to approved or rejected/);
            expect((await pg.pool.query('SELECT name FROM shop_submissions WHERE id = 2')).rows[0].name).toBe('Published Renamed');
        });

        it('a read-only (no --apply) session cannot write even though the login could', async () => {
            // The CLI sets this on every non --apply session; prove the setting refuses a write.
            const client = await reviewerPool.connect();
            try {
                await client.query('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY');
                await expect(client.query("UPDATE shop_submissions SET status = 'approved' WHERE id = 2"))
                    .rejects.toMatchObject({ code: '25006' });
            } finally {
                client.release(true);
            }
            expect((await state()).submissions[1]).toEqual({ id: 2, status: 'pending' });
        });
    });
});
