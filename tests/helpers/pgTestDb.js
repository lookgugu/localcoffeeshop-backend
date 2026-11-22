/**
 * Postgres test helpers.
 *
 * Postgres suites run when PG_TEST_DATABASE_URL points at a server where that
 * login may CREATE DATABASE and CREATE ROLE (a local or CI superuser). Each
 * suite gets its own throwaway database, dropped afterwards. Without the
 * variable they are skipped — unless REQUIRE_PG_TESTS=1 (set in CI), which
 * turns a missing database into a failure instead of a silent skip.
 *
 *   PG_TEST_DATABASE_URL=postgresql://postgres@localhost:5432/postgres npm test
 */

const crypto = require('crypto');
const { Pool } = require('pg');

const PG_URL = process.env.PG_TEST_DATABASE_URL || '';

if (!PG_URL && process.env.REQUIRE_PG_TESTS === '1') {
    throw new Error('REQUIRE_PG_TESTS=1 but PG_TEST_DATABASE_URL is not set');
}

const describePg = PG_URL ? describe : describe.skip;

function urlForDatabase(name) {
    const url = new URL(PG_URL);
    url.pathname = `/${name}`;
    return url.toString();
}

/**
 * Create an empty database for one suite.
 *
 * @returns {Promise<{ url: string, pool: import('pg').Pool, drop: () => Promise<void> }>}
 */
async function createPgTestDatabase() {
    const name = `lcs_test_${process.pid}_${crypto.randomBytes(4).toString('hex')}`;
    const admin = new Pool({ connectionString: PG_URL, max: 1 });
    await admin.query(`CREATE DATABASE ${name}`);
    const url = urlForDatabase(name);
    const pool = new Pool({ connectionString: url, max: 10 });
    pool.on('error', () => {});
    return {
        url,
        pool,
        async drop() {
            await pool.end().catch(() => {});
            await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
            await admin.end();
        },
    };
}

/**
 * A pool whose every connection acts as `role` (SET ROLE), so privilege
 * checks run against that role's grants exactly as for a login in it.
 */
function poolAsRole(url, role, max = 10) {
    const pool = new Pool({ connectionString: url, max });
    pool.on('connect', (client) => client.query(`SET ROLE ${role}`));
    pool.on('error', () => {});
    return pool;
}

module.exports = { describePg, createPgTestDatabase, poolAsRole, PG_URL };
