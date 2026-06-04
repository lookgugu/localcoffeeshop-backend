/**
 * Ops Routes
 *
 * Three trivial endpoints with shared deps:
 *   GET /health  — DB liveness + process info (returns 503 if DB is down)
 *   GET /stats   — aggregate counts by price level
 *   GET /config  — public client configuration
 *
 * Collapsed into one mounter because each is small and they all need
 * `db`, `config`, `logger`, and `packageJson`.
 */

const { asyncHandler } = require('../lib/async-handler');
const { sendSuccess } = require('../lib/responses');

function mountOps(router, { db, config, logger, packageJson }) {
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
        };

        if (!isDbHealthy) {
            logger.warn({ health }, 'Health check failed - database error');
            return res.status(503).json(health);
        }
        if (req.query.detailed === 'true') {
            const row = await db.get('SELECT COUNT(*) as count FROM coffee_shops', [], 'health_check_detailed');
            health.database_stats = {
                total_shops: row.count,
                last_checked: new Date().toISOString(),
            };
        }
        logger.debug({ health }, 'Health check completed');
        res.json(health);
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
        res.json(clientConfig);
    });
}

module.exports = { mountOps };
