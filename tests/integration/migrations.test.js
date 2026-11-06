/**
 * Integration Tests — migrations via the real scripts/migrate.js
 *
 * Runs the migration CLI as a child process against throw-away databases
 * under os.tmpdir() (honours TMPDIR). Never touches data/coffee_shops.db
 * except to copy it, and asserts the tracked file is byte-identical after.
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const sqlite3 = require('sqlite3');

const ROOT = path.join(__dirname, '..', '..');
const TRACKED_DB = path.join(ROOT, 'data', 'coffee_shops.db');
const REVIEWS_MIGRATION = '20261017_03_create_submission_reviews.sql';
const DEDUP_MIGRATION = '20261030_01_remove_duplicate_listings.sql';
const CLEANUP_MIGRATION = '20261030_02_remove_non_coffee_listings.sql';
const NEW_MIGRATIONS = [
    '20261017_01_create_shop_submissions.sql',
    '20261017_02_idempotency_request_hash.sql',
    REVIEWS_MIGRATION,
    DEDUP_MIGRATION,
    CLEANUP_MIGRATION,
];
// Test setup only: rewind a throw-away copy to the state before 20261017_03.
const REWIND_03 = `
    DROP TRIGGER submission_reviews_append_only_update;
    DROP TRIGGER submission_reviews_append_only_delete;
    DROP TABLE submission_reviews;
    DELETE FROM migrations WHERE name = '${REVIEWS_MIGRATION}';`;

/** The (id, name, address) rows CLEANUP_MIGRATION deletes, parsed from its VALUES list. */
function removedListings() {
    const sql = fs.readFileSync(path.join(ROOT, 'migrations', CLEANUP_MIGRATION), 'utf8');
    const sqlString = "'((?:[^']|'')*)'";
    const tuple = new RegExp(`^\\s*\\((\\d+), ${sqlString}, ${sqlString}\\),?(?: --.*)?$`, 'gm');
    return [...sql.matchAll(tuple)].map(([, id, name, address]) => ({
        id: Number(id), name: name.replace(/''/g, "'"), address: address.replace(/''/g, "'"),
    }));
}

function sha256File(file) {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function migrate(dbPath, command) {
    return execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'migrate.js'), command], {
        cwd: ROOT,
        env: { ...process.env, DB_PATH: dbPath },
        encoding: 'utf8',
    });
}

function withDb(dbPath, fn) {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(dbPath, (err) => {
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

async function schemaOf(dbPath) {
    return withDb(dbPath, (db) => all(db, "SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name"));
}

async function columns(dbPath, table) {
    return withDb(dbPath, async (db) => (await all(db, `PRAGMA table_info(${table})`)).map((c) => c.name));
}

async function appliedMigrations(dbPath) {
    return withDb(dbPath, async (db) => (await all(db, 'SELECT name FROM migrations ORDER BY name')).map((r) => r.name));
}

async function publishedRows(dbPath) {
    return withDb(dbPath, (db) => all(db, 'SELECT id, name, address, price_level, language_code, source_file, created_at, state FROM coffee_shops ORDER BY id'));
}

function digest(rows) {
    return { count: rows.length, hash: crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex') };
}

async function publishedDigest(dbPath) {
    return digest(await publishedRows(dbPath));
}

/** Test setup only: forget the migrations named after `name`, as if `name` were the latest applied. */
async function asIfLatest(dbPath, name) {
    await withDb(dbPath, (db) => all(db, 'DELETE FROM migrations WHERE name > ?', [name]));
}

describe('Migrations (scripts/migrate.js)', () => {
    let tmp;
    let trackedHashBefore;

    beforeAll(() => {
        trackedHashBefore = sha256File(TRACKED_DB);
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lcs-migrations-'));
    });

    afterAll(() => {
        fs.rmSync(tmp, { recursive: true, force: true });
        expect(sha256File(TRACKED_DB)).toBe(trackedHashBefore);
    });

    it('fresh database (base coffee_shops schema only): applies every migration', async () => {
        const dbPath = path.join(tmp, 'fresh.db');
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

        migrate(dbPath, 'up');

        const files = fs.readdirSync(path.join(ROOT, 'migrations')).filter((f) => f.endsWith('.sql')).sort();
        expect(await appliedMigrations(dbPath)).toEqual(files);
        expect(await columns(dbPath, 'shop_submissions')).toEqual(expect.arrayContaining([
            'id', 'kind', 'target_shop_id', 'name', 'address', 'state', 'price_level',
            'phone_number', 'website', 'description', 'language_code', 'status', 'created_at',
        ]));
        expect(await columns(dbPath, 'idempotency_keys')).toContain('request_hash');
        expect(await columns(dbPath, 'submission_reviews')).toEqual([
            'id', 'submission_id', 'old_status', 'new_status', 'reviewer', 'reason', 'payload_sha256', 'decided_at',
        ]);
    });

    it('existing database (copy of data/coffee_shops.db): removes only duplicate copies and the listed non-coffee listings, reapply is a no-op', async () => {
        const dbPath = path.join(tmp, 'existing.db');
        fs.copyFileSync(TRACKED_DB, dbPath);
        const rowsBefore = await publishedRows(dbPath);
        const appliedBefore = await appliedMigrations(dbPath);
        expect(appliedBefore).not.toEqual(expect.arrayContaining(NEW_MIGRATIONS));

        // Dedup keeps the lowest id of each (name, address) group.
        const kept = new Map();
        for (const r of rowsBefore) {
            const key = `${r.name.toLowerCase()}\u0000${r.address}`;
            if (!kept.has(key) || r.id < kept.get(key).id) kept.set(key, r);
        }
        // Every listing the cleanup names is a kept row, exactly as matched, so none is a silent no-op.
        const removed = removedListings();
        expect(removed.length).toBeGreaterThan(1000);
        expect(removed).toContainEqual({ id: 27841, name: 'Woods Hill Table', address: '24 Commonwealth Ave, Concord, MA 01742, USA' });
        const keptById = new Map([...kept.values()].map((r) => [r.id, r]));
        for (const listing of removed) {
            expect(keptById.get(listing.id)).toEqual(expect.objectContaining(listing));
        }
        const removedIds = new Set(removed.map((l) => l.id));
        const before = digest(rowsBefore.filter((r) => keptById.has(r.id) && !removedIds.has(r.id)));

        migrate(dbPath, 'up');

        expect(await publishedDigest(dbPath)).toEqual(before);
        expect(await appliedMigrations(dbPath)).toEqual(expect.arrayContaining([...appliedBefore, ...NEW_MIGRATIONS]));
        const schemaAfterFirst = await schemaOf(dbPath);

        const second = migrate(dbPath, 'up');
        expect(second).toMatch(/No pending migrations/);
        expect(await schemaOf(dbPath)).toEqual(schemaAfterFirst);
        expect(await publishedDigest(dbPath)).toEqual(before);
    });

    it('CHECK constraints in the shipped DDL reject out-of-bounds rows even if app validation regressed', async () => {
        const dbPath = path.join(tmp, 'existing.db');
        await withDb(dbPath, async (db) => {
            const bad = [
                ["'create'", 'NULL', `'${'n'.repeat(201)}'`, "'1 St'", "'CA'", 'NULL'],
                ["'create'", 'NULL', "'ok'", "'1 St'", "'CAL'", 'NULL'],
                ["'create'", 'NULL', "'ok'", "'1 St'", "'CA'", "'PRICE_LEVEL_FREE'"],
                ["'publish'", 'NULL', "'ok'", "'1 St'", "'CA'", 'NULL'],
                ["'update'", 'NULL', "'ok'", "'1 St'", "'CA'", 'NULL'],
                ["'create'", '5', "'ok'", "'1 St'", "'CA'", 'NULL'],
            ];
            for (const [kind, target, name, address, state, price] of bad) {
                await expect(exec(db, `INSERT INTO shop_submissions (kind, target_shop_id, name, address, state, price_level, created_at)
                                       VALUES (${kind}, ${target}, ${name}, ${address}, ${state}, ${price}, 0)`))
                    .rejects.toThrow(/CHECK constraint failed/);
            }
        });
    });

    it('submission_reviews: CHECK, UNIQUE and append-only triggers reject invalid or altered audit rows', async () => {
        const dbPath = path.join(tmp, 'audit-checks.db');
        fs.copyFileSync(path.join(tmp, 'existing.db'), dbPath);
        const SHA = 'b'.repeat(64);
        await withDb(dbPath, async (db) => {
            await exec(db, `INSERT INTO shop_submissions (id, kind, name, address, state, status, created_at)
                            VALUES (7, 'create', 'P', '1 St', 'CA', 'pending', 1);`);
            const insert = (cols) => exec(db, `INSERT INTO submission_reviews
                (submission_id, old_status, new_status, reviewer, reason, payload_sha256, decided_at)
                VALUES (${cols.join(', ')})`);
            const good = ['7', "'pending'", "'approved'", "'op'", "'ok'", `'${SHA}'`, '1'];
            const bad = [
                ['7', "'approved'", "'rejected'", "'op'", "'ok'", `'${SHA}'`, '1'],
                ['7', "'pending'", "'pending'", "'op'", "'ok'", `'${SHA}'`, '1'],
                ['7', "'pending'", "'published'", "'op'", "'ok'", `'${SHA}'`, '1'],
                ['7', "'pending'", "'approved'", "''", "'ok'", `'${SHA}'`, '1'],
                ['7', "'pending'", "'approved'", `'${'r'.repeat(65)}'`, "'ok'", `'${SHA}'`, '1'],
                ['7', "'pending'", "'approved'", "'op'", "''", `'${SHA}'`, '1'],
                ['7', "'pending'", "'approved'", "'op'", `'${'x'.repeat(501)}'`, `'${SHA}'`, '1'],
                ['7', "'pending'", "'approved'", "'op'", "'ok'", "'abc'", '1'],
                ['7', "'pending'", "'approved'", "'op'", "'ok'", `'${'G'.repeat(64)}'`, '1'],
                ['7', "'pending'", "'approved'", "'op'", "'ok'", `'${SHA}'`, 'NULL'],
            ];
            for (const cols of bad) {
                await expect(insert(cols)).rejects.toThrow(/CHECK constraint failed|NOT NULL constraint failed/);
            }
            await insert(good);
            await expect(insert(good)).rejects.toThrow(/UNIQUE constraint failed/);
            await expect(exec(db, "UPDATE submission_reviews SET reason = 'edited'")).rejects.toThrow(/append-only/);
            await expect(exec(db, 'DELETE FROM submission_reviews')).rejects.toThrow(/append-only/);
            expect(await all(db, 'SELECT reason FROM submission_reviews')).toEqual([{ reason: 'ok' }]);
        });
    });

    describe('forward-only: `down` is refused and retains ledger, queued proposals and fingerprints', () => {
        const FINGERPRINT = 'a'.repeat(64);

        async function seedRetainedData(dbPath, { withFingerprint }) {
            await withDb(dbPath, (db) => exec(db, `
                INSERT INTO shop_submissions (kind, name, address, state, status, created_at)
                VALUES ('create', 'Queued Proposal', '1 Keep St', 'CA', 'pending', 1),
                       ('create', 'Reviewed Proposal', '2 Keep St', 'CA', 'rejected', 2);
                INSERT INTO idempotency_keys (key, endpoint, status_code, response, created_at, status${withFingerprint ? ', request_hash' : ''})
                VALUES ('retained-key', 'POST /coffee-shops', 202, '{}', 1, 'completed'${withFingerprint ? `, '${FINGERPRINT}'` : ''});`));
        }

        async function snapshot(dbPath) {
            return withDb(dbPath, async (db) => ({
                reviews: (await all(db, "SELECT name FROM sqlite_master WHERE name = 'submission_reviews'")).length
                    ? await all(db, 'SELECT * FROM submission_reviews ORDER BY id') : null,
                ledger: await all(db, 'SELECT name FROM migrations ORDER BY name'),
                submissions: await all(db, 'SELECT * FROM shop_submissions ORDER BY id'),
                keys: await all(db, 'SELECT * FROM idempotency_keys ORDER BY key'),
                schema: await all(db, "SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name"),
            }));
        }

        function migrateExpectingRefusal(dbPath) {
            let failure;
            try {
                migrate(dbPath, 'down');
            } catch (err) {
                failure = err;
            }
            expect(failure).toBeDefined();
            expect(failure.status).not.toBe(0);
            return `${failure.stdout}${failure.stderr}`;
        }

        it('20261017_03 (latest applied): down refused; audit rows, queue rows, fingerprints and ledger intact; up then applies only what follows', async () => {
            const dbPath = path.join(tmp, 'retain-03.db');
            fs.copyFileSync(path.join(tmp, 'existing.db'), dbPath);
            await asIfLatest(dbPath, REVIEWS_MIGRATION);
            await seedRetainedData(dbPath, { withFingerprint: true });
            await withDb(dbPath, (db) => exec(db, `
                INSERT INTO submission_reviews (submission_id, old_status, new_status, reviewer, reason, payload_sha256, decided_at)
                SELECT id, 'pending', 'rejected', 'op-1', 'duplicate listing', '${'c'.repeat(64)}', 3
                FROM shop_submissions WHERE name = 'Reviewed Proposal';`));
            const before = await snapshot(dbPath);
            expect(before.reviews).toHaveLength(1);

            expect(migrateExpectingRefusal(dbPath)).toMatch(/No down migration found in 20261017_03_create_submission_reviews\.sql/);
            expect(await snapshot(dbPath)).toEqual(before);

            migrate(dbPath, 'up');
            const after = await snapshot(dbPath);
            expect(after.ledger.map((r) => r.name)).toEqual([...before.ledger.map((r) => r.name), DEDUP_MIGRATION, CLEANUP_MIGRATION].sort());
            expect({ ...after, ledger: before.ledger }).toEqual(before);
            expect(migrate(dbPath, 'up')).toMatch(/No pending migrations/);
        });

        it('20261017_02 (latest applied): down refused; request_hash values, queue rows and ledger intact; up then applies only what follows', async () => {
            const dbPath = path.join(tmp, 'retain-02.db');
            fs.copyFileSync(path.join(tmp, 'existing.db'), dbPath);
            await asIfLatest(dbPath, '20261017_02_idempotency_request_hash.sql');
            await withDb(dbPath, (db) => exec(db, REWIND_03));
            await seedRetainedData(dbPath, { withFingerprint: true });
            const before = await snapshot(dbPath);
            expect(before.reviews).toBeNull();

            expect(migrateExpectingRefusal(dbPath)).toMatch(/No down migration found in 20261017_02_idempotency_request_hash\.sql/);
            expect(await snapshot(dbPath)).toEqual(before);
            expect(before.keys.find((k) => k.key === 'retained-key').request_hash).toBe(FINGERPRINT);

            // Only 03 and the later cleanup migrations are pending; reapplying them removes nothing more.
            migrate(dbPath, 'up');
            const after = await snapshot(dbPath);
            expect(after.ledger.map((r) => r.name)).toEqual([
                ...before.ledger.map((r) => r.name), REVIEWS_MIGRATION, DEDUP_MIGRATION, CLEANUP_MIGRATION,
            ].sort());
            expect(after.submissions).toEqual(before.submissions);
            expect(after.keys).toEqual(before.keys);
            expect(after.reviews).toEqual([]);
            expect(migrate(dbPath, 'up')).toMatch(/No pending migrations/);
        });

        it('20261017_01 (latest applied): down refused; queued proposals and ledger intact; up then applies only what follows', async () => {
            const dbPath = path.join(tmp, 'retain-01.db');
            fs.copyFileSync(path.join(tmp, 'existing.db'), dbPath);
            // Test setup only: put this throw-away copy in the state "01 applied, 02 not yet".
            await asIfLatest(dbPath, '20261017_01_create_shop_submissions.sql');
            await withDb(dbPath, (db) => exec(db, `${REWIND_03}
                ALTER TABLE idempotency_keys DROP COLUMN request_hash;`));
            await seedRetainedData(dbPath, { withFingerprint: false });
            const before = await snapshot(dbPath);
            expect(before.ledger.map((r) => r.name)).toContain('20261017_01_create_shop_submissions.sql');

            expect(migrateExpectingRefusal(dbPath)).toMatch(/No down migration found in 20261017_01_create_shop_submissions\.sql/);
            expect(await snapshot(dbPath)).toEqual(before);

            migrate(dbPath, 'up');
            const after = await snapshot(dbPath);
            expect(after.ledger.map((r) => r.name)).toEqual([
                ...before.ledger.map((r) => r.name), '20261017_02_idempotency_request_hash.sql', REVIEWS_MIGRATION, DEDUP_MIGRATION, CLEANUP_MIGRATION,
            ].sort());
            expect(after.submissions).toEqual(before.submissions);
            expect(await columns(dbPath, 'idempotency_keys')).toContain('request_hash');
            expect(migrate(dbPath, 'up')).toMatch(/No pending migrations/);
        });

        it.each(NEW_MIGRATIONS)('%s has no migration:down section', (file) => {
            const content = fs.readFileSync(path.join(ROOT, 'migrations', file), 'utf8');
            expect(content).not.toMatch(/-- migration:down/i);
            expect(content).not.toMatch(/\bDROP\s+(TABLE|COLUMN|INDEX)\b/i);
        });
    });
});
