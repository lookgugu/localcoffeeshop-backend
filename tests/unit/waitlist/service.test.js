/**
 * Unit Tests — waitlist service (double opt-in against the provider)
 *
 * Signup only SENDS a confirmation email (provider acceptance = pending, not
 * confirmed). The contact is created / added to the dedicated segment only
 * when the token holder explicitly confirms. Provider state is the source of
 * truth for dedup; nothing is stored locally.
 */

const { makeWaitlistService, WaitlistError } = require('../../../src/waitlist/service');
const { makeResendProvider } = require('../../../src/waitlist/resend-provider');
const { loadWaitlistConfig } = require('../../../src/waitlist/config');
const { makeFakeResend, waitlistEnv, tokenFromEmail, jsonResponse, SEGMENT_ID, OTHER_SEGMENT_ID, SUPPRESSION_SEGMENT_ID } = require('../../helpers/waitlistEnv');

const EMAIL = 'person@example.com';

function recordingLogger() {
    const lines = [];
    const log = (level) => (obj, msg) => lines.push({ level, obj, msg });
    return { lines, info: log('info'), warn: log('warn'), error: log('error') };
}

function setup({ env = {}, now = { t: 1_800_000_000_000 }, segmentId } = {}) {
    const wl = loadWaitlistConfig(waitlistEnv(env), { nodeEnv: 'test', corsOrigins: ['https://localcoffeeshop.co'], metricsAuthToken: '' });
    expect(wl.enabled).toBe(true);
    const fake = makeFakeResend();
    const provider = makeResendProvider({
        apiKey: wl.apiKey,
        segmentId: segmentId || wl.segmentId,
        segmentName: wl.segmentName,
        suppressionSegmentId: wl.suppressionSegmentId,
        suppressionSegmentName: wl.suppressionSegmentName,
        fetchImpl: fake.fetchImpl,
        timeoutMs: 50,
        maxRetries: 1,
        sleep: async () => {},
    });
    const logger = recordingLogger();
    const service = makeWaitlistService({ waitlist: wl, provider, logger, now: () => now.t });
    return { wl, fake, provider, service, logger, now };
}

async function signupAndToken(ctx, email = EMAIL) {
    await ctx.service.requestSignup({ email, source: 'home', honeypotTripped: false });
    return tokenFromEmail(ctx.fake.state.emails.at(-1));
}

describe('requestSignup', () => {
    it('sends one confirmation email and makes NO contact/segment writes', async () => {
        const ctx = setup();
        expect(await ctx.service.requestSignup({ email: EMAIL, source: 'home', honeypotTripped: false }))
            .toEqual({ status: 'pending_confirmation' });
        expect(ctx.fake.state.emails).toHaveLength(1);
        expect(ctx.fake.writes().map((c) => c.path)).toEqual(['/emails']);
        expect(ctx.fake.state.contacts.size).toBe(0);
    });

    it('email has the dedicated sender, fragment links, interest-only and unsubscribe/support copy', async () => {
        const ctx = setup();
        await ctx.service.requestSignup({ email: EMAIL, source: 'roasters', honeypotTripped: false });
        const mail = ctx.fake.state.emails[0];
        expect(mail.from).toBe('Local Coffee Shops <waitlist@localcoffeeshop.co>');
        expect(mail.to).toEqual([EMAIL]);
        expect(mail.text).toMatch(/https:\/\/localcoffeeshop\.co\/waitlist\/confirm\/#token=v2\./);
        expect(mail.text).toMatch(/https:\/\/localcoffeeshop\.co\/waitlist\/unsubscribe\/#token=v2\./);
        expect(mail.text).toMatch(/won.t be added/i);
        expect(mail.text).toMatch(/no payment/i);
        expect(mail.text).toMatch(/pages\/contact\.html/);
        expect(mail.text).not.toMatch(/\?token=/); // tokens never in a query string
        expect(mail.html).toContain('#token=v2.');
        expect(mail.idempotencyKey).toMatch(/^waitlist-confirm-[A-Za-z0-9_-]{20,}$/);
        expect(mail.idempotencyKey).not.toContain('person');
    });

    it('a retried signup inside the idempotency bucket reuses the key (provider sends once)', async () => {
        const ctx = setup();
        await ctx.service.requestSignup({ email: EMAIL, source: 'home', honeypotTripped: false });
        ctx.now.t += 60_000;
        await ctx.service.requestSignup({ email: EMAIL, source: 'home', honeypotTripped: false });
        const keys = ctx.fake.state.calls.filter((c) => c.path === '/emails').map((c) => c.headers['Idempotency-Key']);
        expect(new Set(keys).size).toBe(1);
        expect(ctx.fake.state.emails).toHaveLength(1);
    });

    it('honeypot: same response, nothing sent', async () => {
        const ctx = setup();
        expect(await ctx.service.requestSignup({ email: EMAIL, source: 'home', honeypotTripped: true })).toEqual({ status: 'pending_confirmation' });
        expect(ctx.fake.state.calls).toHaveLength(0);
    });

    it('limits confirmation emails per address (anti mail-bombing)', async () => {
        const ctx = setup({ env: { WAITLIST_EMAIL_MAX_PER_DAY: '2' } });
        for (let i = 0; i < 2; i++) {
            ctx.now.t += 11 * 60_000; // new idempotency bucket each time
            await ctx.service.requestSignup({ email: EMAIL, source: 'home', honeypotTripped: false });
        }
        ctx.now.t += 11 * 60_000;
        const err = await ctx.service.requestSignup({ email: EMAIL, source: 'home', honeypotTripped: false }).catch((e) => e);
        expect(err).toBeInstanceOf(WaitlistError);
        expect(err).toMatchObject({ code: 'WAITLIST_RATE_LIMITED', status: 429 });
        // a different address is unaffected
        await ctx.service.requestSignup({ email: 'other@example.com', source: 'home', honeypotTripped: false });
    });

    it('caps total sends per hour (cost/abuse ceiling)', async () => {
        const ctx = setup({ env: { WAITLIST_GLOBAL_SENDS_PER_HOUR: '2' } });
        await ctx.service.requestSignup({ email: 'a@example.com', source: 'home', honeypotTripped: false });
        await ctx.service.requestSignup({ email: 'b@example.com', source: 'home', honeypotTripped: false });
        await expect(ctx.service.requestSignup({ email: 'c@example.com', source: 'home', honeypotTripped: false }))
            .rejects.toMatchObject({ code: 'WAITLIST_UNAVAILABLE', status: 503 });
    });

    it('provider failure after retries → 502 WAITLIST_PROVIDER_ERROR (never reported as accepted)', async () => {
        const ctx = setup();
        ctx.fake.failAlways((c) => c.path === '/emails', jsonResponse(500, { name: 'application_error' }));
        await expect(ctx.service.requestSignup({ email: EMAIL, source: 'home', honeypotTripped: false }))
            .rejects.toMatchObject({ code: 'WAITLIST_PROVIDER_ERROR', status: 502 });
    });

    it('provider timeout → 502 after retrying', async () => {
        const ctx = setup();
        ctx.fake.hangNext((c) => c.path === '/emails');
        ctx.fake.hangNext((c) => c.path === '/emails');
        await expect(ctx.service.requestSignup({ email: EMAIL, source: 'home', honeypotTripped: false }))
            .rejects.toMatchObject({ code: 'WAITLIST_PROVIDER_ERROR' });
        expect(ctx.fake.state.calls.filter((c) => c.path === '/emails')).toHaveLength(2);
    });

    it('a segment that fails isolation verification → 503 and nothing is sent', async () => {
        const ctx = setup({ segmentId: OTHER_SEGMENT_ID });
        await expect(ctx.service.requestSignup({ email: EMAIL, source: 'home', honeypotTripped: false }))
            .rejects.toMatchObject({ code: 'WAITLIST_UNAVAILABLE', status: 503 });
        expect(ctx.fake.writes()).toHaveLength(0);
    });

    it('never logs the email address or a token', async () => {
        const ctx = setup();
        await ctx.service.requestSignup({ email: EMAIL, source: 'home', honeypotTripped: false });
        const token = tokenFromEmail(ctx.fake.state.emails[0]);
        await ctx.service.confirm(token);
        ctx.fake.failAlways(() => true, jsonResponse(500, { name: 'application_error', message: EMAIL }));
        await ctx.service.requestSignup({ email: 'x@example.com', source: 'home', honeypotTripped: false }).catch(() => {});
        const text = JSON.stringify(ctx.logger.lines);
        expect(text).not.toContain('example.com');
        expect(text).not.toContain(token);
        expect(text).toMatch(/waitlist_confirmation_sent/);
    });
});

describe('confirm', () => {
    it('creates the contact and adds it to the dedicated segment only on confirmation', async () => {
        const ctx = setup();
        const token = await signupAndToken(ctx);
        expect(await ctx.service.confirm(token)).toEqual({ status: 'confirmed', conversion: 'observed_new' });
        const contact = ctx.fake.state.contacts.get(EMAIL);
        expect([...contact.segments]).toEqual([SEGMENT_ID]);
        expect(contact.unsubscribed).toBe(false);
    });

    it('replaying the token is idempotent: already_confirmed, no further writes', async () => {
        const ctx = setup();
        const token = await signupAndToken(ctx);
        await ctx.service.confirm(token);
        const writes = ctx.fake.writes().length;
        expect(await ctx.service.confirm(token)).toEqual({ status: 'already_confirmed', conversion: 'none' });
        expect(ctx.fake.writes()).toHaveLength(writes);
    });

    it('concurrent confirmations of one address: exactly one "confirmed"', async () => {
        const ctx = setup();
        const token = await signupAndToken(ctx);
        const results = await Promise.all([ctx.service.confirm(token), ctx.service.confirm(token), ctx.service.confirm(token)]);
        expect(results.filter((r) => r.status === 'confirmed')).toHaveLength(1);
        expect(results.filter((r) => r.status === 'already_confirmed')).toHaveLength(2);
    });

    it('an existing contact of another business: only our segment membership is added, nothing else written', async () => {
        const ctx = setup();
        const existing = ctx.fake.seedContact(EMAIL, { segmentIds: [OTHER_SEGMENT_ID], first_name: 'Kept' });
        const token = await signupAndToken(ctx);
        expect(await ctx.service.confirm(token)).toEqual({ status: 'confirmed', conversion: 'observed_new' });
        expect([...existing.segments].sort()).toEqual([OTHER_SEGMENT_ID, SEGMENT_ID].sort());
        expect(existing.first_name).toBe('Kept');
        expect(ctx.fake.writes().map((w) => `${w.method} ${w.path}`)).toEqual([
            'POST /emails',
            `POST /contacts/${existing.id}/segments/${SEGMENT_ID}`,
        ]);
    });

    it('a globally unsubscribed contact is NOT re-subscribed or added', async () => {
        const ctx = setup();
        const token = await signupAndToken(ctx); // email sent before the global opt-out happened
        const existing = ctx.fake.seedContact(EMAIL, { unsubscribed: true });
        expect(await ctx.service.confirm(token)).toEqual({ status: 'unsubscribed_globally', conversion: 'none' });
        expect(existing.unsubscribed).toBe(true);
        expect(existing.segments.size).toBe(0);
        expect(ctx.fake.writes().map((w) => w.path)).toEqual(['/emails']);
    });

    it('a globally unsubscribed address gets the normal 202 but no confirmation email', async () => {
        const ctx = setup();
        ctx.fake.seedContact(EMAIL, { unsubscribed: true });
        expect(await ctx.service.requestSignup({ email: EMAIL, source: 'home', honeypotTripped: false })).toEqual({ status: 'pending_confirmation' });
        expect(ctx.fake.writes()).toHaveLength(0);
    });

    it('create-contact race (contact appears between lookup and create) falls back to the existing contact', async () => {
        const ctx = setup();
        const token = await signupAndToken(ctx);
        ctx.fake.failNext((c) => c.method === 'POST' && c.path === '/contacts', () => {
            ctx.fake.seedContact(EMAIL, {});
            return jsonResponse(409, { name: 'conflict' });
        });
        expect(await ctx.service.confirm(token)).toEqual({ status: 'confirmed', conversion: 'observed_new' });
        expect([...ctx.fake.state.contacts.get(EMAIL).segments]).toEqual([SEGMENT_ID]);
    });

    it('add-to-segment failure that actually landed is reconciled as confirmed/ambiguous (not a false already_confirmed)', async () => {
        const ctx = setup();
        const existing = ctx.fake.seedContact(EMAIL, {});
        const token = await signupAndToken(ctx);
        ctx.fake.failNext((c) => c.method === 'POST' && c.path.includes('/segments/'), () => {
            existing.segments.add(SEGMENT_ID);
            return jsonResponse(422, { name: 'validation_error' });
        });
        expect(await ctx.service.confirm(token)).toEqual({ status: 'confirmed', conversion: 'ambiguous' });
    });

    it('invalid token → 400 WAITLIST_TOKEN_INVALID, no provider calls', async () => {
        const ctx = setup();
        await expect(ctx.service.confirm('v1.garbage')).rejects.toMatchObject({ code: 'WAITLIST_TOKEN_INVALID', status: 400 });
        expect(ctx.fake.state.calls).toHaveLength(0);
    });

    it('expired token → 410 WAITLIST_TOKEN_EXPIRED', async () => {
        const ctx = setup();
        const token = await signupAndToken(ctx);
        ctx.now.t += 49 * 3600 * 1000;
        await expect(ctx.service.confirm(token)).rejects.toMatchObject({ code: 'WAITLIST_TOKEN_EXPIRED', status: 410 });
    });

    it('an unsubscribe token cannot confirm', async () => {
        const ctx = setup();
        await ctx.service.requestSignup({ email: EMAIL, source: 'home', honeypotTripped: false });
        const unsub = tokenFromEmail(ctx.fake.state.emails[0], 'unsubscribe');
        await expect(ctx.service.confirm(unsub)).rejects.toMatchObject({ code: 'WAITLIST_TOKEN_INVALID' });
    });

    it('a token minted by another business/segment config is rejected (cross-business)', async () => {
        const other = setup({ env: { WAITLIST_FRONTEND_ORIGIN: 'https://localcoffeeshop.co', WAITLIST_RESEND_SEGMENT_ID: OTHER_SEGMENT_ID } });
        await other.service.requestSignup({ email: EMAIL, source: 'home', honeypotTripped: false }).catch(() => {});
        // `other` cannot even send (its segment fails verification), so mint directly:
        const { makeTokenCodec } = require('../../../src/waitlist/tokens');
        const foreign = makeTokenCodec({ secret: other.wl.signingSecret, segmentId: OTHER_SEGMENT_ID, frontendOrigin: 'https://localcoffeeshop.co', now: () => other.now.t })
            .seal('confirm', EMAIL, 3600);
        const ours = setup();
        await expect(ours.service.confirm(foreign)).rejects.toMatchObject({ code: 'WAITLIST_TOKEN_INVALID' });
        expect(ours.fake.state.calls).toHaveLength(0);
    });

    it('provider failure during confirmation → 502, and the token stays usable', async () => {
        const ctx = setup();
        const token = await signupAndToken(ctx);
        ctx.fake.failAlways((c) => c.method === 'GET' && c.path.startsWith('/contacts/'), jsonResponse(503, {}));
        await expect(ctx.service.confirm(token)).rejects.toMatchObject({ code: 'WAITLIST_PROVIDER_ERROR', status: 502 });
        ctx.fake.state.failures.length = 0;
        expect(await ctx.service.confirm(token)).toEqual({ status: 'confirmed', conversion: 'observed_new' });
    });
});

describe('unsubscribe', () => {
    it('suppresses, then removes the dedicated segment only (global flag and other segments untouched)', async () => {
        const ctx = setup();
        const existing = ctx.fake.seedContact(EMAIL, { segmentIds: [OTHER_SEGMENT_ID] });
        await ctx.service.confirm(await signupAndToken(ctx));
        const unsub = tokenFromEmail(ctx.fake.state.emails[0], 'unsubscribe');
        expect(await ctx.service.unsubscribe(unsub)).toEqual({ status: 'unsubscribed' });
        expect([...existing.segments].sort()).toEqual([OTHER_SEGMENT_ID, SUPPRESSION_SEGMENT_ID].sort());
        expect(existing.unsubscribed).toBe(false);
        expect(ctx.fake.writes().filter((w) => w.method === 'PATCH')).toHaveLength(0);
    });

    it('before confirming: records the opt-out (contact with email + unsubscribed:false, suppression only); idempotent', async () => {
        const ctx = setup();
        await ctx.service.requestSignup({ email: EMAIL, source: 'home', honeypotTripped: false });
        const unsub = tokenFromEmail(ctx.fake.state.emails[0], 'unsubscribe');
        expect(await ctx.service.unsubscribe(unsub)).toEqual({ status: 'not_subscribed' });
        const writes = ctx.fake.writes().length;
        expect(await ctx.service.unsubscribe(unsub)).toEqual({ status: 'not_subscribed' });
        expect(ctx.fake.writes()).toHaveLength(writes); // second call writes nothing
        expect(ctx.fake.state.contacts.get(EMAIL)).toMatchObject({ unsubscribed: false, first_name: null });
        expect(ctx.fake.segmentsOf(EMAIL)).toEqual([SUPPRESSION_SEGMENT_ID]);
        expect(ctx.fake.writes().find((w) => w.path === '/contacts').body).toEqual({ email: EMAIL, unsubscribed: false });
    });

    it('a confirm token cannot unsubscribe', async () => {
        const ctx = setup();
        await expect(ctx.service.unsubscribe(await signupAndToken(ctx))).rejects.toMatchObject({ code: 'WAITLIST_TOKEN_INVALID' });
    });
});

describe('disabled', () => {
    it('every operation fails closed with 503 and no provider', async () => {
        const wl = loadWaitlistConfig({}, { nodeEnv: 'test', corsOrigins: false, metricsAuthToken: '' });
        const service = makeWaitlistService({ waitlist: wl, provider: null, logger: recordingLogger() });
        for (const op of [
            () => service.requestSignup({ email: EMAIL, source: 'home', honeypotTripped: false }),
            () => service.confirm('v1.x'),
            () => service.unsubscribe('v1.x'),
        ]) {
            await expect(op()).rejects.toMatchObject({ code: 'WAITLIST_UNAVAILABLE', status: 503 });
        }
    });
});
