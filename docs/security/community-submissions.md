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
| Queue bound | An atomic `INSERT … SELECT … WHERE (pending count) < SUBMISSION_QUEUE_MAX` (default 500). On Postgres it runs under a transaction-scoped advisory lock, because Postgres has no database-wide write lock to make the count-then-insert atomic. When the queue is full: **503** `SUBMISSION_QUEUE_FULL` plus `Retry-After`. Reviewed rows don't count toward the cap. |
| Idempotency | Order per route: kill switch → validate → idempotency → handler. Invalid requests never reserve a key. Keys must match `[A-Za-z0-9._:-]{1,128}`, otherwise 400 `IDEMPOTENCY_KEY_INVALID`. Each reservation stores a SHA-256 of method, route, params and body. Reusing a key for a different request gives **422** `IDEMPOTENCY_KEY_REUSED`: the stored response is not replayed and the handler does not run. **Legacy rows with a NULL fingerprint fail closed (422)**, so a pre-moderation "shop created" response is never replayed. Non-2xx outcomes (400, 503, 500) release the key. A key older than the 24h TTL is replaced atomically on reuse (fixes B-01). If idempotency storage fails, the write is refused with **503** `IDEMPOTENCY_UNAVAILABLE` and the handler does not run (fixes B-02b). |
| Errors | Malformed JSON returns 400 and an oversized body returns 413, both in the standard envelope (they used to be 500). |
| Kill switch | `SUBMISSIONS_ENABLED`. **Production is closed by default (503 `SUBMISSIONS_DISABLED`) and opens only on the exact value `true` with `DATABASE_URL` also set** (the durable queue; see below). Development and test default to open, and there `false/0/off/no` closes it. |
| Logging | Each accepted proposal logs `event: shop_submission_queued` with submissionId, kind and targetShopId only. No user-supplied content is logged. |

There is **deliberately no moderation, publication or admin endpoint**. No browser secret was added. Nothing in the app reads from `shop_submissions`. A private operator CLI for recording moderation decisions (never publication) was added later. It works on local SQLite copies and, as an `lcs_reviewer` login, on the production Postgres queue; see [submission-review-cli.md](submission-review-cli.md).

## Durable queue (Postgres)

Status as of 2026-11-22, branch `feat/durable-submission-queue`.

The queue used to live in the SQLite file baked into the image. App Platform replaces that file on every deploy, restart or instance replacement, so queued proposals would have been lost. The queue, its review audit and the idempotency keys now live in Postgres, all together. The published directory (`coffee_shops`) stays in SQLite.

- **Storage selection** (`src/queue/`): with `DATABASE_URL` set, the API uses the Postgres store; otherwise it uses the SQLite store (development and tests). Both implement one interface, covered by one contract suite run against both databases (`tests/integration/queue-store.test.js`). See [ADR-0002](../adr/0002-submission-queue-store.md).
- **Production gate**: submissions open only with `SUBMISSIONS_ENABLED=true` **and** `DATABASE_URL`. The flag alone logs a warning and stays closed.
- **Schema** (`migrations/postgres/`, forward-only): applied at boot, one transaction per file, recorded with a SHA-256 in `schema_migrations`; an edited applied file is refused. A session advisory lock serialises concurrent boots. Run manually with `npm run migrate:pg -- status|up`.
- **A Postgres outage never takes the API down**: at boot or later. If Postgres is unreachable or a migration fails, the directory keeps serving, `/health` stays 200 with `data.submissions.queue = "error"`, and every submission gets **503** `SUBMISSIONS_UNAVAILABLE`. The migration is retried every 60 s.
- **TLS**: `sslmode` in the URL is honoured by requiring TLS. Set `DATABASE_CA_CERT` (App Platform: `${db.CA_CERT}`) to verify DigitalOcean's certificate. Verification is never disabled.
- **Least privilege, enforced by the database**:

  | Role | Can | Cannot |
  |---|---|---|
  | `lcs_app` (the API) | insert and count `shop_submissions`; read/write `idempotency_keys` | update or delete submissions; read or write `submission_reviews` |
  | `lcs_reviewer` (moderation) | read submissions; update **only** `status`; insert into `submission_reviews` | edit submission content; enqueue; touch `idempotency_keys` |

  Triggers make every submission start as `pending`, keep its content immutable, and allow status only `pending → approved|rejected`, whoever runs the statement; `submission_reviews` is append-only. Both roles are `NOLOGIN` groups created by the migration (needs `CREATEROLE`, which DigitalOcean's `doadmin` has).
- `/health` reports `data.submissions = { open, storage, durable, queue }`, so a deploy can be checked from a browser.

### Production setup (operator)

Done on 2026-11-23 (backend #19): cluster `lcs-queue`, database `localcoffeeshop`. These steps record how, for a rebuild. The app never holds `doadmin`.

1. Create a DigitalOcean Managed PostgreSQL 16 cluster in the app's region (a dedicated one: roles are cluster-wide) and add it to the app as a database component. Trusted sources: the app, plus each reviewer's machine.
2. As `doadmin`, create the group roles first, so the migration never needs `CREATEROLE`: `CREATE ROLE lcs_app NOLOGIN; CREATE ROLE lcs_reviewer NOLOGIN;`. Then create the logins: `lcs_migrator` (owns the database, runs migrations), `lcs_api IN ROLE lcs_app` (the API) and `lcs_review IN ROLE lcs_reviewer` (moderation).
3. Create the database owned by the migrator (`CREATE DATABASE localcoffeeshop OWNER lcs_migrator`). Then, as `lcs_migrator`: `REVOKE CONNECT, TEMPORARY ON DATABASE localcoffeeshop FROM PUBLIC; GRANT CONNECT ON DATABASE localcoffeeshop TO lcs_app, lcs_reviewer;`.
4. App environment variables: `DATABASE_URL` = the `lcs_api` connection string (secret), `MIGRATION_DATABASE_URL` = the `lcs_migrator` connection string (secret), `DATABASE_CA_CERT` = `${<db>.CA_CERT}`. Leave `SUBMISSIONS_ENABLED` unset. `MIGRATION_DATABASE_URL` is required: the boot migration needs to create `schema_migrations` in the schema, which `lcs_api` cannot.
5. Deploy, or migrate ahead with `MIGRATION_DATABASE_URL=… npm run migrate:pg -- up`.
6. Reviewers connect with `REVIEW_DATABASE_URL` = the `lcs_review` connection string and `REVIEW_DATABASE_CA_CERT` = the cluster's CA certificate. The CLI refuses `lcs_api`, `lcs_migrator` and `doadmin`. See [submission-review-cli.md](submission-review-cli.md#postgres-the-production-queue).
7. Check `GET https://api.localcoffeeshop.co/api/v1/health`: `submissions.storage` must be `postgres` and `submissions.queue` must be `ok`. `queue` reports `error` if Postgres is unreachable **or** the API's login lacks the `lcs_app` grants. `open` stays `false` until step 8.
8. Only when the gate below is met, set `SUBMISSIONS_ENABLED=true`.

### Release gate before `SUBMISSIONS_ENABLED=true`

| Gate | Status |
|---|---|
| Durable storage: proposals, idempotency and review audit together, atomic capacity | **Done**: code (#17) and production database (#19, 2026-11-23) |
| Idempotency edge cases B-01 (expired-key 409) and B-02b (fail-open on storage error) | **Fixed** (this change) |
| Least-privilege identities: the public app cannot decide or publish | **Done**: schema grants plus the `lcs_api` / `lcs_review` / `lcs_migrator` logins (#19) |
| Review tooling on the durable store | **Done**: `npm run review -- --postgres …` (#20) with the `lcs_review` login |
| Confirmed reviewer/owner, cadence, retention and privacy policy | **Partly done**: reviewer and notification decided (see [Review process](#review-process)); backup reviewer, retention and the privacy-page line are still open |
| Real App Platform `X-Forwarded-For` hop behaviour verified against `trust proxy = 1` | **Open**: needs a check against production |
| Restore drill (backup and restore of the queue database) | **Open** |
| Publication path | Still a separate, human-reviewed change (for example a data PR); not built |

### Review process

Decided by the project owner on 2026-11-23 (backend #21):

- **Reviewer:** the project owner (GitHub `lookgugu`), who holds the `lcs_review` login. There is no backup reviewer yet.
- **Notification:** each queued submission is emailed to the reviewer (`SUBMISSION_NOTIFY_*`, `src/submissions/`), so review happens as submissions arrive and nobody has to poll the queue. The email is best effort: a failed or capped email never affects the submission, and the queue (`npm run review -- --postgres list`) stays the source of truth. At most `SUBMISSION_NOTIFY_MAX_PER_HOUR` emails go out per hour (default 20). Past the cap, the next email says how many submissions arrived without one. Submitted content is shown as untrusted, HTML-escaped plain text with every link defused. The recipient address is set only in the app's environment, never in the repository.
- **Privacy:** the email puts a copy of the submission (which may include a phone number and free text) in the reviewer's mailbox. Delete those emails along with the queue rows once retention is decided. Reviewers must not put personal data in the append-only `reason` field.
- **Still open:** a backup reviewer; what to do as the queue nears `SUBMISSION_QUEUE_MAX` (500); retention for pending, rejected and approved rows, the audit and the emails; and whether the privacy page (frontend #18/#22) needs a line about submissions.

| Variable | Purpose |
|---|---|
| `SUBMISSION_NOTIFY_ENABLED` | `true` to send reviewer emails. Anything else disables them. |
| `SUBMISSION_NOTIFY_TO` | Reviewer address (one) |
| `SUBMISSION_NOTIFY_FROM` | Sender on a Resend-verified domain, e.g. `LocalCoffeeShop <submissions@mail.localcoffeeshop.co>` |
| `SUBMISSION_NOTIFY_RESEND_API_KEY` | A dedicated **sending-only** Resend key, restricted to that domain. Never the waitlist key: there is no fallback. |
| `SUBMISSION_NOTIFY_MAX_PER_HOUR` | 1–1000, default 20 |

## Deploy, migration and rollback

Migrations are additive and **forward-only**. They run automatically at boot (`npm start` = `migrate up` + server) on the image's DB copy:

- `20261017_01_create_shop_submissions.sql`: new table and index.
- `20261017_02_idempotency_request_hash.sql`: `ALTER TABLE idempotency_keys ADD COLUMN request_hash`.
- `20261017_03_create_submission_reviews.sql`: append-only moderation decision audit table and its triggers (written only by the operator CLI).

None of these migrations has a `down` section. `npm run migrate -- down` refuses them ("No down migration found", non-zero exit) and changes nothing: the ledger, queued proposals, stored fingerprints and review audit rows all stay as they were, and the next `up` is a no-op. All three objects are inert to code that doesn't reference them, so no schema rollback is ever needed. Never run migrations against the tracked `data/coffee_shops.db`.

**Deploy:** merge to `main`, which auto-deploys. Leave `SUBMISSIONS_ENABLED` unset in the app spec until the release gate above is met. Afterwards, check (read-only) that `GET /api/v1/health` returns 200. Do **not** test the write path in production. An invalid `SUBMISSION_QUEUE_MAX`, `WRITE_RATE_LIMIT_MAX` or `WRITE_RATE_LIMIT_WINDOW_MS` makes the boot fail with an error naming the variable. Allowed values: queue 0–100000 (0 accepts nothing), write max 1–10000, window 1000–86400000 ms. Unset or empty means the default.

**Rollback: never restore pre-security code with writes open.** The verified baseline `ee3e8bc` performs unauthenticated `INSERT`/`UPDATE` on the published `coffee_shops` table, has no write rate limit, and **ignores `SUBMISSIONS_ENABLED`**. Treat any older build with equivalent direct-write handlers the same way. In order of preference:

1. **Operational rollback (no code change):** keep this code and close submissions. Unset `SUBMISSIONS_ENABLED` in production (fails closed, 503) or set it to `false`. This is the default state anyway.
2. **If this code must be backed out for an unrelated defect:** fix forward on top of it. Alternatively, deploy an older build **only after** `POST` and `PUT` are blocked before the app, for example by an ingress or edge rule returning 403/405/503, for **all** of the following:
   - the base paths `/api/v1/coffee-shops` and `/api/coffee-shops` themselves. A `/coffee-shops/*` wildcard alone may not match the base path, which is where `POST` creates go.
   - every descendant of both, such as `/api/v1/coffee-shops/123`.
   - every spelling Express would route to them: case variants (`/API/V1/Coffee-Shops`) and a trailing slash (`/api/v1/coffee-shops/`). Express matches paths case-insensitively and ignores one trailing slash.

   The simplest safe rule is case-insensitive: block `POST`/`PUT` whose path equals, or starts with `/` after, `/api/v1/coffee-shops` or `/api/coffee-shops`. Confirm the block from outside on the base path, a descendant and a variant, without sending a real write (for example, an invalid empty body), before the older build goes live. Keep the block until this change is redeployed. A plain `git revert` plus auto-deploy is **not** an acceptable rollback.
3. Schema: do nothing. The forward-only table and column stay in place and are harmless to older code. Older code's `idempotency_keys` INSERT names its columns, so a nullable `request_hash` doesn't break it.

## Tests

- `tests/integration/queue-store.test.js`: one contract suite run against real SQLite and real Postgres (the latter as `lcs_app`): field storage, capacity counting only pending rows, 25 concurrent enqueues against a cap of 5 (fails without the advisory lock), atomic reservation, B-01 expired-key replacement, release/complete/sweep scope.
- `tests/integration/postgres-queue.test.js`: migration runner (fresh, re-run, edited file refused, failed file rolled back, concurrent runners); `lcs_app` and `lcs_reviewer` grants; immutability and append-only triggers; CHECK constraints; `POST /coffee-shops` end to end on Postgres with replay and 422; boot with an unreachable Postgres resolves and answers 503.
- `tests/integration/review-submissions-postgres.test.js`: the review CLI as a subprocess with real login roles: refuses the owner/superuser and `lcs_app` logins, never falls back to `DATABASE_URL`, digest parity with SQLite, dry runs write nothing, stale and non-pending decisions refused, rollback when the audit insert or the status update fails, 8 racing processes with exactly one decision landing, and the reviewer login unable to edit content or rewrite the audit.
- Postgres suites run when `PG_TEST_DATABASE_URL` is set (each creates and drops its own database). CI runs them against a `postgres:16` service with `REQUIRE_PG_TESTS=1`, so a missing database fails the run instead of skipping.
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

- With `DATABASE_URL` set the queue is durable (see above). Decisions are recorded with the operator CLI (`--postgres`); there is still no review UI or publication path.
- Rate limiting is per IP. A distributed attacker can still fill the queue up to the cap, after which they hit 503. `trust proxy = 1` assumes exactly one proxy hop at DO; check this against real DO headers before relying on per-client fairness.
- **B-01 (fixed 2026-11-22):** a key reused more than 24h after its first use used to get 409 `IDEMPOTENCY_IN_PROGRESS` until a probabilistic sweep removed the expired row. Reservation is now one upsert that replaces an expired row atomically, tested against real SQLite and Postgres.
- **Deferred baseline items B-02 (pre-existing, not fixed here):** (a) the non-API 404 handler returns 500 because `src/public/html/404.html` is missing. (b) Fixed 2026-11-22: a storage error in the idempotency lookup or reservation now refuses the write with 503 `IDEMPOTENCY_UNAVAILABLE` instead of running it unprotected. (c) The `Dockerfile` doesn't set `DB_PATH`, so container runs without the app-spec env default to `./coffee_shops.db`. (d) Jest `collectCoverageFrom` covers only `src/server.js` and `src/db.js`.
- Frontend: companion PR #49 (separate) changes the two success messages to "pending review". The frontend's update tab has never loaded shop ids (`allCoffeeShops` is never filled), so PUT proposals from the UI may not be reachable today.
