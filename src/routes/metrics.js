/**
 * Metrics Route
 *
 * Top-level (outside /api/v1) so scrapers don't go through rate-limit.
 * Always protected by a bearer token; if METRICS_AUTH_TOKEN is unset,
 * the endpoint refuses with 503.
 */

const crypto = require('crypto');
const { sendError } = require('../lib/responses');

/**
 * Constant-time bearer-token comparison. Guards against timing side-channels
 * that could let an attacker recover the token byte-by-byte. Length is checked
 * first because timingSafeEqual throws on unequal-length buffers.
 */
function tokensMatch(provided, expected) {
    if (typeof provided !== 'string' || typeof expected !== 'string') return false;
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
}

function mountMetricsRoute(app, { metrics, config, logger }) {
    app.get('/metrics', async (req, res) => {
        if (!config.metricsAuthToken) {
            const envInfo = config.nodeEnv === 'production' ? '' : ' (even in development)';
            logger.warn(`Metrics endpoint disabled${envInfo}. Set METRICS_AUTH_TOKEN to enable.`);
            return sendError(res, 503, 'Metrics endpoint not configured. Set METRICS_AUTH_TOKEN environment variable.');
        }

        const authHeader = req.headers.authorization;
        const token = authHeader && authHeader.startsWith('Bearer ')
            ? authHeader.substring(7)
            : null;
        if (!token || !tokensMatch(token, config.metricsAuthToken)) {
            logger.warn({ ip: req.ip }, 'Unauthorized metrics access attempt');
            return sendError(res, 401, 'Unauthorized. Valid Bearer token required.');
        }

        try {
            res.set('Content-Type', metrics.registry.contentType);
            res.end(await metrics.registry.metrics());
        } catch (err) {
            logger.error({ err }, 'Error generating metrics');
            // Don't leak internal error details to the client, even behind auth.
            res.status(500).end('Internal Server Error');
        }
    });
}

module.exports = { mountMetricsRoute };
