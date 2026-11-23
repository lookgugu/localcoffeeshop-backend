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
const { boundedInt } = require('./lib/bounded-int');
const { loadWaitlistConfig } = require('./waitlist/config');
const { loadSubmissionNotifyConfig } = require('./submissions/notify-config');

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
        // Production fails closed: submissions open only on an explicit
        // SUBMISSIONS_ENABLED=true AND a durable Postgres queue (DATABASE_URL).
        // The image's SQLite file is replaced on every deploy, so a queue
        // there would silently lose proposals. Elsewhere it defaults open.
        submissionsEnabled: nodeEnv === 'production'
            ? String(env.SUBMISSIONS_ENABLED || '').trim().toLowerCase() === 'true' && Boolean(env.DATABASE_URL)
            : !['false', '0', 'off', 'no'].includes(String(env.SUBMISSIONS_ENABLED || '').trim().toLowerCase()),
        // Queue storage (src/queue/). Unset → SQLite store (dev/tests).
        // MIGRATION_DATABASE_URL lets schema migrations run as a more
        // privileged login than the app's own (lcs_app) user.
        queue: Object.freeze({
            databaseUrl: env.DATABASE_URL || '',
            migrationDatabaseUrl: env.MIGRATION_DATABASE_URL || '',
            caCert: env.DATABASE_CA_CERT || '',
        }),
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

    // Roaster-subscription interest waitlist (src/waitlist/). Fail-closed:
    // disabled unless WAITLIST_ENABLED=true and every WAITLIST_* is valid.
    config.waitlist = loadWaitlistConfig(env, {
        nodeEnv,
        corsOrigins: config.corsOrigins,
        metricsAuthToken: config.metricsAuthToken,
    });
    if (config.waitlist.reason === 'misconfigured') {
        config.warnings.push(`Waitlist disabled (503) - fix: ${config.waitlist.problems.join('; ')}`);
    } else if (config.waitlist.reason === 'disabled' && nodeEnv === 'production') {
        config.recommendations.push('WAITLIST_ENABLED is not "true" - roaster-subscription waitlist returns 503');
    }

    // Reviewer email for each queued submission (src/submissions/). Optional:
    // a missing or invalid setting disables the email, never submissions.
    config.submissionNotify = loadSubmissionNotifyConfig(env);
    if (config.submissionNotify.reason === 'misconfigured') {
        config.warnings.push(`Submission emails disabled - fix: ${config.submissionNotify.problems.join('; ')}`);
    }

    if (config.nodeEnv === 'production') {
        if (!env.METRICS_AUTH_TOKEN) {
            config.recommendations.push('METRICS_AUTH_TOKEN not set - /metrics endpoint will be disabled');
        }
        const submissionsRequested = String(env.SUBMISSIONS_ENABLED || '').trim().toLowerCase() === 'true';
        if (submissionsRequested && !env.DATABASE_URL) {
            config.warnings.push('SUBMISSIONS_ENABLED=true but DATABASE_URL is not set - community submissions stay closed (503) until the Postgres queue is configured');
        } else if (!config.submissionsEnabled) {
            config.recommendations.push('SUBMISSIONS_ENABLED is not "true" - community submissions return 503');
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
