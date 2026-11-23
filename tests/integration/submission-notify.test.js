/**
 * Integration Tests — reviewer email on POST/PUT /coffee-shops
 *
 * The email is a side effect of a successful enqueue, so it must never
 * change the HTTP outcome. A failing or hanging provider still gets a 202,
 * an idempotent replay doesn't send twice, and a rejected request sends nothing.
 */

const request = require('supertest');
const {
    createTestDatabase, closeDatabase, seedTestData, queryAll,
} = require('../helpers/testDb');
const { startTestServer, stopTestServer } = require('../helpers/testServer');

const NOTIFY_ENV = {
    WRITE_RATE_LIMIT_MAX: '1000',
    SUBMISSION_NOTIFY_ENABLED: 'true',
    SUBMISSION_NOTIFY_RESEND_API_KEY: 're_test_abcdefghijklmnop',
    SUBMISSION_NOTIFY_TO: 'reviewer@example.com',
    SUBMISSION_NOTIFY_FROM: 'LocalCoffeeShop <submissions@mail.example.com>',
};

function payload(name = 'Corner Roasters') {
    return { shop: { displayName: { text: name }, formattedAddress: '10 Market St, San Francisco, California 94105', state: 'CA' } };
}

const flush = () => new Promise((r) => setTimeout(r, 50));

describe('Submission reviewer email', () => {
    let db;
    let baseURL;
    let mode;
    const calls = [];

    async function fetchImpl(url, init) {
        calls.push({ url, body: JSON.parse(init.body), key: init.headers['Idempotency-Key'] });
        if (mode === 'fail') return { status: 500, ok: false };
        if (mode === 'hang') return new Promise(() => {});
        return { status: 200, ok: true };
    }

    beforeAll(async () => {
        db = await createTestDatabase();
        await seedTestData(db, [{ name: 'Published One', address: '1 First St, Austin, Texas 78701', price_level: null, state: 'TX' }]);
        const info = await startTestServer(db, { env: NOTIFY_ENV, deps: { submissionNotifyFetch: fetchImpl } });
        baseURL = info.url;
    });

    afterAll(async () => {
        await stopTestServer();
        await closeDatabase(db);
    });

    beforeEach(async () => {
        mode = 'ok';
        calls.length = 0;
        await queryAll(db, 'DELETE FROM shop_submissions');
        await queryAll(db, 'DELETE FROM idempotency_keys');
    });

    it('emails the reviewer once per queued submission, keyed by its id', async () => {
        const res = await request(baseURL).post('/api/v1/coffee-shops').send(payload());
        expect(res.status).toBe(202);
        await flush();
        expect(calls).toHaveLength(1);
        expect(calls[0].key).toBe(`lcs-submission-${res.body.data.submissionId}`);
        expect(calls[0].body.to).toEqual(['reviewer@example.com']);
        expect(calls[0].body.subject).toContain(`#${res.body.data.submissionId}`);
    });

    it('labels update proposals', async () => {
        const res = await request(baseURL).put('/api/v1/coffee-shops/1').send(payload('Published One Renamed'));
        expect(res.status).toBe(202);
        await flush();
        expect(calls[0].body.subject).toContain('Update to shop 1');
    });

    it.each(['fail', 'hang'])('a provider that %ss still gets a 202 and the submission is queued', async (m) => {
        mode = m;
        const res = await request(baseURL).post('/api/v1/coffee-shops').send(payload());
        expect(res.status).toBe(202);
        expect(await queryAll(db, 'SELECT id FROM shop_submissions')).toHaveLength(1);
    });

    it('an idempotent replay does not send a second email', async () => {
        const key = 'notify-replay-1';
        const first = await request(baseURL).post('/api/v1/coffee-shops').set('Idempotency-Key', key).send(payload());
        const again = await request(baseURL).post('/api/v1/coffee-shops').set('Idempotency-Key', key).send(payload());
        expect(first.status).toBe(202);
        expect(again.status).toBe(202);
        await flush();
        expect(calls).toHaveLength(1);
    });

    it('a rejected (invalid) submission sends nothing', async () => {
        const res = await request(baseURL).post('/api/v1/coffee-shops').send({ shop: { state: 'CA' } });
        expect(res.status).toBe(400);
        await flush();
        expect(calls).toHaveLength(0);
    });
});
