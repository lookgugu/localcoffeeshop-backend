# Community submissions: moderation queue (backend #4)

Status as of 2026-10-17, branch `security/community-submissions-20261017`, base `ee3e8bc`.

## Problem

Before this change, `POST /api/v1/coffee-shops` inserted straight into the published `coffee_shops` table, and `PUT /api/v1/coffee-shops/:id` overwrote any row by id. Neither route had authentication. The only rate limit was the shared 100 requests per 15 minutes. Anyone could deface or flood the live directory.

## What changed

| Area | Behaviour now |
|---|---|
| Public writes | `POST` and `PUT` never touch `coffee_shops`. A valid proposal goes into `shop_submissions` with `status='pending'` and gets **202** `{ success: true, data: { submissionId, status: 'pending_review', kind, targetShopId, message, displayName, formattedAddress, state, priceLevel } }` with `Cache-Control: no-store`. Unlike before, `data.id` is not returned, so nothing claims a published id. |
| PUT | A strict id check (`^[1-9][0-9]{0,9}$`): `12abc`, `1e3` and `01` are rejected with 400. The target must exist (400 otherwise, the same as before). The request is queued as `kind='update'` and the live row is left alone. |
| Validation | Name ≤200, address ≤300, phone ≤32 (digits, spaces and `+().-`), website ≤300 (absolute http/https, no credentials), description ≤1000 (newlines allowed, other control characters rejected), price level must be in the enum, state must be a US code, languageCode must be a BCP-47 tag ≤16. Unknown fields, including the client-generated `id`, are ignored. The table's CHECK constraints repeat these bounds. |
| Write rate limit | One per-IP budget covers every `POST`/`PUT`/`PATCH`/`DELETE` under `/api/`: the v1 router, the legacy `/api/*` 301 alias, and case or trailing-slash variants. Default is 10 per hour (`WRITE_RATE_LIMIT_MAX`, `WRITE_RATE_LIMIT_WINDOW_MS`). Over the limit you get **429** with `Retry-After` and `error.code = 'RATE_LIMITED'`. The limiter runs **before the JSON body parser**, validation and idempotency, so malformed or oversized bodies, invalid requests and rotated `Idempotency-Key` values all spend the budget. The key is `req.ip`, which follows `X-Forwarded-For` only through `trust proxy = 1` in production. `X-Real-IP`, `DO-Connecting-IP`, `CF-Connecting-IP`, `True-Client-IP`, `Forwarded`, and the forged left-most XFF entries are all ignored. |
| Queue bound | A single atomic `INSERT … SELECT … WHERE (pending count) < SUBMISSION_QUEUE_MAX` (default 500). When the queue is full: **503** `SUBMISSION_QUEUE_FULL` plus `Retry-After`. Reviewed rows don't count toward the cap. |
| Idempotency | Order per route: kill switch → validate → idempotency → handler. Invalid requests never reserve a key. Keys must match `[A-Za-z0-9._:-]{1,128}`, otherwise 400 `IDEMPOTENCY_KEY_INVALID`. Each reservation stores a SHA-256 of method, route, params and body. Reusing a key for a different request gives **422** `IDEMPOTENCY_KEY_REUSED`: the stored response is not replayed and the handler does not run. **Legacy rows with a NULL fingerprint fail closed (422)**, so a pre-moderation "shop created" response is never replayed. Non-2xx outcomes (400, 503, 500) release the key. |
| Errors | Malformed JSON returns 400 and an oversized body returns 413, both in the standard envelope (they used to be 500). |
| Kill switch | `SUBMISSIONS_ENABLED`. **Production is closed by default (503 `SUBMISSIONS_DISABLED`) and opens only on the exact value `true`.** Development and test default to open, and there `false/0/off/no` closes it. |
| Logging | Each accepted proposal logs `event: shop_submission_queued` with submissionId, kind and targetShopId only. No user-supplied content is logged. |

There is **deliberately no moderation, publication or admin endpoint**. No browser secret was added. Nothing in the app reads from `shop_submissions`. A private, local operator CLI for recording moderation decisions (never publication) was added later; see [submission-review-cli.md](submission-review-cli.md).

## Release blocker (needs an operator decision)

DigitalOcean app `bc7a8c43-…` runs one instance. It serves the SQLite file baked into the image, on an ephemeral filesystem, and auto-deploys from `main`. As a result:

1. **Every queued submission is lost on each deploy, restart or instance replacement.** The queue is not durable, and no config flag can make it durable.
2. **No publication path exists in this repository, and reviewer ownership is not documented here.** A local review CLI ([submission-review-cli.md](submission-review-cli.md)) can record decisions on a SQLite copy, but it does not make the queue durable and does not identify an owner. Whether a reviewer exists outside the repository is unknown; it must be confirmed and recorded before opening the queue.

Production therefore ships with submissions **closed**. While the gate below is unmet, community proposals in production get an honest 503 "temporarily closed" instead of a 202 that would later be silently dropped. Set `SUBMISSIONS_ENABLED=true` only after **both** of these are true:

- **Durable storage**: the queue lives somewhere that survives deploys, such as DO Managed Postgres, a persistent volume, or an external queue. This is an infrastructure change and is out of scope here.
- **Confirmed, documented reviewer ownership** (currently unknown) and a documented review and publish procedure, including who exports or deletes pending rows and how often.

Accepting the risk instead ("best-effort queue, losses OK") is a product-owner decision. If that is the choice, record it explicitly before flipping the flag. The rate limiter's memory store is also per-process and resets on restart, which is acceptable with one instance.

## Deploy, migration and rollback

Migrations are additive and **forward-only**. They run automatically at boot (`npm start` = `migrate up` + server) on the image's DB copy:

- `20261017_01_create_shop_submissions.sql`: new table and index.
- `20261017_02_idempotency_request_hash.sql`: `ALTER TABLE idempotency_keys ADD COLUMN request_hash`.
- `20261017_03_create_submission_reviews.sql`: append-only moderation decision audit table and its triggers (written only by the operator CLI).

None of these migrations has a `down` section. `npm run migrate -- down` refuses them ("No down migration found", non-zero exit) and changes nothing: the ledger, queued proposals, stored fingerprints and review audit rows all stay as they were, and the next `up` is a no-op. All three objects are inert to code that doesn't reference them, so no schema rollback is ever needed. Never run migrations against the tracked `data/coffee_shops.db`.

**Deploy:** merge to `main`, which auto-deploys. Leave `SUBMISSIONS_ENABLED` unset in the app spec. Afterwards, check (read-only) that `GET /api/v1/health` returns 200. Do **not** test the write path in production. An invalid `SUBMISSION_QUEUE_MAX`, `WRITE_RATE_LIMIT_MAX` or `WRITE_RATE_LIMIT_WINDOW_MS` makes the boot fail with an error naming the variable. Allowed values: queue 0–100000 (0 accepts nothing), write max 1–10000, window 1000–86400000 ms. Unset or empty means the default.

**Rollback: never restore pre-security code with writes open.** The verified baseline `ee3e8bc` performs unauthenticated `INSERT`/`UPDATE` on the published `coffee_shops` table, has no write rate limit, and **ignores `SUBMISSIONS_ENABLED`**. Treat any older build with equivalent direct-write handlers the same way. In order of preference:

1. **Operational rollback (no code change):** keep this code and close submissions. Unset `SUBMISSIONS_ENABLED` in production (fails closed, 503) or set it to `false`. This is the default state anyway.
2. **If this code must be backed out for an unrelated defect:** fix forward on top of it. Alternatively, deploy an older build **only after** `POST` and `PUT` are blocked before the app, for example by an ingress or edge rule returning 403/405/503, for **all** of the following:
   - the base paths `/api/v1/coffee-shops` and `/api/coffee-shops` themselves. A `/coffee-shops/*` wildcard alone may not match the base path, which is where `POST` creates go.
   - every descendant of both, such as `/api/v1/coffee-shops/123`.
   - every spelling Express would route to them: case variants (`/API/V1/Coffee-Shops`) and a trailing slash (`/api/v1/coffee-shops/`). Express matches paths case-insensitively and ignores one trailing slash.

   The simplest safe rule is case-insensitive: block `POST`/`PUT` whose path equals, or starts with `/` after, `/api/v1/coffee-shops` or `/api/coffee-shops`. Confirm the block from outside on the base path, a descendant and a variant, without sending a real write (for example, an invalid empty body), before the older build goes live. Keep the block until this change is redeployed. A plain `git revert` plus auto-deploy is **not** an acceptable rollback.
3. Schema: do nothing. The forward-only table and column stay in place and are harmless to older code. Older code's `idempotency_keys` INSERT names its columns, so a nullable `request_hash` doesn't break it.

## Tests (`npm test`: 15 suites, 309 tests)

- `tests/integration/submissions.test.js`: 202 pending for POST/PUT, published rows deep-equal before and after every test, frontend payload shape, rejection of invalid lengths/types/enums/URLs/ids with nothing stored in either table.
- `tests/unit/usecases/submissions.test.js`: field-by-field validation, `parseShopId`, and the capacity-checked INSERT.
- `tests/integration/write-rate-limit.test.js`: 429 + `Retry-After`; a shared budget across POST/PUT, case and trailing-slash variants and the legacy alias; spoofed forwarding headers; rotated keys; invalid, malformed and oversized bodies spend budget; production `trust proxy` keying; reads and preflights not counted.
- `tests/integration/idempotency.test.js` and `tests/unit/lib/idempotency.test.js`: replay, concurrency, 422 on key reuse (body or endpoint), legacy NULL fingerprint fails closed, key format.
- `tests/integration/submission-failures.test.js`: malformed JSON 400, oversize 413, queue-full 503 including the concurrent race, storage failure 500 with key release and successful retry, kill switch, production default closed.
- `tests/integration/migrations.test.js`: runs the real `scripts/migrate.js` on TMPDIR databases. Covers a fresh database, a copy of the tracked database (published rows hash-identical; reapply is a no-op), CHECK constraints, and forward-only retention. Retention is tested for each new migration on its own: with it as the latest applied, `down` is refused and the ledger, queued proposals and `request_hash` values are unchanged; then `up` is a no-op or applies only what is pending. It also asserts that neither file contains a down section or `DROP`. Asserts the tracked DB is byte-identical afterwards.
- `tests/unit/config.test.js`: strict bounded parsing of `SUBMISSION_QUEUE_MAX` (0 = accept nothing), `WRITE_RATE_LIMIT_MAX` (0 rejected), `WRITE_RATE_LIMIT_WINDOW_MS` (≤24h). Rejects junk, negative, fractional, hex, exponent and overflow values. Covers `submissionsEnabled` in production and non-production.
- `.github/workflows/test.yml`: `npm ci && npm test` on `pull_request` and `workflow_call`, read-only permissions, no schedule. It fails if `data/` changes.

Raw red/green evidence lives outside the repo in the parent report `/home/beno/clawd/reports/localcoffeeshop-security-20261017/`: `implementation-evidence/` for the implementation and `review-fix-evidence/` for the review fixes (F01–F05).

## Dependencies

Lock-only, semver-compatible, limited to the request path: express 4.22.3, body-parser 1.20.8, proxy-addr 2.0.8, qs 6.16.1 (+ side-channel 1.1.1 / side-channel-list 1.0.1), path-to-regexp 0.1.13, express-rate-limit 8.7.1 (fixes the IPv4-mapped IPv6 bypass), ip-address 10.7.4, compression 1.8.2. `package.json` is unchanged. `npm audit --omit=dev`: **19 → 11**. The remaining 11 are in sqlite3's install-time build chain (`tar`, `@tootallnate/once`, `http-cache-semantics`, `minimatch`, `brace-expansion`; fixing them needs the sqlite3@6 major) and pino-pretty's `fast-copy`, which only matters for non-production logging. Dev-only advisories (pm2, jest chain) are not addressed.

## Known limitations and follow-ups

- The queue is ephemeral (see the release blocker above), and there is no review UI or publication path. The local review CLI records decisions only.
- Rate limiting is per IP. A distributed attacker can still fill the queue up to the cap, after which they hit 503. `trust proxy = 1` assumes exactly one proxy hop at DO; check this against real DO headers before relying on per-client fairness.
- **Deferred baseline defect B-01 (pre-dates this change, not fixed here):** expired `idempotency_keys` rows are only removed by a 1% probabilistic sweep. The lookup ignores rows older than the TTL (`created_at > now - 86400`), but the reservation `INSERT OR IGNORE` still collides with the expired row's primary key and returns `changes === 0`. The middleware reports that as a lost race, so reusing a key more than 24h after its first use gets **409 `IDEMPOTENCY_IN_PROGRESS`** until a sweep happens to run. Impact: availability for that key only, with no data exposure or bypass. The frontend uses a fresh UUID per submit, so it doesn't hit this. Suggested fix: `DELETE FROM idempotency_keys WHERE key = ? AND created_at <= ?` before reserving, with a real-SQLite regression test.
- **Deferred baseline items B-02 (pre-existing, not fixed here):** (a) the non-API 404 handler returns 500 because `src/public/html/404.html` is missing. (b) If the idempotency lookup or reservation fails with a storage error, the request falls through and is executed (fail-open); the worst case is now a duplicate *pending* row, bounded by the queue cap and the write limit. (c) The `Dockerfile` doesn't set `DB_PATH`, so container runs without the app-spec env default to `./coffee_shops.db`. (d) Jest `collectCoverageFrom` covers only `src/server.js` and `src/db.js`.
- Frontend: companion PR #49 (separate) changes the two success messages to "pending review". The frontend's update tab has never loaded shop ids (`allCoffeeShops` is never filled), so PUT proposals from the UI may not be reachable today.
