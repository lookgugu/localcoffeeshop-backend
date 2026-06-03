/**
 * Unit Tests — withIdempotency middleware
 *
 * Exercises the middleware against a fake `db` so the tests run with no
 * sqlite3 dependency. Behaviour we cover:
 *   - hit: returns cached payload with Idempotent-Replay; handler not called
 *   - miss: handler called, response cached after res.json
 *   - no header: handler called, nothing cached
 *   - TTL expiry: row older than ttl → treated as miss
 *   - concurrent: parallel identical requests both succeed
 *   - lookup failure: SELECT throws → falls through to handler
 */

const { withIdempotency } = require('../../../src/lib/idempotency');

function makeRes() {
    const res = {
        statusCode: 200,
        headers: {},
        body: null,
        rawBody: null,
        set(name, value) { this.headers[name.toLowerCase()] = value; return this; },
        get(name) { return this.headers[name.toLowerCase()]; },
        status(code) { this.statusCode = code; return this; },
        type() { return this; },
        send(payload) { this.rawBody = payload; return this; },
        json(payload) { this.body = payload; return this; },
    };
    return res;
}

function makeReq(headers = {}, { method = 'POST', path = '/coffee-shops' } = {}) {
    const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
    return {
        method,
        path,
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

    it('on hit: replays cached body, sets Idempotent-Replay, skips handler', async () => {
        const cachedBody = JSON.stringify({ success: true, data: { id: 7 } });
        const db = {
            get: jest.fn().mockResolvedValue({ status_code: 201, response: cachedBody }),
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

    it('on miss: calls handler, then caches the response after res.json', async () => {
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

        // Simulate the handler running.
        res.statusCode = 200;
        res.json({ success: true, data: { id: 42 } });

        // Give the fire-and-forget INSERT a tick to run.
        await new Promise((r) => setImmediate(r));

        const insertCall = db.run.mock.calls.find(([sql]) => sql.includes('INSERT OR IGNORE INTO idempotency_keys'));
        expect(insertCall).toBeDefined();
        const [, params] = insertCall;
        expect(params[0]).toBe('k-miss');                  // key
        expect(params[1]).toBe('POST /coffee-shops');       // endpoint
        expect(params[2]).toBe(200);                        // status_code
        expect(JSON.parse(params[3])).toEqual({ success: true, data: { id: 42 } });
        expect(typeof params[4]).toBe('number');            // created_at
    });

    it('TTL expiry: lookup query filters by created_at > now-ttl; expired row → miss', async () => {
        // First call uses a small ttl and the row is older — db.get is parametrised
        // by `minCreated`, so the test verifies the parameter passed in.
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
        // minCreated should be roughly now-60. Allow a small drift window.
        expect(minCreated).toBeGreaterThanOrEqual(beforeNow - 61);
        expect(minCreated).toBeLessThanOrEqual(beforeNow - 59);
    });

    it('concurrent: two parallel identical requests both resolve cleanly', async () => {
        // Simulate the race: both SELECTs return no row, both INSERT OR IGNOREs succeed
        // (the second is silently a no-op in real sqlite — here we just verify the
        // middleware doesn't throw on either path).
        const db = {
            get: jest.fn().mockResolvedValue(undefined),
            run: jest.fn().mockResolvedValue({ lastID: 1, changes: 1 }),
        };
        const middleware = withIdempotency({ db, logger: silentLogger });

        const runOne = async () => {
            const req = makeReq({ 'Idempotency-Key': 'k-race' });
            const res = makeRes();
            const next = jest.fn();
            await middleware(req, res, next);
            res.json({ success: true });
            return next;
        };

        const [next1, next2] = await Promise.all([runOne(), runOne()]);
        expect(next1).toHaveBeenCalledTimes(1);
        expect(next2).toHaveBeenCalledTimes(1);

        await new Promise((r) => setImmediate(r));
        const inserts = db.run.mock.calls.filter(([sql]) => sql.includes('INSERT OR IGNORE'));
        expect(inserts).toHaveLength(2);
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
        // calling res.json should not attempt an INSERT.
        res.json({ ok: true });
        expect(db.run).not.toHaveBeenCalled();
    });
});
