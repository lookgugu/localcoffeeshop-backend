/**
 * Unit Tests — withIdempotency middleware
 *
 * Exercises the middleware against a fake `db` so the tests run with no
 * sqlite3 dependency. Behaviour we cover:
 *   - hit (completed): returns cached payload with Idempotent-Replay; handler not called
 *   - hit (pending):   returns 409 IDEMPOTENCY_IN_PROGRESS; handler not called
 *   - miss:            reserves a pending row, calls handler, flips to completed on 2xx
 *   - 5xx response:    pending row released, NOT cached as completed
 *   - no header:       handler called, nothing cached
 *   - TTL expiry:      row older than ttl → treated as miss
 *   - race (reservation lost): second caller sees changes === 0 → 409
 *   - lookup failure:  SELECT throws → falls through to handler
 */

const { withIdempotency, requestFingerprint } = require('../../../src/lib/idempotency');

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
        const db = {
            get: jest.fn(),
            run: jest.fn(),
        };
        const middleware = withIdempotency({ db, logger: silentLogger });
        const req = makeReq();
        const res = makeRes();
        const next = jest.fn();

        await middleware(req, res, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(db.get).not.toHaveBeenCalled();
        // res.json was not wrapped.
        res.json({ ok: true });
        expect(db.run).not.toHaveBeenCalled();
    });

    it('on completed hit: replays cached body, sets Idempotent-Replay, skips handler', async () => {
        const cachedBody = JSON.stringify({ success: true, data: { id: 7 } });
        const db = {
            get: jest.fn().mockResolvedValue({
                status_code: 201, response: cachedBody, status: 'completed', request_hash: requestFingerprint(makeReq()),
            }),
            run: jest.fn(),
        };
        const middleware = withIdempotency({ db, logger: silentLogger });
        const req = makeReq({ 'Idempotency-Key': 'k1' });
        const res = makeRes();
        const next = jest.fn();

        await middleware(req, res, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.headers['idempotent-replay']).toBe('true');
        expect(res.statusCode).toBe(201);
        expect(res.rawBody).toBe(cachedBody);
        expect(db.run).not.toHaveBeenCalled();
    });

    it('on pending hit: returns 409 IDEMPOTENCY_IN_PROGRESS, skips handler', async () => {
        const db = {
            get: jest.fn().mockResolvedValue({
                status_code: 0, response: '', status: 'pending', request_hash: requestFingerprint(makeReq()),
            }),
            run: jest.fn(),
        };
        const middleware = withIdempotency({ db, logger: silentLogger });
        const req = makeReq({ 'Idempotency-Key': 'k-pending' });
        const res = makeRes();
        const next = jest.fn();

        await middleware(req, res, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(409);
        expect(res.body.success).toBe(false);
        expect(res.body.error.code).toBe('IDEMPOTENCY_IN_PROGRESS');
        expect(db.run).not.toHaveBeenCalled();
    });

    it('on miss: reserves a pending row, calls handler, flips to completed on 2xx', async () => {
        const db = {
            get: jest.fn().mockResolvedValue(undefined),
            run: jest.fn().mockResolvedValue({ lastID: 1, changes: 1 }),
        };
        const middleware = withIdempotency({ db, logger: silentLogger });
        const req = makeReq({ 'Idempotency-Key': 'k-miss' });
        const res = makeRes();
        const next = jest.fn();

        await middleware(req, res, next);
        expect(next).toHaveBeenCalledTimes(1);

        // Reservation insert ran BEFORE next().
        const reserveCall = db.run.mock.calls.find(([sql]) => sql.includes('INSERT OR IGNORE INTO idempotency_keys'));
        expect(reserveCall).toBeDefined();
        const [, reserveParams] = reserveCall;
        expect(reserveParams[0]).toBe('k-miss');
        expect(reserveParams[1]).toBe('POST /coffee-shops');

        // Simulate the handler succeeding.
        res.statusCode = 200;
        res.json({ success: true, data: { id: 42 } });

        await new Promise((r) => setImmediate(r));

        const completeCall = db.run.mock.calls.find(([sql]) => sql.includes("status = 'completed'"));
        expect(completeCall).toBeDefined();
        const [, completeParams] = completeCall;
        expect(completeParams[0]).toBe(200);                  // status_code
        expect(JSON.parse(completeParams[1])).toEqual({ success: true, data: { id: 42 } });
        expect(completeParams[2]).toBe('k-miss');             // key
    });

    it('5xx response: pending row released, NOT cached as completed', async () => {
        const db = {
            get: jest.fn().mockResolvedValue(undefined),
            run: jest.fn().mockResolvedValue({ lastID: 1, changes: 1 }),
        };
        const middleware = withIdempotency({ db, logger: silentLogger });
        const req = makeReq({ 'Idempotency-Key': 'k-err' });
        const res = makeRes();
        const next = jest.fn();

        await middleware(req, res, next);
        expect(next).toHaveBeenCalledTimes(1);

        // Handler returns a 500.
        res.statusCode = 500;
        res.json({ success: false, error: { message: 'boom' } });

        await new Promise((r) => setImmediate(r));

        const completeCall = db.run.mock.calls.find(([sql]) => sql.includes("status = 'completed'"));
        expect(completeCall).toBeUndefined();

        const releaseCall = db.run.mock.calls.find(([sql]) => sql.includes("DELETE FROM idempotency_keys WHERE key = ? AND status = 'pending'"));
        expect(releaseCall).toBeDefined();
        expect(releaseCall[1][0]).toBe('k-err');
    });

    it('race lost: reservation INSERT reports changes === 0 → 409 IDEMPOTENCY_IN_PROGRESS', async () => {
        const db = {
            get: jest.fn().mockResolvedValue(undefined),
            // The other concurrent request won the INSERT; ours is a no-op.
            run: jest.fn().mockResolvedValue({ lastID: 0, changes: 0 }),
        };
        const middleware = withIdempotency({ db, logger: silentLogger });
        const req = makeReq({ 'Idempotency-Key': 'k-race-lost' });
        const res = makeRes();
        const next = jest.fn();

        await middleware(req, res, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(409);
        expect(res.body.error.code).toBe('IDEMPOTENCY_IN_PROGRESS');
    });

    it('TTL expiry: lookup query filters by created_at > now-ttl; expired row → miss', async () => {
        const db = {
            get: jest.fn().mockResolvedValue(undefined),
            run: jest.fn().mockResolvedValue({ lastID: 1, changes: 1 }),
        };
        const middleware = withIdempotency({ db, ttlSeconds: 60, logger: silentLogger });
        const req = makeReq({ 'Idempotency-Key': 'k-ttl' });
        const res = makeRes();
        const next = jest.fn();
        const beforeNow = Math.floor(Date.now() / 1000);

        await middleware(req, res, next);

        expect(next).toHaveBeenCalledTimes(1);
        const lookupCall = db.get.mock.calls[0];
        const minCreated = lookupCall[1][1];
        expect(minCreated).toBeGreaterThanOrEqual(beforeNow - 61);
        expect(minCreated).toBeLessThanOrEqual(beforeNow - 59);
    });

    describe('request fingerprint (key reuse with a different request)', () => {
        const original = { method: 'POST', path: '/coffee-shops', body: { shop: { displayName: { text: 'A' } } } };

        it('reservation stores a fingerprint of method, route, params and body', async () => {
            const db = {
                get: jest.fn().mockResolvedValue(undefined),
                run: jest.fn().mockResolvedValue({ lastID: 1, changes: 1 }),
            };
            const middleware = withIdempotency({ db, logger: silentLogger });
            await middleware(makeReq({ 'Idempotency-Key': 'k-fp' }, original), makeRes(), jest.fn());

            const [sql, params] = db.run.mock.calls.find(([s]) => s.includes('INSERT OR IGNORE'));
            expect(sql).toMatch(/request_hash/);
            expect(params).toContain(requestFingerprint(makeReq({}, original)));
            expect(requestFingerprint(makeReq({}, original))).toMatch(/^[0-9a-f]{64}$/);
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
            const db = {
                get: jest.fn().mockResolvedValue({ status_code: 202, response: '{"success":true}', status: 'completed', request_hash: hash }),
                run: jest.fn(),
            };
            const res = makeRes();
            const next = jest.fn();
            await withIdempotency({ db, logger: silentLogger })(makeReq({ 'Idempotency-Key': 'k' }, original), res, next);

            expect(next).not.toHaveBeenCalled();
            expect(res.statusCode).toBe(202);
            expect(res.headers['idempotent-replay']).toBe('true');
        });

        it.each(['completed', 'pending'])('%s row with a different fingerprint → 422 IDEMPOTENCY_KEY_REUSED, handler skipped, row untouched', async (status) => {
            const db = {
                get: jest.fn().mockResolvedValue({ status_code: 202, response: '{"success":true}', status, request_hash: 'f'.repeat(64) }),
                run: jest.fn(),
            };
            const res = makeRes();
            const next = jest.fn();
            await withIdempotency({ db, logger: silentLogger })(makeReq({ 'Idempotency-Key': 'k' }, original), res, next);

            expect(next).not.toHaveBeenCalled();
            expect(res.statusCode).toBe(422);
            expect(res.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
            expect(res.headers['idempotent-replay']).toBeUndefined();
            expect(db.run).not.toHaveBeenCalled();
        });

        it.each(['completed', 'pending'])(
            'legacy %s row without a fingerprint fails closed (422) — never replays a pre-moderation response',
            async (status) => {
                const db = {
                    get: jest.fn().mockResolvedValue({ status_code: 200, response: '{"success":true,"data":{"id":1}}', status, request_hash: null }),
                    run: jest.fn(),
                };
                const res = makeRes();
                const next = jest.fn();
                await withIdempotency({ db, logger: silentLogger })(makeReq({ 'Idempotency-Key': 'k' }, original), res, next);
                expect(next).not.toHaveBeenCalled();
                expect(res.statusCode).toBe(422);
                expect(res.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
                expect(res.headers['idempotent-replay']).toBeUndefined();
                expect(res.rawBody).toBeNull();
                expect(db.run).not.toHaveBeenCalled();
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
            const db = { get: jest.fn(), run: jest.fn() };
            const res = makeRes();
            const next = jest.fn();
            await withIdempotency({ db, logger: silentLogger })(makeReq({ 'Idempotency-Key': key }), res, next);

            expect(next).not.toHaveBeenCalled();
            expect(res.statusCode).toBe(400);
            expect(['IDEMPOTENCY_KEY_INVALID', 'IDEMPOTENCY_KEY_TOO_LONG']).toContain(res.body.error.code);
            expect(db.get).not.toHaveBeenCalled();
            expect(db.run).not.toHaveBeenCalled();
        });

        it.each([['a UUID', '0b0e6f9c-3f59-4c43-9d55-1f4f2d0f8a11'], ['128 safe chars', 'A1._:-'.repeat(21) + 'xy']])(
            'accepts %s',
            async (_label, key) => {
                const db = {
                    get: jest.fn().mockResolvedValue(undefined),
                    run: jest.fn().mockResolvedValue({ lastID: 1, changes: 1 }),
                };
                const next = jest.fn();
                await withIdempotency({ db, logger: silentLogger })(makeReq({ 'Idempotency-Key': key }), makeRes(), next);
                expect(next).toHaveBeenCalledTimes(1);
            },
        );
    });

    it('lookup failure: SELECT throws → falls through to handler (does NOT block writes)', async () => {
        const db = {
            get: jest.fn().mockRejectedValue(new Error('disk error')),
            run: jest.fn(),
        };
        const middleware = withIdempotency({ db, logger: silentLogger });
        const req = makeReq({ 'Idempotency-Key': 'k-broken' });
        const res = makeRes();
        const next = jest.fn();

        await middleware(req, res, next);

        expect(next).toHaveBeenCalledTimes(1);
        // res.json was NOT wrapped (we never reached the wrap step), so a handler
        // calling res.json should not attempt an UPDATE/DELETE.
        res.json({ ok: true });
        expect(db.run).not.toHaveBeenCalled();
    });
});
