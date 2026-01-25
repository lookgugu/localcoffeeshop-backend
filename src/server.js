require('dotenv').config();

const express = require('express');
const db = require('./db');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const compression = require('compression');
const pino = require('pino');
const pinoHttp = require('pino-http');
const promClient = require('prom-client');
const crypto = require('crypto');
const packageJson = require('../package.json');

const app = express();

// Trust proxy settings for production (Digital Ocean App Platform, AWS ELB, etc.)
// This enables req.secure to work correctly with X-Forwarded-Proto header
// Setting to 1 means trust the first proxy hop
if (process.env.NODE_ENV === 'production') {
    app.set('trust proxy', 1);
}

// Prometheus metrics setup
const register = new promClient.Registry();

// Add default metrics (CPU, memory, event loop, etc.)
promClient.collectDefaultMetrics({ register });

// Custom metrics
const httpRequestDuration = new promClient.Histogram({
    name: 'http_request_duration_seconds',
    help: 'Duration of HTTP requests in seconds',
    labelNames: ['method', 'route', 'status_code'],
    buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5]
});

const httpRequestTotal = new promClient.Counter({
    name: 'http_requests_total',
    help: 'Total number of HTTP requests',
    labelNames: ['method', 'route', 'status_code']
});

const databaseQueryDuration = new promClient.Histogram({
    name: 'database_query_duration_seconds',
    help: 'Duration of database queries in seconds',
    labelNames: ['query_type'],
    buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1]
});

const databaseErrors = new promClient.Counter({
    name: 'database_errors_total',
    help: 'Total number of database errors',
    labelNames: ['query_type']
});

// Cache metrics
const cacheHits = new promClient.Counter({
    name: 'cache_hits_total',
    help: 'Total number of cache hits',
    labelNames: ['cache_key']
});

const cacheMisses = new promClient.Counter({
    name: 'cache_misses_total',
    help: 'Total number of cache misses',
    labelNames: ['cache_key']
});

// Register custom metrics
register.registerMetric(httpRequestDuration);
register.registerMetric(httpRequestTotal);
register.registerMetric(databaseQueryDuration);
register.registerMetric(databaseErrors);
register.registerMetric(cacheHits);
register.registerMetric(cacheMisses);

// In-memory cache implementation with TTL support, max size limit, and LRU eviction
class SimpleCache {
    constructor(options = {}) {
        const {
            defaultTTL = 3600000,    // Default 1 hour TTL
            maxSize = 10000,          // Maximum number of entries
            cleanupInterval = 60000   // Cleanup every minute
        } = options;

        this.cache = new Map();
        this.defaultTTL = defaultTTL;
        this.maxSize = maxSize;

        // Single periodic cleanup timer instead of per-entry timers
        this.cleanupTimer = setInterval(() => {
            this._cleanup();
        }, cleanupInterval);

        // Prevent timer from keeping process alive
        if (this.cleanupTimer.unref) {
            this.cleanupTimer.unref();
        }
    }

    set(key, value, ttl = this.defaultTTL) {
        // Evict oldest entries if at max size
        if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
            this._evictOldest();
        }

        const now = Date.now();
        this.cache.set(key, {
            value,
            expiresAt: now + ttl,
            lastAccessed: now
        });
    }

    get(key) {
        const entry = this.cache.get(key);

        if (!entry) {
            cacheMisses.labels(key).inc();
            return null;
        }

        // Check if expired
        if (Date.now() > entry.expiresAt) {
            this.cache.delete(key);
            cacheMisses.labels(key).inc();
            return null;
        }

        // Update last accessed time for LRU tracking
        entry.lastAccessed = Date.now();
        cacheHits.labels(key).inc();
        return entry.value;
    }

    delete(key) {
        return this.cache.delete(key);
    }

    clear() {
        this.cache.clear();
    }

    has(key) {
        const entry = this.cache.get(key);
        if (!entry) return false;

        // Check if expired
        if (Date.now() > entry.expiresAt) {
            this.cache.delete(key);
            return false;
        }

        return true;
    }

    size() {
        return this.cache.size;
    }

    // Internal cleanup method - removes expired entries
    _cleanup() {
        const now = Date.now();
        let cleaned = 0;
        // Iterate directly without creating array copy
        for (const [key, entry] of this.cache.entries()) {
            if (now > entry.expiresAt) {
                this.cache.delete(key);
                cleaned++;
            }
        }
        if (cleaned > 0) {
            // Use logger if available, otherwise silent
            if (typeof logger !== 'undefined') {
                logger.debug({ cleaned, remaining: this.cache.size }, 'Cache cleanup completed');
            }
        }
    }

    // Evict oldest (least recently accessed) entries when at max size
    _evictOldest() {
        // Find and remove the least recently accessed entry
        let oldestKey = null;
        let oldestTime = Infinity;

        // Iterate directly without creating array copy
        for (const [key, entry] of this.cache.entries()) {
            if (entry.lastAccessed < oldestTime) {
                oldestTime = entry.lastAccessed;
                oldestKey = key;
            }
        }

        if (oldestKey) {
            this.cache.delete(oldestKey);
        }
    }

    // Stop cleanup timer (for graceful shutdown)
    destroy() {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
            this.cleanupTimer = null;
        }
    }
}

// Initialize cache instance with sensible limits
const queryCache = new SimpleCache({
    defaultTTL: 3600000,    // 1 hour default TTL
    maxSize: 10000,         // Max 10,000 entries
    cleanupInterval: 60000  // Cleanup every minute
});



// Configuration from environment variables
const config = {
    port: process.env.PORT || 3000,
    dbPath: process.env.DB_PATH || './coffee_shops.db',
    nodeEnv: process.env.NODE_ENV || 'development',
    // CORS: Default to same-origin only for security. Use CORS_ORIGIN env var to allow specific origins.
    // Set CORS_ORIGIN=* explicitly in development if cross-origin access is needed.
    corsOrigin: process.env.CORS_ORIGIN || false,
    logLevel: process.env.LOG_LEVEL || 'info',
    rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
    rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
    gaMeasurementId: process.env.GA_MEASUREMENT_ID || '',
    metricsAuthToken: process.env.METRICS_AUTH_TOKEN || '',
    compressionLevel: parseInt(process.env.COMPRESSION_LEVEL) || 6, // 1-9, higher = better compression but slower
    compressionThreshold: parseInt(process.env.COMPRESSION_THRESHOLD) || 5120 // bytes (5KB min to avoid compression overhead)
};

// Environment variable validation for production
// Warns about missing recommended variables instead of failing
if (config.nodeEnv === 'production') {
    const warnings = [];
    const recommendations = [];

    // Check for recommended production variables
    if (!process.env.METRICS_AUTH_TOKEN) {
        recommendations.push('METRICS_AUTH_TOKEN not set - /metrics endpoint will be disabled');
    }
    if (!process.env.CORS_ORIGIN) {
        recommendations.push('CORS_ORIGIN not set - defaulting to same-origin only');
    }
    if (!process.env.GA_MEASUREMENT_ID) {
        recommendations.push('GA_MEASUREMENT_ID not set - analytics disabled');
    }

    // Check for critical issues
    if (!require('fs').existsSync(config.dbPath)) {
        warnings.push(`Database file not found at ${config.dbPath}`);
    }

    // Log warnings (will be logged after logger is initialized)
    config._startupWarnings = warnings;
    config._startupRecommendations = recommendations;
}

// Configure structured logging
const logger = pino({
    level: config.logLevel,
    transport: config.nodeEnv !== 'production' ? {
        target: 'pino-pretty',
        options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname'
        }
    } : undefined
});

// Log startup warnings and recommendations (collected during config validation)
if (config._startupWarnings && config._startupWarnings.length > 0) {
    config._startupWarnings.forEach(warning => {
        logger.warn(warning);
    });
}
if (config._startupRecommendations && config._startupRecommendations.length > 0) {
    config._startupRecommendations.forEach(rec => {
        logger.info({ type: 'recommendation' }, rec);
    });
}

// Request ID middleware - adds unique ID to each request for tracing
app.use((req, res, next) => {
    // Use existing request ID from header or generate new one
    const requestId = req.headers['x-request-id'] || crypto.randomBytes(16).toString('hex');

    // Store in request for use in handlers
    req.id = requestId;

    // Add to response headers for client-side tracing
    res.setHeader('X-Request-ID', requestId);

    next();
});

// HTTP request logging middleware - includes request ID
app.use(/** @type {any} */ (pinoHttp)({
    logger,
    customProps: (req) => ({
        requestId: req.id
    })
}));

// Prometheus metrics middleware - track request duration and count
app.use((req, res, next) => {
    const start = Date.now();

    // Capture original end function
    const originalEnd = res.end;

    // Override end function to capture metrics
    const endFunc = function(...args) {
        const duration = (Date.now() - start) / 1000; // Convert to seconds
        const route = req.route ? req.route.path : req.path;

        // Record metrics
        httpRequestDuration.labels(req.method, route, String(res.statusCode)).observe(duration);
        httpRequestTotal.labels(req.method, route, String(res.statusCode)).inc();

        // Call original end function
        originalEnd.apply(res, args);
    };
    res.end = /** @type {any} */ (endFunc);

    next();
});

// Response compression with optimized settings
// Reduces bandwidth by 60-80% for JSON responses
app.use(compression({
    // Compression level from config: good balance between speed and size (1-9)
    // Lower = faster but larger, Higher = slower but smaller
    // Level 6 is recommended for production (good balance)
    level: config.compressionLevel,

    // Only compress responses larger than threshold (default 1KB)
    // Small responses have overhead from compression
    threshold: config.compressionThreshold,

    // Compress these MIME types
    filter: (req, res) => {
        // Don't compress if client doesn't support it
        if (req.headers['x-no-compression']) {
            return false;
        }

        // Use compression for compressible content types
        return compression.filter(req, res);
    },

    // Memory level for compression (1-9, default 8)
    // Higher = more memory usage but better compression
    memLevel: 8,

    // Use Z_DEFAULT_STRATEGY for general purpose compression
    strategy: require('zlib').constants.Z_DEFAULT_STRATEGY
}));

// Security middleware - helmet for security headers
app.use(/** @type {any} */ (helmet)({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "https://www.googletagmanager.com"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
            fontSrc: ["'self'", "https://fonts.gstatic.com"],
            imgSrc: ["'self'", "data:"],
            connectSrc: [
                "'self'",
                "https://www.google-analytics.com",
                "https://analytics.google.com",
                ...(process.env.FRONTEND_URL ? [process.env.FRONTEND_URL] : [])
            ],
            frameAncestors: ["'none'"], // Prevent clickjacking
        },
    },
    // Additional security headers
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    permissionsPolicy: {
        features: {
            geolocation: [],
            microphone: [],
            camera: [],
        },
    },
}));

// HTTPS enforcement in production
if (config.nodeEnv === 'production') {
    app.use((req, res, next) => {
        // Skip HTTPS enforcement for health check endpoints (used by load balancers)
        // Using startsWith for prefix matching to handle any query strings or sub-paths
        const healthPaths = ['/api/v1/health', '/api/health', '/health'];
        if (healthPaths.some(p => req.path.startsWith(p))) {
            return next();
        }

        // req.secure is properly set when 'trust proxy' is configured
        // This correctly handles X-Forwarded-Proto from trusted proxies
        if (!req.secure) {
            // Redirect to HTTPS
            const httpsUrl = `https://${req.headers.host}${req.url}`;
            logger.info({ from: req.url, to: httpsUrl }, 'Redirecting HTTP to HTTPS');
            return res.redirect(301, httpsUrl);
        }

        next();
    });
}

// Rate limiting for API endpoints
const apiLimiter = /** @type {any} */ (rateLimit)({
    windowMs: config.rateLimitWindowMs,
    max: config.rateLimitMax,
    message: { error: 'Too many requests, please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
});

// Middleware
// CORS configuration - Support multiple origins for separate frontend deployment
const corsOrigins = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',').map(o => o.trim())
    : false;

app.use(cors({
    origin: corsOrigins === false ? false : corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

// Log CORS configuration
if (corsOrigins === false) {
    logger.info('CORS disabled - only same-origin requests allowed');
} else if (Array.isArray(corsOrigins)) {
    logger.info({
        corsOrigins: corsOrigins,
        nodeEnv: config.nodeEnv
    }, `CORS configured for ${corsOrigins.length} origin(s)`);
}
app.use(express.json({ limit: '10kb' })); // Add request body size limit

// Cache-busting middleware for JavaScript and CSS files
// Forces browsers to revalidate these files on every request while still allowing caching
app.use((req, res, next) => {
    if (req.path.endsWith('.js') || req.path.endsWith('.css')) {
        // no-cache means "always revalidate" - browsers will use ETag/If-None-Match
        // to check if file changed, getting 304 Not Modified if unchanged (fast)
        // or 200 with new content if changed
        res.set('Cache-Control', 'no-cache, must-revalidate');
    }
    next();
});

if (config.nodeEnv === 'production') {
    // Serve minified files from dist at /dist path with long cache
    app.use('/dist', express.static('public/dist', {
        maxAge: '1y',
        immutable: true,
        etag: true,
        lastModified: true
    }));
    // Serve other files from public directory
    app.use(express.static('public', {
        maxAge: '1d',
        etag: true,
        lastModified: true
    }));
} else {
    // Serve static files from the 'public' directory
    app.use(express.static('public', {
        maxAge: '1d', // Cache static assets for 1 day
        etag: true,
        lastModified: true
    }));
}

// Apply rate limiting to all API routes
app.use('/api/', apiLimiter);

// Enable strong ETags for API responses (default is weak)
app.set('etag', 'strong');

// API version router
const apiV1Router = express.Router();

// Cache control middleware for API responses
apiV1Router.use((req, res, next) => {
    // Store original json method
    const originalJson = res.json.bind(res);

    // Override json method to add cache headers
    res.json = function(body) {
        // Set Vary header to support proper caching with different conditions
        res.set('Vary', 'Accept-Encoding');

        // Check if response is successful and cacheable
        if (res.statusCode === 200 && body?.success === true) {
            // Set Last-Modified header if not already set
            if (!res.get('Last-Modified')) {
                // Use current time as Last-Modified for dynamic content
                // In a real scenario, this would be the data's actual modification time
                res.set('Last-Modified', new Date().toUTCString());
            }

            // Set cache headers if not already set
            if (!res.get('Cache-Control')) {
                // Default cache strategy for API responses
                // Use shorter cache for frequently changing data
                const cacheTime = req.path.includes('/search') ? 300 : 3600; // 5 min vs 1 hour
                res.set('Cache-Control', `public, max-age=${cacheTime}`);
            }
        }

        // Call original json method
        return originalJson(body);
    };

    next();
});



// Async error handler wrapper utility
const asyncHandler = (fn) => (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
};

// Standardized error response helper
function sendError(res, statusCode, message, details = null) {
    const response = {
        success: false,
        error: {
            message,
            statusCode,
            timestamp: new Date().toISOString(),
            requestId: res.req?.id // Include request ID for tracing
        }
    };

    if (details && config.nodeEnv !== 'production') {
        response.error.details = details;
    }

    res.status(statusCode).json(response);
}

// Standardized success response helper
function sendSuccess(res, data, metadata = null) {
    const response = {
        success: true,
        data
    };

    if (metadata) {
        response.metadata = metadata;
    }

    // Enable ETags for conditional requests
    // Express will automatically generate ETag based on response body
    // and handle If-None-Match headers, returning 304 Not Modified when appropriate
    res.json(response);
}

// API Routes - Version 1

// Get all states with coffee shop counts
// Uses indexed 'state' column and prepared statement for optimal performance
// Implements in-memory caching to reduce database load
apiV1Router.get('/states', asyncHandler(async (req, res) => {
    const cacheKey = 'states-list';

    // Check cache first
    const cachedData = queryCache.get(cacheKey);
    if (cachedData) {
        logger.debug({ source: 'cache' }, 'States retrieved from cache');
        res.set('Cache-Control', 'public, max-age=86400');
        res.set('X-Cache', 'HIT');
        return sendSuccess(res, cachedData.rows, cachedData.metadata);
    }

    const query = `
        SELECT
            state as state_code,
            COUNT(*) as shop_count,
            AVG(CASE
                WHEN price_level = 'PRICE_LEVEL_INEXPENSIVE' THEN 1
                WHEN price_level = 'PRICE_LEVEL_MODERATE' THEN 2
                WHEN price_level = 'PRICE_LEVEL_EXPENSIVE' THEN 3
                ELSE NULL
            END) as avg_price_level
        FROM coffee_shops
        WHERE state IS NOT NULL
        GROUP BY state
        ORDER BY state
    `;

    const rows = await db.all(query, [], 'get_all_states');

    logger.debug({ count: rows.length, source: 'database' }, 'States retrieved from database');

    // Cache result for 24 hours (86400000 ms) - state statistics change infrequently
    const metadata = { count: rows.length, cached_at: new Date().toISOString() };
    queryCache.set(cacheKey, { rows, metadata }, 86400000);

    // Cache for 24 hours - state data doesn't change frequently
    res.set('Cache-Control', 'public, max-age=86400');
    res.set('X-Cache', 'MISS');
    sendSuccess(res, rows, metadata);
}));

// Get coffee shops by state
// Implements in-memory caching per state and pagination
apiV1Router.get('/states/:stateCode', asyncHandler(async (req, res) => {
    const stateCode = req.params.stateCode.toUpperCase();

    // Pagination parameters
    const page = parseInt(String(req.query.page || 1)) || 1;
    const limit = Math.min(parseInt(String(req.query.limit || 100)) || 100, 500); // Max 500 per page
    const offset = (page - 1) * limit;

    // Validate state code format (2 uppercase letters)
    if (!/^[A-Z]{2}$/.test(stateCode)) {
        return sendError(res, 400, 'Invalid state code format. Expected 2-letter state abbreviation.');
    }

    // Validate pagination parameters
    if (page < 1) {
        return sendError(res, 400, 'Page number must be >= 1');
    }
    if (limit < 1) {
        return sendError(res, 400, 'Limit must be >= 1');
    }

    // Generate cache key including pagination params
    const cacheKey = `state-${stateCode}-page-${page}-limit-${limit}`;

    // Check cache first
    const cachedData = queryCache.get(cacheKey);
    if (cachedData) {
        logger.debug({ stateCode, page, limit, source: 'cache' }, 'State shops retrieved from cache');
        res.set('Cache-Control', 'public, max-age=3600');
        res.set('X-Cache', 'HIT');
        return sendSuccess(res, cachedData.shops, cachedData.metadata);
    }

    const countRow = await db.get('SELECT COUNT(*) as total FROM coffee_shops WHERE state = ?', [stateCode], 'count_state_shops');
    const total = countRow.total;
    const totalPages = Math.ceil(total / limit);

    const rows = await db.all(`
        SELECT
            id,
            name,
            address,
            price_level,
            language_code
        FROM coffee_shops
        WHERE state = ?
        ORDER BY name
        LIMIT ? OFFSET ?
    `, [stateCode, limit, offset], 'get_state_shops');

    // Transform data to match expected format
    const shops = rows.map(row => ({
        id: row.id,
        displayName: {
            text: row.name,
            languageCode: row.language_code
        },
        formattedAddress: row.address,
        priceLevel: row.price_level,
        state: stateCode
    }));

    logger.debug({ stateCode, page, limit, count: shops.length, source: 'database' }, 'State shops retrieved from database');

    const metadata = {
        pagination: {
            page,
            limit,
            total,
            totalPages,
            hasNext: page < totalPages,
            hasPrev: page > 1
        },
        state: stateCode
    };

    // Cache result for 1 hour (3600000 ms)
    queryCache.set(cacheKey, { shops, metadata }, 3600000);

    // Cache for 1 hour - shop data doesn't change frequently
    res.set('Cache-Control', 'public, max-age=3600');
    res.set('X-Cache', 'MISS');
    sendSuccess(res, shops, metadata);
}));

// Search coffee shops with caching
apiV1Router.get('/search', asyncHandler(async (req, res) => {
    const searchTerm = typeof req.query.q === 'string' ? req.query.q : '';
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    const price = typeof req.query.price === 'string' ? req.query.price : '';

    // Pagination parameters with validation
    const page = Math.max(1, parseInt(String(req.query.page || 1), 10) || 1);
    const limit = Math.min(Math.max(1, parseInt(String(req.query.limit || 100), 10) || 100), 500); // 1-500 per page
    const offset = (page - 1) * limit;

    // Maximum page limit to prevent excessive database queries
    const MAX_PAGE = 1000;
    if (page > MAX_PAGE) {
        return sendError(res, 400, `Page number too high. Maximum page is ${MAX_PAGE}.`);
    }

    // Input validation
    const validPriceLevels = ['PRICE_LEVEL_INEXPENSIVE', 'PRICE_LEVEL_MODERATE', 'PRICE_LEVEL_EXPENSIVE'];

    // Validate state code format if provided
    if (state && !/^[A-Z]{2}$/.test(state.toUpperCase())) {
        return sendError(res, 400, 'Invalid state code format. Expected 2-letter state abbreviation.');
    }

    // Validate price level if provided
    if (price && !validPriceLevels.includes(price)) {
        return sendError(res, 400, 'Invalid price level. Must be one of: PRICE_LEVEL_INEXPENSIVE, PRICE_LEVEL_MODERATE, PRICE_LEVEL_EXPENSIVE');
    }

    // Validate search term length to prevent performance issues
    if (searchTerm && searchTerm.length > 100) {
        return sendError(res, 400, 'Search term too long. Maximum 100 characters.');
    }

    // Validate search term characters (alphanumeric, spaces, and common punctuation only)
    // Prevents special characters that could be used for abuse
    if (searchTerm && !/^[a-zA-Z0-9\s\-'.,&]+$/.test(searchTerm)) {
        return sendError(res, 400, 'Search term contains invalid characters. Only letters, numbers, spaces, and common punctuation allowed.');
    }

    // Generate cache key from search parameters
    const normalizedTerm = (searchTerm || '').toLowerCase().trim();
    const normalizedState = (state || '').toUpperCase();
    const normalizedPrice = price || '';
    const cacheKey = `search:${normalizedTerm}:${normalizedState}:${normalizedPrice}:${page}:${limit}`;

    // Check cache first (5 minute TTL for search results)
    const cachedResult = queryCache.get(cacheKey);
    if (cachedResult) {
        logger.debug({ cacheKey, source: 'cache' }, 'Search results retrieved from cache');
        res.set('Cache-Control', 'public, max-age=300');
        res.set('X-Cache', 'HIT');
        return sendSuccess(res, cachedResult.shops, cachedResult.metadata);
    }

    // Build WHERE clause - use FTS5 for text search when available
    let whereClause = 'WHERE 1=1';
    let fromClause = 'coffee_shops';
    const params = [];

    if (searchTerm) {
        // Use FTS5 for faster full-text search
        fromClause = `coffee_shops INNER JOIN coffee_shops_fts ON coffee_shops.id = coffee_shops_fts.rowid`;
        whereClause += ` AND coffee_shops_fts MATCH ?`;
        // FTS5 search syntax: escape special chars and add * for prefix matching
        const ftsSearchTerm = searchTerm.replace(/['"]/g, '').split(/\s+/).map(t => `"${t}"*`).join(' ');
        params.push(ftsSearchTerm);
    }

    if (state) {
        whereClause += ` AND coffee_shops.state = ?`;
        params.push(state.toUpperCase());
    }

    if (price) {
        whereClause += ` AND coffee_shops.price_level = ?`;
        params.push(price);
    }

    // First, get total count
    const countQuery = `SELECT COUNT(*) as total FROM ${fromClause} ${whereClause}`;
    const countRow = await db.get(countQuery, params, 'count_search_results');

    const total = countRow.total;
    const totalPages = Math.ceil(total / limit);

    // Then get paginated results
    const query = `
        SELECT
            coffee_shops.id,
            coffee_shops.name,
            coffee_shops.address,
            coffee_shops.state,
            coffee_shops.price_level,
            coffee_shops.language_code
        FROM ${fromClause}
        ${whereClause}
        ORDER BY coffee_shops.name
        LIMIT ? OFFSET ?
    `;

    const rows = await db.all(query, [...params, limit, offset], 'search_shops');

    // Transform data to match expected format
    const shops = rows.map(row => ({
        id: row.id,
        displayName: {
            text: row.name,
            languageCode: row.language_code
        },
        formattedAddress: row.address,
        priceLevel: row.price_level,
        state: row.state || 'Unknown'
    }));

    const metadata = {
        pagination: {
            page,
            limit,
            total,
            totalPages,
            hasNext: page < totalPages,
            hasPrev: page > 1
        },
        filters: { searchTerm, state, price }
    };

    // Cache results for 5 minutes (300000 ms)
    queryCache.set(cacheKey, { shops, metadata }, 300000);
    logger.debug({ cacheKey, resultCount: shops.length, source: 'database' }, 'Search results cached');

    res.set('Cache-Control', 'public, max-age=300');
    res.set('X-Cache', 'MISS');
    sendSuccess(res, shops, metadata);
}));

// Get coffee shop statistics
// Get overall database statistics
// Uses prepared statement for optimal performance
apiV1Router.get('/stats', asyncHandler(async (req, res) => {
    const row = await db.get(`
        SELECT
            COUNT(*) as total_shops,
            COUNT(DISTINCT state) as total_states,
            COUNT(CASE WHEN price_level = 'PRICE_LEVEL_INEXPENSIVE' THEN 1 END) as inexpensive_count,
            COUNT(CASE WHEN price_level = 'PRICE_LEVEL_MODERATE' THEN 1 END) as moderate_count,
            COUNT(CASE WHEN price_level = 'PRICE_LEVEL_EXPENSIVE' THEN 1 END) as expensive_count,
            COUNT(CASE WHEN price_level IS NULL OR price_level = '' THEN 1 END) as unknown_price_count
        FROM coffee_shops
    `, [], 'get_stats');

    logger.debug({ stats: row }, 'Stats retrieved successfully');

    // Cache for 1 hour - stats don't change frequently
    res.set('Cache-Control', 'public, max-age=3600');
    sendSuccess(res, row);
}));

// Health check endpoint with comprehensive system checks
apiV1Router.get('/health', asyncHandler(async (req, res) => {
    const isDbHealthy = await db.isHealthy();
    const health = {
        status: isDbHealthy ? 'ok' : 'degraded',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: config.nodeEnv,
        version: packageJson.version,
        apiVersion: 'v1',
        name: packageJson.name,
        memory: {
            used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
            total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
            unit: 'MB'
        },
        database: isDbHealthy ? 'connected' : 'error'
    };

    if (!isDbHealthy) {
        logger.warn({ health }, 'Health check failed - database error');
        return res.status(503).json(health);
    }

    if (req.query.detailed === 'true') {
        const row = await db.get('SELECT COUNT(*) as count FROM coffee_shops', [], 'health_check_detailed');
        health.database_stats = {
            total_shops: row.count,
            last_checked: new Date().toISOString()
        };
    }

    logger.debug({ health }, 'Health check completed');
    res.json(health);
}));

// Client configuration endpoint - provides safe configuration to frontend
apiV1Router.get('/config', (req, res) => {
    // Only expose safe, client-side configuration
    const clientConfig = {
        gaMeasurementId: config.gaMeasurementId,
        environment: config.nodeEnv,
        apiVersion: 'v1',
        apiBaseUrl: '/api/v1', // Relative URL works across all environments
        frontendUrl: process.env.FRONTEND_URL || 'https://localcoffeeshop.co'
    };

    // Cache for 1 hour - config doesn't change frequently
    res.set('Cache-Control', 'public, max-age=3600');
    res.json(clientConfig);
});

// Prometheus metrics endpoint - always protected by authentication token
app.get('/metrics', async (req, res) => {
    // Always require authentication to prevent accidental exposure of system metrics
    if (!config.metricsAuthToken) {
        const envInfo = config.nodeEnv === 'production' ? '' : ' (even in development)';
        logger.warn(`Metrics endpoint disabled${envInfo}. Set METRICS_AUTH_TOKEN to enable.`);
        return sendError(res, 503, 'Metrics endpoint not configured. Set METRICS_AUTH_TOKEN environment variable.');
    }

    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7) : null;

    if (!token || token !== config.metricsAuthToken) {
        logger.warn({ ip: req.ip }, 'Unauthorized metrics access attempt');
        return sendError(res, 401, 'Unauthorized. Valid Bearer token required.');
    }

    try {
        res.set('Content-Type', register.contentType);
        res.end(await register.metrics());
    } catch (err) {
        logger.error({ err }, 'Error generating metrics');
        res.status(500).end(err.message);
    }
});

// Mount API v1 router
app.use('/api/v1', apiV1Router);

// Backward compatibility: redirect /api/* to /api/v1/*
app.use('/api', (req, res, next) => {
    // If the path starts with /api/ but not /api/v1/, redirect to v1
    if (!req.path.startsWith('/v1/')) {
        const newPath = `/api/v1${req.path}`;
        logger.debug({ oldPath: req.path, newPath }, 'Redirecting to API v1');
        return res.redirect(301, `${newPath}${req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : ''}`);
    }
    next();
});

// Redirect old state page URLs to new dynamic page
// Matches /pages/states/california.html and redirects to /html/state.html?code=CA
const STATE_NAMES = {
    'AK': 'Alaska', 'AL': 'Alabama', 'AR': 'Arkansas', 'AZ': 'Arizona',
    'CA': 'California', 'CO': 'Colorado', 'CT': 'Connecticut', 'DC': 'Washington D.C.',
    'DE': 'Delaware', 'FL': 'Florida', 'GA': 'Georgia', 'HI': 'Hawaii',
    'IA': 'Iowa', 'ID': 'Idaho', 'IL': 'Illinois', 'IN': 'Indiana',
    'KS': 'Kansas', 'KY': 'Kentucky', 'LA': 'Louisiana', 'MA': 'Massachusetts',
    'MD': 'Maryland', 'ME': 'Maine', 'MI': 'Michigan', 'MN': 'Minnesota',
    'MO': 'Missouri', 'MS': 'Mississippi', 'MT': 'Montana', 'NC': 'North Carolina',
    'ND': 'North Dakota', 'NE': 'Nebraska', 'NH': 'New Hampshire', 'NJ': 'New Jersey',
    'NM': 'New Mexico', 'NV': 'Nevada', 'NY': 'New York', 'OH': 'Ohio',
    'OK': 'Oklahoma', 'OR': 'Oregon', 'PA': 'Pennsylvania', 'PR': 'Puerto Rico',
    'RI': 'Rhode Island', 'SC': 'South Carolina', 'SD': 'South Dakota', 'TN': 'Tennessee',
    'TX': 'Texas', 'UT': 'Utah', 'VA': 'Virginia', 'VT': 'Vermont',
    'WA': 'Washington', 'WI': 'Wisconsin', 'WV': 'West Virginia', 'WY': 'Wyoming'
};
const stateNameToCode = Object.fromEntries(Object.entries(STATE_NAMES).map(([code, name]) => [name.toLowerCase(), code]));

app.get('/pages/states/:stateName.html', (req, res) => {
    const stateName = req.params.stateName.replace('-', ' ');
    const stateCode = stateNameToCode[stateName];

    if (stateCode) {
        res.redirect(301, `/html/state.html?code=${stateCode}`);
    } else {
        res.status(404).send('State not found');
    }
});

// Redirect old state page URLs to new dynamic page
// Matches /html/state_xx.html and redirects to /html/state.html?code=XX
app.get('/html/state_:stateCode.html', (req, res) => {
    const stateCode = req.params.stateCode.toUpperCase();
    // Validate state code format
    if (/^[A-Z]{2}$/.test(stateCode)) {
        res.redirect(301, `/html/state.html?code=${stateCode}`);
    } else {
        res.status(404).send('State not found');
    }
});

// Serve the main page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'html', 'index.html'));
});

// Dynamic sitemap.xml for SEO
app.get('/sitemap.xml', asyncHandler(async (req, res) => {
    const baseUrl = process.env.FRONTEND_URL || 'https://localcoffeeshop.co';
    const today = new Date().toISOString().split('T')[0];

    const states = await db.all(`
        SELECT DISTINCT
            UPPER(SUBSTR(address, INSTR(address, ', ') + 2, 2)) as state_code
        FROM coffee_shops
        WHERE address LIKE '%, __ %'
        ORDER BY state_code
    `, [], 'get_sitemap_states');

    let xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${baseUrl}/</loc>
    <lastmod>${today}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>${baseUrl}/pages/contact.html</loc>
    <lastmod>${today}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.5</priority>
  </url>
  <url>
    <loc>${baseUrl}/pages/submit.html</loc>
    <lastmod>${today}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.6</priority>
  </url>`;

    // Add state pages
    for (const state of states) {
        if (state.state_code && /^[A-Z]{2}$/.test(state.state_code)) {
            xml += `
<url>
<loc>${baseUrl}/html/state.html?code=${state.state_code}</loc>
<lastmod>${today}</lastmod>
<changefreq>weekly</changefreq>
<priority>0.8</priority>
</url>`;
        }
    }

    xml += '\n</urlset>';

    res.set('Content-Type', 'application/xml');
    res.set('Cache-Control', 'public, max-age=86400'); // Cache for 1 day
    res.send(xml);
}));

// 404 handler - must be after all other routes
app.use((req, res, next) => {
    // Skip for API routes (they have their own error handling)
    if (req.path.startsWith('/api/')) {
        return next();
    }

    logger.info({ path: req.path, method: req.method }, '404 Not Found');
    res.status(404).sendFile(path.join(__dirname, 'public', 'html', '404.html'));
});

// Error handling middleware
app.use((err, req, res, next) => {
    logger.error({ err, url: req.url, method: req.method }, 'Unhandled server error');
    sendError(res, 500, 'Internal server error', err.message);
});

// Start server only when run directly (not when imported for testing)
if (require.main === module) {
    const startServer = async () => {
        try {
            await db.initialize({
                dbPath: config.dbPath,
                logger,
                metrics: {
                    queryDuration: databaseQueryDuration,
                    errors: databaseErrors,
                },
            });

            app.listen(config.port, () => {
                logger.info({
                    port: config.port,
                    nodeEnv: config.nodeEnv,
                    dbPath: config.dbPath
                }, 'Server started successfully');
                logger.info('API v1 endpoints:');
                logger.info('  GET /api/v1/states - Get all states with shop counts');
                logger.info('  GET /api/v1/states/:stateCode - Get shops for a specific state');
                logger.info('  GET /api/v1/search?q=term&state=CA&price=PRICE_LEVEL_MODERATE - Search shops');
                logger.info('  GET /api/v1/stats - Get database statistics');
                logger.info('  GET /api/v1/health - Health check');
                logger.info('  GET /api/v1/config - Client configuration');
                logger.info('Note: Legacy /api/* routes redirect to /api/v1/*');
            });
        } catch (err) {
            logger.fatal({ err }, 'Failed to start server');
            process.exit(1);
        }
    };

    startServer();
}

// Export for testing
module.exports = { app, db };

// Graceful shutdown handler
async function gracefulShutdown(signal) {
    logger.info({ signal }, 'Received shutdown signal, closing server gracefully...');

    // Destroy cache and stop cleanup timer
    queryCache.destroy();

    // Close database connection
    await db.close();

    logger.info('Graceful shutdown completed');
    process.exit(0);
}

// Handle shutdown signals
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// Handle uncaught exceptions
process.on('uncaughtException', async (err) => {
    logger.fatal({ err }, 'Uncaught exception');
    await gracefulShutdown('uncaughtException');
});

// Handle unhandled promise rejections
process.on('unhandledRejection', async (reason, promise) => {
    logger.fatal({ reason, promise }, 'Unhandled promise rejection');
    await gracefulShutdown('unhandledRejection');
}); 