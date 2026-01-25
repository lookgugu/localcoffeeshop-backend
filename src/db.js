/**
 * Database Module
 *
 * Encapsulates database connection and query functions.
 * This abstraction allows for easier database swapping in the future
 * (e.g., SQLite -> PostgreSQL) by changing only this module.
 *
 * Current implementation: SQLite
 */

const sqlite3 = require('sqlite3').verbose();

let db = null;
let logger = null;
let metrics = null;

/**
 * Initialize the database connection
 * @param {Object} options Configuration options
 * @param {string} options.dbPath Path to the database file
 * @param {Object} options.logger Pino logger instance
 * @param {Object} options.metrics Prometheus metrics object (optional)
 * @returns {Promise<InstanceType<typeof sqlite3.Database>>} The database instance
 */
function initialize({ dbPath, logger: loggerInstance, metrics: metricsInstance }) {
    logger = loggerInstance;
    metrics = metricsInstance;

    return new Promise((resolve, reject) => {
        db = new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE, (err) => {
            if (err) {
                reject(err);
                return;
            }

            logger.info({ dbPath }, 'Connected to the coffee_shops database');

            // Configure SQLite for optimal read performance
            db.configure('busyTimeout', 5000);

            // Apply PRAGMA optimizations
            db.serialize(() => {
                db.run('PRAGMA cache_size = -64000', (err) => {
                    if (err) logger.warn({ err }, 'Failed to set cache_size');
                });

                db.run('PRAGMA mmap_size = 67108864', (err) => {
                    if (err) logger.warn({ err }, 'Failed to set mmap_size');
                });

                db.run('PRAGMA temp_store = MEMORY', (err) => {
                    if (err) logger.warn({ err }, 'Failed to set temp_store');
                });

                db.run('PRAGMA optimize', (err) => {
                    if (err) logger.warn({ err }, 'Failed to run optimize');
                });

                logger.debug('Database optimization settings applied');
                resolve(db);
            });
        });
    });
}

/**
 * Get the raw database instance
 * @returns {InstanceType<typeof sqlite3.Database>} The database instance
 */
function getInstance() {
    if (!db) {
        throw new Error('Database not initialized. Call initialize() first.');
    }
    return db;
}

/**
 * Execute a single-row query with metrics tracking
 * @param {string} query SQL query
 * @param {Array} params Query parameters
 * @param {string} queryType Type label for metrics
 * @returns {Promise<Object>} Query result
 */
function get(query, params, queryType = 'unknown') {
    return new Promise((resolve, reject) => {
        const startTime = Date.now();

        db.get(query, params, (err, row) => {
            const duration = (Date.now() - startTime) / 1000;

            if (metrics) {
                metrics.queryDuration.labels(queryType).observe(duration);
                if (err) {
                    metrics.errors.labels(queryType).inc();
                }
            }

            if (err) {
                logger.error({ err, queryType, duration }, 'Database query error');
                reject(err);
            } else {
                logger.debug({ queryType, duration }, 'Database query completed');
                resolve(row);
            }
        });
    });
}

/**
 * Execute a multi-row query with metrics tracking
 * @param {string} query SQL query
 * @param {Array} params Query parameters
 * @param {string} queryType Type label for metrics
 * @returns {Promise<Array>} Query results
 */
function all(query, params, queryType = 'unknown') {
    return new Promise((resolve, reject) => {
        const startTime = Date.now();

        db.all(query, params, (err, rows) => {
            const duration = (Date.now() - startTime) / 1000;

            if (metrics) {
                metrics.queryDuration.labels(queryType).observe(duration);
                if (err) {
                    metrics.errors.labels(queryType).inc();
                }
            }

            if (err) {
                logger.error({ err, queryType, duration }, 'Database query error');
                reject(err);
            } else {
                logger.debug({ queryType, duration, rowCount: rows?.length }, 'Database query completed');
                resolve(rows);
            }
        });
    });
}

/**
 * Prepare a SQL statement for repeated execution
 * @param {string} query SQL query
 * @returns {InstanceType<typeof sqlite3.Statement>} Prepared statement
 */
function prepare(query) {
    return db.prepare(query);
}

/**
 * Execute operations in serial order
 * @param {Function} callback Operations to execute
 */
function serialize(callback) {
    db.serialize(callback);
}

/**
 * Close the database connection
 * @returns {Promise<void>}
 */
function close() {
    return new Promise((resolve) => {
        if (!db) {
            resolve();
            return;
        }

        db.close((err) => {
            if (err) {
                logger.error({ err }, 'Error closing database');
            } else {
                logger.info('Database connection closed');
            }
            db = null;
            resolve();
        });
    });
}

/**
 * Check if database is connected and healthy
 * @returns {Promise<boolean>}
 */
async function isHealthy() {
    try {
        const row = await get('SELECT 1 as test', [], 'health_check');
        return row && row.test === 1;
    } catch {
        return false;
    }
}

module.exports = {
    initialize,
    getInstance,
    get,
    all,
    prepare,
    serialize,
    close,
    isHealthy
};
