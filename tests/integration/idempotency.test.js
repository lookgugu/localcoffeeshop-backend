/**
 * Integration Tests — POST /coffee-shops with Idempotency-Key
 *
 * End-to-end: same key → second POST replays without a second queued
 * submission. Different keys → two real submissions. Public writes land in
 * the `shop_submissions` moderation queue (202 pending review); the
 * published `coffee_shops` table is never touched.
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

function countSubmissions(db, name) {
    return queryAll(db, 'SELECT id FROM shop_submissions WHERE name = ?', [name]).then((r) => r.length);
}

describe('Idempotency — POST /api/v1/coffee-shops', () => {
    let db;
    let baseURL;

    beforeAll(async () => {
        db = await createTestDatabase();
        const info = await startTestServer(db, { env: { WRITE_RATE_LIMIT_MAX: '1000' } });
        baseURL = info.url;
    });

    afterAll(async () => {
        // No test in this file may publish anything.
        expect(await queryAll(db, 'SELECT id FROM coffee_shops')).toHaveLength(0);
        await stopTestServer();
        await closeDatabase(db);
    });

    it('same Idempotency-Key returns the cached response without a second queued submission', async () => {
        const key = 'integration-key-1';

        const first = await request(baseURL)
            .post('/api/v1/coffee-shops')
            .set('Idempotency-Key', key)
            .send(validShop);

        expect(first.status).toBe(202);
        expect(first.body.success).toBe(true);
        expect(first.body.data.status).toBe('pending_review');
        expect(first.body.data.submissionId).toBeGreaterThan(0);
        expect(first.headers['idempotent-replay']).toBeUndefined();

        const countAfterFirst = await countSubmissions(db, 'Test Shop');
        expect(countAfterFirst).toBe(1);

        const second = await request(baseURL)
            .post('/api/v1/coffee-shops')
            .set('Idempotency-Key', key)
            .send(validShop);

        expect(second.status).toBe(202);
        expect(second.body).toEqual(first.body);
        expect(second.headers['idempotent-replay']).toBe('true');

        expect(await countSubmissions(db, 'Test Shop')).toBe(countAfterFirst);
    });

    it('different Idempotency-Key values produce two real submissions', async () => {
        const startCount = await countSubmissions(db, 'Distinct Shop');
        const body = {
            shop: {
                displayName: { text: 'Distinct Shop' },
                formattedAddress: '1 Pine St, Seattle, WA 98101',
                state: 'WA',
                priceLevel: 'PRICE_LEVEL_INEXPENSIVE',
            },
        };

        const a = await request(baseURL).post('/api/v1/coffee-shops').set('Idempotency-Key', 'integration-key-A').send(body);
        const b = await request(baseURL).post('/api/v1/coffee-shops').set('Idempotency-Key', 'integration-key-B').send(body);
        expect([a.status, b.status]).toEqual([202, 202]);

        expect(await countSubmissions(db, 'Distinct Shop')).toBe(startCount + 2);
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

        expect(res.status).toBe(202);
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

        // Validation runs before idempotency: no row was ever reserved.
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
        expect(second.status).toBe(202);
        expect(second.headers['idempotent-replay']).toBeUndefined();
    });

    describe('key reuse with a different request', () => {
        const original = {
            shop: {
                displayName: { text: 'Reuse Original' },
                formattedAddress: '7 Reuse Rd, Portland, Oregon 97201',
                state: 'OR',
            },
        };

        it('different body → 422 IDEMPOTENCY_KEY_REUSED, nothing new queued, original replay intact', async () => {
            const key = 'integration-key-reuse-body';
            const first = await request(baseURL).post('/api/v1/coffee-shops').set('Idempotency-Key', key).send(original);
            expect(first.status).toBe(202);

            const tampered = await request(baseURL)
                .post('/api/v1/coffee-shops')
                .set('Idempotency-Key', key)
                .send({ shop: { ...original.shop, displayName: { text: 'Reuse Tampered' } } });
            expect(tampered.status).toBe(422);
            expect(tampered.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
            expect(tampered.headers['idempotent-replay']).toBeUndefined();
            expect(await countSubmissions(db, 'Reuse Tampered')).toBe(0);

            const replay = await request(baseURL).post('/api/v1/coffee-shops').set('Idempotency-Key', key).send(original);
            expect(replay.status).toBe(202);
            expect(replay.body).toEqual(first.body);
            expect(await countSubmissions(db, 'Reuse Original')).toBe(1);
        });

        it('same key on a different endpoint → 422, not a replay of the POST response', async () => {
            const key = 'integration-key-reuse-endpoint';
            const [seeded] = await queryAll(db, "INSERT INTO coffee_shops (name, address, state) VALUES ('Seed', '1 Seed St', 'OR') RETURNING id");
            try {
                expect((await request(baseURL).post('/api/v1/coffee-shops').set('Idempotency-Key', key).send(original)).status).toBe(202);
                const put = await request(baseURL).put(`/api/v1/coffee-shops/${seeded.id}`).set('Idempotency-Key', key).send(original);
                expect(put.status).toBe(422);
                expect(await queryAll(db, "SELECT id FROM shop_submissions WHERE kind = 'update'")).toHaveLength(0);
            } finally {
                await queryAll(db, 'DELETE FROM coffee_shops WHERE id = ?', [seeded.id]);
            }
        });

        it('malformed key → 400 IDEMPOTENCY_KEY_INVALID and nothing stored', async () => {
            const res = await request(baseURL).post('/api/v1/coffee-shops').set('Idempotency-Key', 'bad key!').send(original);
            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('IDEMPOTENCY_KEY_INVALID');
            expect(await queryAll(db, "SELECT key FROM idempotency_keys WHERE key = 'bad key!'")).toHaveLength(0);
        });
    });

    it('concurrent requests with the same key: at most one submission; the loser sees 409 or replay', async () => {
        const key = 'integration-key-concurrent';
        const payload = {
            shop: {
                displayName: { text: 'Concurrent Shop' },
                formattedAddress: '900 Market St, San Francisco, CA 94103',
                state: 'CA',
                priceLevel: 'PRICE_LEVEL_MODERATE',
            },
        };

        const startCount = await countSubmissions(db, 'Concurrent Shop');

        const [a, b] = await Promise.all([
            request(baseURL).post('/api/v1/coffee-shops').set('Idempotency-Key', key).send(payload),
            request(baseURL).post('/api/v1/coffee-shops').set('Idempotency-Key', key).send(payload),
        ]);

        // Exactly one new queued submission.
        expect(await countSubmissions(db, 'Concurrent Shop')).toBe(startCount + 1);

        // Acceptable outcomes per request: accepted (202), in-flight (409), or replay (202 + Idempotent-Replay).
        for (const res of [a, b]) {
            expect([202, 409]).toContain(res.status);
        }
        // At least one must be the accepted winner.
        expect([a.status, b.status]).toContain(202);
    });
});
