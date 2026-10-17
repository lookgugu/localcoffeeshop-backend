/**
 * Integration Tests — community submission failure paths
 *
 * Every failure must (a) answer with an honest 4xx/5xx envelope, (b) leave
 * the published table untouched, and (c) leave no idempotency reservation
 * behind that would turn a transient failure into a permanent one.
 */

const request = require('supertest');
const {
    createTestDatabase, closeDatabase, seedTestData, queryAll,
} = require('../helpers/testDb');
const { startTestServer, stopTestServer } = require('../helpers/testServer');

const QUEUE_MAX = 2;

function payload(name = 'Failure Shop') {
    return {
        shop: {
            displayName: { text: name },
            formattedAddress: '5 Fail St, Omaha, Nebraska 68102',
            state: 'NE',
        },
    };
}

describe('Community submissions — failure paths', () => {
    let db;
    let baseURL;
    let published;

    async function boot(env = {}) {
        await stopTestServer();
        const info = await startTestServer(db, {
            env: { WRITE_RATE_LIMIT_MAX: '1000', SUBMISSION_QUEUE_MAX: String(QUEUE_MAX), ...env },
        });
        baseURL = info.url;
    }

    beforeAll(async () => {
        db = await createTestDatabase();
        await seedTestData(db, [{ name: 'Live', address: '9 Live Ln, Omaha, Nebraska 68102', price_level: null, state: 'NE' }]);
        published = await queryAll(db, 'SELECT * FROM coffee_shops ORDER BY id');
        await boot();
    });

    beforeEach(async () => {
        await queryAll(db, 'DELETE FROM shop_submissions');
        await queryAll(db, 'DELETE FROM idempotency_keys');
    });

    afterEach(async () => {
        expect(await queryAll(db, 'SELECT * FROM coffee_shops ORDER BY id')).toEqual(published);
        expect(await queryAll(db, "SELECT key FROM idempotency_keys WHERE status = 'pending'")).toHaveLength(0);
    });

    afterAll(async () => {
        await stopTestServer();
        await closeDatabase(db);
    });

    describe('request bodies the parser rejects', () => {
        it('malformed JSON → 400 envelope (not 500), nothing stored', async () => {
            const res = await request(baseURL)
                .post('/api/v1/coffee-shops')
                .set('Content-Type', 'application/json')
                .set('Idempotency-Key', 'malformed-json')
                .send('{"shop": {');
            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
            expect(await queryAll(db, 'SELECT id FROM shop_submissions')).toHaveLength(0);
            expect(await queryAll(db, 'SELECT key FROM idempotency_keys')).toHaveLength(0);
        });

        it('body over the 10kb limit → 413 envelope, nothing stored', async () => {
            const res = await request(baseURL)
                .post('/api/v1/coffee-shops')
                .send({ shop: { ...payload().shop, description: 'x'.repeat(11 * 1024) } });
            expect(res.status).toBe(413);
            expect(res.body.success).toBe(false);
            expect(await queryAll(db, 'SELECT id FROM shop_submissions')).toHaveLength(0);
        });

        it('non-JSON content type → 400, nothing stored', async () => {
            const res = await request(baseURL)
                .post('/api/v1/coffee-shops')
                .set('Content-Type', 'text/plain')
                .send(JSON.stringify(payload()));
            expect(res.status).toBe(400);
            expect(await queryAll(db, 'SELECT id FROM shop_submissions')).toHaveLength(0);
        });
    });

    describe('bounded queue', () => {
        it('refuses new submissions with 503 + Retry-After once the pending queue is full', async () => {
            for (let i = 0; i < QUEUE_MAX; i++) {
                expect((await request(baseURL).post('/api/v1/coffee-shops').send(payload(`Fill ${i}`))).status).toBe(202);
            }

            const res = await request(baseURL)
                .post('/api/v1/coffee-shops')
                .set('Idempotency-Key', 'queue-full-key')
                .send(payload('Overflow'));
            expect(res.status).toBe(503);
            expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
            expect(res.body).toMatchObject({ success: false, error: { code: 'SUBMISSION_QUEUE_FULL' } });
            expect(await queryAll(db, 'SELECT id FROM shop_submissions')).toHaveLength(QUEUE_MAX);
            // The 503 was not cached: the key is free for a later retry.
            expect(await queryAll(db, "SELECT key FROM idempotency_keys WHERE key = 'queue-full-key'")).toHaveLength(0);
        });

        it('concurrent submissions cannot overshoot the cap', async () => {
            const results = await Promise.all(
                Array.from({ length: 8 }, (_, i) => request(baseURL).post('/api/v1/coffee-shops').send(payload(`Race ${i}`))),
            );
            const accepted = results.filter((r) => r.status === 202).length;
            expect(accepted).toBe(QUEUE_MAX);
            expect(results.filter((r) => r.status === 503)).toHaveLength(8 - QUEUE_MAX);
            expect(await queryAll(db, 'SELECT id FROM shop_submissions')).toHaveLength(QUEUE_MAX);
        });

        it('reviewed (non-pending) rows do not count toward the cap', async () => {
            await queryAll(db, `INSERT INTO shop_submissions (kind, name, address, state, status, created_at)
                                VALUES ('create', 'Old', '1 Old St', 'NE', 'rejected', 0),
                                       ('create', 'Old2', '2 Old St', 'NE', 'approved', 0)`);
            expect((await request(baseURL).post('/api/v1/coffee-shops').send(payload())).status).toBe(202);
        });
    });

    describe('storage failure', () => {
        it('insert failure → 500, key released, and the same key succeeds once storage recovers', async () => {
            await queryAll(db, 'ALTER TABLE shop_submissions RENAME TO shop_submissions_offline');
            let res;
            try {
                res = await request(baseURL)
                    .post('/api/v1/coffee-shops')
                    .set('Idempotency-Key', 'storage-failure-key')
                    .send(payload());
            } finally {
                await queryAll(db, 'ALTER TABLE shop_submissions_offline RENAME TO shop_submissions');
            }
            expect(res.status).toBe(500);
            expect(res.body.success).toBe(false);

            // Release is fire-and-forget; give it a tick.
            await new Promise((r) => setTimeout(r, 50));
            expect(await queryAll(db, "SELECT key FROM idempotency_keys WHERE key = 'storage-failure-key'")).toHaveLength(0);

            const retry = await request(baseURL)
                .post('/api/v1/coffee-shops')
                .set('Idempotency-Key', 'storage-failure-key')
                .send(payload());
            expect(retry.status).toBe(202);
            expect(retry.headers['idempotent-replay']).toBeUndefined();
        });

        it('update proposal for a missing shop releases its key', async () => {
            const res = await request(baseURL)
                .put('/api/v1/coffee-shops/424242')
                .set('Idempotency-Key', 'missing-target-key')
                .send(payload());
            expect(res.status).toBe(400);
            await new Promise((r) => setTimeout(r, 50));
            expect(await queryAll(db, "SELECT key FROM idempotency_keys WHERE key = 'missing-target-key'")).toHaveLength(0);
        });
    });

    describe('operator kill switch', () => {
        afterAll(async () => {
            await boot();
        });

        it('SUBMISSIONS_ENABLED=false → 503 SUBMISSIONS_DISABLED for POST and PUT; nothing stored', async () => {
            await boot({ SUBMISSIONS_ENABLED: 'false' });
            const post = await request(baseURL).post('/api/v1/coffee-shops').set('Idempotency-Key', 'disabled-key').send(payload());
            const put = await request(baseURL).put(`/api/v1/coffee-shops/${published[0].id}`).send(payload());

            for (const res of [post, put]) {
                expect(res.status).toBe(503);
                expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
                expect(res.body).toMatchObject({ success: false, error: { code: 'SUBMISSIONS_DISABLED' } });
            }
            expect(await queryAll(db, 'SELECT id FROM shop_submissions')).toHaveLength(0);
            expect(await queryAll(db, 'SELECT key FROM idempotency_keys')).toHaveLength(0);
        });

        it.each([['true'], [''], ['1']])('outside production, SUBMISSIONS_ENABLED=%p keeps submissions open', async (value) => {
            await boot({ SUBMISSIONS_ENABLED: value });
            expect((await request(baseURL).post('/api/v1/coffee-shops').send(payload())).status).toBe(202);
        });

        describe('production fails closed (ephemeral queue — see docs/security/community-submissions.md)', () => {
            const prod = { NODE_ENV: 'production', CORS_ORIGIN: 'https://localcoffeeshop.co' };
            const prodPost = () => request(baseURL)
                .post('/api/v1/coffee-shops').set('X-Forwarded-Proto', 'https').send(payload());

            it.each([[undefined], [''], ['1'], ['yes'], ['false']])(
                'SUBMISSIONS_ENABLED=%p → 503 SUBMISSIONS_DISABLED, nothing stored',
                async (value) => {
                    await boot({ ...prod, ...(value === undefined ? {} : { SUBMISSIONS_ENABLED: value }) });
                    const res = await prodPost();
                    expect(res.status).toBe(503);
                    expect(res.body.error.code).toBe('SUBMISSIONS_DISABLED');
                    expect(await queryAll(db, 'SELECT id FROM shop_submissions')).toHaveLength(0);
                },
            );

            it('only an explicit SUBMISSIONS_ENABLED=true opens the queue', async () => {
                await boot({ ...prod, SUBMISSIONS_ENABLED: 'true' });
                expect((await prodPost()).status).toBe(202);
            });
        });
    });
});
