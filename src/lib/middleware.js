/**
 * Middleware Stack
 *
 * MIDDLEWARE ORDER IS LOAD-BEARING — do not reorder:
 *   1. request-id           (every downstream log needs req.id)
 *   2. pinoHttp              (must run before handlers that log)
 *   3. metrics collector    (wraps res.end; must run before routes)
 *   4. compression
 *   5. helmet                (security headers)
 *   6. https enforcement    (production only; skipped for health checks)
 *   7. cors
 *   8. json body parser     (10kb limit)
 *   9. cache-busting for .js/.css static asset paths
 *  10. static asset serving (production: /dist immutable, /public 1d; dev: /public 1d)
 *  11. rate-limit           (mounted on /api/ — AFTER cors, BEFORE the router)
 *
 * Rate-limit must come last in this list because it's mounted on a path
 * prefix; the prior global middleware needs to wrap it.
 */

const crypto = require('crypto');
const path = require('path');
const zlib = require('zlib');
const compression = require('compression');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const express = require('express');
const pinoHttp = require('pino-http');

/**
 * Mount the full ordered middleware stack on the app.
 *
 * @param {import('express').Application} app
 * @param {Object} deps
 * @param {Object} deps.config Frozen config from loadConfig
 * @param {Object} deps.logger Pino logger
 * @param {Object} deps.metrics Built metrics object
 */
function mountMiddleware(app, { config, logger, metrics }) {
    // 1. Request ID — adds unique ID to each request for tracing
    app.use((req, res, next) => {
        const requestId = req.headers['x-request-id'] || crypto.randomBytes(16).toString('hex');
        req.id = requestId;
        res.setHeader('X-Request-ID', requestId);
        next();
    });

    // 2. HTTP request logging — includes request ID
    app.use(/** @type {any} */ (pinoHttp)({
        logger,
        customProps: (req) => ({ requestId: req.id }),
    }));

    // 3. Prometheus metrics collector — wraps res.end
    app.use((req, res, next) => {
        const start = Date.now();
        const originalEnd = res.end;
        const endFunc = function (...args) {
            const duration = (Date.now() - start) / 1000;
            // Static fallback (not req.path) — otherwise unmatched URLs from
            // scanners or random paths each become a new Prometheus label,
            // causing high-cardinality memory blow-up.
            const route = req.route ? req.route.path : 'unmatched';
            metrics.httpDuration.labels(req.method, route, String(res.statusCode)).observe(duration);
            metrics.httpTotal.labels(req.method, route, String(res.statusCode)).inc();
            originalEnd.apply(res, args);
        };
        res.end = /** @type {any} */ (endFunc);
        next();
    });

    // 4. Compression — 60-80% bandwidth reduction on JSON
    app.use(compression({
        level: config.compressionLevel,
        threshold: config.compressionThreshold,
        filter: (req, res) => {
            if (req.headers['x-no-compression']) return false;
            return compression.filter(req, res);
        },
        memLevel: 8,
        strategy: zlib.constants.Z_DEFAULT_STRATEGY,
    }));

    // 5. Helmet — security headers
    app.use(/** @type {any} */ (helmet)({
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                scriptSrc: ["'self'", 'https://www.googletagmanager.com'],
                styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
                fontSrc: ["'self'", 'https://fonts.gstatic.com'],
                imgSrc: ["'self'", 'data:'],
                connectSrc: [
                    "'self'",
                    'https://www.google-analytics.com',
                    'https://analytics.google.com',
                    ...(config.frontendUrl ? [config.frontendUrl] : []),
                ],
                frameAncestors: ["'none'"],
            },
        },
        referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
        permissionsPolicy: {
            features: {
                geolocation: [],
                microphone: [],
                camera: [],
            },
        },
    }));

    // 6. HTTPS enforcement (production only; skip health checks for LBs)
    if (config.nodeEnv === 'production') {
        app.use((req, res, next) => {
            const healthPaths = ['/api/v1/health', '/api/health', '/health'];
            if (healthPaths.some((p) => req.path.startsWith(p))) {
                return next();
            }
            if (!req.secure) {
                const httpsUrl = `https://${req.headers.host}${req.url}`;
                logger.info({ from: req.url, to: httpsUrl }, 'Redirecting HTTP to HTTPS');
                return res.redirect(301, httpsUrl);
            }
            next();
        });
    }

    // 7. CORS
    // PUT/DELETE need to be in `methods` so browser preflights for the write
    // endpoints succeed; Idempotency-Key needs to be allowed so retries from
    // a separate-origin frontend can flow through withIdempotency.
    app.use(cors({
        origin: config.corsOrigins === false ? false : config.corsOrigins,
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],
    }));

    if (config.corsOrigins === false) {
        logger.info('CORS disabled - only same-origin requests allowed');
    } else if (Array.isArray(config.corsOrigins)) {
        logger.info(
            { corsOrigins: config.corsOrigins, nodeEnv: config.nodeEnv },
            `CORS configured for ${config.corsOrigins.length} origin(s)`,
        );
    }

    // 8. JSON body parser with size limit
    app.use(express.json({ limit: '10kb' }));

    // 9. Cache-busting for JS/CSS — forces revalidation while still caching
    app.use((req, res, next) => {
        if (req.path.endsWith('.js') || req.path.endsWith('.css')) {
            res.set('Cache-Control', 'no-cache, must-revalidate');
        }
        next();
    });

    // 10. Static asset serving
    if (config.nodeEnv === 'production') {
        app.use('/dist', express.static('public/dist', {
            maxAge: '1y',
            immutable: true,
            etag: true,
            lastModified: true,
        }));
        app.use(express.static('public', {
            maxAge: '1d',
            etag: true,
            lastModified: true,
        }));
    } else {
        app.use(express.static('public', {
            maxAge: '1d',
            etag: true,
            lastModified: true,
        }));
    }

    // 11. Rate limit on /api/* — AFTER cors, BEFORE the v1 router mounts
    const apiLimiter = /** @type {any} */ (rateLimit)({
        windowMs: config.rateLimitWindowMs,
        max: config.rateLimitMax,
        message: { error: 'Too many requests, please try again later.' },
        standardHeaders: true,
        legacyHeaders: false,
    });
    app.use('/api/', apiLimiter);

    // ETag config used by route handlers
    app.set('etag', 'strong');
}

module.exports = { mountMiddleware };
