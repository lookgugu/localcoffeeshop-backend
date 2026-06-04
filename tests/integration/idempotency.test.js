/**
 * Integration Tests — POST /coffee-shops with Idempotency-Key
 *
 * End-to-end: same key → second POST replays without a second DB insert.
 * Different keys → two real inserts.
 */

const request = require('supertest');
const { createTestDatabase, closeDatabase, queryAll } = require('../helpers/testDb');
const { startTestServer, stopTestServer } = require('../helpers/testServer');

const validShop = {
    shop: {
        displayName: { text: 'Test Shop', languageCode: 'en' },
        formattedAddress: '123 Main St, San Francisco, CA 94101',
        state: 'CA',
        priceLevel: 'PRICE_LEVEL_MODERATE',
    },
};

describe('Idempotency — POST /api/v1/coffee-shops', () => {
    let db;
    let baseURL;

    beforeAll(async () => {
        db = await createTestDatabase();
        const info = await startTestServer(db);
        baseURL = info.url;
    });

    afterAll(async () => {
        await stopTestServer();
        await closeDatabase(db);
    });

    it('same Idempotency-Key returns the cached response without a second DB insert', async () => {
        const key = 'integration-key-1';

        const first = await request(baseURL)
            .post('/api/v1/coffee-shops')
            .set('Idempotency-Key', key)
            .send(validShop);

        expect(first.status).toBe(200);
        expect(first.body.success).toBe(true);
        expect(first.body.data.id).toBeGreaterThan(0);
        expect(first.headers['idempotent-replay']).toBeUndefined();

        const shopsAfterFirst = await queryAll(db, 'SELECT id FROM coffee_shops WHERE name = ?', ['Test Shop']);
        const insertedCountAfterFirst = shopsAfterFirst.length;

        const second = await request(baseURL)
            .post('/api/v1/coffee-shops')
            .set('Idempotency-Key', key)
            .send(validShop);

        expect(second.status).toBe(200);
        expect(second.body).toEqual(first.body);
        expect(second.headers['idempotent-replay']).toBe('true');

        const shopsAfterSecond = await queryAll(db, 'SELECT id FROM coffee_shops WHERE name = ?', ['Test Shop']);
        expect(shopsAfterSecond.length).toBe(insertedCountAfterFirst);
    });

    it('different Idempotency-Key values produce two real inserts', async () => {
        const before = await queryAll(db, 'SELECT id FROM coffee_shops WHERE name = ?', ['Distinct Shop']);
        const startCount = before.length;

        await request(baseURL)
            .post('/api/v1/coffee-shops')
            .set('Idempotency-Key', 'integration-key-A')
            .send({
                shop: {
                    displayName: { text: 'Distinct Shop' },
                    formattedAddress: '1 Pine St, Seattle, WA 98101',
                    state: 'WA',
                    priceLevel: 'PRICE_LEVEL_INEXPENSIVE',
                },
            });

        await request(baseURL)
            .post('/api/v1/coffee-shops')
            .set('Idempotency-Key', 'integration-key-B')
            .send({
                shop: {
                    displayName: { text: 'Distinct Shop' },
                    formattedAddress: '1 Pine St, Seattle, WA 98101',
                    state: 'WA',
                    priceLevel: 'PRICE_LEVEL_INEXPENSIVE',
                },
            });

        const after = await queryAll(db, 'SELECT id FROM coffee_shops WHERE name = ?', ['Distinct Shop']);
        expect(after.length).toBe(startCount + 2);
    });

    it('no Idempotency-Key header → handler runs normally, nothing stored in idempotency_keys', async () => {
        const keysBefore = await queryAll(db, 'SELECT key FROM idempotency_keys');
        const startCount = keysBefore.length;

        const res = await request(baseURL)
            .post('/api/v1/coffee-shops')
            .send({
                shop: {
                    displayName: { text: 'No Key Shop' },
                    formattedAddress: '500 Broadway, New York, NY 10012',
                    state: 'NY',
                    priceLevel: 'PRICE_LEVEL_MODERATE',
                },
            });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.headers['idempotent-replay']).toBeUndefined();

        const keysAfter = await queryAll(db, 'SELECT key FROM idempotency_keys');
        expect(keysAfter.length).toBe(startCount);
    });

    it('4xx validation errors do NOT pollute the idempotency cache — same key can retry', async () => {
        const key = 'integration-key-retry-after-400';
        const badShop = {
            shop: {
                displayName: { text: 'Bad Shop' },
                formattedAddress: '1 Nowhere St',
                // Missing state → ValidationError → 400
            },
        };

        const first = await request(baseURL)
            .post('/api/v1/coffee-shops')
            .set('Idempotency-Key', key)
            .send(badShop);
        expect(first.status).toBe(400);

        // The pending reservation should have been released on the non-2xx response.
        const rows = await queryAll(db, 'SELECT status FROM idempotency_keys WHERE key = ?', [key]);
        expect(rows.length).toBe(0);

        // A retry with the corrected payload should succeed normally (not 409).
        const second = await request(baseURL)
            .post('/api/v1/coffee-shops')
            .set('Idempotency-Key', key)
            .send({
                shop: {
                    displayName: { text: 'Good Shop After Retry' },
                    formattedAddress: '500 Broadway, New York, NY 10012',
                    state: 'NY',
                    priceLevel: 'PRICE_LEVEL_MODERATE',
                },
            });
        expect(second.status).toBe(200);
        expect(second.headers['idempotent-replay']).toBeUndefined();
    });

    it('concurrent requests with the same key: at most one insert; the loser sees 409 or replay', async () => {
        const key = 'integration-key-concurrent';
        const payload = {
            shop: {
                displayName: { text: 'Concurrent Shop' },
                formattedAddress: '900 Market St, San Francisco, CA 94103',
                state: 'CA',
                priceLevel: 'PRICE_LEVEL_MODERATE',
            },
        };

        const before = await queryAll(db, 'SELECT id FROM coffee_shops WHERE name = ?', ['Concurrent Shop']);
        const startCount = before.length;

        const [a, b] = await Promise.all([
            request(baseURL).post('/api/v1/coffee-shops').set('Idempotency-Key', key).send(payload),
            request(baseURL).post('/api/v1/coffee-shops').set('Idempotency-Key', key).send(payload),
        ]);

        // Exactly one new DB insert.
        const after = await queryAll(db, 'SELECT id FROM coffee_shops WHERE name = ?', ['Concurrent Shop']);
        expect(after.length).toBe(startCount + 1);

        // Acceptable outcomes per request: success (200), in-flight (409), or replay (200 + Idempotent-Replay).
        for (const res of [a, b]) {
            expect([200, 409]).toContain(res.status);
        }
        // At least one must be a successful 200 (the winner).
        expect([a.status, b.status]).toContain(200);
    });
});
