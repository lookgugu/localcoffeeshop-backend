/**
 * Unit Tests — Resend adapter
 *
 * The adapter is the isolation boundary: it is constructed with exactly one
 * segment id and has no method that can address any other segment, update
 * a contact's fields or flip the global `unsubscribed` flag. The fake
 * enforces the documented request shapes (bearer auth, User-Agent, JSON).
 */

const { makeResendProvider, ProviderError, IsolationError } = require('../../../src/waitlist/resend-provider');
const {
    makeFakeResend, jsonResponse, SEGMENT_ID, OTHER_SEGMENT_ID, SUPPRESSION_SEGMENT_ID, SEGMENT_NAME, SUPPRESSION_SEGMENT_NAME,
} = require('../../helpers/waitlistEnv');

const NAME = SEGMENT_NAME;

function setup(opts = {}) {
    const fake = makeFakeResend();
    const sleeps = [];
    const provider = makeResendProvider({
        apiKey: 're_test_fake_key_not_real_0001',
        segmentId: SEGMENT_ID,
        segmentName: NAME,
        suppressionSegmentId: SUPPRESSION_SEGMENT_ID,
        suppressionSegmentName: SUPPRESSION_SEGMENT_NAME,
        fetchImpl: fake.fetchImpl,
        timeoutMs: 50,
        maxRetries: 2,
        sleep: async (ms) => { sleeps.push(ms); },
        ...opts,
    });
    return { fake, provider, sleeps };
}

describe('resend provider — interface', () => {
    it('exposes only segment-scoped operations', () => {
        const { provider } = setup();
        expect(Object.keys(provider).sort()).toEqual([
            'addToSegment', 'addToSuppression', 'createContact', 'getContact', 'memberships', 'removeFromSegment', 'sendEmail', 'verifySegments',
        ]);
    });

    it('refuses to construct without a separate suppression segment', () => {
        expect(() => setup({ suppressionSegmentId: undefined })).toThrow(/segment/);
        expect(() => setup({ suppressionSegmentId: SEGMENT_ID })).toThrow(/separate/);
        expect(() => setup({ suppressionSegmentName: NAME })).toThrow(/separate/);
    });

    it('sends email with auth, user agent, JSON and the idempotency key', async () => {
        const { fake, provider } = setup();
        const result = await provider.sendEmail({
            from: 'A <a@localcoffeeshop.co>', to: 'p@example.com', subject: 's', html: '<p>h</p>', text: 't', idempotencyKey: 'k1',
        });
        expect(result).toEqual({ id: 'email-1' });
        const [call] = fake.state.calls;
        expect(call).toMatchObject({ method: 'POST', path: '/emails' });
        expect(call.headers['Idempotency-Key']).toBe('k1');
        expect(call.body).toEqual({ from: 'A <a@localcoffeeshop.co>', to: ['p@example.com'], subject: 's', html: '<p>h</p>', text: 't' });
    });

    it('verifies BOTH configured segments by id AND expected name, once', async () => {
        const { fake, provider } = setup();
        await provider.verifySegments();
        await provider.verifySegments();
        expect(fake.state.calls.map((c) => c.path)).toEqual([`/segments/${SEGMENT_ID}`, `/segments/${SUPPRESSION_SEGMENT_ID}`]);
    });

    it.each([
        ['list id → another business segment', { segmentId: OTHER_SEGMENT_ID }],
        ['suppression id → another business segment', { suppressionSegmentId: OTHER_SEGMENT_ID }],
        ['list segment missing', { segmentId: '00000000-0000-4000-8000-000000000000' }],
        ['suppression segment missing', { suppressionSegmentId: '00000000-0000-4000-8000-000000000000' }],
        ['suppression name mismatch', { suppressionSegmentName: 'LocalCoffeeShop other suppression' }],
    ])('refuses (IsolationError) when %s', async (_label, opts) => {
        const { fake, provider } = setup(opts);
        await expect(provider.verifySegments()).rejects.toBeInstanceOf(IsolationError);
        expect(fake.writes()).toHaveLength(0);
    });

    it('getContact returns null on 404 and the id/unsubscribed flag otherwise', async () => {
        const { fake, provider } = setup();
        expect(await provider.getContact('nobody@example.com')).toBeNull();
        const c = fake.seedContact('p@example.com', { unsubscribed: true });
        expect(await provider.getContact('p@example.com')).toEqual({ id: c.id, unsubscribed: true });
        expect(fake.state.calls.at(-1).path).toBe('/contacts/p%40example.com');
    });

    it('createContact sends only email + unsubscribed:false (no names, no other segments)', async () => {
        const { fake, provider } = setup();
        await provider.createContact('new@example.com');
        expect(fake.state.calls.at(-1)).toMatchObject({ method: 'POST', path: '/contacts', body: { email: 'new@example.com', unsubscribed: false } });
    });

    it('membership, add, remove and suppress only ever use the two configured segment ids', async () => {
        const { fake, provider } = setup();
        const c = fake.seedContact('p@example.com', { segmentIds: [OTHER_SEGMENT_ID] });
        expect(await provider.memberships(c.id)).toEqual({ member: false, suppressed: false });
        await provider.addToSegment(c.id);
        expect(await provider.memberships(c.id)).toEqual({ member: true, suppressed: false });
        await provider.addToSuppression(c.id);
        await provider.removeFromSegment(c.id);
        expect(await provider.memberships(c.id)).toEqual({ member: false, suppressed: true });
        expect([...c.segments].sort()).toEqual([OTHER_SEGMENT_ID, SUPPRESSION_SEGMENT_ID].sort());
        for (const call of fake.writes()) {
            expect(call.path).not.toContain(OTHER_SEGMENT_ID);
        }
        expect(fake.writes().map((w) => `${w.method} ${w.path}`)).toEqual([
            `POST /contacts/${c.id}/segments/${SEGMENT_ID}`,
            `POST /contacts/${c.id}/segments/${SUPPRESSION_SEGMENT_ID}`,
            `DELETE /contacts/${c.id}/segments/${SEGMENT_ID}`,
        ]);
    });

    it('follows contact-segment pagination', async () => {
        const { fake, provider } = setup();
        fake.failNext((c) => c.path.endsWith('/segments') && !c.search.includes('after'), jsonResponse(200, { object: 'list', data: [{ id: OTHER_SEGMENT_ID }], has_more: true }));
        fake.failNext((c) => c.path.endsWith('/segments') && c.search.includes(`after=${OTHER_SEGMENT_ID}`), jsonResponse(200, { object: 'list', data: [{ id: SEGMENT_ID }], has_more: true }));
        fake.failNext((c) => c.path.endsWith('/segments') && c.search.includes(`after=${SEGMENT_ID}`), jsonResponse(200, { object: 'list', data: [{ id: SUPPRESSION_SEGMENT_ID }], has_more: false }));
        expect(await provider.memberships('c-1')).toEqual({ member: true, suppressed: true });
        expect(fake.state.calls).toHaveLength(3);
    });
});

describe('resend provider — failures', () => {
    it('retries 5xx and 429 (honouring a bounded Retry-After), then succeeds with the same idempotency key', async () => {
        const { fake, provider, sleeps } = setup();
        fake.failNext((c) => c.path === '/emails', jsonResponse(503, { name: 'service_unavailable' }));
        fake.failNext((c) => c.path === '/emails', jsonResponse(429, { name: 'rate_limit_exceeded' }, { 'retry-after': '1' }));
        await provider.sendEmail({ from: 'a@localcoffeeshop.co', to: 'p@example.com', subject: 's', html: 'h', text: 't', idempotencyKey: 'same' });
        const keys = fake.state.calls.filter((c) => c.path === '/emails').map((c) => c.headers['Idempotency-Key']);
        expect(keys).toEqual(['same', 'same', 'same']);
        expect(sleeps).toHaveLength(2);
        expect(sleeps[1]).toBe(1000);
        expect(fake.state.emails).toHaveLength(1);
    });

    it('caps Retry-After so a hostile header cannot stall the request', async () => {
        const { fake, provider, sleeps } = setup();
        fake.failNext(() => true, jsonResponse(429, {}, { 'retry-after': '3600' }));
        await provider.getContact('p@example.com');
        expect(sleeps[0]).toBeLessThanOrEqual(2000);
    });

    it('gives up after maxRetries with a ProviderError that carries no response text', async () => {
        const { fake, provider } = setup();
        fake.failAlways(() => true, jsonResponse(500, { name: 'application_error', message: 'boom for p@example.com' }));
        const err = await provider.getContact('p@example.com').catch((e) => e);
        expect(err).toBeInstanceOf(ProviderError);
        expect(err).toMatchObject({ kind: 'http', status: 500, code: 'application_error' });
        expect(err.message).not.toContain('p@example.com');
        expect(fake.state.calls).toHaveLength(3);
    });

    it('times out a hung request and retries it', async () => {
        const { fake, provider } = setup();
        fake.hangNext(() => true);
        expect(await provider.getContact('nobody@example.com')).toBeNull();
        expect(fake.state.calls).toHaveLength(2);
    });

    it('reports a persistent timeout as kind=timeout', async () => {
        const { fake, provider } = setup({ maxRetries: 0 });
        fake.hangNext(() => true);
        await expect(provider.getContact('x@example.com')).rejects.toMatchObject({ kind: 'timeout' });
    });

    it('retries network errors', async () => {
        const { fake, provider } = setup();
        fake.throwNext(() => true, new TypeError('fetch failed'));
        expect(await provider.getContact('nobody@example.com')).toBeNull();
    });

    it('does not retry 4xx client errors (other than 429 / concurrent idempotent request)', async () => {
        const { fake, provider } = setup();
        fake.failNext(() => true, jsonResponse(422, { name: 'invalid_parameter' }));
        await expect(provider.createContact('x@example.com')).rejects.toMatchObject({ kind: 'http', status: 422, code: 'invalid_parameter' });
        expect(fake.state.calls).toHaveLength(1);
    });

    it('retries 409 concurrent_idempotent_requests but not 409 invalid_idempotent_request', async () => {
        const { fake, provider } = setup();
        fake.failNext(() => true, jsonResponse(409, { name: 'concurrent_idempotent_requests' }));
        await provider.sendEmail({ from: 'a@localcoffeeshop.co', to: 'p@example.com', subject: 's', html: 'h', text: 't', idempotencyKey: 'k' });
        expect(fake.state.calls).toHaveLength(2);

        fake.failNext(() => true, jsonResponse(409, { name: 'invalid_idempotent_request' }));
        await expect(provider.sendEmail({ from: 'a@localcoffeeshop.co', to: 'p@example.com', subject: 's', html: 'h', text: 't', idempotencyKey: 'k2' }))
            .rejects.toMatchObject({ status: 409, code: 'invalid_idempotent_request' });
    });

    it('sanitises provider error names', async () => {
        const { fake, provider } = setup({ maxRetries: 0 });
        fake.failNext(() => true, jsonResponse(400, { name: '<script>p@example.com' }));
        await expect(provider.getContact('x@example.com')).rejects.toMatchObject({ code: 'unknown' });
    });
});
