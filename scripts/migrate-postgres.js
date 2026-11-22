#!/usr/bin/env node

/**
 * Postgres migrations for the submission queue (migrations/postgres/).
 *
 * The API also applies these at boot (src/queue/index.js); this script is for
 * operators: inspecting state, or migrating ahead of a deploy.
 *
 * Usage:
 *   node scripts/migrate-postgres.js status
 *   node scripts/migrate-postgres.js up
 *
 * Connects with MIGRATION_DATABASE_URL, else DATABASE_URL (and
 * DATABASE_CA_CERT for TLS). With neither set it does nothing and exits 0.
 * Forward-only: there is no `down`.
 */

require('dotenv').config();

const { createPool } = require('../src/queue/postgres-pool');
const { migratePostgres, listMigrations } = require('../src/queue/postgres-migrate');

async function main() {
    const command = process.argv[2];
    if (!['status', 'up'].includes(command)) {
        console.error('Usage: node scripts/migrate-postgres.js <status|up>');
        process.exit(2);
    }

    const databaseUrl = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
    if (!databaseUrl) {
        console.log('No MIGRATION_DATABASE_URL or DATABASE_URL set; nothing to do.');
        return;
    }

    const pool = createPool({ databaseUrl, caCert: process.env.DATABASE_CA_CERT, max: 1 });
    try {
        if (command === 'up') {
            const { applied, skipped } = await migratePostgres(pool);
            console.log(`Applied ${applied.length}: ${applied.join(', ') || '-'}`);
            console.log(`Already applied ${skipped.length}`);
            return;
        }
        const exists = await pool.query("SELECT to_regclass('public.schema_migrations') AS t");
        const done = new Map();
        if (exists.rows[0].t) {
            const { rows } = await pool.query('SELECT name, sha256, applied_at FROM schema_migrations');
            rows.forEach((r) => done.set(r.name, r));
        }
        for (const m of listMigrations()) {
            const row = done.get(m.name);
            let state = 'pending';
            if (row) state = row.sha256 === m.sha256 ? `applied ${row.applied_at.toISOString()}` : 'APPLIED BUT MODIFIED';
            console.log(`${m.name}  ${state}`);
        }
    } finally {
        await pool.end();
    }
}

main().catch((err) => {
    console.error(err.message);
    process.exit(1);
});
