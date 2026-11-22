/**
 * SQLite queue store — development and tests.
 *
 * Wraps the shared `db` module (the image's SQLite file). NOT durable in
 * production: that file is replaced on every deploy, which is why production
 * only opens submissions on the Postgres store (src/config.js).
 *
 * Interface shared with postgres-store.js; see src/queue/index.js.
 */

const SUBMISSION_COLUMNS = `kind, target_shop_id, name, address, state, price_level,
                 phone_number, website, description, language_code, status, created_at`;

function makeSqliteQueueStore(db) {
    return {
        kind: 'sqlite',
        durable: false,

        async lookupKey(key, minCreated) {
            const row = await db.get(
                'SELECT status_code, response, status, request_hash FROM idempotency_keys WHERE key = ? AND created_at > ?',
                [key, minCreated],
                'idempotency_lookup',
            );
            return row || null;
        },

        // Atomic: inserts, or replaces a row that has expired (created_at at
        // or before `expiredBefore`). A live row is left alone → false.
        async reserveKey({ key, endpoint, requestHash, now, expiredBefore }) {
            const { changes } = await db.run(
                `INSERT INTO idempotency_keys
                    (key, endpoint, status_code, response, created_at, status, request_hash)
                 VALUES (?, ?, 0, '', ?, 'pending', ?)
                 ON CONFLICT (key) DO UPDATE SET
                    endpoint = excluded.endpoint, status_code = 0, response = '',
                    created_at = excluded.created_at, status = 'pending',
                    request_hash = excluded.request_hash
                 WHERE idempotency_keys.created_at <= ?`,
                [key, endpoint, now, requestHash, expiredBefore],
                'idempotency_reserve',
            );
            return changes === 1;
        },

        async completeKey(key, statusCode, response) {
            await db.run(
                `UPDATE idempotency_keys SET status = 'completed', status_code = ?, response = ?
                 WHERE key = ? AND status = 'pending'`,
                [statusCode, response, key],
                'idempotency_complete',
            );
        },

        async releaseKey(key) {
            await db.run(
                "DELETE FROM idempotency_keys WHERE key = ? AND status = 'pending'",
                [key],
                'idempotency_release',
            );
        },

        async sweepKeys(expiredBefore) {
            const { changes } = await db.run(
                'DELETE FROM idempotency_keys WHERE created_at <= ?',
                [expiredBefore],
                'idempotency_sweep',
            );
            return changes;
        },

        // Single statement, so the capacity check and the insert are atomic
        // under SQLite's write lock. Returns the new id, or null when full.
        async enqueueSubmission({ kind, targetShopId, proposal, now, queueMax }) {
            const { lastID, changes } = await db.run(
                `INSERT INTO shop_submissions (${SUBMISSION_COLUMNS})
                 SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?
                 WHERE (SELECT COUNT(*) FROM shop_submissions WHERE status = 'pending') < ?`,
                [
                    kind, targetShopId, proposal.name, proposal.address, proposal.state,
                    proposal.priceLevel, proposal.phoneNumber, proposal.website,
                    proposal.description, proposal.languageCode, now, queueMax,
                ],
                'insert_shop_submission',
            );
            return changes === 0 ? null : lastID;
        },

        async isHealthy() {
            return db.isHealthy();
        },

        // The db module is owned and closed by server.js.
        async close() {},
    };
}

module.exports = { makeSqliteQueueStore };
