/**
 * Integration Tests — private operator CLI scripts/review-submissions.js
 *
 * Every test runs the real CLI as a child process against throw-away SQLite
 * databases under os.tmpdir() (honours TMPDIR), built by the real
 * scripts/migrate.js. The tracked data/coffee_shops.db is never opened; it is
 * only hashed to prove it is byte-identical afterwards.
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawn, spawnSync } = require('child_process');
const sqlite3 = require('sqlite3');

const ROOT = path.join(__dirname, '..', '..');
const CLI = path.join(ROOT, 'scripts', 'review-submissions.js');
const TRACKED_DB = path.join(ROOT, 'data', 'coffee_shops.db');

function sha256File(file) {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function withDb(dbPath, fn) {
    return new Promise((resolve, reject) => {
        // OPEN_READWRITE without OPEN_CREATE: a typo in a test path fails loudly.
        const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE, (err) => {
            if (err) return reject(err);
            Promise.resolve(fn(db)).then(
                (v) => db.close(() => resolve(v)),
                (e) => db.close(() => reject(e)),
            );
        });
    });
}

function all(db, sql, params = []) {
    return new Promise((resolve, reject) => db.all(sql, params, (e, r) => (e ? reject(e) : resolve(r))));
}

function exec(db, sql) {
    return new Promise((resolve, reject) => db.exec(sql, (e) => (e ? reject(e) : resolve())));
}

/**
 * Independent restatement of the documented digest: SHA-256 over the JSON
 * array below. If the CLI's canonical form drifts, this test must fail,
 * because digests copied from an older `show` would silently stop matching.
 */
function expectedDigest(row) {
    return crypto.createHash('sha256').update(JSON.stringify([
        'lcs-shop-submission-v1', row.id, row.kind, row.target_shop_id, row.name, row.address, row.state,
        row.price_level, row.phone_number, row.website, row.description, row.language_code, row.created_at,
    ])).digest('hex');
}

const PUBLISHED_SQL = 'SELECT * FROM coffee_shops ORDER BY id';

/** Byte-level snapshot of a fixture DB's directory: proves no write and no journal. */
function dirSnapshot(dir) {
    return fs.readdirSync(dir).sort().map((f) => [f, sha256File(path.join(dir, f))]);
}

/**
 * Build a template DB: base published schema + every real migration (via the
 * real migrate.js) + seed rows. Each test copies it into its own directory.
 */
async function buildTemplate(dir) {
    const dbPath = path.join(dir, 'template.db');
    await new Promise((resolve, reject) => {
        const db = new sqlite3.Database(dbPath, (err) => (err ? reject(err) : db.close(resolve)));
    });
    await withDb(dbPath, (db) => exec(db, `
        CREATE TABLE coffee_shops (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            address TEXT NOT NULL,
            price_level TEXT,
            language_code TEXT DEFAULT 'en',
            source_file TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            state TEXT
        );`));
    execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'migrate.js'), 'up'], {
        cwd: ROOT, env: { ...process.env, DB_PATH: dbPath }, encoding: 'utf8',
    });
    await withDb(dbPath, (db) => exec(db, `
        INSERT INTO coffee_shops (id, name, address, price_level, state) VALUES
            (1, 'Published One', '1 Main St', 'PRICE_LEVEL_MODERATE', 'CA'),
            (2, 'Published Two', '2 Main St', NULL, 'NY');
        INSERT INTO shop_submissions (id, kind, target_shop_id, name, address, state, price_level,
                                      phone_number, website, description, language_code, status, created_at) VALUES
            (1, 'create', NULL, 'New Cafe', '10 Bean Rd', 'CA', 'PRICE_LEVEL_INEXPENSIVE',
             '+1 555 0100', 'https://new.example', 'Line one' || char(10) || 'Line two', 'en', 'pending', 1000),
            (2, 'update', 1, 'Published One Renamed', '1 Main St', 'CA', NULL,
             NULL, NULL, NULL, 'en', 'pending', 2000),
            (3, 'create', NULL, 'Old Rejected', '3 Gone St', 'TX', NULL,
             NULL, NULL, NULL, 'en', 'rejected', 500);`));
    return dbPath;
}

function cli(args, { cwd } = {}) {
    const res = spawnSync(process.execPath, [CLI, ...args], { cwd: cwd || ROOT, encoding: 'utf8' });
    return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

function cliAsync(args) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [CLI, ...args], { cwd: ROOT });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (d) => { stdout += d; });
        child.stderr.on('data', (d) => { stderr += d; });
        child.on('error', reject);
        child.on('close', (status) => resolve({ status, stdout, stderr }));
    });
}

describe('scripts/review-submissions.js', () => {
    let tmp;
    let trackedHashBefore;
    let template;

    beforeAll(async () => {
        trackedHashBefore = sha256File(TRACKED_DB);
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lcs-review-'));
        template = await buildTemplate(fs.mkdtempSync(path.join(tmp, 'template-')));
    });

    /** Fresh copy of the template in its own directory. */
    function fixture() {
        const dir = fs.mkdtempSync(path.join(tmp, 'case-'));
        const dbPath = path.join(dir, 'review.db');
        fs.copyFileSync(template, dbPath);
        return { dir, dbPath };
    }

    afterAll(() => {
        fs.rmSync(tmp, { recursive: true, force: true });
        expect(sha256File(TRACKED_DB)).toBe(trackedHashBefore);
    });

    describe('database selection', () => {
        it('requires --db: no default database, nothing created', () => {
            const cwd = fs.mkdtempSync(path.join(tmp, 'cwd-'));
            const res = cli(['list'], { cwd });
            expect(res.status).toBe(2);
            expect(res.stderr).toMatch(/--db is required/);
            expect(res.stdout).toBe('');
            expect(fs.readdirSync(cwd)).toEqual([]);
        });

        it('refuses a nonexistent database and does not create it', () => {
            const missing = path.join(tmp, 'missing', 'nope.db');
            const res = cli(['--db', missing, 'list']);
            expect(res.status).toBe(1);
            expect(res.stderr).toMatch(/does not exist/);
            expect(res.stdout).toBe('');
            expect(fs.existsSync(missing)).toBe(false);
            expect(fs.existsSync(path.dirname(missing))).toBe(false);
        });

        it.each([':memory:', 'file:x.db?mode=rwc', ''])('refuses special SQLite name %j without creating anything', (name) => {
            const cwd = fs.mkdtempSync(path.join(tmp, 'cwd-'));
            const res = cli(['--db', name, 'list'], { cwd });
            expect(res.status).toBe(2);
            expect(res.stdout).toBe('');
            expect(fs.readdirSync(cwd)).toEqual([]);
        });

        describe('refuses the tracked repository database, however it is reached', () => {
            const variants = {
                absolute: () => TRACKED_DB,
                relative: () => 'data/coffee_shops.db',
                traversal: () => 'data/../data/./coffee_shops.db',
                'file symlink': () => {
                    const link = path.join(fs.mkdtempSync(path.join(tmp, 'ln-')), 'innocent.db');
                    fs.symlinkSync(TRACKED_DB, link);
                    return link;
                },
                'directory symlink': () => {
                    const link = path.join(fs.mkdtempSync(path.join(tmp, 'ln-')), 'd');
                    fs.symlinkSync(path.dirname(TRACKED_DB), link);
                    return path.join(link, 'coffee_shops.db');
                },
            };
            const commands = [
                ['list'],
                ['show', '1'],
                ['approve', '1', '--expect-sha256', 'a'.repeat(64), '--reviewer', 'op', '--reason', 'r', '--apply'],
            ];

            it.each(Object.keys(variants))('%s path', (variant) => {
                const dbArg = variants[variant]();
                for (const command of commands) {
                    const res = cli(['--db', dbArg, ...command]);
                    expect(res.status).toBe(1);
                    expect(res.stderr).toMatch(/refusing to open the tracked repository database/);
                    expect(res.stdout).toBe('');
                }
                expect(sha256File(TRACKED_DB)).toBe(trackedHashBefore);
                expect(fs.existsSync(`${TRACKED_DB}-journal`)).toBe(false);
            });
        });

        it('refuses a directory', () => {
            const res = cli(['--db', tmp, 'list']);
            expect(res.status).toBe(1);
            expect(res.stderr).toMatch(/not a regular file/);
        });
    });

    describe('list (read-only)', () => {
        it('lists pending submissions by default with allowlisted summary fields only', () => {
            const { dir, dbPath } = fixture();
            const before = dirSnapshot(dir);
            const res = cli(['--db', dbPath, 'list']);
            expect(res.stderr).toBe('');
            expect(res.status).toBe(0);
            const out = JSON.parse(res.stdout);
            expect(out.submissions).toEqual([
                { id: 1, kind: 'create', targetShopId: null, state: 'CA', status: 'pending', createdAt: 1000, name: 'New Cafe' },
                { id: 2, kind: 'update', targetShopId: 1, state: 'CA', status: 'pending', createdAt: 2000, name: 'Published One Renamed' },
            ]);
            expect(dirSnapshot(dir)).toEqual(before);
        });

        it('filters by --status and bounds --limit', () => {
            const { dir, dbPath } = fixture();
            const before = dirSnapshot(dir);
            expect(JSON.parse(cli(['--db', dbPath, 'list', '--status', 'rejected']).stdout).submissions.map((s) => s.id)).toEqual([3]);
            expect(JSON.parse(cli(['--db', dbPath, 'list', '--status', 'all']).stdout).submissions.map((s) => s.id)).toEqual([3, 1, 2]);
            expect(JSON.parse(cli(['--db', dbPath, 'list', '--status', 'all', '--limit', '1']).stdout).submissions.map((s) => s.id)).toEqual([3]);
            expect(dirSnapshot(dir)).toEqual(before);
        });
    });

    describe('show (read-only)', () => {
        it('prints allowlisted content, the payload digest and an explicit not-published notice', async () => {
            const { dir, dbPath } = fixture();
            const [row] = await withDb(dbPath, (db) => all(db, 'SELECT * FROM shop_submissions WHERE id = 1'));
            const before = dirSnapshot(dir);
            const res = cli(['--db', dbPath, 'show', '1']);
            expect(res.stderr).toBe('');
            expect(res.status).toBe(0);
            const out = JSON.parse(res.stdout);
            expect(out.submission).toEqual({
                id: 1, kind: 'create', targetShopId: null, status: 'pending', createdAt: 1000,
                name: 'New Cafe', address: '10 Bean Rd', state: 'CA', priceLevel: 'PRICE_LEVEL_INEXPENSIVE',
                phoneNumber: '+1 555 0100', website: 'https://new.example', description: 'Line one\nLine two',
                languageCode: 'en',
            });
            expect(out.payloadSha256).toBe(expectedDigest(row));
            expect(out.review).toBeNull();
            expect(out.published).toBe(false);
            expect(dirSnapshot(dir)).toEqual(before);
        });

        it('fails cleanly for an unknown id', () => {
            const { dir, dbPath } = fixture();
            const before = dirSnapshot(dir);
            const res = cli(['--db', dbPath, 'show', '99']);
            expect(res.status).toBe(1);
            expect(res.stderr).toMatch(/submission 99 not found/);
            expect(res.stdout).toBe('');
            expect(dirSnapshot(dir)).toEqual(before);
        });

        it('never prints request metadata columns, even if a future schema adds them', async () => {
            const { dbPath } = fixture();
            await withDb(dbPath, (db) => exec(db, `
                ALTER TABLE shop_submissions ADD COLUMN client_ip TEXT;
                ALTER TABLE shop_submissions ADD COLUMN user_agent TEXT;
                ALTER TABLE shop_submissions ADD COLUMN api_token TEXT;
                UPDATE shop_submissions SET client_ip = '203.0.113.77', user_agent = 'Sneaky/1.0', api_token = 'tok_SECRET_123';`));
            const [row] = await withDb(dbPath, (db) => all(db, 'SELECT * FROM shop_submissions WHERE id = 1'));
            for (const args of [['list', '--status', 'all'], ['show', '1'], ['show', '2']]) {
                const res = cli(['--db', dbPath, ...args]);
                expect(res.status).toBe(0);
                expect(res.stdout).not.toMatch(/203\.0\.113\.77|Sneaky|tok_SECRET|client_ip|user_agent|api_token/);
            }
            expect(JSON.parse(cli(['--db', dbPath, 'show', '1']).stdout).payloadSha256).toBe(expectedDigest(row));
        });

        it('escapes control characters so stored text cannot drive the terminal', async () => {
            const { dbPath } = fixture();
            await withDb(dbPath, (db) => exec(db, "UPDATE shop_submissions SET name = 'Evil' || char(27) || '[2J', description = 'a' || char(7) WHERE id = 1"));
            for (const args of [['list'], ['show', '1']]) {
                const res = cli(['--db', dbPath, ...args]);
                expect(res.status).toBe(0);
                expect(res.stdout).not.toMatch(/[\u0000-\u0009\u000B-\u001F\u007F]/);
                expect(res.stdout).toContain('Evil\\u001b[2J');
            }
        });

        it('also escapes DEL, C1 controls (e.g. single-byte CSI) and bidi overrides, which JSON.stringify leaves raw', async () => {
            const { dbPath } = fixture();
            await withDb(dbPath, (db) => exec(db,
                "UPDATE shop_submissions SET name = 'A' || char(127) || 'B' || char(155) || '2J' || char(8238) || 'gpj.exe' WHERE id = 1"));
            for (const args of [['list'], ['show', '1']]) {
                const res = cli(['--db', dbPath, ...args]);
                expect(res.status).toBe(0);
                expect(res.stdout).not.toMatch(/[\u007F-\u009F\u2028\u2029\u202A-\u202E\u2066-\u2069]/);
                expect(res.stdout).toContain('A\\u007fB\\u009b2J\\u202egpj.exe');
                // Still valid JSON that round-trips to the stored value.
                const parsed = JSON.parse(res.stdout);
                const name = args[0] === 'list' ? parsed.submissions[0].name : parsed.submission.name;
                expect(name).toBe('A\u007FB\u009B2J\u202Egpj.exe');
            }
        });

        it('sanitizes user input echoed in error messages', () => {
            const res = cli(['--db', 'x.db', 'list', '--evil\u001b[2J\u009b']);
            expect(res.status).toBe(2);
            expect(res.stderr).toMatch(/^error: /);
            expect(res.stderr).not.toMatch(/[\u0000-\u0009\u000B-\u001F\u007F-\u009F]/);
        });

        it('refuses a database whose schema is not migrated, and does not migrate it', async () => {
            const { dir, dbPath } = fixture();
            await withDb(dbPath, (db) => exec(db, `
                DROP TRIGGER submission_reviews_append_only_update;
                DROP TRIGGER submission_reviews_append_only_delete;
                DROP TABLE submission_reviews;`));
            const before = dirSnapshot(dir);
            for (const args of [['list'], ['show', '1']]) {
                const res = cli(['--db', dbPath, ...args]);
                expect(res.status).toBe(1);
                expect(res.stderr).toMatch(/missing table\(s\) submission_reviews; run the migrations explicitly first/);
            }
            expect(dirSnapshot(dir)).toEqual(before);
        });
    });

    /** Digest exactly as the operator would copy it from `show`. */
    function shownDigest(dbPath, id) {
        const res = cli(['--db', dbPath, 'show', String(id)]);
        expect(res.status).toBe(0);
        return JSON.parse(res.stdout).payloadSha256;
    }

    function decisionArgs(dbPath, { command = 'approve', id = '1', sha, reviewer = 'op-alice', reason = 'checked listing' } = {}) {
        return ['--db', dbPath, command, id, '--expect-sha256', sha, '--reviewer', reviewer, '--reason', reason];
    }

    describe('decision gates (approve / reject)', () => {
        it.each(['approve', 'reject'])('%s without --apply is a dry run: validates, reports, writes nothing', (command) => {
            const { dir, dbPath } = fixture();
            const sha = shownDigest(dbPath, 1);
            const before = dirSnapshot(dir);
            const res = cli(decisionArgs(dbPath, { command, sha }));
            expect(res.stderr).toBe('');
            expect(res.status).toBe(0);
            expect(JSON.parse(res.stdout)).toEqual(expect.objectContaining({
                dryRun: true,
                submissionId: 1,
                oldStatus: 'pending',
                newStatus: command === 'approve' ? 'approved' : 'rejected',
                published: false,
            }));
            expect(dirSnapshot(dir)).toEqual(before);
        });

        describe('rejects invalid ids and options with exit 2 and no side effects, even with --apply', () => {
            const SHA = 'a'.repeat(64);
            const cases = {
                'missing id': [/a submission id is required/, (db) => ['--db', db, 'approve', '--expect-sha256', SHA, '--reviewer', 'op', '--reason', 'r', '--apply']],
                'two ids': [/exactly one submission id/, (db) => [...decisionArgs(db, { sha: SHA }), '2', '--apply']],
                'id 0': [/submission id must be a positive integer/, (db) => [...decisionArgs(db, { id: '0', sha: SHA }), '--apply']],
                'id leading zero': [/submission id must be a positive integer/, (db) => [...decisionArgs(db, { id: '01', sha: SHA }), '--apply']],
                'id negative': [/Unknown option '-1'/, (db) => [...decisionArgs(db, { id: '-1', sha: SHA }), '--apply']],
                'id fractional': [/submission id must be a positive integer/, (db) => [...decisionArgs(db, { id: '1.5', sha: SHA }), '--apply']],
                'id exponent': [/submission id must be a positive integer/, (db) => [...decisionArgs(db, { id: '1e3', sha: SHA }), '--apply']],
                'id trailing junk': [/submission id must be a positive integer/, (db) => [...decisionArgs(db, { id: '1abc', sha: SHA }), '--apply']],
                'id hex': [/submission id must be a positive integer/, (db) => [...decisionArgs(db, { id: '0x1', sha: SHA }), '--apply']],
                'id whitespace': [/submission id must be a positive integer/, (db) => [...decisionArgs(db, { id: ' 1', sha: SHA }), '--apply']],
                'id too long': [/submission id must be a positive integer/, (db) => [...decisionArgs(db, { id: '12345678901', sha: SHA }), '--apply']],
                'missing --expect-sha256': [/--expect-sha256 is required/, (db) => ['--db', db, 'approve', '1', '--reviewer', 'op', '--reason', 'r', '--apply']],
                'short digest': [/--expect-sha256 must be 64 hex characters/, (db) => [...decisionArgs(db, { sha: 'abc' }), '--apply']],
                'non-hex digest': [/--expect-sha256 must be 64 hex characters/, (db) => [...decisionArgs(db, { sha: 'g'.repeat(64) }), '--apply']],
                'long digest': [/--expect-sha256 must be 64 hex characters/, (db) => [...decisionArgs(db, { sha: 'a'.repeat(65) }), '--apply']],
                'missing --reviewer': [/--reviewer is required/, (db) => ['--db', db, 'approve', '1', '--expect-sha256', SHA, '--reason', 'r', '--apply']],
                'empty reviewer': [/--reviewer must be 1-64 characters/, (db) => [...decisionArgs(db, { sha: SHA, reviewer: '' }), '--apply']],
                'reviewer too long': [/--reviewer must be 1-64 characters/, (db) => [...decisionArgs(db, { sha: SHA, reviewer: 'r'.repeat(65) }), '--apply']],
                'reviewer with space': [/--reviewer must be 1-64 characters/, (db) => [...decisionArgs(db, { sha: SHA, reviewer: 'op alice' }), '--apply']],
                'reviewer with newline': [/--reviewer must be 1-64 characters/, (db) => [...decisionArgs(db, { sha: SHA, reviewer: 'op\nx' }), '--apply']],
                'missing --reason': [/--reason is required/, (db) => ['--db', db, 'approve', '1', '--expect-sha256', SHA, '--reviewer', 'op', '--apply']],
                'blank reason': [/--reason must be 1-500 characters/, (db) => [...decisionArgs(db, { sha: SHA, reason: '   ' }), '--apply']],
                'reason too long': [/--reason must be 1-500 characters/, (db) => [...decisionArgs(db, { sha: SHA, reason: 'x'.repeat(501) }), '--apply']],
                'reason with control char': [/--reason must not contain control characters/, (db) => [...decisionArgs(db, { sha: SHA, reason: 'ok\u001b[2J' }), '--apply']],
                'reason with newline': [/--reason must not contain control characters/, (db) => [...decisionArgs(db, { sha: SHA, reason: 'line\nbreak' }), '--apply']],
                'duplicate --reviewer': [/--reviewer given more than once/, (db) => [...decisionArgs(db, { sha: SHA }), '--reviewer', 'op-mallory', '--apply']],
                'duplicate --db': [/--db given more than once/, (db) => [...decisionArgs(db, { sha: SHA }), '--db', db, '--apply']],
                '--apply with a value': [/--apply' does not take an argument/, (db) => [...decisionArgs(db, { sha: SHA }), '--apply=false']],
                'unknown option': [/Unknown option '--force'/, (db) => [...decisionArgs(db, { sha: SHA }), '--force', '--apply']],
                '--publish option': [/Unknown option '--publish'/, (db) => [...decisionArgs(db, { sha: SHA }), '--publish', '--apply']],
                'unknown command publish': [/unknown command "publish"/, (db) => [...decisionArgs(db, { command: 'publish', sha: SHA }), '--apply']],
                'unknown command accept-for-export': [/unknown command "accept-for-export"/, (db) => [...decisionArgs(db, { command: 'accept-for-export', sha: SHA }), '--apply']],
                '--apply on show': [/--apply is not valid for show/, (db) => ['--db', db, 'show', '1', '--apply']],
                '--apply on list': [/--apply is not valid for list/, (db) => ['--db', db, 'list', '--apply']],
                'decision option on show': [/--reviewer is not valid for show/, (db) => ['--db', db, 'show', '1', '--reviewer', 'op']],
                'list bad status': [/--status must be one of/, (db) => ['--db', db, 'list', '--status', 'published']],
                'list limit 0': [/--limit must be an integer from 1 to 500/, (db) => ['--db', db, 'list', '--limit', '0']],
                'list limit too big': [/--limit must be an integer from 1 to 500/, (db) => ['--db', db, 'list', '--limit', '501']],
                'list limit junk': [/--limit must be an integer from 1 to 500/, (db) => ['--db', db, 'list', '--limit', '5x']],
                'no command': [/a command is required/, (db) => ['--db', db]],
            };

            it.each(Object.keys(cases))('%s', (name) => {
                const { dir, dbPath } = fixture();
                const before = dirSnapshot(dir);
                const [message, args] = cases[name];
                const res = cli(args(dbPath));
                expect(res.status).toBe(2);
                expect(res.stderr).toMatch(/^error: /);
                expect(res.stderr).toMatch(message);
                expect(res.stdout).toBe('');
                expect(dirSnapshot(dir)).toEqual(before);
            });
        });
    });

    describe('applying a decision (--apply)', () => {
        it('approve: atomically records audit + status; approved is NOT published; coffee_shops untouched', async () => {
            const { dbPath } = fixture();
            const sha = shownDigest(dbPath, 1);
            const published = await withDb(dbPath, (db) => all(db, PUBLISHED_SQL));
            const othersBefore = await withDb(dbPath, (db) => all(db, 'SELECT * FROM shop_submissions WHERE id <> 1 ORDER BY id'));
            const t0 = Math.floor(Date.now() / 1000);

            const res = cli([...decisionArgs(dbPath, { sha, reason: '  verified on site  ' }), '--apply']);
            const t1 = Math.floor(Date.now() / 1000);
            expect(res.stderr).toBe('');
            expect(res.status).toBe(0);
            const out = JSON.parse(res.stdout);
            expect(out).toEqual(expect.objectContaining({
                applied: true, submissionId: 1, oldStatus: 'pending', newStatus: 'approved', published: false,
            }));
            expect(out.notice).toMatch(/does NOT mean published/);

            await withDb(dbPath, async (db) => {
                expect(await all(db, PUBLISHED_SQL)).toEqual(published);
                expect(await all(db, 'SELECT * FROM shop_submissions WHERE id <> 1 ORDER BY id')).toEqual(othersBefore);
                expect(await all(db, 'SELECT status FROM shop_submissions WHERE id = 1')).toEqual([{ status: 'approved' }]);
                const audit = await all(db, 'SELECT * FROM submission_reviews');
                expect(audit).toHaveLength(1);
                expect(audit[0]).toEqual({
                    id: expect.any(Number), submission_id: 1, old_status: 'pending', new_status: 'approved',
                    reviewer: 'op-alice', reason: 'verified on site', payload_sha256: sha, decided_at: expect.any(Number),
                });
                expect(audit[0].decided_at).toBeGreaterThanOrEqual(t0);
                expect(audit[0].decided_at).toBeLessThanOrEqual(t1);
            });

            const shown = JSON.parse(cli(['--db', dbPath, 'show', '1']).stdout);
            expect(shown.submission.status).toBe('approved');
            expect(shown.published).toBe(false);
            expect(shown.review).toEqual(expect.objectContaining({
                oldStatus: 'pending', newStatus: 'approved', reviewer: 'op-alice', reason: 'verified on site', payloadSha256: sha,
            }));
        });

        it('reject of an update proposal never touches the targeted published row', async () => {
            const { dbPath } = fixture();
            const sha = shownDigest(dbPath, 2);
            const published = await withDb(dbPath, (db) => all(db, PUBLISHED_SQL));
            const res = cli([...decisionArgs(dbPath, { command: 'reject', id: '2', sha, reason: 'not the owner' }), '--apply']);
            expect(res.status).toBe(0);
            expect(JSON.parse(res.stdout).newStatus).toBe('rejected');
            await withDb(dbPath, async (db) => {
                expect(await all(db, PUBLISHED_SQL)).toEqual(published);
                expect(await all(db, 'SELECT status FROM shop_submissions WHERE id = 2')).toEqual([{ status: 'rejected' }]);
                expect(await all(db, 'SELECT submission_id, new_status FROM submission_reviews')).toEqual([{ submission_id: 2, new_status: 'rejected' }]);
            });
        });
    });

    describe('fail closed: stale review, non-pending, replay', () => {
        async function state(dbPath) {
            return withDb(dbPath, async (db) => ({
                published: await all(db, PUBLISHED_SQL),
                submissions: await all(db, 'SELECT * FROM shop_submissions ORDER BY id'),
                reviews: await all(db, 'SELECT * FROM submission_reviews ORDER BY id'),
            }));
        }

        it('refuses (dry run and --apply) when content changed after `show`', async () => {
            const { dbPath } = fixture();
            const sha = shownDigest(dbPath, 1);
            await withDb(dbPath, (db) => exec(db, "UPDATE shop_submissions SET website = 'https://swapped.example' WHERE id = 1"));
            const before = await state(dbPath);
            for (const extra of [[], ['--apply']]) {
                const res = cli([...decisionArgs(dbPath, { sha }), ...extra]);
                expect(res.status).toBe(1);
                expect(res.stderr).toMatch(/stale review: payload digest of submission 1 does not match --expect-sha256/);
                expect(res.stdout).toBe('');
            }
            expect(await state(dbPath)).toEqual(before);
        });

        it("refuses a digest copied from a different submission", async () => {
            const { dbPath } = fixture();
            const before = await state(dbPath);
            const res = cli([...decisionArgs(dbPath, { id: '1', sha: shownDigest(dbPath, 2) }), '--apply']);
            expect(res.status).toBe(1);
            expect(res.stderr).toMatch(/stale review/);
            expect(await state(dbPath)).toEqual(before);
        });

        it('accepts the digest case-insensitively and stores it lowercase', async () => {
            const { dbPath } = fixture();
            const sha = shownDigest(dbPath, 1);
            expect(cli([...decisionArgs(dbPath, { sha: sha.toUpperCase() }), '--apply']).status).toBe(0);
            expect((await state(dbPath)).reviews[0].payload_sha256).toBe(sha);
        });

        it('refuses to decide a submission that is not pending (dry run and --apply)', async () => {
            const { dbPath } = fixture();
            const sha = shownDigest(dbPath, 3);
            const before = await state(dbPath);
            for (const extra of [[], ['--apply']]) {
                const res = cli([...decisionArgs(dbPath, { id: '3', sha }), ...extra]);
                expect(res.status).toBe(1);
                expect(res.stderr).toMatch(/submission 3 is rejected, not pending/);
            }
            expect(await state(dbPath)).toEqual(before);
        });

        it('a replayed or contradicting decision fails closed and keeps the first audit row', async () => {
            const { dbPath } = fixture();
            const sha = shownDigest(dbPath, 1);
            expect(cli([...decisionArgs(dbPath, { sha }), '--apply']).status).toBe(0);
            const after = await state(dbPath);

            const replay = cli([...decisionArgs(dbPath, { sha }), '--apply']);
            expect(replay.status).toBe(1);
            expect(replay.stderr).toMatch(/submission 1 is approved, not pending/);
            const flip = cli([...decisionArgs(dbPath, { command: 'reject', sha, reviewer: 'op-bob' }), '--apply']);
            expect(flip.status).toBe(1);
            expect(await state(dbPath)).toEqual(after);
        });

        it('unknown id with --apply writes nothing', async () => {
            const { dbPath } = fixture();
            const before = await state(dbPath);
            const res = cli([...decisionArgs(dbPath, { id: '99', sha: 'a'.repeat(64) }), '--apply']);
            expect(res.status).toBe(1);
            expect(res.stderr).toMatch(/submission 99 not found/);
            expect(await state(dbPath)).toEqual(before);
        });
    });

    describe('atomicity', () => {
        it('a failure after the audit insert rolls back both writes and leaves the DB usable', async () => {
            const { dbPath } = fixture();
            const sha = shownDigest(dbPath, 1);
            // Test-only fault injection: the status UPDATE (which runs after the audit INSERT) aborts.
            await withDb(dbPath, (db) => exec(db, `
                CREATE TRIGGER inject_status_failure BEFORE UPDATE OF status ON shop_submissions
                BEGIN SELECT RAISE(ABORT, 'injected status failure'); END;`));
            const before = await withDb(dbPath, async (db) => ({
                submissions: await all(db, 'SELECT * FROM shop_submissions ORDER BY id'),
                reviews: await all(db, 'SELECT * FROM submission_reviews'),
                published: await all(db, PUBLISHED_SQL),
            }));

            const res = cli([...decisionArgs(dbPath, { sha }), '--apply']);
            expect(res.status).toBe(1);
            expect(res.stderr).toMatch(/injected status failure/);
            expect(res.stdout).toBe('');

            await withDb(dbPath, async (db) => {
                expect(await all(db, 'SELECT * FROM shop_submissions ORDER BY id')).toEqual(before.submissions);
                expect(await all(db, 'SELECT * FROM submission_reviews')).toEqual([]);
                expect(await all(db, PUBLISHED_SQL)).toEqual(before.published);
                await exec(db, 'DROP TRIGGER inject_status_failure');
            });
            expect(fs.existsSync(`${dbPath}-journal`)).toBe(false);

            // The same reviewed decision succeeds once the fault is gone.
            expect(cli([...decisionArgs(dbPath, { sha }), '--apply']).status).toBe(0);
            expect(await withDb(dbPath, (db) => all(db, 'SELECT submission_id FROM submission_reviews'))).toEqual([{ submission_id: 1 }]);
        });
    });

    describe('concurrency', () => {
        it('racing approve/reject processes: exactly one decision lands, the rest fail closed', async () => {
            const { dbPath } = fixture();
            const sha = shownDigest(dbPath, 1);
            const published = await withDb(dbPath, (db) => all(db, PUBLISHED_SQL));
            const racers = Array.from({ length: 8 }, (_, i) => cliAsync([
                ...decisionArgs(dbPath, { command: i % 2 ? 'reject' : 'approve', sha, reviewer: `op-${i}` }), '--apply',
            ]));
            const results = await Promise.all(racers);

            const winners = results.filter((r) => r.status === 0);
            const losers = results.filter((r) => r.status !== 0);
            expect(winners).toHaveLength(1);
            expect(losers).toHaveLength(7);
            for (const loser of losers) {
                expect(loser.status).toBe(1);
                expect(loser.stderr).toMatch(/submission 1 is (approved|rejected), not pending/);
            }

            const won = JSON.parse(winners[0].stdout);
            await withDb(dbPath, async (db) => {
                expect(await all(db, 'SELECT submission_id, new_status, reviewer FROM submission_reviews'))
                    .toEqual([{ submission_id: 1, new_status: won.newStatus, reviewer: won.reviewer }]);
                expect(await all(db, 'SELECT status FROM shop_submissions WHERE id = 1')).toEqual([{ status: won.newStatus }]);
                expect(await all(db, PUBLISHED_SQL)).toEqual(published);
            });
        });
    });

    describe('retention', () => {
        it('decisions and audit survive close/reopen, a no-op migrate up, and a file copy', async () => {
            const { dir, dbPath } = fixture();
            const sha1 = shownDigest(dbPath, 1);
            const sha2 = shownDigest(dbPath, 2);
            expect(cli([...decisionArgs(dbPath, { sha: sha1 }), '--apply']).status).toBe(0);
            expect(cli([...decisionArgs(dbPath, { command: 'reject', id: '2', sha: sha2, reviewer: 'op-bob', reason: 'spam' }), '--apply']).status).toBe(0);

            const audit = await withDb(dbPath, (db) => all(db, 'SELECT * FROM submission_reviews ORDER BY submission_id'));
            expect(audit.map((r) => [r.submission_id, r.new_status, r.reviewer, r.reason, r.payload_sha256]))
                .toEqual([[1, 'approved', 'op-alice', 'checked listing', sha1], [2, 'rejected', 'op-bob', 'spam', sha2]]);

            const migrated = execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'migrate.js'), 'up'], {
                cwd: ROOT, env: { ...process.env, DB_PATH: dbPath }, encoding: 'utf8',
            });
            expect(migrated).toMatch(/No pending migrations/);

            const copy = path.join(dir, 'restarted.db');
            fs.copyFileSync(dbPath, copy);
            for (const file of [dbPath, copy]) {
                expect(await withDb(file, (db) => all(db, 'SELECT * FROM submission_reviews ORDER BY submission_id'))).toEqual(audit);
                expect(JSON.parse(cli(['--db', file, 'list', '--status', 'approved']).stdout).submissions.map((s) => s.id)).toEqual([1]);
                expect(JSON.parse(cli(['--db', file, 'list', '--status', 'rejected']).stdout).submissions.map((s) => s.id)).toEqual([3, 2]);
                const shown = JSON.parse(cli(['--db', file, 'show', '2']).stdout);
                expect(shown.review).toEqual({
                    oldStatus: 'pending', newStatus: 'rejected', reviewer: 'op-bob', reason: 'spam',
                    payloadSha256: sha2, decidedAt: audit[1].decided_at,
                });
                expect(shown.payloadSha256).toBe(sha2);
            }
        });
    });

    describe('scope guard', () => {
        function filesUnder(dir) {
            return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (
                e.isDirectory() ? filesUnder(path.join(dir, e.name)) : [path.join(dir, e.name)]));
        }

        it('no runtime code under src/ references the review CLI or the audit table (operator-only, never HTTP)', () => {
            const offenders = filesUnder(path.join(ROOT, 'src'))
                .filter((f) => /review-submissions|submission_reviews/.test(fs.readFileSync(f, 'utf8')));
            expect(offenders).toEqual([]);
        });
    });
});
