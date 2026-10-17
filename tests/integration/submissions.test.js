/**
 * Integration Tests — community submissions
 *
 * Public POST /coffee-shops and PUT /coffee-shops/:id must never touch the
 * published `coffee_shops` table. A valid request is accepted into the
 * `shop_submissions` moderation queue as `pending` and answered with 202.
 * An invalid request is rejected with 400 and stores nothing anywhere.
 */

const request = require('supertest');
const {
    createTestDatabase, closeDatabase, seedTestData, queryAll, queryGet,
} = require('../helpers/testDb');
const { startTestServer, stopTestServer } = require('../helpers/testServer');

const PUBLISHED = [
    { name: 'Published One', address: '1 First St, Austin, Texas 78701', price_level: 'PRICE_LEVEL_MODERATE', state: 'TX' },
    { name: 'Published Two', address: '2 Second St, Boise, Idaho 83702', price_level: null, state: 'ID' },
];

// Shape the frontend's public/submit.js actually sends (id, empty optional strings).
function frontendPayload(overrides = {}) {
    return {
        shop: {
            id: '1760659200000',
            displayName: { text: 'Corner Roasters' },
            formattedAddress: '10 Market St, San Francisco, California 94105',
            state: 'CA',
            phoneNumber: '',
            website: '',
            priceLevel: '',
            description: '',
            ...overrides,
        },
    };
}

async function publishedSnapshot(db) {
    return queryAll(db, 'SELECT * FROM coffee_shops ORDER BY id');
}

describe('Community submissions — public writes go to the pending queue', () => {
    let db;
    let baseURL;
    let published;

    beforeAll(async () => {
        db = await createTestDatabase();
        await seedTestData(db, PUBLISHED);
        published = await publishedSnapshot(db);
        const info = await startTestServer(db, { env: { WRITE_RATE_LIMIT_MAX: '1000' } });
        baseURL = info.url;
    });

    afterAll(async () => {
        await stopTestServer();
        await closeDatabase(db);
    });

    beforeEach(async () => {
        await queryAll(db, 'DELETE FROM shop_submissions');
        await queryAll(db, 'DELETE FROM idempotency_keys');
    });

    afterEach(async () => {
        // The invariant every test in this file must uphold.
        expect(await publishedSnapshot(db)).toEqual(published);
    });

    describe('POST /api/v1/coffee-shops', () => {
        it('accepts a frontend-shaped proposal with 202 pending review and queues it', async () => {
            const res = await request(baseURL)
                .post('/api/v1/coffee-shops')
                .send(frontendPayload({ phoneNumber: '(415) 555-0100', website: 'https://corner.example', priceLevel: 'PRICE_LEVEL_MODERATE', description: 'Pour-over bar' }));

            expect(res.status).toBe(202);
            expect(res.headers['cache-control']).toBe('no-store');
            expect(res.body.success).toBe(true);
            expect(res.body.data).toMatchObject({
                status: 'pending_review',
                kind: 'create',
                targetShopId: null,
                displayName: { text: 'Corner Roasters', languageCode: 'en' },
                formattedAddress: '10 Market St, San Francisco, California 94105',
                state: 'CA',
                priceLevel: 'PRICE_LEVEL_MODERATE',
            });
            expect(res.body.data.submissionId).toBeGreaterThan(0);
            // No published-shop id is claimed for something that is not published.
            expect(res.body.data.id).toBeUndefined();

            const rows = await queryAll(db, 'SELECT * FROM shop_submissions');
            expect(rows).toHaveLength(1);
            expect(rows[0]).toMatchObject({
                id: res.body.data.submissionId,
                kind: 'create',
                target_shop_id: null,
                status: 'pending',
                name: 'Corner Roasters',
                address: '10 Market St, San Francisco, California 94105',
                state: 'CA',
                price_level: 'PRICE_LEVEL_MODERATE',
                phone_number: '(415) 555-0100',
                website: 'https://corner.example',
                description: 'Pour-over bar',
                language_code: 'en',
            });
        });

        it('normalises empty optional strings to NULL and ignores the client-supplied id', async () => {
            const res = await request(baseURL).post('/api/v1/coffee-shops').send(frontendPayload());
            expect(res.status).toBe(202);

            const row = await queryGet(db, 'SELECT * FROM shop_submissions');
            expect(row.price_level).toBeNull();
            expect(row.phone_number).toBeNull();
            expect(row.website).toBeNull();
            expect(row.description).toBeNull();
            expect(row.target_shop_id).toBeNull();
            expect(row.id).not.toBe(1760659200000);
        });

        it('a proposal duplicating a published shop is queued, not merged into it', async () => {
            const res = await request(baseURL).post('/api/v1/coffee-shops').send(frontendPayload({
                displayName: { text: 'Published One' },
                formattedAddress: '1 First St, Austin, Texas 78701',
                state: 'TX',
            }));
            expect(res.status).toBe(202);
            expect(await queryAll(db, 'SELECT id FROM shop_submissions')).toHaveLength(1);
        });
    });

    describe('invalid proposals are rejected before any storage', () => {
        it.each([
            ['over-long name', frontendPayload({ displayName: { text: 'n'.repeat(201) } })],
            ['over-long description', frontendPayload({ description: 'd'.repeat(1001) })],
            ['numeric name', frontendPayload({ displayName: { text: 7 } })],
            ['object address', frontendPayload({ formattedAddress: { a: 1 } })],
            ['unknown state', frontendPayload({ state: 'XX' })],
            ['unknown price level', frontendPayload({ priceLevel: 'PRICE_LEVEL_FREE' })],
            ['javascript: website', frontendPayload({ website: 'javascript:alert(1)' })],
            ['array body', []],
        ])('%s → 400 on POST and PUT, nothing queued, no idempotency key reserved', async (_label, payload) => {
            const post = await request(baseURL)
                .post('/api/v1/coffee-shops')
                .set('Idempotency-Key', 'invalid-post')
                .send(payload);
            const put = await request(baseURL)
                .put(`/api/v1/coffee-shops/${published[0].id}`)
                .set('Idempotency-Key', 'invalid-put')
                .send(payload);

            expect(post.status).toBe(400);
            expect(put.status).toBe(400);
            expect(post.body.success).toBe(false);
            expect(await queryAll(db, 'SELECT id FROM shop_submissions')).toHaveLength(0);
            expect(await queryAll(db, 'SELECT key FROM idempotency_keys')).toHaveLength(0);
        });
    });

    describe('PUT /api/v1/coffee-shops/:id', () => {
        it('queues an update proposal for an existing shop without changing the published row', async () => {
            const target = published[0];
            const res = await request(baseURL)
                .put(`/api/v1/coffee-shops/${target.id}`)
                .send(frontendPayload({ id: String(target.id), displayName: { text: 'Defaced Name' }, state: 'TX' }));

            expect(res.status).toBe(202);
            expect(res.body.data).toMatchObject({
                status: 'pending_review',
                kind: 'update',
                targetShopId: target.id,
                displayName: { text: 'Defaced Name', languageCode: 'en' },
            });

            const rows = await queryAll(db, 'SELECT kind, target_shop_id, name, status FROM shop_submissions');
            expect(rows).toEqual([{ kind: 'update', target_shop_id: target.id, name: 'Defaced Name', status: 'pending' }]);
        });

        it('rejects an update proposal for a shop that does not exist and stores nothing', async () => {
            const res = await request(baseURL)
                .put('/api/v1/coffee-shops/999999')
                .send(frontendPayload());
            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
            expect(await queryAll(db, 'SELECT id FROM shop_submissions')).toHaveLength(0);
        });

        it.each([
            ['abc'], ['0'], ['-1'], ['12abc'], ['1.5'], ['1e3'], ['01'], ['99999999999'],
        ])('rejects malformed shop id %p with 400 and stores nothing', async (id) => {
            const res = await request(baseURL)
                .put(`/api/v1/coffee-shops/${id}`)
                .set('Idempotency-Key', `bad-id-${id}`)
                .send(frontendPayload());
            expect(res.status).toBe(400);
            expect(await queryAll(db, 'SELECT id FROM shop_submissions')).toHaveLength(0);
            expect(await queryAll(db, 'SELECT key FROM idempotency_keys')).toHaveLength(0);
        });
    });
});
