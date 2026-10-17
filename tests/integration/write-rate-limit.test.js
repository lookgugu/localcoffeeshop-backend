/**
 * Integration Tests — write rate limit
 *
 * Every write method under /api (the /api/v1 router and the legacy /api/*
 * alias) draws from ONE per-client budget that is much stricter than the
 * read limiter. Path spelling, client-supplied forwarding headers and
 * idempotency keys must not buy a fresh budget.
 */

const request = require('supertest');
const { createTestDatabase, closeDatabase, seedTestData, queryAll } = require('../helpers/testDb');
const { startTestServer, stopTestServer } = require('../helpers/testServer');

const WRITE_MAX = 3;

function payload(name = 'Limit Shop') {
    return {
        shop: {
            displayName: { text: name },
            formattedAddress: '1 Limit Ave, Denver, Colorado 80202',
            state: 'CO',
        },
    };
}

describe('Write rate limit', () => {
    let db;
    let baseURL;
    let shopId;

    async function boot(env = {}) {
        await stopTestServer();
        const info = await startTestServer(db, {
            env: { WRITE_RATE_LIMIT_MAX: String(WRITE_MAX), WRITE_RATE_LIMIT_WINDOW_MS: '60000', ...env },
        });
        baseURL = info.url;
    }

    beforeAll(async () => {
        db = await createTestDatabase();
        await seedTestData(db, [{ name: 'Target', address: '2 Target Rd, Denver, Colorado 80202', price_level: null, state: 'CO' }]);
        shopId = (await queryAll(db, 'SELECT id FROM coffee_shops'))[0].id;
    });

    beforeEach(async () => {
        await queryAll(db, 'DELETE FROM shop_submissions');
        await queryAll(db, 'DELETE FROM idempotency_keys');
        await boot();
    });

    afterAll(async () => {
        await stopTestServer();
        await closeDatabase(db);
    });

    it('returns 429 with Retry-After and an error envelope once the budget is spent', async () => {
        for (let i = 0; i < WRITE_MAX; i++) {
            const ok = await request(baseURL).post('/api/v1/coffee-shops').send(payload());
            expect(ok.status).toBe(202);
        }

        const blocked = await request(baseURL)
            .post('/api/v1/coffee-shops')
            .set('Idempotency-Key', 'blocked-key')
            .send(payload());

        expect(blocked.status).toBe(429);
        expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
        expect(blocked.body).toMatchObject({
            success: false,
            error: { code: 'RATE_LIMITED', statusCode: 429 },
        });
        // The blocked request reached neither the queue nor idempotency storage.
        expect(await queryAll(db, 'SELECT id FROM shop_submissions')).toHaveLength(WRITE_MAX);
        expect(await queryAll(db, 'SELECT key FROM idempotency_keys')).toHaveLength(0);
    });

    it('POST, PUT and alternate path spellings share one budget', async () => {
        const attempts = [
            () => request(baseURL).post('/api/v1/coffee-shops').send(payload()),
            () => request(baseURL).put(`/api/v1/coffee-shops/${shopId}`).send(payload()),
            () => request(baseURL).post('/API/V1/COFFEE-SHOPS').send(payload()),
        ];
        for (const attempt of attempts) {
            expect((await attempt()).status).toBe(202);
        }

        for (const path of ['/api/v1/coffee-shops/', '/Api/v1/Coffee-Shops', `/api/v1/coffee-shops/${shopId}/`]) {
            const method = path.includes(String(shopId)) ? 'put' : 'post';
            const res = await request(baseURL)[method](path).send(payload());
            expect(res.status).toBe(429);
        }
        expect(await queryAll(db, 'SELECT id FROM shop_submissions')).toHaveLength(WRITE_MAX);
    });

    it('legacy /api/* alias writes nothing and draws from the same budget', async () => {
        const legacy = await request(baseURL).post('/api/coffee-shops').send(payload());
        expect(legacy.status).toBe(301);
        expect(legacy.headers.location).toBe('/api/v1/coffee-shops');
        expect(await queryAll(db, 'SELECT id FROM shop_submissions')).toHaveLength(0);

        expect((await request(baseURL).put(`/api/coffee-shops/${shopId}`).send(payload())).status).toBe(301);
        expect((await request(baseURL).post('/api/v1/coffee-shops').send(payload())).status).toBe(202);
        expect((await request(baseURL).post('/api/v1/coffee-shops').send(payload())).status).toBe(429);
    });

    it('paths that escape the /api mount (e.g. a leading double slash) never write', async () => {
        const res = await request(baseURL).post('//api/v1/coffee-shops').send(payload());
        // Falls through to the non-API 404 handler. (That handler currently
        // 500s because src/public/html/404.html is absent — pre-existing and
        // out of scope; what matters here is that nothing is accepted.)
        expect(res.status).toBeGreaterThanOrEqual(400);
        expect(await queryAll(db, 'SELECT id FROM shop_submissions')).toHaveLength(0);
    });

    it('rotating client-supplied forwarding headers does not reset the budget', async () => {
        const spoofHeaders = (i) => ({
            'X-Forwarded-For': `203.0.113.${i}`,
            'X-Real-IP': `198.51.100.${i}`,
            'DO-Connecting-IP': `192.0.2.${i}`,
            'CF-Connecting-IP': `192.0.2.${100 + i}`,
            'True-Client-IP': `192.0.2.${200 + i}`,
            Forwarded: `for=203.0.113.${i}`,
        });

        const statuses = [];
        for (let i = 1; i <= WRITE_MAX + 2; i++) {
            const res = await request(baseURL).post('/api/v1/coffee-shops').set(spoofHeaders(i)).send(payload());
            statuses.push(res.status);
        }
        expect(statuses).toEqual([202, 202, 202, 429, 429]);
    });

    it('rotating Idempotency-Key values does not reset the budget', async () => {
        const statuses = [];
        for (let i = 1; i <= WRITE_MAX + 1; i++) {
            const res = await request(baseURL).post('/api/v1/coffee-shops').set('Idempotency-Key', `rotate-${i}`).send(payload());
            statuses.push(res.status);
        }
        expect(statuses).toEqual([202, 202, 202, 429]);
    });

    it('invalid requests also spend the budget (no free probing)', async () => {
        for (let i = 0; i < WRITE_MAX; i++) {
            expect((await request(baseURL).post('/api/v1/coffee-shops').send({ shop: {} })).status).toBe(400);
        }
        expect((await request(baseURL).post('/api/v1/coffee-shops').send(payload())).status).toBe(429);
        expect(await queryAll(db, 'SELECT id FROM shop_submissions')).toHaveLength(0);
    });

    it('malformed and oversized bodies spend the budget (limiter runs before the body parser)', async () => {
        const malformed = await request(baseURL)
            .post('/api/v1/coffee-shops').set('Content-Type', 'application/json').send('{"shop": {');
        const oversized = await request(baseURL)
            .post('/api/v1/coffee-shops').send({ shop: { description: 'x'.repeat(11 * 1024) } });
        const malformedPut = await request(baseURL)
            .put(`/api/v1/coffee-shops/${shopId}`).set('Content-Type', 'application/json').send('not json');
        expect([malformed.status, oversized.status, malformedPut.status]).toEqual([400, 413, 400]);

        const blocked = await request(baseURL)
            .post('/api/v1/coffee-shops').set('Content-Type', 'application/json').send('{"shop": {');
        expect(blocked.status).toBe(429);
        expect((await request(baseURL).post('/api/v1/coffee-shops').send(payload())).status).toBe(429);
        expect(await queryAll(db, 'SELECT id FROM shop_submissions')).toHaveLength(0);
    });

    it('reads are not throttled by the write budget', async () => {
        for (let i = 0; i < WRITE_MAX + 1; i++) {
            await request(baseURL).post('/api/v1/coffee-shops').send(payload());
        }
        const health = await request(baseURL).get('/api/v1/health');
        expect(health.status).toBe(200);
    });

    it('CORS preflight is not counted', async () => {
        for (let i = 0; i < WRITE_MAX + 2; i++) {
            const pre = await request(baseURL)
                .options('/api/v1/coffee-shops')
                .set('Origin', 'https://localcoffeeshop.co')
                .set('Access-Control-Request-Method', 'POST');
            expect(pre.status).toBeLessThan(400);
        }
        expect((await request(baseURL).post('/api/v1/coffee-shops').send(payload())).status).toBe(202);
    });

    describe('production (trust proxy = 1 hop)', () => {
        beforeEach(async () => {
            // Production defaults submissions OFF; these tests opt in explicitly.
            await boot({ NODE_ENV: 'production', CORS_ORIGIN: 'https://localcoffeeshop.co', SUBMISSIONS_ENABLED: 'true' });
        });

        function prodPost(xff) {
            return request(baseURL)
                .post('/api/v1/coffee-shops')
                .set('X-Forwarded-Proto', 'https')
                .set('X-Forwarded-For', xff)
                .send(payload());
        }

        it('keys on the address appended by the trusted proxy, not a client-forged prefix', async () => {
            const statuses = [];
            for (let i = 1; i <= WRITE_MAX + 2; i++) {
                // A client forges the left-most entry; the platform proxy appends the real peer.
                const res = await prodPost(`10.0.0.${i}, 198.51.100.7`);
                statuses.push(res.status);
            }
            expect(statuses).toEqual([202, 202, 202, 429, 429]);
        });

        it('distinct real clients (as seen by the proxy) get independent budgets', async () => {
            for (let i = 0; i < WRITE_MAX; i++) {
                expect((await prodPost('198.51.100.7')).status).toBe(202);
            }
            expect((await prodPost('198.51.100.7')).status).toBe(429);
            expect((await prodPost('198.51.100.8')).status).toBe(202);
        });
    });
});
