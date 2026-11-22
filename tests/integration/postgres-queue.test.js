/**
 * Integration Tests — Postgres submission queue
 *
 * Against a real Postgres (see tests/helpers/pgTestDb.js):
 *   - migration runner: fresh apply, idempotent re-run, edited-file refusal,
 *     failed-migration rollback, concurrent runners
 *   - least privilege: lcs_app cannot decide or read the audit; lcs_reviewer
 *     can change only status and append to the audit
 *   - triggers: content immutable, status pending → approved|rejected only,
 *     audit append-only
 *   - HTTP: POST /coffee-shops with the Postgres store end to end
 *   - startQueueStore: ready with Postgres, 503 (not a crash) without it
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const pino = require('pino');

const { describePg, createPgTestDatabase, poolAsRole } = require('../helpers/pgTestDb');
const { createTestDatabase, closeDatabase } = require('../helpers/testDb');
const { startTestServer, stopTestServer } = require('../helpers/testServer');
const { migratePostgres, MIGRATIONS_DIR } = require('../../src/queue/postgres-migrate');
const { makePostgresQueueStore } = require('../../src/queue/postgres-store');
const { startQueueStore } = require('../../src/queue');

const silent = pino({ level: 'silent' });

function insertSubmission(pool, name = 'Beans') {
    return pool.query(
        `INSERT INTO shop_submissions (kind, name, address, state, created_at)
         VALUES ('create', $1, '1 Main St', 'TX', 1000) RETURNING id`,
        [name],
    ).then(({ rows }) => Number(rows[0].id));
}

describePg('Postgres submission queue', () => {
    describe('migration runner', () => {
        let pg;
        let tmp;

        beforeEach(async () => {
            pg = await createPgTestDatabase();
            tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pgmig-'));
        });

        afterEach(async () => {
            fs.rmSync(tmp, { recursive: true, force: true });
            await pg.drop();
        });

        it('applies every shipped migration once; a re-run is a no-op', async () => {
            const shipped = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
            expect(shipped.length).toBeGreaterThan(0);

            expect(await migratePostgres(pg.pool)).toEqual({ applied: shipped, skipped: [] });
            expect(await migratePostgres(pg.pool)).toEqual({ applied: [], skipped: shipped });

            const { rows } = await pg.pool.query(
                "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY 1",
            );
            expect(rows.map((r) => r.table_name)).toEqual(
                ['idempotency_keys', 'schema_migrations', 'shop_submissions', 'submission_reviews'],
            );
        });

        it('concurrent runners apply each migration exactly once', async () => {
            const results = await Promise.all([migratePostgres(pg.pool), migratePostgres(pg.pool), migratePostgres(pg.pool)]);
            const appliedCounts = results.map((r) => r.applied.length);
            expect(appliedCounts.filter((n) => n > 0)).toHaveLength(1);
            const { rows } = await pg.pool.query('SELECT COUNT(*)::int AS n FROM schema_migrations');
            expect(rows[0].n).toBe(fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).length);
        });

        it('refuses a migration edited after it was applied', async () => {
            fs.writeFileSync(path.join(tmp, '001_a.sql'), 'CREATE TABLE a (id int);');
            await migratePostgres(pg.pool, { dir: tmp });
            fs.writeFileSync(path.join(tmp, '001_a.sql'), 'CREATE TABLE a (id bigint);');
            await expect(migratePostgres(pg.pool, { dir: tmp })).rejects.toThrow(/001_a\.sql was modified/);
        });

        it('rolls back a failing migration completely and records nothing', async () => {
            fs.writeFileSync(path.join(tmp, '001_ok.sql'), 'CREATE TABLE ok (id int);');
            fs.writeFileSync(path.join(tmp, '002_bad.sql'), 'CREATE TABLE half (id int); SELECT no_such_function();');
            await expect(migratePostgres(pg.pool, { dir: tmp })).rejects.toThrow(/002_bad\.sql failed/);

            const { rows } = await pg.pool.query('SELECT name FROM schema_migrations ORDER BY name');
            expect(rows.map((r) => r.name)).toEqual(['001_ok.sql']);
            const half = await pg.pool.query("SELECT to_regclass('public.half') AS t");
            expect(half.rows[0].t).toBeNull();
        });
    });

    describe('roles and triggers', () => {
        let pg;
        let app;
        let reviewer;

        beforeAll(async () => {
            pg = await createPgTestDatabase();
            await migratePostgres(pg.pool);
            app = poolAsRole(pg.url, 'lcs_app');
            reviewer = poolAsRole(pg.url, 'lcs_reviewer');
        });

        afterAll(async () => {
            await app.end();
            await reviewer.end();
            await pg.drop();
        });

        const review = (id, status = 'approved') => [
            `INSERT INTO submission_reviews
                (submission_id, old_status, new_status, reviewer, reason, payload_sha256, decided_at)
             VALUES ($1, 'pending', $2, 'tester', 'looks right', $3, 2000)`,
            [id, status, 'c'.repeat(64)],
        ];

        it('lcs_app can enqueue and count, but cannot decide, delete or touch the audit', async () => {
            const id = await insertSubmission(app);
            await expect(app.query('SELECT COUNT(*) FROM shop_submissions')).resolves.toBeDefined();
            await expect(app.query("UPDATE shop_submissions SET status = 'approved' WHERE id = $1", [id]))
                .rejects.toThrow(/permission denied/);
            await expect(app.query('DELETE FROM shop_submissions WHERE id = $1', [id]))
                .rejects.toThrow(/permission denied/);
            await expect(app.query('SELECT * FROM submission_reviews')).rejects.toThrow(/permission denied/);
            await expect(app.query(...review(id))).rejects.toThrow(/permission denied/);
        });

        it('no one can insert a submission that is already decided (status must start pending)', async () => {
            for (const pool of [app, pg.pool]) {
                for (const status of ['approved', 'rejected']) {
                    await expect(pool.query(
                        `INSERT INTO shop_submissions (kind, name, address, state, status, created_at)
                         VALUES ('create', 'Sneaky', '1 Main St', 'TX', $1, 1000)`,
                        [status],
                    )).rejects.toThrow(/must be inserted as pending/);
                }
            }
            const { rows } = await pg.pool.query("SELECT COUNT(*)::int AS n FROM shop_submissions WHERE name = 'Sneaky'");
            expect(rows[0].n).toBe(0);
        });

        it('lcs_reviewer can approve and audit, but cannot edit content or enqueue', async () => {
            const id = await insertSubmission(pg.pool);
            await reviewer.query(...review(id));
            await reviewer.query("UPDATE shop_submissions SET status = 'approved' WHERE id = $1", [id]);

            await expect(reviewer.query("UPDATE shop_submissions SET name = 'Edited' WHERE id = $1", [id]))
                .rejects.toThrow(/permission denied/);
            await expect(insertSubmission(reviewer)).rejects.toThrow(/permission denied/);
            await expect(reviewer.query('SELECT * FROM idempotency_keys')).rejects.toThrow(/permission denied/);
        });

        it('submission content is immutable and status only moves out of pending, whoever updates', async () => {
            const id = await insertSubmission(pg.pool);
            await expect(pg.pool.query("UPDATE shop_submissions SET name = 'Edited' WHERE id = $1", [id]))
                .rejects.toThrow(/content is immutable/);
            await expect(pg.pool.query("UPDATE shop_submissions SET status = 'pending' WHERE id = $1", [id]))
                .rejects.toThrow(/may only move from pending/);

            await pg.pool.query("UPDATE shop_submissions SET status = 'rejected' WHERE id = $1", [id]);
            await expect(pg.pool.query("UPDATE shop_submissions SET status = 'approved' WHERE id = $1", [id]))
                .rejects.toThrow(/may only move from pending/);
        });

        it('the review audit is append-only and one decision per submission', async () => {
            const id = await insertSubmission(pg.pool);
            await pg.pool.query(...review(id));
            await expect(pg.pool.query(...review(id, 'rejected'))).rejects.toThrow(/duplicate key/);
            await expect(pg.pool.query("UPDATE submission_reviews SET reason = 'x'")).rejects.toThrow(/append-only/);
            await expect(pg.pool.query('DELETE FROM submission_reviews')).rejects.toThrow(/append-only/);
        });

        it('isHealthy is false for a login without the lcs_app grants (missing GRANT shows in /health)', async () => {
            await pg.pool.query(`DO $$ BEGIN
                IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lcs_test_no_grants') THEN
                    CREATE ROLE lcs_test_no_grants NOLOGIN;
                END IF; END $$`);
            const bare = poolAsRole(pg.url, 'lcs_test_no_grants');
            try {
                expect(await makePostgresQueueStore(bare).isHealthy()).toBe(false);
                expect(await makePostgresQueueStore(app).isHealthy()).toBe(true);
                expect(await makePostgresQueueStore(reviewer).isHealthy()).toBe(false);
            } finally {
                await bare.end();
            }
        });

        it('CHECK constraints mirror the route validation', async () => {
            await expect(pg.pool.query(
                `INSERT INTO shop_submissions (kind, name, address, state, created_at)
                 VALUES ('create', '', '1 Main St', 'TX', 1)`,
            )).rejects.toThrow(/check constraint/);
            await expect(pg.pool.query(
                `INSERT INTO shop_submissions (kind, target_shop_id, name, address, state, created_at)
                 VALUES ('update', NULL, 'x', '1 Main St', 'TX', 1)`,
            )).rejects.toThrow(/check constraint/);
            await expect(pg.pool.query(
                `INSERT INTO idempotency_keys (key, endpoint, status, status_code, response, request_hash, created_at)
                 VALUES ('bad key', 'POST /x', 'pending', 0, '', $1, 1)`,
                ['a'.repeat(64)],
            )).rejects.toThrow(/check constraint/);
        });
    });

    describe('POST /coffee-shops with the Postgres store', () => {
        let pg;
        let appPool;
        let sqlite;
        let baseURL;

        const payload = (name = 'Durable Beans') => ({
            shop: {
                displayName: { text: name },
                formattedAddress: '1 Main St, Austin, Texas 78701',
                state: 'TX',
                priceLevel: 'PRICE_LEVEL_MODERATE',
            },
        });

        beforeAll(async () => {
            pg = await createPgTestDatabase();
            await migratePostgres(pg.pool);
            appPool = poolAsRole(pg.url, 'lcs_app');
            const queueStore = Object.assign(makePostgresQueueStore(appPool), { ready: true });
            sqlite = await createTestDatabase();
            const info = await startTestServer(sqlite, {
                env: { WRITE_RATE_LIMIT_MAX: '1000' },
                deps: { queueStore },
            });
            baseURL = info.url;
        });

        afterAll(async () => {
            await stopTestServer();
            await closeDatabase(sqlite);
            await appPool.end();
            await pg.drop();
        });

        it('queues the proposal in Postgres and replays a retry without a second row', async () => {
            const key = 'pg-e2e-1';
            const first = await request(baseURL).post('/api/v1/coffee-shops').set('Idempotency-Key', key).send(payload());
            expect(first.status).toBe(202);
            expect(first.body.data.status).toBe('pending_review');

            // Completion is written after the response; let it land.
            await new Promise((r) => setTimeout(r, 100));
            const retry = await request(baseURL).post('/api/v1/coffee-shops').set('Idempotency-Key', key).send(payload());
            expect(retry.status).toBe(202);
            expect(retry.headers['idempotent-replay']).toBe('true');
            expect(retry.body).toEqual(first.body);

            const { rows } = await pg.pool.query('SELECT id, name, status FROM shop_submissions');
            expect(rows).toEqual([{ id: String(first.body.data.submissionId), name: 'Durable Beans', status: 'pending' }]);
        });

        it('a reused key with a different body is refused (422) and stores nothing', async () => {
            const key = 'pg-e2e-2';
            await request(baseURL).post('/api/v1/coffee-shops').set('Idempotency-Key', key).send(payload('One'));
            await new Promise((r) => setTimeout(r, 100));
            const reused = await request(baseURL).post('/api/v1/coffee-shops').set('Idempotency-Key', key).send(payload('Two'));
            expect(reused.status).toBe(422);
            const { rows } = await pg.pool.query("SELECT COUNT(*)::int AS n FROM shop_submissions WHERE name = 'Two'");
            expect(rows[0].n).toBe(0);
        });

        it('/health reports a durable, healthy Postgres queue', async () => {
            const res = await request(baseURL).get('/api/v1/health');
            expect(res.status).toBe(200);
            expect(res.body.data.submissions).toEqual({ open: true, storage: 'postgres', durable: true, queue: 'ok' });
        });
    });

    describe('Postgres outage after a healthy boot', () => {
        let sqlite;

        afterEach(async () => {
            await stopTestServer();
            if (sqlite) await closeDatabase(sqlite);
        });

        it('submissions answer 503 SUBMISSIONS_UNAVAILABLE + Retry-After, not 500', async () => {
            const pg = await createPgTestDatabase();
            const queueStore = await startQueueStore({
                config: { queue: { databaseUrl: pg.url, migrationDatabaseUrl: '', caCert: '' } },
                db: null,
                logger: silent,
            });
            expect(queueStore.ready).toBe(true);
            sqlite = await createTestDatabase();
            const { url } = await startTestServer(sqlite, { env: { WRITE_RATE_LIMIT_MAX: '1000' }, deps: { queueStore } });

            // Database disappears under a running API (connections killed).
            await pg.drop();

            const body = { shop: { displayName: { text: 'Outage' }, formattedAddress: '1 Main St', state: 'TX' } };
            for (const req of [
                request(url).post('/api/v1/coffee-shops').send(body),
                request(url).post('/api/v1/coffee-shops').set('Idempotency-Key', 'outage-1').send(body),
            ]) {
                const res = await req;
                expect(res.status).toBe(503);
                expect(res.headers['retry-after']).toBe('60');
                expect(['SUBMISSIONS_UNAVAILABLE', 'IDEMPOTENCY_UNAVAILABLE']).toContain(res.body.error.code);
            }
            const noKey = await request(url).post('/api/v1/coffee-shops').send(body);
            expect(noKey.body.error.code).toBe('SUBMISSIONS_UNAVAILABLE');

            const health = await request(url).get('/api/v1/health');
            expect(health.status).toBe(200);
            expect(health.body.data.submissions).toMatchObject({ open: false, queue: 'error' });
            await queueStore.close();
        });
    });

    describe('startQueueStore', () => {
        it('migrates and becomes ready when DATABASE_URL works', async () => {
            const pg = await createPgTestDatabase();
            const store = await startQueueStore({
                config: { queue: { databaseUrl: pg.url, migrationDatabaseUrl: '', caCert: '' } },
                db: null,
                logger: silent,
            });
            try {
                expect(store.kind).toBe('postgres');
                expect(store.ready).toBe(true);
                expect(await store.isHealthy()).toBe(true);
                const { rows } = await pg.pool.query('SELECT COUNT(*)::int AS n FROM schema_migrations');
                expect(rows[0].n).toBeGreaterThan(0);
            } finally {
                await store.close();
                await pg.drop();
            }
        });
    });
});

describe('startQueueStore without a reachable Postgres', () => {
    it('resolves (does not crash the API) with submissions answering 503 SUBMISSIONS_UNAVAILABLE', async () => {
        const store = await startQueueStore({
            // Nothing listens on port 1; the connection is refused at once.
            config: { queue: { databaseUrl: 'postgresql://nobody@127.0.0.1:1/none', migrationDatabaseUrl: '', caCert: '' } },
            db: null,
            logger: silent,
            retryMs: 60000,
        });
        try {
            expect(store.ready).toBe(false);
            expect(await store.isHealthy()).toBe(false);
            await expect(store.enqueueSubmission({})).rejects.toMatchObject({
                name: 'UnavailableError', code: 'SUBMISSIONS_UNAVAILABLE',
            });
            await expect(store.lookupKey('k', 0)).rejects.toMatchObject({ code: 'SUBMISSIONS_UNAVAILABLE' });
        } finally {
            await store.close();
        }
    });

    it('uses the SQLite store when DATABASE_URL is unset', async () => {
        const raw = await createTestDatabase();
        try {
            const store = await startQueueStore({
                config: { queue: { databaseUrl: '', migrationDatabaseUrl: '', caCert: '' } },
                db: { isHealthy: async () => true },
                logger: silent,
            });
            expect(store).toMatchObject({ kind: 'sqlite', durable: false, ready: true });
        } finally {
            await closeDatabase(raw);
        }
    });
});
