#!/usr/bin/env node

/**
 * Private operator CLI for the community-submission moderation queue.
 *
 * Two backends, chosen explicitly (there is no default):
 *   --db <path>   a local SQLite copy (dev, tests, operator-held copies)
 *   --postgres    the production queue in Postgres, as a login in the
 *                 `lcs_reviewer` role, read from REVIEW_DATABASE_URL
 *
 * It is never exposed over HTTP and nothing in src/ imports it. See
 * docs/security/submission-review-cli.md.
 *
 * Usage:
 *   node scripts/review-submissions.js (--db <path> | --postgres) list [--status <s>] [--limit <n>]
 *   node scripts/review-submissions.js (--db <path> | --postgres) show <id>
 *   node scripts/review-submissions.js (--db <path> | --postgres) approve <id> --expect-sha256 <hex>
 *       --reviewer <id> --reason <text> [--apply]
 *   node scripts/review-submissions.js (--db <path> | --postgres) reject  <id> (same options)
 *
 * Exit codes: 0 ok, 1 refused/failed, 2 usage error. Errors go to stderr;
 * results are JSON on stdout.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { parseArgs } = require('util');
const sqlite3 = require('sqlite3');

const TRACKED_DB = path.join(__dirname, '..', 'data', 'coffee_shops.db');

const STATUSES = ['pending', 'approved', 'rejected'];
const ID_PATTERN = /^[1-9][0-9]{0,9}$/;
const SHA256_PATTERN = /^[0-9a-fA-F]{64}$/;
// Attribution label, not a credential. Length is also enforced by CHECK in 20261017_03.
const REVIEWER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._@-]{0,63}$/;
const REASON_MAX = 500;
// A concurrent decision waits for the writer instead of failing with
// SQLITE_BUSY, then sees the row is no longer pending. Explicit rather than
// relying on node-sqlite3's implicit 1000 ms default.
const BUSY_TIMEOUT_MS = 5000;
// Postgres equivalents: wait this long for a row lock held by a concurrent
// decision, and bound any one statement.
const PG_LOCK_TIMEOUT_MS = 5000;
const PG_STATEMENT_TIMEOUT_MS = 15000;
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/;
// Code points JSON.stringify leaves raw that a terminal may act on: DEL, C1
// controls (U+009B is a single-byte CSI), line/paragraph separators and bidi
// overrides/isolates.
const UNSAFE_OUTPUT_CHARS = /[\u007F-\u009F\u2028\u2029\u202A-\u202E\u2066-\u2069]/g;
const DECISIONS = { approve: 'approved', reject: 'rejected' };
const LIMIT_PATTERN = /^[1-9][0-9]{0,2}$/;
const LIMIT_MAX = 500;
const LIMIT_DEFAULT = 50;

// Explicit allowlist. Never SELECT *: a column added later (for example
// request metadata) must not leak into operator output by default.
const SUMMARY_COLUMNS = 'id, kind, target_shop_id, state, status, created_at, name';
const DETAIL_COLUMNS = `${SUMMARY_COLUMNS}, address, price_level, phone_number, website, description, language_code`;
const REVIEW_COLUMNS = 'old_status, new_status, reviewer, reason, payload_sha256, decided_at';
const REQUIRED_TABLES = ['shop_submissions', 'submission_reviews'];

const NOT_PUBLISHED_NOTICE = 'A moderation decision only. Approved does NOT mean published: '
    + 'this tool never reads or writes coffee_shops, and no publication path exists.';

class UsageError extends Error {}
class RefusedError extends Error {}

// Same canonical path, or same inode (catches hard links too).
function isTrackedDb(real, stat) {
    let tracked;
    try {
        tracked = fs.realpathSync(TRACKED_DB);
    } catch {
        return false;
    }
    const trackedStat = fs.statSync(tracked);
    return real === tracked || (stat.dev === trackedStat.dev && stat.ino === trackedStat.ino);
}

/**
 * Validate --db without creating anything. Returns the canonical (symlink-free)
 * absolute path, which is what gets handed to SQLite.
 */
function resolveDbPath(raw) {
    if (raw === '' || raw === ':memory:' || /^file:/i.test(raw)) {
        throw new UsageError('--db must be a path to an existing SQLite file (no :memory:, file: URIs or empty value)');
    }
    let real;
    try {
        real = fs.realpathSync(raw);
    } catch {
        throw new RefusedError(`database ${JSON.stringify(raw)} does not exist (this tool never creates databases)`);
    }
    const stat = fs.statSync(real);
    if (!stat.isFile()) {
        throw new RefusedError(`database ${JSON.stringify(raw)} is not a regular file`);
    }
    if (isTrackedDb(real, stat)) {
        throw new RefusedError('refusing to open the tracked repository database data/coffee_shops.db; use a copy outside the repository');
    }
    return real;
}

function parseCli(argv) {
    let parsed;
    try {
        parsed = parseArgs({
            args: argv,
            allowPositionals: true,
            strict: true,
            tokens: true,
            options: {
                db: { type: 'string' },
                postgres: { type: 'boolean' },
                status: { type: 'string' },
                limit: { type: 'string' },
                'expect-sha256': { type: 'string' },
                reviewer: { type: 'string' },
                reason: { type: 'string' },
                apply: { type: 'boolean' },
            },
        });
    } catch (err) {
        throw new UsageError(err.message);
    }
    const { values, tokens } = parsed;
    const seen = new Set();
    for (const token of tokens) {
        if (token.kind !== 'option') continue;
        if (seen.has(token.name)) throw new UsageError(`--${token.name} given more than once`);
        seen.add(token.name);
    }
    if (values.db !== undefined && values.postgres) {
        throw new UsageError('give either --db or --postgres, not both');
    }
    if (values.db === undefined && !values.postgres) {
        throw new UsageError('--db <sqlite file> or --postgres is required (there is no default database)');
    }
    return { values, positionals: parsed.positionals };
}

// Options that select the database; valid with every command.
const DATABASE_OPTIONS = ['db', 'postgres'];

// Options each command accepts besides the database selection. Anything else is a usage error.
const COMMAND_OPTIONS = {
    list: ['status', 'limit'],
    show: [],
    approve: ['expect-sha256', 'reviewer', 'reason', 'apply'],
    reject: ['expect-sha256', 'reviewer', 'reason', 'apply'],
};

function parseId(raw) {
    if (raw === undefined) throw new UsageError('a submission id is required');
    if (!ID_PATTERN.test(raw)) throw new UsageError('submission id must be a positive integer without sign, leading zeros or exponent');
    return Number(raw);
}

function validateCommand({ values, positionals }) {
    const [command, ...rest] = positionals;
    if (!command) throw new UsageError('a command is required: list, show, approve or reject');
    const allowed = COMMAND_OPTIONS[command];
    if (!allowed) throw new UsageError(`unknown command ${JSON.stringify(command)}`);
    for (const name of Object.keys(values)) {
        if (!DATABASE_OPTIONS.includes(name) && !allowed.includes(name)) {
            throw new UsageError(`--${name} is not valid for ${command}`);
        }
    }
    if (command === 'list') {
        if (rest.length > 0) throw new UsageError('list takes no positional arguments');
        const status = values.status === undefined ? 'pending' : values.status;
        if (status !== 'all' && !STATUSES.includes(status)) {
            throw new UsageError('--status must be one of pending, approved, rejected, all');
        }
        let limit = LIMIT_DEFAULT;
        if (values.limit !== undefined) {
            if (!LIMIT_PATTERN.test(values.limit) || Number(values.limit) > LIMIT_MAX) {
                throw new UsageError(`--limit must be an integer from 1 to ${LIMIT_MAX}`);
            }
            limit = Number(values.limit);
        }
        return { command, status, limit };
    }
    if (command === 'show') {
        if (rest.length !== 1) throw new UsageError('show takes exactly one submission id');
        return { command, id: parseId(rest[0]) };
    }
    // approve / reject
    if (rest.length > 1) throw new UsageError(`${command} takes exactly one submission id`);
    const id = parseId(rest[0]);

    const sha = values['expect-sha256'];
    if (sha === undefined) throw new UsageError('--expect-sha256 is required (copy payloadSha256 from `show`)');
    if (!SHA256_PATTERN.test(sha)) throw new UsageError('--expect-sha256 must be 64 hex characters');

    if (values.reviewer === undefined) throw new UsageError('--reviewer is required');
    if (!REVIEWER_PATTERN.test(values.reviewer)) {
        throw new UsageError('--reviewer must be 1-64 characters of A-Z a-z 0-9 . _ @ - (starting with a letter or digit)');
    }

    if (values.reason === undefined) throw new UsageError('--reason is required');
    const reason = values.reason.trim();
    if (reason.length < 1 || reason.length > REASON_MAX) throw new UsageError(`--reason must be 1-${REASON_MAX} characters`);
    if (CONTROL_CHARS.test(reason)) throw new UsageError('--reason must not contain control characters (single line only)');

    return {
        command,
        id,
        newStatus: DECISIONS[command],
        expectedSha256: sha.toLowerCase(),
        reviewer: values.reviewer,
        reason,
        apply: values.apply === true,
    };
}

/**
 * Postgres connection settings, read from the environment only so the
 * password never appears in argv (shell history, `ps`). Deliberately NOT
 * DATABASE_URL: that is the API's `lcs_app` login, which must never decide.
 */
function resolvePostgresConfig(env) {
    const databaseUrl = env.REVIEW_DATABASE_URL;
    if (!databaseUrl) {
        throw new UsageError('--postgres needs REVIEW_DATABASE_URL (a login in the lcs_reviewer role; never the app\'s DATABASE_URL)');
    }
    if (env.DATABASE_URL && databaseUrl === env.DATABASE_URL) {
        throw new RefusedError('REVIEW_DATABASE_URL is the same as DATABASE_URL (the API\'s lcs_app login); use a separate lcs_reviewer login');
    }
    try {
        const { protocol } = new URL(databaseUrl);
        if (protocol !== 'postgres:' && protocol !== 'postgresql:') throw new Error('protocol');
    } catch {
        throw new UsageError('REVIEW_DATABASE_URL must be a postgres:// or postgresql:// URL');
    }
    return { databaseUrl, caCert: env.REVIEW_DATABASE_CA_CERT || env.DATABASE_CA_CERT || undefined };
}

// --- Row helpers (shared by both backends) -----------------------------------

/**
 * node-postgres returns BIGINT as a string; SQLite returns a number. Both
 * become numbers before anything is printed or digested, so the same content
 * has the same digest on either backend.
 */
function toInt(value) {
    return value === null || value === undefined ? null : Number(value);
}

function normalizeSubmission(row) {
    if (!row) return row;
    return { ...row, id: toInt(row.id), target_shop_id: toInt(row.target_shop_id), created_at: toInt(row.created_at) };
}

function summary(row) {
    return {
        id: row.id,
        kind: row.kind,
        targetShopId: row.target_shop_id,
        state: row.state,
        status: row.status,
        createdAt: row.created_at,
        name: row.name,
    };
}

function detail(row) {
    return {
        ...summary(row),
        address: row.address,
        priceLevel: row.price_level,
        phoneNumber: row.phone_number,
        website: row.website,
        description: row.description,
        languageCode: row.language_code,
    };
}

/**
 * The digest a reviewer copies from `show` into --expect-sha256. It covers the
 * submission id and every reviewable content field, so a decision cannot be
 * applied to different content than was reviewed. Status is excluded; it is
 * guarded separately (pending-only). Changing this form invalidates digests
 * printed by older versions, which fails closed.
 */
function payloadDigest(row) {
    return crypto.createHash('sha256').update(JSON.stringify([
        'lcs-shop-submission-v1', row.id, row.kind, row.target_shop_id, row.name, row.address, row.state,
        row.price_level, row.phone_number, row.website, row.description, row.language_code, row.created_at,
    ])).digest('hex');
}

function review(row) {
    if (!row) return null;
    return {
        oldStatus: row.old_status,
        newStatus: row.new_status,
        reviewer: row.reviewer,
        reason: row.reason,
        payloadSha256: row.payload_sha256,
        decidedAt: toInt(row.decided_at),
    };
}

/**
 * Preconditions shared by dry run and apply. Digest first, so a stale review
 * is reported as stale even if the row has since been decided.
 */
function assertDecidable(row, cmd) {
    if (!row) throw new RefusedError(`submission ${cmd.id} not found`);
    if (payloadDigest(row) !== cmd.expectedSha256) {
        throw new RefusedError(`stale review: payload digest of submission ${row.id} does not match --expect-sha256; run show again and re-review`);
    }
    if (row.status !== 'pending') {
        throw new RefusedError(`submission ${row.id} is ${row.status}, not pending; decisions are final`);
    }
}

function appliedResult(row, cmd, decidedAt) {
    return {
        applied: true,
        submissionId: row.id,
        oldStatus: row.status,
        newStatus: cmd.newStatus,
        reviewer: cmd.reviewer,
        reason: cmd.reason,
        payloadSha256: cmd.expectedSha256,
        decidedAt,
        published: false,
        notice: NOT_PUBLISHED_NOTICE,
    };
}

// --- SQLite backend (no OPEN_CREATE anywhere) --------------------------------

function openSqlite(file, mode) {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(file, mode, (err) => {
            if (err) return reject(err);
            db.configure('busyTimeout', BUSY_TIMEOUT_MS);
            return resolve(db);
        });
    });
}

function runAsync(db, sql, params = []) {
    return new Promise((resolve, reject) => db.run(sql, params, function onRun(err) {
        if (err) reject(err);
        else resolve(this);
    }));
}

function allAsync(db, sql, params = []) {
    return new Promise((resolve, reject) => db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows))));
}

async function sqliteBackend(file, { apply }) {
    // Only an explicit --apply opens read-write; everything else cannot write.
    const db = await openSqlite(file, apply ? sqlite3.OPEN_READWRITE : sqlite3.OPEN_READONLY);
    const getSubmission = async (id) => normalizeSubmission(
        (await allAsync(db, `SELECT ${DETAIL_COLUMNS} FROM shop_submissions WHERE id = ?`, [id]))[0],
    );
    return {
        async requireTables() {
            const rows = await allAsync(db, "SELECT name FROM sqlite_master WHERE type = 'table'");
            const present = new Set(rows.map((r) => r.name));
            const missing = REQUIRED_TABLES.filter((t) => !present.has(t));
            if (missing.length > 0) {
                throw new RefusedError(`database is missing table(s) ${missing.join(', ')}; run the migrations explicitly first (this tool never migrates)`);
            }
        },
        async list(status, limit) {
            const where = status === 'all' ? '' : 'WHERE status = ?';
            const params = status === 'all' ? [limit] : [status, limit];
            const rows = await allAsync(db, `SELECT ${SUMMARY_COLUMNS} FROM shop_submissions ${where} ORDER BY created_at, id LIMIT ?`, params);
            return rows.map(normalizeSubmission);
        },
        getSubmission,
        async getReview(id) {
            return (await allAsync(db, `SELECT ${REVIEW_COLUMNS} FROM submission_reviews WHERE submission_id = ?`, [id]))[0];
        },
        async applyDecision(cmd) {
            // IMMEDIATE takes the write lock before the read, so the checks below and
            // both writes see one consistent state; a concurrent decision waits, then
            // finds the row no longer pending.
            await runAsync(db, 'BEGIN IMMEDIATE');
            try {
                const row = await getSubmission(cmd.id);
                assertDecidable(row, cmd);
                const decidedAt = Math.floor(Date.now() / 1000);
                await runAsync(db, `INSERT INTO submission_reviews
                    (submission_id, old_status, new_status, reviewer, reason, payload_sha256, decided_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [row.id, row.status, cmd.newStatus, cmd.reviewer, cmd.reason, cmd.expectedSha256, decidedAt]);
                const { changes } = await runAsync(db,
                    "UPDATE shop_submissions SET status = ? WHERE id = ? AND status = 'pending'", [cmd.newStatus, row.id]);
                if (changes !== 1) throw new RefusedError(`submission ${row.id} changed during the decision; nothing recorded`);
                await runAsync(db, 'COMMIT');
                return appliedResult(row, cmd, decidedAt);
            } catch (err) {
                try {
                    await runAsync(db, 'ROLLBACK');
                } catch (rollbackErr) {
                    err.message = `${err.message}; rollback failed: ${rollbackErr.message}`;
                }
                throw err;
            }
        },
        close() {
            return new Promise((resolve, reject) => db.close((err) => (err ? reject(err) : resolve())));
        },
    };
}

// --- Postgres backend ----------------------------------------------------------

/**
 * Turn a Postgres error into a message an operator can act on. The schema's
 * triggers (immutable content, pending → approved|rejected only, append-only
 * audit) and grants are the last line of defence; their refusals are
 * reported as refusals, not crashes.
 */
function describePgError(err) {
    switch (err.code) {
    case 'P0001': return new RefusedError(`database refused the decision: ${err.message}; nothing recorded`);
    case '42501': return new RefusedError(`permission denied (${err.message}); REVIEW_DATABASE_URL must be a login in the lcs_reviewer role`);
    case '55P03': return new RefusedError('timed out waiting for another decision on this submission; run show again');
    case '57014': return new RefusedError('a database statement timed out; nothing recorded');
    case '23505': return new RefusedError('this submission already has a review; decisions are final');
    case '25006': return new RefusedError(`database refused a write in a read-only session (${err.message})`);
    case '42P01': return new RefusedError(`${err.message}; run the Postgres migrations first (npm run migrate:pg -- up, this tool never migrates)`);
    default: return err;
    }
}

async function postgresBackend({ databaseUrl, caCert }, { apply }) {
    // Required lazily so the SQLite path never loads pg.
    const { Client } = require('pg');
    const { connectionOptions } = require('../src/queue/postgres-pool');
    const client = new Client({
        ...connectionOptions(databaseUrl, caCert),
        connectionTimeoutMillis: 5000,
        application_name: 'lcs-review-cli',
    });
    client.on('error', () => {});
    try {
        await client.connect();
    } catch (err) {
        // pg's connection errors name host/port/user, never the password.
        throw new RefusedError(`could not connect to REVIEW_DATABASE_URL: ${err.message}`);
    }
    const q = async (sql, params) => {
        try {
            return (await client.query(sql, params)).rows;
        } catch (err) {
            throw describePgError(err);
        }
    };
    try {
        await q(`SET lock_timeout = ${PG_LOCK_TIMEOUT_MS}`);
        await q(`SET statement_timeout = ${PG_STATEMENT_TIMEOUT_MS}`);
        // The Postgres analogue of OPEN_READONLY: without --apply the session
        // itself refuses writes, whatever the login may do.
        if (!apply) await q('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY');
    } catch (err) {
        await client.end().catch(() => {});
        throw err;
    }

    const getSubmission = async (id, { forUpdate = false } = {}) => normalizeSubmission((await q(
        `SELECT ${DETAIL_COLUMNS} FROM shop_submissions WHERE id = $1${forUpdate ? ' FOR UPDATE' : ''}`, [id],
    ))[0]);

    return {
        async requireTables() {
            const [row] = await q(
                `SELECT to_regclass('public.shop_submissions') IS NOT NULL AS shop_submissions,
                        to_regclass('public.submission_reviews') IS NOT NULL AS submission_reviews`,
            );
            const missing = REQUIRED_TABLES.filter((t) => !row[t]);
            if (missing.length > 0) {
                throw new RefusedError(`database is missing table(s) ${missing.join(', ')}; run the Postgres migrations explicitly first (npm run migrate:pg -- up; this tool never migrates)`);
            }
            await this.requireReviewerLogin();
        },
        /**
         * Least privilege, checked rather than assumed: the login must hold
         * exactly the reviewer's capabilities. A superuser, the table owner
         * (doadmin, which ran the migrations) or an lcs_app member would hold
         * more, so it is refused even though it could do the job.
         */
        async requireReviewerLogin() {
            const [p] = await q(`SELECT
                current_user AS login,
                has_table_privilege('shop_submissions', 'SELECT') AS read_submissions,
                has_column_privilege('shop_submissions', 'status', 'UPDATE') AS update_status,
                has_table_privilege('submission_reviews', 'SELECT') AS read_reviews,
                has_table_privilege('submission_reviews', 'INSERT') AS append_reviews,
                has_table_privilege('shop_submissions', 'INSERT') AS insert_submissions,
                has_table_privilege('shop_submissions', 'DELETE') AS delete_submissions,
                has_column_privilege('shop_submissions', 'name', 'UPDATE') AS update_content,
                has_table_privilege('submission_reviews', 'UPDATE') AS update_reviews,
                has_table_privilege('submission_reviews', 'DELETE') AS delete_reviews,
                COALESCE(has_table_privilege(to_regclass('public.idempotency_keys'), 'SELECT'), false) AS read_idempotency`);
            const missing = ['read_submissions', 'update_status', 'read_reviews', 'append_reviews'].filter((k) => !p[k]);
            if (missing.length > 0) {
                throw new RefusedError(`login ${JSON.stringify(p.login)} lacks lcs_reviewer privileges (${missing.join(', ')}); grant it the lcs_reviewer role`);
            }
            const excess = ['insert_submissions', 'delete_submissions', 'update_content', 'update_reviews', 'delete_reviews', 'read_idempotency']
                .filter((k) => p[k]);
            if (excess.length > 0) {
                throw new RefusedError(`login ${JSON.stringify(p.login)} has more than lcs_reviewer privileges (${excess.join(', ')}); `
                    + 'use a dedicated reviewer login, never the owner, a superuser or the app\'s lcs_app login');
            }
        },
        async list(status, limit) {
            const rows = status === 'all'
                ? await q(`SELECT ${SUMMARY_COLUMNS} FROM shop_submissions ORDER BY created_at, id LIMIT $1`, [limit])
                : await q(`SELECT ${SUMMARY_COLUMNS} FROM shop_submissions WHERE status = $1 ORDER BY created_at, id LIMIT $2`, [status, limit]);
            return rows.map(normalizeSubmission);
        },
        getSubmission: (id) => getSubmission(id),
        async getReview(id) {
            return (await q(`SELECT ${REVIEW_COLUMNS} FROM submission_reviews WHERE submission_id = $1`, [id]))[0];
        },
        async applyDecision(cmd) {
            // FOR UPDATE locks the row before the checks, so the checks and both
            // writes see one state. A concurrent decision waits on the lock (up
            // to lock_timeout), then re-reads the committed row and finds it no
            // longer pending. READ COMMITTED re-evaluates the locked row.
            await q('BEGIN');
            try {
                const row = await getSubmission(cmd.id, { forUpdate: true });
                assertDecidable(row, cmd);
                const decidedAt = Math.floor(Date.now() / 1000);
                await q(`INSERT INTO submission_reviews
                    (submission_id, old_status, new_status, reviewer, reason, payload_sha256, decided_at)
                    VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [row.id, row.status, cmd.newStatus, cmd.reviewer, cmd.reason, cmd.expectedSha256, decidedAt]);
                const updated = await q(
                    "UPDATE shop_submissions SET status = $1 WHERE id = $2 AND status = 'pending' RETURNING id",
                    [cmd.newStatus, row.id],
                );
                if (updated.length !== 1) throw new RefusedError(`submission ${row.id} changed during the decision; nothing recorded`);
                await q('COMMIT');
                return appliedResult(row, cmd, decidedAt);
            } catch (err) {
                try {
                    await client.query('ROLLBACK');
                } catch (rollbackErr) {
                    err.message = `${err.message}; rollback failed: ${rollbackErr.message}`;
                }
                throw err;
            }
        },
        close: () => client.end(),
    };
}

// --- Commands ----------------------------------------------------------------

async function listCommand(backend, { status, limit }) {
    return { submissions: (await backend.list(status, limit)).map(summary) };
}

async function requireSubmission(backend, id) {
    const row = await backend.getSubmission(id);
    if (!row) throw new RefusedError(`submission ${id} not found`);
    return row;
}

async function showCommand(backend, { id }) {
    const row = await requireSubmission(backend, id);
    const audit = await backend.getReview(id);
    return {
        submission: detail(row),
        payloadSha256: payloadDigest(row),
        review: review(audit),
        published: false,
        notice: NOT_PUBLISHED_NOTICE,
    };
}

async function dryRunDecision(backend, cmd) {
    const row = await requireSubmission(backend, cmd.id);
    assertDecidable(row, cmd);
    return {
        dryRun: true,
        submissionId: row.id,
        oldStatus: row.status,
        newStatus: cmd.newStatus,
        reviewer: cmd.reviewer,
        reason: cmd.reason,
        payloadSha256: cmd.expectedSha256,
        published: false,
        notice: `${NOT_PUBLISHED_NOTICE} Nothing was written; re-run with --apply to record this decision.`,
    };
}

function print(result) {
    // JSON.stringify escapes C0 controls; escape the rest of the terminal-unsafe
    // set too, so stored text cannot emit escape sequences or reorder output.
    const json = JSON.stringify(result, null, 2)
        .replace(UNSAFE_OUTPUT_CHARS, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
    process.stdout.write(`${json}\n`);
}

async function main(argv, env) {
    const parsed = parseCli(argv);
    // All input is validated before the database is touched.
    const cmd = validateCommand(parsed);
    const backend = parsed.values.postgres
        ? await postgresBackend(resolvePostgresConfig(env), { apply: cmd.apply === true })
        : await sqliteBackend(resolveDbPath(parsed.values.db), { apply: cmd.apply === true });
    try {
        await backend.requireTables();
        if (cmd.command === 'list') print(await listCommand(backend, cmd));
        else if (cmd.command === 'show') print(await showCommand(backend, cmd));
        else print(await (cmd.apply ? backend.applyDecision(cmd) : dryRunDecision(backend, cmd)));
    } finally {
        await backend.close();
    }
}

// exitCode (not process.exit) so buffered stdout/stderr are always flushed.
main(process.argv.slice(2), process.env).then(
    () => { process.exitCode = 0; },
    (err) => {
        process.stderr.write(`error: ${err.message.replace(UNSAFE_OUTPUT_CHARS, '?').replace(/[\u0000-\u001F]/g, '?')}\n`);
        process.exitCode = err instanceof UsageError ? 2 : 1;
    },
);
