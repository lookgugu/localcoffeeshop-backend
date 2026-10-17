/**
 * Idempotency Middleware
 *
 * Honours the `Idempotency-Key` request header by deduplicating writes with
 * an at-most-once guarantee — even under concurrent retries.
 *
 *   - No header → next() immediately. The middleware is opt-in per request.
 *   - Header too long or outside [A-Za-z0-9._:-] → 400 before any storage.
 *   - Header present, row in cache whose request fingerprint (method, route,
 *     params, body) differs from this request — or is NULL (legacy row) —
 *     → 422 IDEMPOTENCY_KEY_REUSED; neither replayed nor executed.
 *   - Header present, completed row in cache (within TTL) → replay the
 *     stored {status_code, response} body, set `Idempotent-Replay: true`,
 *     and skip the handler.
 *   - Header present, pending row in cache → another request with this key
 *     is still in flight. Return 409 IDEMPOTENCY_IN_PROGRESS so the client
 *     can decide whether to retry once that one finishes.
 *   - Header present, cache miss → reserve a `pending` row via
 *     `INSERT OR IGNORE`. The unique key on the primary key gives us atomic
 *     mutual exclusion: if `changes === 0`, another request won the race and
 *     this one returns 409. Otherwise call next(); on a 2xx response we
 *     UPDATE the row to `completed`, on non-2xx (or handler error / hangup)
 *     we DELETE the placeholder so the client can retry.
 *   - Lookup throws (DB error before reservation) → fall through to the
 *     handler. The dedup table is bookkeeping; a broken bookkeeping table
 *     must not block production writes.
 *
 * Only 2xx responses are cached. Caching a 5xx would turn a transient
 * upstream failure into a permanent one — every retry with the same key
 * would replay the cached 500 instead of running the handler again.
 *
 * Cleanup uses a 1% probabilistic sweep on each completion. No cron.
 *
 * The middleware is transparent to handlers — they don't know it exists.
 */

const crypto = require('crypto');

const TTL_SECONDS_DEFAULT = 86400; // 24h
const SWEEP_PROBABILITY = 0.01; // 1% chance per completed write
const MAX_KEY_LENGTH = 128; // reject oversized keys before reserving storage
// UUIDs and other opaque tokens; no whitespace, quotes or non-ASCII.
const KEY_PATTERN = /^[A-Za-z0-9._:-]+$/;

/**
 * SHA-256 over what makes two requests "the same" for replay purposes:
 * method, matched route pattern, route params and parsed body. Keyed on the
 * route pattern rather than the raw URL so case/trailing-slash variants of
 * one endpoint still match.
 *
 * @param {import('express').Request} req
 * @returns {string} hex digest
 */
function requestFingerprint(req) {
    const route = req.route ? req.route.path : req.path;
    return crypto
        .createHash('sha256')
        .update(JSON.stringify([req.method, route, req.params || {}, req.body ?? null]))
        .digest('hex');
}

function withIdempotency({ db, ttlSeconds = TTL_SECONDS_DEFAULT, logger }) {
    return async function idempotencyMiddleware(req, res, next) {
        const key = req.get('Idempotency-Key');
        if (!key) return next();

        const log = req.log || logger;

        // Bound the key length so a caller can't reserve arbitrarily large
        // `pending` rows as a storage/DoS vector. The key is only ever used as
        // a bound `?` parameter, so this is not an injection guard — purely a
        // resource bound.
        if (key.length > MAX_KEY_LENGTH) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'IDEMPOTENCY_KEY_TOO_LONG',
                    message: `Idempotency-Key must be at most ${MAX_KEY_LENGTH} characters`,
                },
            });
        }
        if (!KEY_PATTERN.test(key)) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'IDEMPOTENCY_KEY_INVALID',
                    message: 'Idempotency-Key may contain only letters, digits and . _ : -',
                },
            });
        }

        const fingerprint = requestFingerprint(req);

        try {
            const minCreated = Math.floor(Date.now() / 1000) - ttlSeconds;
            const existing = await db.get(
                'SELECT status_code, response, status, request_hash FROM idempotency_keys WHERE key = ? AND created_at > ?',
                [key, minCreated],
                'idempotency_lookup',
            );

            // Same key, different request: never replay an unrelated
            // response and never run the handler. A NULL fingerprint is a
            // legacy row (pre-moderation direct write) whose request cannot
            // be proven equal — fail closed rather than replay it.
            if (existing && existing.request_hash !== fingerprint) {
                return _respondKeyReused(res);
            }
            if (existing && existing.status === 'completed') {
                res.set('Idempotent-Replay', 'true');
                return res.status(existing.status_code).type('json').send(existing.response);
            }
            if (existing && existing.status === 'pending') {
                return _respondInProgress(res);
            }

            // Reserve the key. The PRIMARY KEY (`key`) makes this atomic: if
            // two concurrent requests race here, exactly one INSERT wins and
            // the other reports changes === 0.
            const endpoint = `${req.method} ${req.route ? req.route.path : req.path}`;
            const now = Math.floor(Date.now() / 1000);
            const reservation = await db.run(
                `INSERT OR IGNORE INTO idempotency_keys
                    (key, endpoint, status_code, response, created_at, status, request_hash)
                 VALUES (?, ?, 0, '', ?, 'pending', ?)`,
                [key, endpoint, now, fingerprint],
                'idempotency_reserve',
            );

            if (reservation.changes === 0) {
                // Race lost: another request with the same key reserved first.
                return _respondInProgress(res);
            }
        } catch (err) {
            log.warn({ err, key }, 'idempotency lookup failed; falling through');
            return next();
        }

        // We hold the reservation. Wrap res.json so we can flip the row to
        // completed on 2xx, or release it on anything else.
        let released = false;
        const release = (reason) => {
            if (released) return;
            released = true;
            db.run(
                "DELETE FROM idempotency_keys WHERE key = ? AND status = 'pending'",
                [key],
                'idempotency_release',
            ).catch((err) => log.warn({ err, key, reason }, 'idempotency release failed'));
        };

        const originalJson = res.json.bind(res);
        res.json = function (body) {
            const isSuccess = res.statusCode >= 200 && res.statusCode < 300;

            if (isSuccess) {
                released = true; // we're flipping pending → completed; nothing to release
                const payload = JSON.stringify(body);
                db.run(
                    `UPDATE idempotency_keys
                     SET status = 'completed', status_code = ?, response = ?
                     WHERE key = ?`,
                    [res.statusCode, payload, key],
                    'idempotency_complete',
                ).then(() => _maybeSweep(db, ttlSeconds, log)).catch((err) => {
                    log.warn({ err, key }, 'idempotency complete failed');
                });
            } else {
                release('non-2xx-response');
            }
            return originalJson(body);
        };

        // Safety net for handlers that never call res.json (e.g. thrown
        // errors handled by the global error middleware, or res.send/end).
        // If the response finishes without us flipping the row, drop the
        // reservation so the client can retry.
        res.on('finish', () => {
            if (!released) release('finish-without-json');
        });
        res.on('close', () => {
            if (!released) release('close-without-finish');
        });

        return next();
    };
}

/**
 * Standard 409 envelope when an in-flight request holds the same key.
 *
 * @private
 */
function _respondInProgress(res) {
    return res.status(409).json({
        success: false,
        error: {
            code: 'IDEMPOTENCY_IN_PROGRESS',
            message: 'A request with this Idempotency-Key is already being processed',
        },
    });
}

/**
 * 422 envelope when a key is reused for a different request
 * (draft-ietf-httpapi-idempotency-key-header).
 *
 * @private
 */
function _respondKeyReused(res) {
    return res.status(422).json({
        success: false,
        error: {
            code: 'IDEMPOTENCY_KEY_REUSED',
            message: 'This Idempotency-Key was already used for a different request',
        },
    });
}

/**
 * Lazy probabilistic sweep — runs on ~1% of completed writes. Cheap,
 * eventually consistent. Failures are swallowed (housekeeping is best-effort).
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

module.exports = { withIdempotency, requestFingerprint, TTL_SECONDS_DEFAULT };
