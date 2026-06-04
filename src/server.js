/**
 * Server Entry
 *
 * Wires concrete dependencies, builds the Express app, and starts listening.
 * Process-level signal handling (SIGINT, SIGTERM, uncaughtException,
 * unhandledRejection) lives here — `buildApp` itself is process-agnostic.
 */

require('dotenv').config();

const pino = require('pino');

const { loadConfig } = require('./config');
const { buildMetrics } = require('./lib/metrics');
const { QueryCache } = require('./lib/cache');
const { buildApp } = require('./app');
const db = require('./db');
const enums = require('./enums');

const config = loadConfig(process.env);

const logger = pino({
    level: config.logLevel,
    transport: config.nodeEnv !== 'production' ? {
        target: 'pino-pretty',
        options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
        },
    } : undefined,
});

config.warnings.forEach((w) => logger.warn(w));
config.recommendations.forEach((r) => logger.info({ type: 'recommendation' }, r));

const metrics = buildMetrics();
const cache = new QueryCache({ maxEntries: 10000 });

async function main() {
    await db.initialize({
        dbPath: config.dbPath,
        logger,
        metrics: {
            queryDuration: metrics.dbDuration,
            errors: metrics.dbErrors,
        },
    });

    const app = buildApp({ config, db, cache, logger, metrics, enums });

    const server = app.listen(config.port, () => {
        logger.info({
            port: config.port,
            nodeEnv: config.nodeEnv,
            dbPath: config.dbPath,
        }, 'Server started successfully');
    });

    const shutdown = async (signal) => {
        logger.info({ signal }, 'Received shutdown signal, closing server gracefully...');
        server.close(() => {
            logger.info('HTTP server closed');
        });
        await db.close();
        logger.info('Graceful shutdown completed');
        process.exit(0);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('uncaughtException', async (err) => {
        logger.fatal({ err }, 'Uncaught exception');
        await shutdown('uncaughtException');
    });
    process.on('unhandledRejection', async (reason, promise) => {
        logger.fatal({ reason, promise }, 'Unhandled promise rejection');
        await shutdown('unhandledRejection');
    });
}

if (require.main === module) {
    main().catch((err) => {
        // Logger may not be useful here if config is broken; use stderr too.
        // eslint-disable-next-line no-console
        console.error('Failed to start server:', err);
        logger.fatal({ err }, 'Failed to start server');
        process.exit(1);
    });
}

module.exports = { main };
