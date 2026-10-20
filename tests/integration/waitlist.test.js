/**
 * Integration Tests — /api/v1/waitlist/*
 *
 * Full HTTP stack (middleware, limiters, body parser, error envelope) with a
 * fake Resend behind the injected fetch. Proves: fail-closed when not
 * configured, double opt-in (pending vs confirmed), POST-only mutation,
 * spam controls, no-store responses, no email/token in logs, and that the
 * SQLite database is never written.
 */

const request = require('supertest');
const { Writable } = require('stream');
const pino = require('pino');
const { createTestDatabase, closeDatabase, queryAll } = require('../helpers/testDb');
const { startTestServer, stopTestServer } = require('../helpers/testServer');
const { makeFakeResend, waitlistEnv, tokenFromEmail, jsonResponse, SEGMENT_ID, SUPPRESSION_SEGMENT_ID } = require('../helpers/waitlistEnv');

const ORIGIN = 'https://localcoffeeshop.co';
const EMAIL = 'qa.person+waitlist@example.com';

function captureLogger() {
    const chunks = [];
    const stream = new Writable({ write(chunk, _enc, cb) { chunks.push(chunk.toString()); cb(); } });
    return { logger: pino({ level: 'debug' }, stream), text: () => chunks.join('') };
}

describe('waitlist API', () => {
    let db;
    let baseURL;
    let fake;
    let logs;

    async function boot(env = waitlistEnv(), { withFake = true } = {}) {
        await stopTestServer();
        fake = makeFakeResend();
        logs = captureLogger();
        const info = await startTestServer(db, {
            env: { WRITE_RATE_LIMIT_MAX: '1000', ...env },
            deps: { ...(withFake ? { waitlistFetch: fake.fetchImpl } : {}), logger: logs.logger, waitlistSleep: async () => {} },
        });
        baseURL = info.url;
    }

    const post = (path, body, origin = ORIGIN) => {
        const req = request(baseURL).post(`/api/v1/waitlist/${path}`);
        if (origin) req.set('Origin', origin);
        return req.send(body);
    };

    const signup = (overrides = {}) => post('subscribe', { email: EMAIL, consent: true, source: 'home', company: '', ...overrides });

    beforeAll(async () => {
        db = await createTestDatabase();
    });

    afterAll(async () => {
        await stopTestServer();
        await closeDatabase(db);
    });

    describe('when not configured', () => {
        it('returns 503 WAITLIST_UNAVAILABLE for every endpoint and never calls a provider', async () => {
            await boot({ NODE_ENV: 'test', CORS_ORIGIN: ORIGIN }, { withFake: true });
            for (const [path, body] of [['subscribe', { email: EMAIL, consent: true, source: 'home' }], ['confirm', { token: 'v1.x' }], ['unsubscribe', { token: 'v1.x' }]]) {
                const res = await post(path, body);
                expect(res.status).toBe(503);
                expect(res.body.error.code).toBe('WAITLIST_UNAVAILABLE');
                expect(res.headers['retry-after']).toBeDefined();
            }
            expect(fake.state.calls).toHaveLength(0);
        });

        it('a partially configured waitlist is also closed', async () => {
            const env = waitlistEnv();
            delete env.WAITLIST_SIGNING_SECRET;
            await boot(env);
            expect((await signup()).status).toBe(503);
            expect(fake.state.calls).toHaveLength(0);
        });
    });

    describe('when configured', () => {
        beforeEach(() => boot());

        it('subscribe → 202 pending_confirmation (not confirmed), no-store, one email, no contact writes', async () => {
            const res = await signup();
            expect(res.status).toBe(202);
            expect(res.body).toEqual({ success: true, data: { status: 'pending_confirmation' } });
            expect(res.headers['cache-control']).toBe('no-store');
            expect(fake.state.emails).toHaveLength(1);
            expect(fake.writes().map((w) => w.path)).toEqual(['/emails']);
        });

        it('400 with per-field codes for invalid input, nothing sent', async () => {
            const res = await signup({ email: 'nope', consent: false });
            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('VALIDATION_FAILED');
            expect(res.body.error.fields).toEqual([{ field: 'email', code: 'email_invalid' }, { field: 'consent', code: 'consent_required' }]);
            expect(JSON.stringify(res.body)).not.toContain('nope');
            expect(fake.state.calls).toHaveLength(0);
        });

        it('rejects unknown fields and non-JSON bodies', async () => {
            expect((await signup({ name: 'x' })).status).toBe(400);
            const text = await request(baseURL).post('/api/v1/waitlist/subscribe').set('Origin', ORIGIN)
                .set('Content-Type', 'text/plain').send(`email=${EMAIL}&consent=true`);
            expect(text.status).toBe(400);
            expect(fake.state.calls).toHaveLength(0);
        });

        it('honeypot submissions get the normal 202 but send nothing', async () => {
            const res = await signup({ company: 'Totally A Company' });
            expect(res.status).toBe(202);
            expect(fake.state.calls).toHaveLength(0);
        });

        it('refuses a foreign Origin (403) before any provider call', async () => {
            const res = await post('subscribe', { email: EMAIL, consent: true, source: 'home' }, 'https://evil.example');
            expect(res.status).toBe(403);
            expect(res.body.error.code).toBe('WAITLIST_ORIGIN_FORBIDDEN');
            expect(fake.state.calls).toHaveLength(0);
        });

        it('GET on the confirm/unsubscribe endpoints does not mutate (email scanners)', async () => {
            await signup();
            const token = tokenFromEmail(fake.state.emails[0]);
            const before = fake.writes().length;
            for (const path of [`confirm?token=${token}`, `confirm/${token}`, `unsubscribe?token=${token}`]) {
                const res = await request(baseURL).get(`/api/v1/waitlist/${path}`);
                expect(res.status).toBe(404);
            }
            expect(fake.writes()).toHaveLength(before);
            expect(fake.state.contacts.size).toBe(0);
        });

        it('explicit POST confirm → confirmed; replay → already_confirmed', async () => {
            await signup();
            const token = tokenFromEmail(fake.state.emails[0]);
            const first = await post('confirm', { token });
            expect(first.status).toBe(200);
            expect(first.body.data).toEqual({ status: 'confirmed', conversion: 'observed_new' });
            expect(first.headers['cache-control']).toBe('no-store');
            expect([...fake.state.contacts.get(EMAIL.toLowerCase()).segments]).toEqual([SEGMENT_ID]);
            const replay = await post('confirm', { token });
            expect(replay.body.data).toEqual({ status: 'already_confirmed', conversion: 'none' });
        });

        it('invalid and expired tokens are distinguished', async () => {
            const invalid = await post('confirm', { token: 'v1.notatoken' });
            expect(invalid.status).toBe(400);
            expect(invalid.body.error.code).toBe('WAITLIST_TOKEN_INVALID');
            const malformed = await post('confirm', { token: 'has spaces' });
            expect(malformed.status).toBe(400);
        });

        it('provider outage → 502 WAITLIST_PROVIDER_ERROR', async () => {
            fake.failAlways((c) => c.path === '/emails', jsonResponse(500, { name: 'application_error' }));
            const res = await signup();
            expect(res.status).toBe(502);
            expect(res.body.error.code).toBe('WAITLIST_PROVIDER_ERROR');
            expect(res.body.data).toBeUndefined();
        });

        it('unsubscribe → unsubscribed from the dedicated segment', async () => {
            await signup();
            await post('confirm', { token: tokenFromEmail(fake.state.emails[0]) });
            const res = await post('unsubscribe', { token: tokenFromEmail(fake.state.emails[0], 'unsubscribe') });
            expect(res.body.data).toEqual({ status: 'unsubscribed' });
            expect([...fake.state.contacts.get(EMAIL.toLowerCase()).segments]).toEqual([SUPPRESSION_SEGMENT_ID]);
            // the old confirmation link can no longer re-add the address
            const replay = await post('confirm', { token: tokenFromEmail(fake.state.emails[0]) });
            expect(replay.status).toBe(200);
            expect(replay.body.data).toEqual({ status: 'suppressed', conversion: 'none' });
            expect([...fake.state.contacts.get(EMAIL.toLowerCase()).segments]).toEqual([SUPPRESSION_SEGMENT_ID]);
        });

        it('a retried subscribe in the same window returns 202 with no second email', async () => {
            expect((await signup()).status).toBe(202);
            expect((await signup()).status).toBe(202);
            expect(fake.state.emails).toHaveLength(1);
            expect(fake.state.calls.filter((c) => c.path === '/emails')).toHaveLength(1);
        });

        it('logs contain neither the email address nor tokens', async () => {
            await signup();
            const token = tokenFromEmail(fake.state.emails[0]);
            await post('confirm', { token });
            await signup({ email: 'bad address@example.com' });
            const text = logs.text();
            expect(text).not.toMatch(/example\.com/);
            expect(text).not.toContain(token);
            expect(text).toMatch(/waitlist_confirmed/);
        });

        it('never writes to the SQLite database', async () => {
            const tables = async () => queryAll(db, "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
            const before = await tables();
            const counts = async () => Promise.all(before.map(async (t) => (await queryAll(db, `SELECT COUNT(*) AS n FROM "${t.name}"`))[0].n));
            const beforeCounts = await counts();
            await signup();
            await post('confirm', { token: tokenFromEmail(fake.state.emails[0]) });
            expect(await tables()).toEqual(before);
            expect(await counts()).toEqual(beforeCounts);
        });
    });

    describe('rate limits', () => {
        it('per-IP subscribe limit returns 429 WAITLIST_RATE_LIMITED', async () => {
            await boot(waitlistEnv({ WAITLIST_IP_MAX: '2' }));
            expect((await signup({ email: 'a@example.com' })).status).toBe(202);
            expect((await signup({ email: 'b@example.com' })).status).toBe(202);
            const blocked = await signup({ email: 'c@example.com' });
            expect(blocked.status).toBe(429);
            expect(blocked.body.error.code).toBe('WAITLIST_RATE_LIMITED');
            expect(fake.state.emails).toHaveLength(2);
        });

        it('the shared write limiter still applies to waitlist POSTs', async () => {
            await boot({ ...waitlistEnv(), WRITE_RATE_LIMIT_MAX: '1' });
            // boot() spreads WRITE_RATE_LIMIT_MAX=1000 first; env wins.
            expect((await signup()).status).toBe(202);
            expect((await post('confirm', { token: 'v1.x' })).status).toBe(429);
        });
    });
});
