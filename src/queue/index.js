/**
 * Submission queue store: selection and startup.
 *
 * The queue (shop_submissions), its review audit and the idempotency keys
 * live together in one store. Two implementations share one interface:
 *
 *   sqlite-store.js    the image's SQLite file: dev and tests. Not durable.
 *   postgres-store.js  Postgres (DATABASE_URL): durable, used in production.
 *
 * Interface (all async):
 *   lookupKey(key, minCreated)                 → row | null
 *   reserveKey({ key, endpoint, requestHash, now, expiredBefore }) → boolean
 *   completeKey(key, statusCode, response)
 *   releaseKey(key)
 *   sweepKeys(expiredBefore)                   → number deleted
 *   enqueueSubmission({ kind, targetShopId, proposal, now, queueMax }) → id | null (full)
 *   isHealthy()                                → boolean
 *   close()
 * plus `kind` ('sqlite' | 'postgres'), `durable` and `ready`.
 *
 * See docs/adr/0002-submission-queue-store.md for why this seam exists.
 *
 * Postgres startup never takes the API down: migrations run at boot, and if
 * they (or the connection) fail the directory keeps serving while every
 * queue operation answers 503 SUBMISSIONS_UNAVAILABLE. Migration is retried
 * in the background until it succeeds.
 */

const { UnavailableError } = require('../usecases/errors');
const { makeSqliteQueueStore } = require('./sqlite-store');
const { makePostgresQueueStore } = require('./postgres-store');
const { createPool } = require('./postgres-pool');
const { migratePostgres } = require('./postgres-migrate');

const RETRY_MS_DEFAULT = 60 * 1000;
const STORE_METHODS = ['lookupKey', 'reserveKey', 'completeKey', 'releaseKey', 'sweepKeys', 'enqueueSubmission'];

function unavailable() {
    return new UnavailableError(
        'SUBMISSIONS_UNAVAILABLE',
        'Community submissions are temporarily unavailable. Please try again later.',
        60,
    );
}

/**
 * Wrap a store so its operations fail with 503 until `markReady()`, and so a
 * storage failure after a healthy boot (database down, connection dropped)
 * is also a 503 SUBMISSIONS_UNAVAILABLE rather than a generic 500. The store
 * throws no domain errors of its own (a full queue is a `null` result), so
 * any rejection is a storage failure; an UnavailableError passes through.
 *
 * @param {Object} inner
 * @param {Object} logger
 */
function makeGatedStore(inner, logger) {
    let ready = false;
    const gated = {
        kind: inner.kind,
        durable: inner.durable,
        get ready() { return ready; },
        markReady() { ready = true; },
        async isHealthy() { return ready && inner.isHealthy(); },
        close: () => inner.close(),
    };
    for (const method of STORE_METHODS) {
        gated[method] = async (...args) => {
            if (!ready) throw unavailable();
            try {
                return await inner[method](...args);
            } catch (err) {
                if (err instanceof UnavailableError) throw err;
                logger.error({ err, op: method }, 'Submission queue storage failed');
                throw unavailable();
            }
        };
    }
    return gated;
}

/**
 * Build and prepare the queue store for this process.
 *
 * @param {Object} deps
 * @param {Object} deps.config Config from loadConfig (uses config.queue)
 * @param {Object} deps.db SQLite db module (used when no DATABASE_URL)
 * @param {Object} deps.logger
 * @param {Function} [deps.createPoolImpl]
 * @param {Function} [deps.migrate]
 * @param {number} [deps.retryMs]
 * @returns {Promise<Object>} store (always resolves)
 */
async function startQueueStore({
    config,
    db,
    logger,
    createPoolImpl = createPool,
    migrate = migratePostgres,
    retryMs = RETRY_MS_DEFAULT,
}) {
    const { databaseUrl, migrationDatabaseUrl, caCert } = config.queue;
    if (!databaseUrl) {
        const store = makeSqliteQueueStore(db);
        return Object.assign(store, { ready: true });
    }

    const pool = createPoolImpl({ databaseUrl, caCert });
    // Without this, an idle client's network error is an unhandled 'error'
    // event that crashes the process.
    pool.on('error', (err) => logger.warn({ err }, 'Postgres pool client error'));
    const store = makeGatedStore(makePostgresQueueStore(pool), logger);

    let timer = null;
    let closed = false;
    const prepare = async () => {
        timer = null;
        // Migrations may use a more privileged login than the app's own
        // (MIGRATION_DATABASE_URL); the app pool itself never runs DDL then.
        const migrationPool = migrationDatabaseUrl && migrationDatabaseUrl !== databaseUrl
            ? createPoolImpl({ databaseUrl: migrationDatabaseUrl, caCert, max: 1 })
            : pool;
        try {
            const { applied } = await migrate(migrationPool);
            store.markReady();
            logger.info({ applied }, 'Submission queue ready (Postgres)');
        } catch (err) {
            logger.error({ err }, 'Submission queue unavailable: Postgres migration/connection failed; submissions return 503, retrying');
            if (!closed) {
                timer = setTimeout(prepare, retryMs);
                timer.unref();
            }
        } finally {
            if (migrationPool !== pool) await migrationPool.end().catch(() => {});
        }
    };
    await prepare();

    const innerClose = store.close;
    store.close = async () => {
        closed = true;
        if (timer) clearTimeout(timer);
        await innerClose();
    };
    return store;
}

module.exports = { startQueueStore, makeGatedStore };
