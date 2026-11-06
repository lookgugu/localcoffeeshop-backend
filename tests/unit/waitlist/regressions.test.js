/**
 * Regression tests for the independent backend review blockers
 * (reports/localcoffeeshop-waitlist-20261018/agy-backend-review.md).
 *
 * The fake Resend enforces the real idempotency contract (same key + different
 * payload → 409 invalid_idempotent_request), so these fail against the
 * pre-fix implementation. "Process recreation" means a brand-new service and
 * provider over the same provider state, i.e. an API restart or a second
 * instance: nothing may depend on in-memory state for correctness.
 */

const { makeWaitlistService } = require('../../../src/waitlist/service');
const { makeResendProvider } = require('../../../src/waitlist/resend-provider');
const { loadWaitlistConfig } = require('../../../src/waitlist/config');
const { loadConfig } = require('../../../src/config');
const {
    makeFakeResend, waitlistEnv, tokenFromEmail, jsonResponse, SEGMENT_ID, SUPPRESSION_SEGMENT_ID, OTHER_SEGMENT_ID,
} = require('../../helpers/waitlistEnv');

const EMAIL = 'person@example.com';
const T0 = 1_800_000_000_000;
const silent = { info() {}, warn() {}, error() {} };

function loadWl(env = {}) {
    const wl = loadWaitlistConfig(waitlistEnv(env), { nodeEnv: 'test', corsOrigins: ['https://localcoffeeshop.co'], metricsAuthToken: '' });
    expect(wl.enabled).toBe(true);
    return wl;
}

/** A fresh service + provider (one "process") over shared fake provider state. */
function instance(wl, fake, now) {
    const provider = makeResendProvider({
        apiKey: wl.apiKey,
        segmentId: wl.segmentId,
        segmentName: wl.segmentName,
        suppressionSegmentId: wl.suppressionSegmentId,
        suppressionSegmentName: wl.suppressionSegmentName,
        fetchImpl: fake.fetchImpl,
        timeoutMs: 50,
        maxRetries: 1,
        sleep: () => new Promise((r) => setImmediate(r)),
    });
    return makeWaitlistService({ waitlist: wl, provider, logger: silent, now: () => now.t });
}

function setup(env = {}) {
    const wl = loadWl(env);
    const fake = makeFakeResend();
    const now = { t: T0 };
    return { wl, fake, now, service: instance(wl, fake, now), restart: () => instance(wl, fake, now) };
}

const signup = (service, email = EMAIL) => service.requestSignup({ email, source: 'home', honeypotTripped: false });

describe('blocker 1: identical provider payload for idempotent retries', () => {
    it('a retry in the same bucket on the same instance succeeds without a second email', async () => {
        const ctx = setup();
        await signup(ctx.service);
        ctx.now.t += 60_000;
        await expect(signup(ctx.service)).resolves.toEqual({ status: 'pending_confirmation' });
        expect(ctx.fake.state.emails).toHaveLength(1);
    });

    it('a retry after process recreation sends a byte-identical payload with the same key', async () => {
        const ctx = setup();
        await signup(ctx.service);
        ctx.now.t += 90_000;
        await expect(signup(ctx.restart())).resolves.toEqual({ status: 'pending_confirmation' });
        const sends = ctx.fake.state.calls.filter((c) => c.path === '/emails');
        expect(sends).toHaveLength(2);
        expect(sends[1].headers['Idempotency-Key']).toBe(sends[0].headers['Idempotency-Key']);
        expect(JSON.stringify(sends[1].body)).toBe(JSON.stringify(sends[0].body));
        expect(ctx.fake.state.emails).toHaveLength(1);
    });

    it('the email still carries no address in cleartext in its links', async () => {
        const ctx = setup();
        await signup(ctx.service, 'needle.address@example.com');
        const mail = ctx.fake.state.emails[0];
        for (const kind of ['confirm', 'unsubscribe']) {
            expect(tokenFromEmail(mail, kind)).not.toMatch(/needle|example/);
        }
        expect(mail.text.match(/https:\/\/\S+/g).join(' ')).not.toMatch(/needle/);
    });

    it('two instances signing up the same address concurrently send exactly one email', async () => {
        const ctx = setup();
        const results = await Promise.all([signup(ctx.service), signup(ctx.restart())]);
        expect(results).toEqual([{ status: 'pending_confirmation' }, { status: 'pending_confirmation' }]);
        expect(ctx.fake.state.emails).toHaveLength(1);
    });
});

describe('blocker 2: durable CoffeeShop-scoped suppression', () => {
    it('confirm → unsubscribe → restart → replay old confirm token does NOT re-subscribe', async () => {
        const ctx = setup();
        await signup(ctx.service);
        const mail = ctx.fake.state.emails[0];
        expect((await ctx.service.confirm(tokenFromEmail(mail, 'confirm'))).status).toBe('confirmed');
        expect((await ctx.service.unsubscribe(tokenFromEmail(mail, 'unsubscribe'))).status).toBe('unsubscribed');

        const restarted = ctx.restart();
        const replay = await restarted.confirm(tokenFromEmail(mail, 'confirm'));
        expect(replay).toEqual({ status: 'suppressed', conversion: 'none' });
        expect(ctx.fake.segmentsOf(EMAIL)).not.toContain(SEGMENT_ID);
        expect(ctx.fake.state.contacts.get(EMAIL).unsubscribed).toBe(false); // global flag untouched
    });

    it('unsubscribe BEFORE the first confirm → restart → confirm does NOT subscribe', async () => {
        const ctx = setup();
        await signup(ctx.service);
        const mail = ctx.fake.state.emails[0];
        expect((await ctx.service.unsubscribe(tokenFromEmail(mail, 'unsubscribe'))).status).toBe('not_subscribed');

        const res = await ctx.restart().confirm(tokenFromEmail(mail, 'confirm'));
        expect(res).toEqual({ status: 'suppressed', conversion: 'none' });
        expect(ctx.fake.segmentsOf(EMAIL)).toEqual([SUPPRESSION_SEGMENT_ID]);
    });

    it('a suppressed confirm never writes list membership, even transiently', async () => {
        const ctx = setup();
        await signup(ctx.service);
        const mail = ctx.fake.state.emails[0];
        await ctx.service.unsubscribe(tokenFromEmail(mail, 'unsubscribe'));
        const before = ctx.fake.writes().length;
        expect((await ctx.restart().confirm(tokenFromEmail(mail, 'confirm'))).status).toBe('suppressed');
        expect(ctx.fake.writes().slice(before)).toEqual([]);
    });

    it('an unsubscribe that lands between the suppression check and the add is undone (race)', async () => {
        const ctx = setup();
        await signup(ctx.service);
        const token = tokenFromEmail(ctx.fake.state.emails[0]);
        ctx.fake.failNext((c) => c.method === 'POST' && c.path.endsWith(`/segments/${SEGMENT_ID}`), (call) => {
            // A concurrent unsubscribe (another instance) completes right now.
            const contact = ctx.fake.state.contacts.get(EMAIL);
            contact.segments.add(SUPPRESSION_SEGMENT_ID);
            contact.segments.add(SEGMENT_ID); // ... and this add still lands
            return jsonResponse(200, { id: SEGMENT_ID, call: call.path });
        });
        expect(await ctx.service.confirm(token)).toEqual({ status: 'suppressed', conversion: 'none' });
        expect(ctx.fake.segmentsOf(EMAIL)).toEqual([SUPPRESSION_SEGMENT_ID]);
    });

    it('suppression never touches other businesses’ segments or the global flag', async () => {
        const ctx = setup();
        const existing = ctx.fake.seedContact(EMAIL, { segmentIds: [OTHER_SEGMENT_ID], first_name: 'Kept' });
        await signup(ctx.service);
        await ctx.service.unsubscribe(tokenFromEmail(ctx.fake.state.emails[0], 'unsubscribe'));
        expect([...existing.segments].sort()).toEqual([OTHER_SEGMENT_ID, SUPPRESSION_SEGMENT_ID].sort());
        expect(existing.unsubscribed).toBe(false);
        expect(existing.first_name).toBe('Kept');
        expect(ctx.fake.writes().some((w) => w.method === 'PATCH' || w.path.includes(OTHER_SEGMENT_ID))).toBe(false);
    });

    it('a suppressed address gets the normal 202 but no further confirmation email', async () => {
        const ctx = setup();
        await signup(ctx.service);
        await ctx.service.unsubscribe(tokenFromEmail(ctx.fake.state.emails[0], 'unsubscribe'));
        ctx.now.t += 11 * 60_000;
        await expect(signup(ctx.restart())).resolves.toEqual({ status: 'pending_confirmation' });
        expect(ctx.fake.state.emails).toHaveLength(1);
    });
});

describe('blocker 3: quotas reserved before awaits; same-bucket dedup', () => {
    it('concurrent signups cannot exceed the global hourly cap', async () => {
        const ctx = setup({ WAITLIST_GLOBAL_SENDS_PER_HOUR: '2' });
        const results = await Promise.allSettled(['a', 'b', 'c', 'd'].map((n) => signup(ctx.service, `${n}@example.com`)));
        expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(2);
        expect(results.filter((r) => r.status === 'rejected').map((r) => r.reason.code)).toEqual(['WAITLIST_UNAVAILABLE', 'WAITLIST_UNAVAILABLE']);
        expect(ctx.fake.state.emails).toHaveLength(2);
    });

    it('concurrent signups in different buckets cannot exceed the per-address cap', async () => {
        const ctx = setup({ WAITLIST_EMAIL_MAX_PER_DAY: '2' });
        const pending = [];
        for (let i = 0; i < 4; i++) {
            pending.push(signup(ctx.service));
            ctx.now.t += 11 * 60_000; // each call in its own idempotency bucket, none awaited yet
        }
        const results = await Promise.allSettled(pending);
        expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(2);
        expect(results.filter((r) => r.status === 'rejected').every((r) => r.reason.code === 'WAITLIST_RATE_LIMITED')).toBe(true);
        expect(ctx.fake.state.emails).toHaveLength(2);
    });

    it('same-bucket retries do not consume extra per-address quota', async () => {
        const ctx = setup(); // default 3/day
        for (let i = 0; i < 5; i++) {
            await expect(signup(ctx.service)).resolves.toEqual({ status: 'pending_confirmation' });
            ctx.now.t += 10_000;
        }
        ctx.now.t += 11 * 60_000;
        await expect(signup(ctx.service)).resolves.toEqual({ status: 'pending_confirmation' });
        expect(ctx.fake.state.emails).toHaveLength(2);
    });

    it('concurrent same-bucket requests share one provider send', async () => {
        const ctx = setup();
        const results = await Promise.all([signup(ctx.service), signup(ctx.service), signup(ctx.service)]);
        expect(results.every((r) => r.status === 'pending_confirmation')).toBe(true);
        expect(ctx.fake.state.calls.filter((c) => c.path === '/emails')).toHaveLength(1);
    });

    it('a definite provider rejection releases the reserved quota', async () => {
        const ctx = setup({ WAITLIST_EMAIL_MAX_PER_DAY: '1', WAITLIST_GLOBAL_SENDS_PER_HOUR: '1' });
        ctx.fake.failNext((c) => c.path === '/emails', jsonResponse(422, { name: 'validation_error' }));
        await expect(signup(ctx.service)).rejects.toMatchObject({ code: 'WAITLIST_PROVIDER_ERROR' });
        await expect(signup(ctx.service)).resolves.toEqual({ status: 'pending_confirmation' });
    });
});

describe('blocker 4: honest confirmation conversion semantics', () => {
    it('first confirm reports conversion "observed_new"; replay reports "none"', async () => {
        const ctx = setup();
        await signup(ctx.service);
        const token = tokenFromEmail(ctx.fake.state.emails[0]);
        expect(await ctx.service.confirm(token)).toEqual({ status: 'confirmed', conversion: 'observed_new' });
        expect(await ctx.restart().confirm(token)).toEqual({ status: 'already_confirmed', conversion: 'none' });
    });

    it('an add that landed but errored is "confirmed" with conversion "ambiguous" (not a false already_confirmed)', async () => {
        const ctx = setup();
        await signup(ctx.service);
        const token = tokenFromEmail(ctx.fake.state.emails[0]);
        ctx.fake.failAlways((c) => c.method === 'POST' && c.path.endsWith(`/segments/${SEGMENT_ID}`), (call) => {
            const id = call.path.split('/')[2];
            for (const c of ctx.fake.state.contacts.values()) if (c.id === id) c.segments.add(SEGMENT_ID);
            return jsonResponse(500, { name: 'application_error' });
        });
        expect(await ctx.service.confirm(token)).toEqual({ status: 'confirmed', conversion: 'ambiguous' });
    });

    it('confirmations racing on two instances never both claim more than they observed', async () => {
        const ctx = setup();
        await signup(ctx.service);
        const token = tokenFromEmail(ctx.fake.state.emails[0]);
        const results = await Promise.all([ctx.service.confirm(token), ctx.restart().confirm(token)]);
        for (const r of results) {
            expect(['confirmed', 'already_confirmed']).toContain(r.status);
            expect(['observed_new', 'ambiguous', 'none']).toContain(r.conversion);
        }
        expect(ctx.fake.segmentsOf(EMAIL)).toEqual([SEGMENT_ID]);
    });

    it('globally unsubscribed contacts report conversion "none"', async () => {
        const ctx = setup();
        ctx.fake.seedContact(EMAIL, { unsubscribed: true });
        const token = require('../../../src/waitlist/tokens')
            .makeTokenCodec({ secret: ctx.wl.signingSecret, segmentId: ctx.wl.segmentId, frontendOrigin: ctx.wl.frontendOrigin, now: () => ctx.now.t })
            .seal('confirm', EMAIL, 3600);
        expect(await ctx.service.confirm(token)).toEqual({ status: 'unsubscribed_globally', conversion: 'none' });
    });
});

describe('blocker 5: CORS fail closed', () => {
    it.each([undefined, ''])('CORS_ORIGIN=%p keeps the waitlist disabled', (value) => {
        const env = waitlistEnv({ CORS_ORIGIN: value });
        if (value === undefined) delete env.CORS_ORIGIN;
        const config = loadConfig(env);
        expect(config.waitlist.enabled).toBe(false);
        expect(config.waitlist.problems.join(' ')).toMatch(/CORS_ORIGIN/);
    });
});
