/**
 * Database Module
 *
 * Encapsulates the database connection. The interface is intentionally narrow:
 * initialize, get (single row), all (multi-row), run (write), close, isHealthy.
 *
 * This narrowness means an eventual swap to a different backend (PostgreSQL,
 * etc.) would touch only this file. Earlier versions exposed a getInstance()
 * escape hatch — that has been removed; tests use tests/helpers/testDb.js for
 * setup that needs raw sqlite3 access.
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
 * Execute a write statement (INSERT / UPDATE / DELETE) with metrics tracking.
 *
 * Mirrors `get` / `all` for instrumentation. Resolves with `{ lastID, changes }`
 * — the two pieces of post-write state sqlite3 surfaces via its `function`
 * callback's `this`. Use this for any DML that needs parameter binding.
 *
 * @param {string} query SQL statement
 * @param {Array} params Statement parameters
 * @param {string} queryType Type label for metrics
 * @returns {Promise<{lastID: number, changes: number}>}
 */
function run(query, params, queryType = 'unknown') {
    return new Promise((resolve, reject) => {
        const startTime = Date.now();

        // 'function' (not arrow) — sqlite3 uses `this.lastID` / `this.changes`.
        db.run(query, params, function (err) {
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
                logger.debug(
                    { queryType, duration, lastID: this.lastID, changes: this.changes },
                    'Database write completed',
                );
                resolve({ lastID: this.lastID, changes: this.changes });
            }
        });
    });
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
    get,
    all,
    run,
    close,
    isHealthy,
};
