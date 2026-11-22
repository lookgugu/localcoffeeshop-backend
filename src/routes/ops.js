/**
 * Ops Routes
 *
 * Three trivial endpoints with shared deps:
 *   GET /health  — DB liveness + process info (returns 503 if DB is down),
 *                  plus submission-queue status (informational)
 *   GET /stats   — aggregate counts by price level
 *   GET /config  — public client configuration
 *
 * Collapsed into one mounter because each is small and they all need
 * `db`, `config`, `logger`, and `packageJson`.
 */

const { asyncHandler } = require('../lib/async-handler');
const { sendSuccess } = require('../lib/responses');

// App Platform's probe times out after 3 s. A slow queue database must not
// push /health past that (and get the instance restarted), so its check is
// capped well below and counts as an error when it runs over.
const QUEUE_HEALTH_TIMEOUT_MS = 500;

function withTimeout(promise, ms, fallback) {
    let timer;
    const timeout = new Promise((resolve) => {
        timer = setTimeout(() => resolve(fallback), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function submissionsHealth(queueStore, config, timeoutMs = QUEUE_HEALTH_TIMEOUT_MS) {
    if (!queueStore) return { open: false, storage: 'none', queue: 'not_configured' };
    const queueOk = await withTimeout(queueStore.isHealthy().catch(() => false), timeoutMs, false);
    return {
        open: Boolean(config.submissionsEnabled && queueOk),
        storage: queueStore.kind,
        durable: queueStore.durable,
        queue: queueOk ? 'ok' : 'error',
    };
}

function mountOps(router, { db, queueStore, config, logger, packageJson }) {
    router.get('/stats', asyncHandler(async (req, res) => {
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
        res.set('Cache-Control', 'public, max-age=3600');
        sendSuccess(res, row);
    }));

    router.get('/health', asyncHandler(async (req, res) => {
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
                unit: 'MB',
            },
            database: isDbHealthy ? 'connected' : 'error',
            // Informational: a queue outage closes submissions (503) but the
            // directory still serves, so it does not fail the health check.
            submissions: await submissionsHealth(queueStore, config),
        };

        if (!isDbHealthy) {
            logger.warn({ health }, 'Health check failed - database error');
            return res.status(503).json({
                success: false,
                error: { code: 'DB_UNHEALTHY', message: 'Database error' },
                data: health,
            });
        }
        if (req.query.detailed === 'true') {
            const row = await db.get('SELECT COUNT(*) as count FROM coffee_shops', [], 'health_check_detailed');
            health.database_stats = {
                total_shops: row.count,
                last_checked: new Date().toISOString(),
            };
        }
        logger.debug({ health }, 'Health check completed');
        sendSuccess(res, health);
    }));

    router.get('/config', (req, res) => {
        const clientConfig = {
            gaMeasurementId: config.gaMeasurementId,
            environment: config.nodeEnv,
            apiVersion: 'v1',
            apiBaseUrl: '/api/v1',
            frontendUrl: config.frontendUrl || 'https://localcoffeeshop.co',
        };
        res.set('Cache-Control', 'public, max-age=3600');
        sendSuccess(res, clientConfig);
    });
}

module.exports = { mountOps, submissionsHealth };
