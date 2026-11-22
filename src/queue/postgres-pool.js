/**
 * Postgres connection pool for the submission queue.
 *
 * TLS: node-postgres lets `sslmode` in a connection string override an
 * explicit `ssl` option, and treats `sslmode=require` as full verification
 * against the system CAs, which DigitalOcean's self-issued CA fails. So the
 * ssl* query parameters are stripped and TLS is configured here instead:
 *
 *   - a CA certificate (DATABASE_CA_CERT) → TLS, verified against that CA
 *   - sslmode other than `disable`, no CA → TLS, verified against system CAs
 *   - no sslmode (local/CI)              → plain connection
 *
 * Certificate verification is never turned off.
 */

const { Pool } = require('pg');

const SSL_PARAMS = ['sslmode', 'sslcert', 'sslkey', 'sslrootcert', 'uselibpqcompat'];

/**
 * @param {string} databaseUrl
 * @param {string} [caCert] PEM text
 * @returns {{ connectionString: string, ssl: false | { ca?: string, rejectUnauthorized: true } }}
 */
function connectionOptions(databaseUrl, caCert) {
    const url = new URL(databaseUrl);
    const sslmode = url.searchParams.get('sslmode');
    for (const p of SSL_PARAMS) url.searchParams.delete(p);

    let ssl = false;
    if (caCert) {
        ssl = { ca: caCert, rejectUnauthorized: true };
    } else if (sslmode && sslmode !== 'disable') {
        ssl = { rejectUnauthorized: true };
    }
    return { connectionString: url.toString(), ssl };
}

/**
 * @param {Object} opts
 * @param {string} opts.databaseUrl
 * @param {string} [opts.caCert]
 * @param {number} [opts.max] Pool size
 * @returns {import('pg').Pool}
 */
function createPool({ databaseUrl, caCert, max = 5 }) {
    return new Pool({
        ...connectionOptions(databaseUrl, caCert),
        max,
        connectionTimeoutMillis: 5000,
        idleTimeoutMillis: 30000,
        // Server-side bound on any one statement, so a stuck query fails the
        // request instead of holding a pooled connection indefinitely.
        statement_timeout: 5000,
        application_name: 'localcoffeeshop-api',
    });
}

module.exports = { createPool, connectionOptions };
