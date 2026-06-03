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
        warnings: [],
        recommendations: [],
    };

    if (config.nodeEnv === 'production') {
        if (!env.METRICS_AUTH_TOKEN) {
            config.recommendations.push('METRICS_AUTH_TOKEN not set - /metrics endpoint will be disabled');
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
