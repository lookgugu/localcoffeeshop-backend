/**
 * Unit Tests — withIdempotency middleware
 *
 * Exercises the middleware against a fake queue store (src/queue/) so the
 * tests run with no database. Behaviour we cover:
 *   - hit (completed): returns cached payload with Idempotent-Replay; handler not called
 *   - hit (pending):   returns 409 IDEMPOTENCY_IN_PROGRESS; handler not called
 *   - miss:            reserves a pending row, calls handler, flips to completed on 2xx
 *   - 5xx response:    pending row released, NOT cached as completed
 *   - no header:       handler called, nothing cached
 *   - TTL expiry:      lookup/reserve use now-ttl as the expiry boundary
 *   - race (reservation lost): reserveKey → false → 409
 *   - storage failure: lookup or reserve throws → 503, handler NOT run (B-02b)
 *
 * The store's own SQL (atomic reserve, expired-key replacement) is covered
 * against real SQLite and Postgres in tests/integration/queue-store.test.js.
 */

const { withIdempotency, requestFingerprint } = require('../../../src/lib/idempotency');
const { UnavailableError } = require('../../../src/usecases/errors');

/**
 * Fake queue store. `existing` is what lookupKey returns; `reserved` what
 * reserveKey returns.
 */
function makeStore({ existing = null, reserved = true } = {}) {
    return {
        lookupKey: jest.fn().mockResolvedValue(existing),
        reserveKey: jest.fn().mockResolvedValue(reserved),
        completeKey: jest.fn().mockResolvedValue(undefined),
        releaseKey: jest.fn().mockResolvedValue(undefined),
        sweepKeys: jest.fn().mockResolvedValue(0),
    };
}

function writesOf(store) {
    return store.reserveKey.mock.calls.length + store.completeKey.mock.calls.length
        + store.releaseKey.mock.calls.length + store.sweepKeys.mock.calls.length;
}

function makeRes() {
    const res = {
        statusCode: 200,
        headers: {},
        body: null,
        rawBody: null,
        _finishListeners: [],
        _closeListeners: [],
        set(name, value) { this.headers[name.toLowerCase()] = value; return this; },
        get(name) { return this.headers[name.toLowerCase()]; },
        status(code) { this.statusCode = code; return this; },
        type() { return this; },
        send(payload) { this.rawBody = payload; return this; },
        json(payload) { this.body = payload; return this; },
        on(event, listener) {
            if (event === 'finish') this._finishListeners.push(listener);
            if (event === 'close') this._closeListeners.push(listener);
            return this;
        },
        _fireFinish() { this._finishListeners.forEach((fn) => fn()); },
    };
    return res;
}

function makeReq(headers = {}, { method = 'POST', path = '/coffee-shops', params = {}, body = {} } = {}) {
    const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
    return {
        method,
        path,
        params,
        body,
        route: { path },
        get(name) { return lower[name.toLowerCase()]; },
    };
}

const silentLogger = {
    info: () => {},
    debug: () => {},
    warn: () => {},
    error: () => {},
};

describe('withIdempotency middleware', () => {
    it('passes through immediately when no Idempotency-Key header is present', async () => {
        const store = makeStore();
        const middleware = withIdempotency({ store, logger: silentLogger });
        const req = makeReq();
        const res = makeRes();
        const next = jest.fn();

        await middleware(req, res, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(store.lookupKey).not.toHaveBeenCalled();
        // res.json was not wrapped.
        res.json({ ok: true });
        expect(writesOf(store)).toBe(0);
    });

    it('on completed hit: replays cached body, sets Idempotent-Replay, skips handler', async () => {
        const cachedBody = JSON.stringify({ success: true, data: { id: 7 } });
        const store = makeStore({
            existing: { status_code: 201, response: cachedBody, status: 'completed', request_hash: requestFingerprint(makeReq()) },
        });
        const middleware = withIdempotency({ store, logger: silentLogger });
        const res = makeRes();
        const next = jest.fn();

        await middleware(makeReq({ 'Idempotency-Key': 'k1' }), res, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.headers['idempotent-replay']).toBe('true');
        expect(res.statusCode).toBe(201);
        expect(res.rawBody).toBe(cachedBody);
        expect(writesOf(store)).toBe(0);
    });

    it('on pending hit: returns 409 IDEMPOTENCY_IN_PROGRESS, skips handler', async () => {
        const store = makeStore({
            existing: { status_code: 0, response: '', status: 'pending', request_hash: requestFingerprint(makeReq()) },
        });
        const res = makeRes();
        const next = jest.fn();

        await withIdempotency({ store, logger: silentLogger })(makeReq({ 'Idempotency-Key': 'k-pending' }), res, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(409);
        expect(res.body.success).toBe(false);
        expect(res.body.error.code).toBe('IDEMPOTENCY_IN_PROGRESS');
        expect(writesOf(store)).toBe(0);
    });

    it('on miss: reserves a pending row, calls handler, flips to completed on 2xx', async () => {
        const store = makeStore();
        const res = makeRes();
        const next = jest.fn();

        await withIdempotency({ store, logger: silentLogger })(makeReq({ 'Idempotency-Key': 'k-miss' }), res, next);
        expect(next).toHaveBeenCalledTimes(1);

        // Reservation ran BEFORE next().
        expect(store.reserveKey).toHaveBeenCalledTimes(1);
        const [reservation] = store.reserveKey.mock.calls[0];
        expect(reservation.key).toBe('k-miss');
        expect(reservation.endpoint).toBe('POST /coffee-shops');

        // Simulate the handler succeeding.
        res.statusCode = 200;
        res.json({ success: true, data: { id: 42 } });
        await new Promise((r) => setImmediate(r));

        expect(store.completeKey).toHaveBeenCalledTimes(1);
        const [key, statusCode, payload] = store.completeKey.mock.calls[0];
        expect(key).toBe('k-miss');
        expect(statusCode).toBe(200);
        expect(JSON.parse(payload)).toEqual({ success: true, data: { id: 42 } });
        expect(store.releaseKey).not.toHaveBeenCalled();
    });

    it('5xx response: pending row released, NOT cached as completed', async () => {
        const store = makeStore();
        const res = makeRes();
        const next = jest.fn();

        await withIdempotency({ store, logger: silentLogger })(makeReq({ 'Idempotency-Key': 'k-err' }), res, next);
        expect(next).toHaveBeenCalledTimes(1);

        res.statusCode = 500;
        res.json({ success: false, error: { message: 'boom' } });
        await new Promise((r) => setImmediate(r));

        expect(store.completeKey).not.toHaveBeenCalled();
        expect(store.releaseKey).toHaveBeenCalledWith('k-err');
    });

    it('response finishing without res.json (thrown error) releases the reservation once', async () => {
        const store = makeStore();
        const res = makeRes();
        await withIdempotency({ store, logger: silentLogger })(makeReq({ 'Idempotency-Key': 'k-fin' }), res, jest.fn());

        res._fireFinish();
        res._fireFinish();
        expect(store.releaseKey).toHaveBeenCalledTimes(1);
        expect(store.releaseKey).toHaveBeenCalledWith('k-fin');
    });

    it('race lost: reserveKey reports false → 409 IDEMPOTENCY_IN_PROGRESS', async () => {
        // The other concurrent request won the reservation; ours is a no-op.
        const store = makeStore({ reserved: false });
        const res = makeRes();
        const next = jest.fn();

        await withIdempotency({ store, logger: silentLogger })(makeReq({ 'Idempotency-Key': 'k-race-lost' }), res, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(409);
        expect(res.body.error.code).toBe('IDEMPOTENCY_IN_PROGRESS');
    });

    it('TTL: lookup and reservation share the now-ttl expiry boundary', async () => {
        const store = makeStore();
        const next = jest.fn();
        const beforeNow = Math.floor(Date.now() / 1000);

        await withIdempotency({ store, ttlSeconds: 60, logger: silentLogger })(
            makeReq({ 'Idempotency-Key': 'k-ttl' }), makeRes(), next,
        );

        expect(next).toHaveBeenCalledTimes(1);
        const [, minCreated] = store.lookupKey.mock.calls[0];
        expect(minCreated).toBeGreaterThanOrEqual(beforeNow - 61);
        expect(minCreated).toBeLessThanOrEqual(beforeNow - 59);
        const [reservation] = store.reserveKey.mock.calls[0];
        // B-01: an expired row with this key is replaced, not reported as in-flight.
        expect(reservation.expiredBefore).toBe(minCreated);
        expect(reservation.now - reservation.expiredBefore).toBe(60);
    });

    describe('storage failure fails closed (B-02b)', () => {
        it.each([
            ['lookup', (store) => store.lookupKey.mockRejectedValue(new Error('disk error'))],
            ['reservation', (store) => store.reserveKey.mockRejectedValue(new Error('connection reset'))],
        ])('%s throws → 503 IDEMPOTENCY_UNAVAILABLE via next(err), handler NOT run', async (_label, breakStore) => {
            const store = makeStore();
            breakStore(store);
            const res = makeRes();
            const next = jest.fn();

            await withIdempotency({ store, logger: silentLogger })(makeReq({ 'Idempotency-Key': 'k-broken' }), res, next);

            expect(next).toHaveBeenCalledTimes(1);
            const [err] = next.mock.calls[0];
            expect(err).toBeInstanceOf(UnavailableError);
            expect(err.code).toBe('IDEMPOTENCY_UNAVAILABLE');
            // res.json was NOT wrapped, so nothing is completed or released.
            res.json({ ok: true });
            expect(store.completeKey).not.toHaveBeenCalled();
            expect(store.releaseKey).not.toHaveBeenCalled();
        });

        it('a store that is not ready passes its own 503 through unchanged', async () => {
            const store = makeStore();
            const notReady = new UnavailableError('SUBMISSIONS_UNAVAILABLE', 'not ready', 60);
            store.lookupKey.mockRejectedValue(notReady);
            const next = jest.fn();

            await withIdempotency({ store, logger: silentLogger })(makeReq({ 'Idempotency-Key': 'k' }), makeRes(), next);

            expect(next).toHaveBeenCalledWith(notReady);
        });
    });

    describe('request fingerprint (key reuse with a different request)', () => {
        const original = { method: 'POST', path: '/coffee-shops', body: { shop: { displayName: { text: 'A' } } } };

        it('reservation stores a fingerprint of method, route, params and body', async () => {
            const store = makeStore();
            await withIdempotency({ store, logger: silentLogger })(
                makeReq({ 'Idempotency-Key': 'k-fp' }, original), makeRes(), jest.fn(),
            );

            const [reservation] = store.reserveKey.mock.calls[0];
            expect(reservation.requestHash).toBe(requestFingerprint(makeReq({}, original)));
            expect(reservation.requestHash).toMatch(/^[0-9a-f]{64}$/);
        });

        it('fingerprint differs for a different body, method, route or params', () => {
            const base = requestFingerprint(makeReq({}, original));
            expect(requestFingerprint(makeReq({}, { ...original, body: { shop: { displayName: { text: 'B' } } } }))).not.toBe(base);
            expect(requestFingerprint(makeReq({}, { ...original, method: 'PUT' }))).not.toBe(base);
            expect(requestFingerprint(makeReq({}, { ...original, path: '/coffee-shops/:id', params: { id: '1' } })))
                .not.toBe(requestFingerprint(makeReq({}, { ...original, path: '/coffee-shops/:id', params: { id: '2' } })));
        });

        it('completed row with matching fingerprint replays', async () => {
            const hash = requestFingerprint(makeReq({}, original));
            const store = makeStore({ existing: { status_code: 202, response: '{"success":true}', status: 'completed', request_hash: hash } });
            const res = makeRes();
            const next = jest.fn();
            await withIdempotency({ store, logger: silentLogger })(makeReq({ 'Idempotency-Key': 'k' }, original), res, next);

            expect(next).not.toHaveBeenCalled();
            expect(res.statusCode).toBe(202);
            expect(res.headers['idempotent-replay']).toBe('true');
        });

        it.each(['completed', 'pending'])('%s row with a different fingerprint → 422 IDEMPOTENCY_KEY_REUSED, handler skipped, row untouched', async (status) => {
            const store = makeStore({ existing: { status_code: 202, response: '{"success":true}', status, request_hash: 'f'.repeat(64) } });
            const res = makeRes();
            const next = jest.fn();
            await withIdempotency({ store, logger: silentLogger })(makeReq({ 'Idempotency-Key': 'k' }, original), res, next);

            expect(next).not.toHaveBeenCalled();
            expect(res.statusCode).toBe(422);
            expect(res.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
            expect(res.headers['idempotent-replay']).toBeUndefined();
            expect(writesOf(store)).toBe(0);
        });

        it.each(['completed', 'pending'])(
            'legacy %s row without a fingerprint fails closed (422) — never replays a pre-moderation response',
            async (status) => {
                const store = makeStore({ existing: { status_code: 200, response: '{"success":true,"data":{"id":1}}', status, request_hash: null } });
                const res = makeRes();
                const next = jest.fn();
                await withIdempotency({ store, logger: silentLogger })(makeReq({ 'Idempotency-Key': 'k' }, original), res, next);
                expect(next).not.toHaveBeenCalled();
                expect(res.statusCode).toBe(422);
                expect(res.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
                expect(res.headers['idempotent-replay']).toBeUndefined();
                expect(res.rawBody).toBeNull();
                expect(writesOf(store)).toBe(0);
            },
        );
    });

    describe('key format', () => {
        it.each([
            ['contains a space', 'has space'],
            ['contains a quote', 'a"b'],
            ['contains non-ASCII', 'clé'],
            ['is 129 characters', 'k'.repeat(129)],
        ])('rejects a key that %s with 400 before touching storage', async (_label, key) => {
            const store = makeStore();
            const res = makeRes();
            const next = jest.fn();
            await withIdempotency({ store, logger: silentLogger })(makeReq({ 'Idempotency-Key': key }), res, next);

            expect(next).not.toHaveBeenCalled();
            expect(res.statusCode).toBe(400);
            expect(['IDEMPOTENCY_KEY_INVALID', 'IDEMPOTENCY_KEY_TOO_LONG']).toContain(res.body.error.code);
            expect(store.lookupKey).not.toHaveBeenCalled();
            expect(writesOf(store)).toBe(0);
        });

        it.each([['a UUID', '0b0e6f9c-3f59-4c43-9d55-1f4f2d0f8a11'], ['128 safe chars', 'A1._:-'.repeat(21) + 'xy']])(
            'accepts %s',
            async (_label, key) => {
                const next = jest.fn();
                await withIdempotency({ store: makeStore(), logger: silentLogger })(makeReq({ 'Idempotency-Key': key }), makeRes(), next);
                expect(next).toHaveBeenCalledTimes(1);
            },
        );
    });
});
