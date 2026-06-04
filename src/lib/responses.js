/**
 * Response Helpers
 *
 * Standard success/error envelopes used across the API.
 *
 * `sendError` includes `details` only outside production to avoid leaking
 * internals. `sendSuccess` attaches `metadata` when supplied.
 *
 * Also exports `attachCacheHeaders(req, res, next)` — the envelope-wrapping
 * middleware that augments responses on the /api/v1 router with `Vary`
 * and `Cache-Control`. (Handlers that know their underlying data's real
 * modification time may set `Last-Modified` themselves; this middleware
 * deliberately does NOT auto-set it, because a per-request `new Date()`
 * makes every `If-Modified-Since` look stale and defeats 304 caching.)
 */

/**
 * Send a standardised error envelope.
 *
 * @param {import('express').Response} res
 * @param {number} statusCode HTTP status code
 * @param {string} message Human-readable error message
 * @param {*} [details] Optional details (only included outside production)
 * @param {Object} [opts]
 * @param {string} [opts.nodeEnv] Defaults to process.env.NODE_ENV
 */
function sendError(res, statusCode, message, details = null, opts = {}) {
    const nodeEnv = opts.nodeEnv || process.env.NODE_ENV;
    const response = {
        success: false,
        error: {
            message,
            statusCode,
            timestamp: new Date().toISOString(),
            requestId: res.req?.id,
        },
    };
    if (details && nodeEnv !== 'production') {
        response.error.details = details;
    }
    res.status(statusCode).json(response);
}

/**
 * Send a standardised success envelope.
 *
 * @param {import('express').Response} res
 * @param {*} data
 * @param {Object|null} [metadata]
 */
function sendSuccess(res, data, metadata = null) {
    const response = { success: true, data };
    if (metadata) response.metadata = metadata;
    res.json(response);
}

/**
 * Express middleware that adds `Vary` and a default `Cache-Control` to
 * successful JSON envelopes — only when the route handler hasn't already set
 * them. Mount on the /api/v1 router. `Last-Modified` is intentionally not
 * defaulted here: setting it to "now" on every response makes conditional
 * `If-Modified-Since` revalidation always return 200, never 304. Handlers
 * with a real modification timestamp may set the header explicitly.
 */
function attachCacheHeaders(req, res, next) {
    const originalJson = res.json.bind(res);
    res.json = function (body) {
        res.set('Vary', 'Accept-Encoding');
        if (res.statusCode === 200 && body?.success === true) {
            if (!res.get('Cache-Control')) {
                const cacheTime = req.path.includes('/search') ? 300 : 3600;
                res.set('Cache-Control', `public, max-age=${cacheTime}`);
            }
        }
        return originalJson(body);
    };
    next();
}

module.exports = { sendError, sendSuccess, attachCacheHeaders };
