/**
 * Idempotency Middleware
 *
 * Honours the `Idempotency-Key` request header by deduplicating writes.
 *
 *   - No header → next() immediately. The middleware is opt-in per request.
 *   - Header present, cache hit (within TTL) → replay the stored
 *     {status_code, response} body and set `Idempotent-Replay: true`.
 *     Handler is NOT invoked.
 *   - Header present, cache miss → call next(), then intercept the handler's
 *     `res.json` so the response is stored AFTER the handler runs.
 *     `INSERT OR IGNORE` so two concurrent identical requests don't race.
 *   - Lookup throws → fall through to the handler. The dedup table is
 *     bookkeeping; a broken bookkeeping table must not block production
 *     writes (better a duplicate than a refused write).
 *
 * Cleanup uses a 1% probabilistic sweep on each insert. No cron infrastructure.
 *
 * The middleware is transparent to handlers — they don't know it exists.
 */

const TTL_SECONDS_DEFAULT = 86400; // 24h
const SWEEP_PROBABILITY = 0.01; // 1% chance per insert

function withIdempotency({ db, ttlSeconds = TTL_SECONDS_DEFAULT, logger }) {
    return async function idempotencyMiddleware(req, res, next) {
        const key = req.get('Idempotency-Key');
        if (!key) return next();

        const log = req.log || logger;

        try {
            const minCreated = Math.floor(Date.now() / 1000) - ttlSeconds;
            const existing = await db.get(
                'SELECT status_code, response FROM idempotency_keys WHERE key = ? AND created_at > ?',
                [key, minCreated],
                'idempotency_lookup',
            );

            if (existing) {
                res.set('Idempotent-Replay', 'true');
                return res.status(existing.status_code).type('json').send(existing.response);
            }

            // Miss: intercept res.json so we cache after the handler runs.
            const originalJson = res.json.bind(res);
            res.json = function (body) {
                const payload = JSON.stringify(body);
                const endpoint = `${req.method} ${req.route ? req.route.path : req.path}`;
                const now = Math.floor(Date.now() / 1000);
                db.run(
                    'INSERT OR IGNORE INTO idempotency_keys(key, endpoint, status_code, response, created_at) VALUES (?, ?, ?, ?, ?)',
                    [key, endpoint, res.statusCode, payload, now],
                    'idempotency_store',
                ).then(() => _maybeSweep(db, ttlSeconds, log)).catch((err) => {
                    log.warn({ err, key }, 'idempotency cache write failed');
                });
                return originalJson(body);
            };

            return next();
        } catch (err) {
            log.warn({ err, key }, 'idempotency lookup failed; falling through');
            return next();
        }
    };
}

/**
 * Lazy probabilistic sweep — runs on ~1% of inserts. Cheap, eventually consistent.
 * Failures are swallowed (sweep is best-effort housekeeping).
 *
 * @private
 */
async function _maybeSweep(db, ttlSeconds, logger) {
    if (Math.random() > SWEEP_PROBABILITY) return;
    try {
        const cutoff = Math.floor(Date.now() / 1000) - ttlSeconds;
        const result = await db.run(
            'DELETE FROM idempotency_keys WHERE created_at < ?',
            [cutoff],
            'idempotency_sweep',
        );
        if (result.changes > 0) {
            logger.info({ deleted: result.changes }, 'idempotency sweep');
        }
    } catch (err) {
        logger.warn({ err }, 'idempotency sweep failed');
    }
}

module.exports = { withIdempotency, TTL_SECONDS_DEFAULT };
