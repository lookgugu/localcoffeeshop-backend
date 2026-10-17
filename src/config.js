/**
 * Configuration Module
 *
 * Pure: reads from an env object (defaulting to process.env), returns a
 * frozen config object plus a list of human-readable warnings/recommendations.
 *
 * Side effects (logger calls about config issues) become return data; the
 * caller (server.js) decides how to surface them.
 */

const fs = require('fs');

/**
 * Strictly parse a bounded integer env var. Unset/empty → fallback;
 * anything else must be plain base-10 digits within [min, max] or this
 * throws, so a misconfigured limit fails the boot instead of silently
 * becoming a default, a negative or a parseInt prefix ('10abc' → 10).
 *
 * @param {NodeJS.ProcessEnv} env
 * @param {string} name
 * @param {{min: number, max: number, fallback: number}} bounds
 * @returns {number}
 */
function boundedInt(env, name, { min, max, fallback }) {
    const raw = env[name] === undefined || env[name] === null ? '' : String(env[name]).trim();
    if (raw === '') return fallback;
    const value = /^[0-9]{1,15}$/.test(raw) ? Number(raw) : NaN;
    if (!Number.isSafeInteger(value) || value < min || value > max) {
        throw new Error(`${name} must be an integer between ${min} and ${max} (got "${raw}")`);
    }
    return value;
}

/**
 * Build the immutable configuration object from environment variables.
 *
 * @param {NodeJS.ProcessEnv} [env] Defaults to process.env
 * @returns {Readonly<Object>} Frozen config + `warnings` and `recommendations` arrays
 */
function loadConfig(env = process.env) {
    const nodeEnv = env.NODE_ENV || 'development';

    const config = {
        port: parseInt(env.PORT, 10) || 3000,
        dbPath: env.DB_PATH || './coffee_shops.db',
        nodeEnv,
        // CORS: Default to same-origin only for security. Use CORS_ORIGIN env var to allow specific origins.
        // Set CORS_ORIGIN=* explicitly in development if cross-origin access is needed.
        corsOrigin: env.CORS_ORIGIN || false,
        // Parsed cors origins array (or false); kept alongside raw value for clarity.
        corsOrigins: env.CORS_ORIGIN
            ? env.CORS_ORIGIN.split(',').map((o) => o.trim())
            : false,
        logLevel: env.LOG_LEVEL || 'info',
        rateLimitWindowMs: parseInt(env.RATE_LIMIT_WINDOW_MS, 10) || 15 * 60 * 1000,
        rateLimitMax: parseInt(env.RATE_LIMIT_MAX_REQUESTS, 10) || 100,
        gaMeasurementId: env.GA_MEASUREMENT_ID || '',
        metricsAuthToken: env.METRICS_AUTH_TOKEN || '',
        compressionLevel: parseInt(env.COMPRESSION_LEVEL, 10) || 6,
        compressionThreshold: parseInt(env.COMPRESSION_THRESHOLD, 10) || 5120,
        frontendUrl: env.FRONTEND_URL || '',
        // Community submissions (pending moderation queue; see
        // docs/security/community-submissions.md).
        // Production fails closed: the queue lives in the baked, ephemeral
        // SQLite file, so it opens only on an explicit SUBMISSIONS_ENABLED=true
        // after the durability/moderation-ownership gate in
        // docs/security/community-submissions.md. Elsewhere it defaults open.
        submissionsEnabled: nodeEnv === 'production'
            ? String(env.SUBMISSIONS_ENABLED || '').trim().toLowerCase() === 'true'
            : !['false', '0', 'off', 'no'].includes(String(env.SUBMISSIONS_ENABLED || '').trim().toLowerCase()),
        // 0 is valid and means "accept nothing" (every submission → 503
        // SUBMISSION_QUEUE_FULL).
        submissionQueueMax: boundedInt(env, 'SUBMISSION_QUEUE_MAX', { min: 0, max: 100000, fallback: 500 }),
        // Strict per-client budget shared by every write method under /api.
        // Max 0 is rejected (close submissions with SUBMISSIONS_ENABLED
        // instead); the window is capped at 24h, well below the 2^31-1 ms
        // setTimeout limit.
        writeRateLimitWindowMs: boundedInt(env, 'WRITE_RATE_LIMIT_WINDOW_MS', { min: 1000, max: 86400000, fallback: 3600000 }),
        writeRateLimitMax: boundedInt(env, 'WRITE_RATE_LIMIT_MAX', { min: 1, max: 10000, fallback: 10 }),
        warnings: [],
        recommendations: [],
    };

    if (config.nodeEnv === 'production') {
        if (!env.METRICS_AUTH_TOKEN) {
            config.recommendations.push('METRICS_AUTH_TOKEN not set - /metrics endpoint will be disabled');
        }
        if (!config.submissionsEnabled) {
            config.recommendations.push('SUBMISSIONS_ENABLED is not "true" - community submissions return 503 (queue storage is ephemeral)');
        }
        if (!env.CORS_ORIGIN) {
            config.recommendations.push('CORS_ORIGIN not set - defaulting to same-origin only');
        }
        if (!env.GA_MEASUREMENT_ID) {
            config.recommendations.push('GA_MEASUREMENT_ID not set - analytics disabled');
        }
        if (!fs.existsSync(config.dbPath)) {
            config.warnings.push(`Database file not found at ${config.dbPath}`);
        }
    }

    return Object.freeze(config);
}

module.exports = { loadConfig };
