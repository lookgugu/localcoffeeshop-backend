/**
 * Waitlist test fixtures: a complete, valid (fake) configuration and a
 * recording fake of the Resend HTTP API that enforces the request shapes the
 * adapter is allowed to make. No test ever reaches the network.
 */

const SEGMENT_ID = '11111111-2222-4333-8444-555555555555';
const OTHER_SEGMENT_ID = '99999999-8888-4777-8666-555555555555';
const SUPPRESSION_SEGMENT_ID = '22222222-3333-4444-8555-666666666666';
const SEGMENT_NAME = 'LocalCoffeeShop roaster subscription interest';
const SUPPRESSION_SEGMENT_NAME = 'LocalCoffeeShop roaster interest suppression';

function waitlistEnv(overrides = {}) {
    return {
        NODE_ENV: 'test',
        CORS_ORIGIN: 'https://localcoffeeshop.co',
        WAITLIST_ENABLED: 'true',
        WAITLIST_RESEND_API_KEY: 're_test_fake_key_not_real_0001',
        WAITLIST_RESEND_SEGMENT_ID: SEGMENT_ID,
        WAITLIST_RESEND_SEGMENT_NAME: SEGMENT_NAME,
        WAITLIST_RESEND_SUPPRESSION_SEGMENT_ID: SUPPRESSION_SEGMENT_ID,
        WAITLIST_RESEND_SUPPRESSION_SEGMENT_NAME: SUPPRESSION_SEGMENT_NAME,
        WAITLIST_SIGNING_SECRET: 'test-signing-secret-0123456789abcdef-0123456789',
        WAITLIST_FROM: 'Local Coffee Shops <waitlist@localcoffeeshop.co>',
        WAITLIST_FRONTEND_ORIGIN: 'https://localcoffeeshop.co',
        ...overrides,
    };
}

function jsonResponse(status, body, headers = {}) {
    return {
        ok: status >= 200 && status < 300,
        status,
        headers: { get: (name) => headers[name.toLowerCase()] ?? null },
        json: async () => body,
    };
}

/**
 * In-memory Resend: contacts are GLOBAL across the account (as in Resend's
 * Global Contacts model), each with a global `unsubscribed` flag and a set
 * of segment memberships. Seed it with contacts that belong to other
 * businesses to prove the adapter never writes to them.
 *
 * Every request is checked against an allowlist of (method, path) shapes;
 * anything else throws so a test fails loudly.
 */
function makeFakeResend({
    segments = {
        [SEGMENT_ID]: SEGMENT_NAME,
        [SUPPRESSION_SEGMENT_ID]: SUPPRESSION_SEGMENT_NAME,
        [OTHER_SEGMENT_ID]: 'Other Business newsletter',
    },
} = {}) {
    const state = {
        contacts: new Map(), // email -> { id, email, unsubscribed, segments:Set, first_name }
        emails: [],
        idempotency: new Map(), // key -> { id, rawBody } | { inFlight: true, rawBody }
        calls: [],
        failures: [], // queue of { match: (call) => bool, response | error }
        segments,
        nextId: 1,
    };

    function seedContact(email, { unsubscribed = false, segmentIds = [], first_name = null } = {}) {
        const contact = { id: `c-${state.nextId++}`, email, unsubscribed, segments: new Set(segmentIds), first_name };
        state.contacts.set(email, contact);
        return contact;
    }

    function byIdOrEmail(key) {
        const decoded = decodeURIComponent(key);
        for (const c of state.contacts.values()) {
            if (c.id === decoded || c.email === decoded) return c;
        }
        return null;
    }

    const ROUTES = [
        ['GET', /^\/segments\/([^/]+)$/, (m) => {
            const name = state.segments[m[1]];
            return name ? jsonResponse(200, { object: 'segment', id: m[1], name, created_at: 'x' })
                : jsonResponse(404, { statusCode: 404, name: 'not_found', message: 'Segment not found' });
        }],
        // Resend idempotency contract (docs: "Idempotency keys"): a reused key
        // with the SAME payload returns the original response without sending
        // again; a reused key with a DIFFERENT payload is
        // 409 invalid_idempotent_request; a key whose first request is still
        // in flight is 409 concurrent_idempotent_requests.
        ['POST', /^\/emails$/, async (m, init) => {
            const body = JSON.parse(init.body);
            const key = init.headers['Idempotency-Key'];
            if (key !== undefined && (typeof key !== 'string' || key.length < 1 || key.length > 256)) {
                return jsonResponse(422, { statusCode: 422, name: 'validation_error', message: 'Invalid idempotency key' });
            }
            const prior = key ? state.idempotency.get(key) : null;
            if (prior) {
                if (prior.rawBody !== init.body) {
                    return jsonResponse(409, { statusCode: 409, name: 'invalid_idempotent_request', message: 'Same idempotency key used with a different request payload' });
                }
                if (prior.inFlight) {
                    return jsonResponse(409, { statusCode: 409, name: 'concurrent_idempotent_requests', message: 'Same idempotency key used while original request is still in progress' });
                }
                return jsonResponse(200, { id: prior.id });
            }
            if (key) state.idempotency.set(key, { inFlight: true, rawBody: init.body });
            await new Promise((r) => setImmediate(r)); // the request is "in flight" across a tick
            const id = `email-${state.emails.length + 1}`;
            state.emails.push({ ...body, idempotencyKey: key });
            if (key) state.idempotency.set(key, { id, rawBody: init.body });
            return jsonResponse(200, { id });
        }],
        ['GET', /^\/contacts\/([^/]+)$/, (m) => {
            const c = byIdOrEmail(m[1]);
            return c ? jsonResponse(200, { object: 'contact', id: c.id, email: c.email, unsubscribed: c.unsubscribed })
                : jsonResponse(404, { statusCode: 404, name: 'not_found', message: 'Contact not found' });
        }],
        ['POST', /^\/contacts$/, (m, init) => {
            const body = JSON.parse(init.body);
            if (state.contacts.has(body.email)) {
                return jsonResponse(409, { statusCode: 409, name: 'conflict', message: 'Contact already exists' });
            }
            const c = seedContact(body.email, { unsubscribed: body.unsubscribed === true });
            return jsonResponse(201, { object: 'contact', id: c.id });
        }],
        ['GET', /^\/contacts\/([^/]+)\/segments$/, (m) => {
            const c = byIdOrEmail(m[1]);
            if (!c) return jsonResponse(404, { statusCode: 404, name: 'not_found', message: 'nf' });
            return jsonResponse(200, {
                object: 'list',
                data: [...c.segments].map((id) => ({ id, name: state.segments[id] || 'unknown', created_at: 'x' })),
                has_more: false,
            });
        }],
        ['POST', /^\/contacts\/([^/]+)\/segments\/([^/]+)$/, (m) => {
            const c = byIdOrEmail(m[1]);
            if (!c) return jsonResponse(404, { statusCode: 404, name: 'not_found', message: 'nf' });
            if (!state.segments[m[2]]) return jsonResponse(404, { statusCode: 404, name: 'not_found', message: 'Segment not found' });
            c.segments.add(m[2]);
            return jsonResponse(200, { id: m[2] });
        }],
        ['DELETE', /^\/contacts\/([^/]+)\/segments\/([^/]+)$/, (m) => {
            const c = byIdOrEmail(m[1]);
            if (!c) return jsonResponse(404, { statusCode: 404, name: 'not_found', message: 'nf' });
            c.segments.delete(m[2]);
            return jsonResponse(200, { id: m[2], deleted: true });
        }],
    ];

    async function fetchImpl(url, init = {}) {
        const u = new URL(url);
        if (u.origin !== 'https://api.resend.com') throw new Error(`fake resend: unexpected origin ${u.origin}`);
        const method = (init.method || 'GET').toUpperCase();
        const call = { method, path: u.pathname, search: u.search, headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined };
        state.calls.push(call);
        if (!init.headers || !/^Bearer re_/.test(init.headers.Authorization)) throw new Error('fake resend: missing bearer auth');
        if (!init.headers['User-Agent']) throw new Error('fake resend: missing User-Agent (Resend returns 403)');
        if (init.body && init.headers['Content-Type'] !== 'application/json') throw new Error('fake resend: body without JSON content type');

        const failureIndex = state.failures.findIndex((f) => f.match(call));
        if (failureIndex !== -1) {
            const failure = state.failures[failureIndex];
            if (!failure.sticky) state.failures.splice(failureIndex, 1);
            if (failure.error) throw failure.error;
            if (failure.hang) {
                return new Promise((resolve, reject) => {
                    init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
                });
            }
            return typeof failure.response === 'function' ? failure.response(call) : failure.response;
        }

        for (const [m, pattern, handler] of ROUTES) {
            const match = method === m && u.pathname.match(pattern);
            if (match) return handler(match, init);
        }
        throw new Error(`fake resend: request shape not allowed: ${method} ${u.pathname}`);
    }

    return {
        fetchImpl,
        state,
        seedContact,
        failNext(match, response) { state.failures.push({ match, response }); },
        failAlways(match, response) { state.failures.push({ match, response, sticky: true }); },
        throwNext(match, error) { state.failures.push({ match, error }); },
        hangNext(match) { state.failures.push({ match, hang: true }); },
        writes() { return state.calls.filter((c) => c.method !== 'GET'); },
        /** Segment ids the address is a member of (empty if no contact). */
        segmentsOf(email) { return [...(state.contacts.get(email)?.segments || [])].sort(); },
    };
}

/** Pull the fragment token out of the link in the n-th sent confirmation email. */
function tokenFromEmail(email, kind = 'confirm') {
    const match = email.text.match(new RegExp(`/waitlist/${kind}/#token=([A-Za-z0-9._-]+)`));
    if (!match) throw new Error(`no ${kind} link in email`);
    return match[1];
}

module.exports = {
    SEGMENT_ID,
    OTHER_SEGMENT_ID,
    SUPPRESSION_SEGMENT_ID,
    SEGMENT_NAME,
    SUPPRESSION_SEGMENT_NAME,
    waitlistEnv,
    jsonResponse,
    makeFakeResend,
    tokenFromEmail,
};
