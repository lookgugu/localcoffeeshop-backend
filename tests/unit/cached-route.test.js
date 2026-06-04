/**
 * Unit Tests for makeCachedRoute
 *
 * Verifies the Express middleware wrapper composes cache keys, forwards
 * hit/miss outcomes to metrics, sets X-Cache headers, and calls sendSuccess.
 */

const { makeCachedRoute, composeKey } = require('../../src/lib/cached-route');

function makeReqRes({ route = { path: '/widgets/:id' }, query = {}, params = {} } = {}) {
    const headers = {};
    const req = { route, query, params, path: route.path };
    const res = {
        headers,
        set: (k, v) => { headers[k] = v; },
        get: (k) => headers[k],
    };
    return { req, res };
}

function makeCounter() {
    const calls = [];
    const counter = {
        labels: (label) => ({
            inc: () => { calls.push(label); },
        }),
        calls,
    };
    return counter;
}

describe('composeKey()', () => {
    it('returns a deterministic string from route path + sorted query + sorted params', () => {
        const a = composeKey({
            route: { path: '/widgets/:id' },
            query: { b: '2', a: '1' },
            params: { id: '42' },
        });
        const b = composeKey({
            route: { path: '/widgets/:id' },
            query: { a: '1', b: '2' },
            params: { id: '42' },
        });
        expect(a).toBe(b);
        expect(a).toBe('/widgets/:id?a=1&b=2&id=42');
    });

    it('handles missing query/params', () => {
        const key = composeKey({ route: { path: '/x' }, query: {}, params: {} });
        expect(key).toBe('/x?&');
    });

    it('falls back to req.path when no route is matched', () => {
        const key = composeKey({ path: '/raw', query: { q: 'foo' }, params: {} });
        expect(key).toBe('/raw?q=foo&');
    });
});

describe('makeCachedRoute()', () => {
    let cacheHits;
    let cacheMisses;
    let sendSuccess;

    beforeEach(() => {
        cacheHits = makeCounter();
        cacheMisses = makeCounter();
        sendSuccess = jest.fn();
    });

    it('passes the composed key + ttl to cache.through and forwards fetcher result to sendSuccess', async () => {
        const fakeCache = {
            through: jest.fn().mockImplementation((key, ttl, load) => load()),
        };
        const fetcher = jest.fn().mockResolvedValue([{ id: 1 }]);
        const cached = makeCachedRoute(fakeCache, { cacheHits, cacheMisses, sendSuccess });
        const handler = cached(fetcher, { ttlSeconds: 120 });

        const { req, res } = makeReqRes({
            route: { path: '/items' },
            query: { q: 'foo' },
            params: {},
        });

        await handler(req, res, () => {});

        expect(fakeCache.through).toHaveBeenCalledTimes(1);
        const [key, ttl] = fakeCache.through.mock.calls[0];
        expect(key).toBe('/items?q=foo&');
        expect(ttl).toBe(120);
        expect(sendSuccess).toHaveBeenCalledWith(res, [{ id: 1 }]);
    });

    it('splits {data, metadata} payloads when calling sendSuccess', async () => {
        const fakeCache = { through: (k, t, load) => load() };
        const fetcher = jest.fn().mockResolvedValue({
            data: [{ x: 1 }],
            metadata: { count: 1 },
        });
        const cached = makeCachedRoute(fakeCache, { cacheHits, cacheMisses, sendSuccess });
        const handler = cached(fetcher);

        const { req, res } = makeReqRes();
        await handler(req, res, () => {});

        expect(sendSuccess).toHaveBeenCalledWith(res, [{ x: 1 }], { count: 1 });
    });

    it('sets X-Cache: MISS and increments misses when fetcher runs', async () => {
        const fakeCache = { through: (k, t, load) => load() };
        const cached = makeCachedRoute(fakeCache, { cacheHits, cacheMisses, sendSuccess });
        const handler = cached(() => Promise.resolve('v'));

        const { req, res } = makeReqRes({ route: { path: '/r' } });
        await handler(req, res, () => {});

        expect(res.headers['X-Cache']).toBe('MISS');
        expect(cacheMisses.calls).toEqual(['/r']);
        expect(cacheHits.calls).toEqual([]);
    });

    it('sets X-Cache: HIT and increments hits when cache serves without running load', async () => {
        // Simulate a cache that returns a pre-existing value without invoking load
        const fakeCache = { through: jest.fn().mockResolvedValue('cached-value') };
        const fetcher = jest.fn();
        const cached = makeCachedRoute(fakeCache, { cacheHits, cacheMisses, sendSuccess });
        const handler = cached(fetcher);

        const { req, res } = makeReqRes({ route: { path: '/r' } });
        await handler(req, res, () => {});

        expect(fetcher).not.toHaveBeenCalled();
        expect(res.headers['X-Cache']).toBe('HIT');
        expect(cacheHits.calls).toEqual(['/r']);
        expect(cacheMisses.calls).toEqual([]);
        expect(sendSuccess).toHaveBeenCalledWith(res, 'cached-value');
    });

    it('sets Cache-Control when cacheControlMaxAge is provided', async () => {
        const fakeCache = { through: (k, t, load) => load() };
        const cached = makeCachedRoute(fakeCache, { cacheHits, cacheMisses, sendSuccess });
        const handler = cached(() => Promise.resolve('v'), { cacheControlMaxAge: 600 });

        const { req, res } = makeReqRes();
        await handler(req, res, () => {});

        expect(res.headers['Cache-Control']).toBe('public, max-age=600');
    });

    it('forwards errors to next() when fetcher rejects', async () => {
        const fakeCache = { through: (k, t, load) => load() };
        const err = new Error('boom');
        const cached = makeCachedRoute(fakeCache, { cacheHits, cacheMisses, sendSuccess });
        const handler = cached(() => Promise.reject(err));

        const { req, res } = makeReqRes();
        const next = jest.fn();
        await handler(req, res, next);

        expect(next).toHaveBeenCalledWith(err);
        expect(sendSuccess).not.toHaveBeenCalled();
    });

    it('defaults ttlSeconds to 60 when not specified', async () => {
        const fakeCache = { through: jest.fn().mockResolvedValue('v') };
        const cached = makeCachedRoute(fakeCache, { cacheHits, cacheMisses, sendSuccess });
        const handler = cached(() => Promise.resolve('v'));

        const { req, res } = makeReqRes();
        await handler(req, res, () => {});

        expect(fakeCache.through.mock.calls[0][1]).toBe(60);
    });
});
