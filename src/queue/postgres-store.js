/**
 * Postgres queue store — the durable production queue.
 *
 * Same interface as sqlite-store.js. The schema comes from
 * migrations/postgres/; the API should connect as a member of `lcs_app`,
 * which can enqueue but never decide or publish.
 */

// Arbitrary constant: serialises enqueues so the pending-count capacity
// check cannot be overshot by concurrent requests (Postgres has no
// database-wide write lock to rely on, unlike SQLite).
const ENQUEUE_LOCK_ID = 2718281828;

function toId(value) {
    // BIGINT comes back from node-postgres as a string.
    return value === null || value === undefined ? null : Number(value);
}

function makePostgresQueueStore(pool) {
    return {
        kind: 'postgres',
        durable: true,

        async lookupKey(key, minCreated) {
            const { rows } = await pool.query(
                `SELECT status_code, response, status, request_hash
                 FROM idempotency_keys WHERE key = $1 AND created_at > $2`,
                [key, minCreated],
            );
            return rows[0] || null;
        },

        async reserveKey({ key, endpoint, requestHash, now, expiredBefore }) {
            const { rowCount } = await pool.query(
                `INSERT INTO idempotency_keys
                    (key, endpoint, status_code, response, created_at, status, request_hash)
                 VALUES ($1, $2, 0, '', $3, 'pending', $4)
                 ON CONFLICT (key) DO UPDATE SET
                    endpoint = EXCLUDED.endpoint, status_code = 0, response = '',
                    created_at = EXCLUDED.created_at, status = 'pending',
                    request_hash = EXCLUDED.request_hash
                 WHERE idempotency_keys.created_at <= $5`,
                [key, endpoint, now, requestHash, expiredBefore],
            );
            return rowCount === 1;
        },

        async completeKey(key, statusCode, response) {
            await pool.query(
                `UPDATE idempotency_keys SET status = 'completed', status_code = $1, response = $2
                 WHERE key = $3 AND status = 'pending'`,
                [statusCode, response, key],
            );
        },

        async releaseKey(key) {
            await pool.query(
                "DELETE FROM idempotency_keys WHERE key = $1 AND status = 'pending'",
                [key],
            );
        },

        async sweepKeys(expiredBefore) {
            const { rowCount } = await pool.query(
                'DELETE FROM idempotency_keys WHERE created_at <= $1',
                [expiredBefore],
            );
            return rowCount;
        },

        async enqueueSubmission({ kind, targetShopId, proposal, now, queueMax }) {
            const client = await pool.connect();
            try {
                await client.query('BEGIN');
                // Released at COMMIT/ROLLBACK. The count below runs after the
                // previous holder committed, so it sees that row.
                await client.query('SELECT pg_advisory_xact_lock($1)', [ENQUEUE_LOCK_ID]);
                const { rows } = await client.query(
                    `INSERT INTO shop_submissions
                        (kind, target_shop_id, name, address, state, price_level,
                         phone_number, website, description, language_code, status, created_at)
                     SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending', $11
                     WHERE (SELECT COUNT(*) FROM shop_submissions WHERE status = 'pending') < $12
                     RETURNING id`,
                    [
                        kind, targetShopId, proposal.name, proposal.address, proposal.state,
                        proposal.priceLevel, proposal.phoneNumber, proposal.website,
                        proposal.description, proposal.languageCode, now, queueMax,
                    ],
                );
                await client.query('COMMIT');
                return rows.length ? toId(rows[0].id) : null;
            } catch (err) {
                await client.query('ROLLBACK').catch(() => {});
                throw err;
            } finally {
                client.release();
            }
        },

        // Reachable AND this login holds the lcs_app privileges it needs, so
        // a missing GRANT shows up in /health instead of as failed submissions.
        async isHealthy() {
            try {
                const { rows } = await pool.query(
                    `SELECT has_table_privilege('shop_submissions', 'SELECT, INSERT')
                        AND has_table_privilege('idempotency_keys', 'SELECT, INSERT, UPDATE, DELETE') AS ok`,
                );
                return rows[0].ok === true;
            } catch {
                return false;
            }
        },

        async close() {
            await pool.end();
        },
    };
}

module.exports = { makePostgresQueueStore };
