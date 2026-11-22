/**
 * Contract tests — submission queue store (src/queue/)
 *
 * The same cases run against the SQLite store (real in-memory SQLite with the
 * shipped migrations) and the Postgres store (real Postgres with
 * migrations/postgres applied, acting as the least-privileged `lcs_app`
 * role). They pin down what the middleware and use case rely on:
 *
 *   - enqueue stores the proposal and returns its id
 *   - capacity counts only pending rows and holds under concurrency
 *   - idempotency reservation is atomic, replaces an expired key (B-01),
 *     and complete/release/sweep touch only what they should
 */

const { createTestDatabase, closeDatabase } = require('../helpers/testDb');
const { describePg, createPgTestDatabase, poolAsRole, PG_URL } = require('../helpers/pgTestDb');
const { makeSqliteQueueStore } = require('../../src/queue/sqlite-store');
const { makePostgresQueueStore } = require('../../src/queue/postgres-store');
const { migratePostgres } = require('../../src/queue/postgres-migrate');

function proposal(overrides = {}) {
    return {
        name: 'Contract Beans',
        address: '1 Main St, Austin, Texas 78701',
        state: 'TX',
        priceLevel: 'PRICE_LEVEL_MODERATE',
        phoneNumber: '512-555-0100',
        website: 'https://beans.example',
        description: 'Line one\nLine two',
        languageCode: 'en',
        ...overrides,
    };
}

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

// Wrap a raw sqlite3 Database in the db-module shape the store expects.
function sqliteDbModule(raw) {
    return {
        get: (sql, params) => new Promise((resolve, reject) => {
            raw.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
        }),
        all: (sql, params) => new Promise((resolve, reject) => {
            raw.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
        }),
        run: (sql, params) => new Promise((resolve, reject) => {
            raw.run(sql, params, function (err) {
                if (err) return reject(err);
                return resolve({ lastID: this.lastID, changes: this.changes });
            });
        }),
        isHealthy: async () => true,
    };
}

const backends = [
    {
        name: 'sqlite',
        describe,
        async setup() {
            const raw = await createTestDatabase();
            const db = sqliteDbModule(raw);
            return {
                store: makeSqliteQueueStore(db),
                query: (sql) => db.all(sql, []),
                approve: (id) => db.run("UPDATE shop_submissions SET status = 'approved' WHERE id = ?", [id]),
                teardown: () => closeDatabase(raw),
            };
        },
    },
    {
        name: 'postgres (as lcs_app)',
        describe: describePg,
        async setup() {
            const pg = await createPgTestDatabase();
            await migratePostgres(pg.pool);
            const appPool = poolAsRole(pg.url, 'lcs_app');
            return {
                store: makePostgresQueueStore(appPool),
                query: async (sql) => (await pg.pool.query(sql)).rows,
                approve: (id) => pg.pool.query("UPDATE shop_submissions SET status = 'approved' WHERE id = $1", [id]),
                async teardown() {
                    await appPool.end();
                    await pg.drop();
                },
            };
        },
    },
];

for (const backend of backends) {
    backend.describe(`queue store contract — ${backend.name}`, () => {
        let ctx;
        let store;

        beforeEach(async () => {
            ctx = await backend.setup();
            store = ctx.store;
        });

        afterEach(async () => {
            await ctx.teardown();
        });

        describe('enqueueSubmission', () => {
            it('stores every field as pending and returns increasing ids', async () => {
                const first = await store.enqueueSubmission({
                    kind: 'create', targetShopId: null, proposal: proposal(), now: 1000, queueMax: 10,
                });
                const second = await store.enqueueSubmission({
                    kind: 'update', targetShopId: 42, proposal: proposal({ priceLevel: null, website: null }), now: 1001, queueMax: 10,
                });
                expect(typeof first).toBe('number');
                expect(second).toBeGreaterThan(first);

                const rows = await ctx.query(
                    'SELECT kind, target_shop_id, name, address, state, price_level, phone_number, website, description, language_code, status, created_at FROM shop_submissions ORDER BY id',
                );
                expect(rows.map((r) => ({ ...r, target_shop_id: r.target_shop_id === null ? null : Number(r.target_shop_id), created_at: Number(r.created_at) }))).toEqual([
                    {
                        kind: 'create', target_shop_id: null, name: 'Contract Beans', address: '1 Main St, Austin, Texas 78701',
                        state: 'TX', price_level: 'PRICE_LEVEL_MODERATE', phone_number: '512-555-0100',
                        website: 'https://beans.example', description: 'Line one\nLine two', language_code: 'en',
                        status: 'pending', created_at: 1000,
                    },
                    {
                        kind: 'update', target_shop_id: 42, name: 'Contract Beans', address: '1 Main St, Austin, Texas 78701',
                        state: 'TX', price_level: null, phone_number: '512-555-0100',
                        website: null, description: 'Line one\nLine two', language_code: 'en',
                        status: 'pending', created_at: 1001,
                    },
                ]);
            });

            it('returns null once the pending queue is at capacity; decided rows do not count', async () => {
                const enqueue = () => store.enqueueSubmission({
                    kind: 'create', targetShopId: null, proposal: proposal(), now: 1000, queueMax: 2,
                });
                const a = await enqueue();
                expect(await enqueue()).not.toBeNull();
                expect(await enqueue()).toBeNull();

                await ctx.approve(a);
                expect(await enqueue()).not.toBeNull();
                expect(await enqueue()).toBeNull();
            });

            it('queueMax 0 accepts nothing', async () => {
                expect(await store.enqueueSubmission({
                    kind: 'create', targetShopId: null, proposal: proposal(), now: 1000, queueMax: 0,
                })).toBeNull();
            });

            it('concurrent enqueues never overshoot the cap', async () => {
                const results = await Promise.all(Array.from({ length: 25 }, (_, i) => store.enqueueSubmission({
                    kind: 'create', targetShopId: null, proposal: proposal({ name: `Racer ${i}` }), now: 1000, queueMax: 5,
                })));
                expect(results.filter((id) => id !== null)).toHaveLength(5);
                const [{ n }] = await ctx.query("SELECT COUNT(*) AS n FROM shop_submissions WHERE status = 'pending'");
                expect(Number(n)).toBe(5);
            });
        });

        describe('idempotency keys', () => {
            const reservation = (overrides = {}) => ({
                key: 'k1', endpoint: 'POST /coffee-shops', requestHash: HASH_A, now: 1000, expiredBefore: 900, ...overrides,
            });

            it('reserve → lookup pending → complete → lookup completed', async () => {
                expect(await store.reserveKey(reservation())).toBe(true);
                expect(await store.lookupKey('k1', 900)).toMatchObject({ status: 'pending', request_hash: HASH_A });

                await store.completeKey('k1', 202, '{"success":true}');
                const row = await store.lookupKey('k1', 900);
                expect(row).toMatchObject({ status: 'completed', response: '{"success":true}', request_hash: HASH_A });
                expect(Number(row.status_code)).toBe(202);
            });

            it('a live key cannot be reserved twice', async () => {
                expect(await store.reserveKey(reservation())).toBe(true);
                expect(await store.reserveKey(reservation({ requestHash: HASH_B, now: 1001 }))).toBe(false);
                expect(await store.lookupKey('k1', 900)).toMatchObject({ request_hash: HASH_A });
            });

            it('concurrent reservations of one key: exactly one wins', async () => {
                const results = await Promise.all(
                    Array.from({ length: 10 }, () => store.reserveKey(reservation({ key: 'race' }))),
                );
                expect(results.filter(Boolean)).toHaveLength(1);
            });

            it('B-01: a key older than the TTL is replaced atomically, not reported as in progress', async () => {
                expect(await store.reserveKey(reservation({ now: 100 }))).toBe(true);
                await store.completeKey('k1', 202, '{"old":true}');

                // Later request: rows created at or before 900 have expired.
                expect(await store.lookupKey('k1', 900)).toBeNull();
                expect(await store.reserveKey(reservation({ requestHash: HASH_B, now: 1000, expiredBefore: 900 }))).toBe(true);
                expect(await store.lookupKey('k1', 900)).toMatchObject({ status: 'pending', request_hash: HASH_B, response: '' });
            });

            it('release removes only a pending reservation', async () => {
                await store.reserveKey(reservation({ key: 'p' }));
                await store.reserveKey(reservation({ key: 'c' }));
                await store.completeKey('c', 202, '{}');

                await store.releaseKey('p');
                await store.releaseKey('c');
                expect(await store.lookupKey('p', 900)).toBeNull();
                expect(await store.lookupKey('c', 900)).toMatchObject({ status: 'completed' });
            });

            it('complete does not resurrect a released key', async () => {
                await store.reserveKey(reservation());
                await store.releaseKey('k1');
                await store.completeKey('k1', 202, '{}');
                expect(await store.lookupKey('k1', 0)).toBeNull();
            });

            it('sweep deletes expired keys only and reports the count', async () => {
                await store.reserveKey(reservation({ key: 'old', now: 100 }));
                await store.reserveKey(reservation({ key: 'new', now: 1000 }));
                expect(await store.sweepKeys(900)).toBe(1);
                expect(await store.lookupKey('old', 0)).toBeNull();
                expect(await store.lookupKey('new', 0)).not.toBeNull();
            });
        });

        it('isHealthy reports true', async () => {
            expect(await store.isHealthy()).toBe(true);
        });
    });
}

if (!PG_URL) {
    // Visible reminder in local runs; CI sets REQUIRE_PG_TESTS=1 instead.
    test.skip('Postgres contract suite skipped: set PG_TEST_DATABASE_URL to run it', () => {});
}
