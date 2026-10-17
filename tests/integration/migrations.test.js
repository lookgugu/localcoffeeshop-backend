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
const NEW_MIGRATIONS = ['20261017_01_create_shop_submissions.sql', '20261017_02_idempotency_request_hash.sql'];

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

async function publishedDigest(dbPath) {
    return withDb(dbPath, async (db) => {
        const rows = await all(db, 'SELECT id, name, address, price_level, language_code, source_file, created_at, state FROM coffee_shops ORDER BY id');
        return { count: rows.length, hash: crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex') };
    });
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
    });

    it('existing database (copy of data/coffee_shops.db): additive only, published rows unchanged, reapply is a no-op', async () => {
        const dbPath = path.join(tmp, 'existing.db');
        fs.copyFileSync(TRACKED_DB, dbPath);
        const before = await publishedDigest(dbPath);
        const appliedBefore = await appliedMigrations(dbPath);
        expect(appliedBefore).not.toEqual(expect.arrayContaining(NEW_MIGRATIONS));

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

    describe('forward-only: `down` is refused and retains ledger, queued proposals and fingerprints', () => {
        const FINGERPRINT = 'a'.repeat(64);

        async function seedRetainedData(dbPath, { withFingerprint }) {
            await withDb(dbPath, (db) => exec(db, `
                INSERT INTO shop_submissions (kind, name, address, state, status, created_at)
                VALUES ('create', 'Queued Proposal', '1 Keep St', 'CA', 'pending', 1);
                INSERT INTO idempotency_keys (key, endpoint, status_code, response, created_at, status${withFingerprint ? ', request_hash' : ''})
                VALUES ('retained-key', 'POST /coffee-shops', 202, '{}', 1, 'completed'${withFingerprint ? `, '${FINGERPRINT}'` : ''});`));
        }

        async function snapshot(dbPath) {
            return withDb(dbPath, async (db) => ({
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

        it('20261017_02 (latest): down refused; request_hash values, queue rows and ledger intact; up is a no-op', async () => {
            const dbPath = path.join(tmp, 'retain-02.db');
            fs.copyFileSync(path.join(tmp, 'existing.db'), dbPath);
            await seedRetainedData(dbPath, { withFingerprint: true });
            const before = await snapshot(dbPath);

            expect(migrateExpectingRefusal(dbPath)).toMatch(/No down migration found in 20261017_02_idempotency_request_hash\.sql/);
            expect(await snapshot(dbPath)).toEqual(before);
            expect(before.keys.find((k) => k.key === 'retained-key').request_hash).toBe(FINGERPRINT);

            expect(migrate(dbPath, 'up')).toMatch(/No pending migrations/);
            expect(await snapshot(dbPath)).toEqual(before);
        });

        it('20261017_01 (latest applied): down refused; queued proposals and ledger intact; up then applies only 02', async () => {
            const dbPath = path.join(tmp, 'retain-01.db');
            fs.copyFileSync(path.join(tmp, 'existing.db'), dbPath);
            // Test setup only: put this throw-away copy in the state "01 applied, 02 not yet".
            await withDb(dbPath, (db) => exec(db, `
                DELETE FROM migrations WHERE name = '20261017_02_idempotency_request_hash.sql';
                ALTER TABLE idempotency_keys DROP COLUMN request_hash;`));
            await seedRetainedData(dbPath, { withFingerprint: false });
            const before = await snapshot(dbPath);
            expect(before.ledger.map((r) => r.name)).toContain('20261017_01_create_shop_submissions.sql');

            expect(migrateExpectingRefusal(dbPath)).toMatch(/No down migration found in 20261017_01_create_shop_submissions\.sql/);
            expect(await snapshot(dbPath)).toEqual(before);

            migrate(dbPath, 'up');
            const after = await snapshot(dbPath);
            expect(after.ledger.map((r) => r.name)).toEqual([...before.ledger.map((r) => r.name), '20261017_02_idempotency_request_hash.sql'].sort());
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
