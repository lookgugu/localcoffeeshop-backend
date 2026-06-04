/**
 * Cached Route Helper
 *
 * Express middleware wrapper around `QueryCache`. Composes a deterministic
 * cache key from `req.route.path + sorted query + sorted params`, increments
 * hit/miss metrics labelled by route, and sets `X-Cache: HIT|MISS` and
 * `Cache-Control` response headers.
 *
 * Fetchers return either:
 *   - a value (passed straight to `sendSuccess(res, value)`), or
 *   - `{ data, metadata }` (split into `sendSuccess(res, data, metadata)`).
 */

function sortedEntries(obj) {
    if (!obj || typeof obj !== 'object') return '';
    return Object.keys(obj)
        .sort()
        .map((k) => `${k}=${obj[k]}`)
        .join('&');
}

function composeKey(req) {
    const routePath = req.route?.path ?? req.path;
    return `${routePath}?${sortedEntries(req.query)}&${sortedEntries(req.params)}`;
}

/**
 * Build the route-layer cache wrapper.
 *
 * @param {Object} cache A QueryCache instance (or anything exposing `through`)
 * @param {Object} deps
 * @param {Object} deps.cacheHits prom-client Counter for cache hits
 * @param {Object} deps.cacheMisses prom-client Counter for cache misses
 * @param {(res: Object, data: any, metadata?: any) => void} deps.sendSuccess Response helper
 */
function makeCachedRoute(cache, { cacheHits, cacheMisses, sendSuccess }) {
    /**
     * Wrap a fetcher into an Express handler with read-through caching.
     *
     * @param {(req: Object) => Promise<any>} fetcher Loader for cache misses
     * @param {Object} [opts]
     * @param {number} [opts.ttlSeconds=60] TTL in seconds (<=0 to bypass)
     * @param {number} [opts.cacheControlMaxAge] If set, sets `Cache-Control: public, max-age=N`
     */
    return function cached(fetcher, opts = {}) {
        const ttl = opts.ttlSeconds ?? 60;
        const cacheControlMaxAge = opts.cacheControlMaxAge;

        return async (req, res, next) => {
            const key = composeKey(req);
            const routeLabel = req.route?.path ?? req.path;

            try {
                // Determine hit vs miss by observing whether our loader ran.
                // (The cache's own onEvent is global; we need a per-call signal.)
                let loadRan = false;
                const result = await cache.through(key, ttl, async () => {
                    loadRan = true;
                    return fetcher(req);
                });
                const outcome = loadRan ? 'MISS' : 'HIT';

                if (outcome === 'HIT') {
                    if (cacheHits) cacheHits.labels(routeLabel).inc();
                } else if (cacheMisses) {
                    cacheMisses.labels(routeLabel).inc();
                }

                if (cacheControlMaxAge !== undefined) {
                    res.set('Cache-Control', `public, max-age=${cacheControlMaxAge}`);
                }
                res.set('X-Cache', outcome);

                if (result && typeof result === 'object' && 'data' in result && 'metadata' in result) {
                    sendSuccess(res, result.data, result.metadata);
                } else {
                    sendSuccess(res, result);
                }
            } catch (err) {
                next(err);
            }
        };
    };
}

module.exports = { makeCachedRoute, composeKey };
