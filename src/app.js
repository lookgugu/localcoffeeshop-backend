/**
 * App Factory
 *
 * `buildApp(deps)` constructs and returns an Express app. No side effects
 * outside the app (no `listen`, no `process.on`). All dependencies are
 * injected so tests can swap real ones for stubs.
 */

const path = require('path');
const express = require('express');
const packageJson = require('../package.json');

const { mountMiddleware } = require('./lib/middleware');
const { makeCachedRoute } = require('./lib/cached-route');
const { sendError, sendSuccess } = require('./lib/responses');
const { ValidationError } = require('./usecases/errors');
const { makeSearchShopsUseCase } = require('./usecases/searchShops');
const { mountMetricsRoute } = require('./routes/metrics');
const { mountApiV1 } = require('./routes/api-v1');
const { mountSeo } = require('./routes/seo');

/**
 * Build the Express app from injected dependencies.
 *
 * @param {Object} deps
 * @param {Object} deps.config Frozen config object from loadConfig
 * @param {Object} deps.db Database module (initialize, get, all, isHealthy, close)
 * @param {Object} deps.cache QueryCache instance
 * @param {Object} deps.logger Pino-shaped logger
 * @param {Object} deps.metrics Built metrics object from buildMetrics
 * @param {Object} deps.enums Enums module (State, Price)
 * @returns {import('express').Application}
 */
function buildApp({ config, db, cache, logger, metrics, enums }) {
    const app = express();

    if (config.nodeEnv === 'production') {
        // Trust the first proxy hop so req.secure works with X-Forwarded-Proto.
        app.set('trust proxy', 1);
    }

    mountMiddleware(app, { config, logger, metrics });

    // /metrics is top-level (outside /api/v1) and bypasses the rate limiter
    // — scrapers shouldn't be throttled.
    mountMetricsRoute(app, { metrics, config, logger });

    // Use cases and the cache wrapper close over the injected deps.
    const cached = makeCachedRoute(cache, {
        cacheHits: metrics.cacheHits,
        cacheMisses: metrics.cacheMisses,
        sendSuccess,
    });
    const searchShopsUseCase = makeSearchShopsUseCase({ db });

    mountApiV1(app, {
        db,
        cached,
        searchShopsUseCase,
        config,
        logger,
        enums,
        packageJson,
    });

    mountSeo(app, { db, enums, config });

    // 404 for non-API paths — falls through to a static 404.html.
    // Path matches the original server.js exactly (src/public/html/404.html).
    app.use((req, res, next) => {
        if (req.path.startsWith('/api/')) return next();
        logger.info({ path: req.path, method: req.method }, '404 Not Found');
        res.status(404).sendFile(path.join(__dirname, 'public', 'html', '404.html'));
    });

    // Global error handler — MUST be last. Maps ValidationError to 400.
    // eslint-disable-next-line no-unused-vars
    app.use((err, req, res, next) => {
        if (err instanceof ValidationError) {
            return sendError(res, 400, err.message);
        }
        logger.error({ err, url: req.url, method: req.method }, 'Unhandled server error');
        sendError(res, 500, 'Internal server error', err.message, { nodeEnv: config.nodeEnv });
    });

    return app;
}

module.exports = { buildApp };
