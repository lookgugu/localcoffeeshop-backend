/**
 * Postgres migration runner for migrations/postgres/*.sql.
 *
 * Used at boot (src/server.js) and by `npm run migrate:pg`. Each file runs
 * in its own transaction and is recorded in `schema_migrations` with its
 * SHA-256; a file edited after it was applied is refused rather than
 * silently skipped. A session advisory lock serialises concurrent runners
 * (for example two instances booting at once). Forward-only: there is no
 * down step.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const MIGRATIONS_DIR = path.join(__dirname, '..', '..', 'migrations', 'postgres');
// Arbitrary constant: identifies "this app's schema migrations" lock.
const MIGRATION_LOCK_ID = 4815162342;

function listMigrations(dir = MIGRATIONS_DIR) {
    return fs.readdirSync(dir)
        .filter((f) => f.endsWith('.sql'))
        .sort()
        .map((name) => {
            const sql = fs.readFileSync(path.join(dir, name), 'utf8');
            return { name, sql, sha256: crypto.createHash('sha256').update(sql).digest('hex') };
        });
}

/**
 * Apply pending migrations.
 *
 * @param {import('pg').Pool} pool
 * @param {Object} [opts]
 * @param {string} [opts.dir]
 * @returns {Promise<{ applied: string[], skipped: string[] }>}
 */
async function migratePostgres(pool, { dir = MIGRATIONS_DIR } = {}) {
    const migrations = listMigrations(dir);
    const client = await pool.connect();
    try {
        await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);
        try {
            await client.query(`
                CREATE TABLE IF NOT EXISTS schema_migrations (
                    name       TEXT PRIMARY KEY,
                    sha256     TEXT NOT NULL,
                    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
                )`);
            const { rows } = await client.query('SELECT name, sha256 FROM schema_migrations');
            const done = new Map(rows.map((r) => [r.name, r.sha256]));

            const applied = [];
            const skipped = [];
            for (const m of migrations) {
                if (done.has(m.name)) {
                    if (done.get(m.name) !== m.sha256) {
                        throw new Error(`Postgres migration ${m.name} was modified after it was applied; add a new migration instead`);
                    }
                    skipped.push(m.name);
                    continue;
                }
                await client.query('BEGIN');
                try {
                    await client.query(m.sql);
                    await client.query(
                        'INSERT INTO schema_migrations (name, sha256) VALUES ($1, $2)',
                        [m.name, m.sha256],
                    );
                    await client.query('COMMIT');
                } catch (err) {
                    await client.query('ROLLBACK').catch(() => {});
                    err.message = `Postgres migration ${m.name} failed: ${err.message}`;
                    throw err;
                }
                applied.push(m.name);
            }
            return { applied, skipped };
        } finally {
            await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]).catch(() => {});
        }
    } finally {
        client.release();
    }
}

module.exports = { migratePostgres, listMigrations, MIGRATIONS_DIR };
