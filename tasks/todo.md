# Architecture deepening — backend plan

Plan derived from the architectural review (see `../architecture-review.html` and `docs/adr/0001-no-repository-port-for-sqlite-reads.md`). Five candidates land in this repo, in this order. Each block is independent unless noted.

---

## 1. Extract the query cache module (candidate #1)

Smallest blast radius, biggest immediate clarity win. Sets up #4 (server.js split).

- [x] Create `src/lib/cache.js` exporting `class QueryCache` with single method `through(key, ttlSeconds, load)`
  - [x] Move LRU + TTL logic from `src/server.js` lines 80–207
  - [x] Add single-flight: concurrent `through(k, ...)` calls share one in-flight `load()`
  - [x] Accept `{ onEvent }` callback at construction for hit/miss metric wiring
  - [x] Treat `ttlSeconds: 0` as bypass (no read, no store)
- [x] Create `src/lib/cached-route.js` exporting `makeCachedRoute(cache, { hits, misses })` → `cached(fetcher, opts)`
  - [x] Compose cache key from `req.route.path + sortedQuery + sortedParams`
  - [x] Bind hit/miss metric labels from `req.route.path`
  - [x] Errors propagate to Express via `next(e)`
- [x] Wire one `QueryCache` instance in `src/server.js`, pass to routes via deps
- [x] Replace inline cache code in `/states`, `/states/:state`, `/search` handlers with `cached(fetcher)`
- [x] Rewrite `tests/unit/cache.test.js` to import the real `QueryCache` (delete the 154-LOC duplicate class)
- [x] Add integration test: cache hit returns same payload as cache miss for `/search` (existing tests in `tests/integration/api/search.test.js` already cover this — verified passes through the new code path)

---

## 2. Shrink the db.js interface (candidate #6)

Independent of the cache work. Pure deletion.

- [ ] Delete `prepare()`, `serialize()`, `getInstance()` from `src/db.js` (lines 70–75, 146–156)
- [ ] Update `module.exports` block — interface goes from 8 methods to 5
- [ ] Delete test blocks in `tests/unit/db.test.js`:
  - [ ] `describe('getInstance()')` (lines 117–135)
  - [ ] `describe('prepare()')` (lines 313–357)
  - [ ] `describe('serialize()')` (lines 358–403)
- [ ] Cull tests that test sqlite3 itself (not our wrapper):
  - [ ] Parameterised-query injection-safety tests in `describe('get()')` and `describe('all()')`
  - [ ] Multi-row-return assertions that mirror sqlite3 behaviour
  - [ ] LIMIT/OFFSET behaviour tests
  - [ ] Keep: tests that assert our wrapping behaviour (metrics recorded, logger called, errors propagate, `isHealthy` semantics)
- [ ] Refactor tests that used `db.getInstance()` for test-table setup — use `tests/helpers/testDb.js` (already opens its own sqlite3 connection)
- [ ] Update JSDoc header in `src/db.js` — the "easier database swapping" claim is now truthful since `getInstance` no longer leaks

> **Note:** `db.run()` does NOT land here. It lands as part of #5 (idempotency), when there's a real production write that needs parameterisation.

---

## 3. Consolidate enums (candidate #2 — backend half)

Coordinated with frontend repo. Each repo commits its own copy of `enums.js`; a GitHub Action on each repo verifies they match.

- [ ] Create `src/enums.js`:
  - [ ] `State` as a namespace of functions over a frozen private map (no field cluster): `stateName`, `stateCodeFromName`, `isStateCode`, `allStates`, `allStateCodes`
  - [ ] `Price` as a typed enum with attached fields: `Price.MODERATE.label`, `Price.MODERATE.cssClass`, `Price.MODERATE.numeric`, `Price.fromKey()`, `Price.average()`, etc.
- [ ] Replace `server.js` lines 959–974 — drop the hand-rolled `STATE_NAMES` + `stateNameToCode`; import `stateCodeFromName` from `src/enums.js`
- [ ] Add GitHub Action `.github/workflows/enums-drift.yml`:
  - [ ] On push, diff `src/enums.js` against the frontend repo's `public/enums.js` via raw URL
  - [ ] Fail the build if they differ
- [ ] (Coordinate with frontend repo to apply the matching half — see frontend `tasks/todo.md`)

---

## 4. Split server.js (candidate #3)

The big refactor. Best to land #1 first so the cache is already a separate module.

> ⚠️ Honours ADR-0001: do NOT introduce a `ShopRepository` port. Use cases call `db` directly.

- [ ] Create `src/config.js` — `loadConfig(env)` → frozen config object (pure)
- [ ] Create `src/lib/middleware.js` — single ordered stack: request-id → pinoHttp → custom logging → compression → helmet → CORS → json parser → rate-limit. Document the ordering invariant in a comment block.
- [ ] Create `src/lib/responses.js` — `sendSuccess`, `sendError`, response envelope wrapper
- [ ] Create `src/lib/async-handler.js` — extract the existing `asyncHandler`
- [ ] Create `src/lib/metrics.js` — promClient registry + counters
- [ ] Create per-resource route modules in `src/routes/`:
  - [ ] `states.js` — `/states` + `/states/:stateCode`
  - [ ] `search.js` — `/search` (delegates to use-case, see next item)
  - [ ] `ops.js` — `/health` + `/stats` + `/config` (collapsed because each is trivial)
  - [ ] `metrics.js` — `/metrics` (top-level mount, outside `/api/v1`)
  - [ ] `seo.js` — `/` + `/sitemap.xml` + HTML redirects
  - [ ] `api-v1.js` — composes the resource mounters under `/api/v1`
- [ ] Create `src/usecases/searchShops.js` — owns validation + cache-key + FTS sanitisation + db.all + result shaping. Pure function of `{ db, cache, enums }`.
- [ ] Create `src/app.js` — `buildApp({ db, cache, logger, metrics, enums, config })` → Express app
- [ ] Rewrite `src/server.js` — ~50 LOC entry: wire deps, `buildApp`, `app.listen`, graceful shutdown
- [ ] Update tests to use `buildApp(fakeDeps)` instead of importing `server.js` (which used to call `app.listen` on import)
- [ ] Add use-case test: `searchShops` validation + cache behaviour with no HTTP, no SQL

---

## 5. Backend idempotency (candidate #7)

Closes the safety loop on the write retries the frontend ApiClient (frontend #4) sends. Also lands `db.run()` — the missing capability we deferred from candidate #6.

- [ ] Create migration: `migrations/NNN_create_idempotency_keys.sql`
  ```sql
  CREATE TABLE idempotency_keys (
    key TEXT PRIMARY KEY,
    endpoint TEXT NOT NULL,
    status_code INTEGER NOT NULL,
    response TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX idx_idempotency_created_at ON idempotency_keys(created_at);
  ```
- [ ] Add `run(sql, params, queryType)` to `src/db.js` (same metrics + logging pattern as `get` and `all`)
- [ ] Create `src/lib/idempotency.js` — `withIdempotency({ db, ttlSeconds = 86400 })` middleware
  - [ ] On request: `SELECT` from `idempotency_keys` WHERE key matches AND `created_at > now-ttl`
  - [ ] On hit: replay cached `{status, response}` with `Idempotent-Replay: true` header; skip handler
  - [ ] On miss: intercept `res.json` to `INSERT OR IGNORE` the response after the handler runs
  - [ ] No `Idempotency-Key` header → call `next()` immediately (no dedup)
- [ ] Create `src/routes/coffee-shops.js` — `mountCoffeeShops(router, { db })` mounting `POST /coffee-shops` and `PUT /coffee-shops/:id` with `withIdempotency` middleware
- [ ] Decide cleanup strategy:
  - [ ] Option A: lazy sweep on insert (delete-where-created_at-old runs probabilistically)
  - [ ] Option B: small cron script (`scripts/idempotency-cleanup.js`) run daily
- [ ] Tests: hit, miss, concurrent retry (both insert at same time → `INSERT OR IGNORE` wins gracefully), TTL expiry, no-header passthrough

---

## Review (fill in after implementation)

### Candidate #1 (cache extraction) — landed

**What changed:**
- `src/lib/cache.js` (~95 LOC): new `QueryCache` class with a single `through(key, ttlSeconds, load)` method. Insertion-order LRU on a Map (delete+reinsert on hit), per-key single-flight via an `_inFlight` Map, `ttlSeconds <= 0` bypasses entirely, `onEvent({kind, key})` fires on every hit/miss.
- `src/lib/cached-route.js` (~85 LOC): `makeCachedRoute(cache, { cacheHits, cacheMisses, sendSuccess })` returns a `cached(fetcher, opts)` wrapper. Composes a deterministic key from `req.route.path + sorted query + sorted params`, increments hit/miss counters labelled by route, sets `X-Cache: HIT|MISS` and optional `Cache-Control: public, max-age=N` headers, splits `{data, metadata}` fetcher returns when calling `sendSuccess`.
- `src/server.js`: deleted the 154-LOC inline `SimpleCache` class, wired one `QueryCache` instance, replaced the inline get/set ceremony in `/states`, `/states/:stateCode`, and `/search` with `cached(fetcher)`. Validation still runs before `cached(...)` is invoked so 400s never hit the cache.
- `tests/unit/cache.test.js`: rewritten — dropped the 154-LOC duplicate class, now imports the real `QueryCache`. 19 tests covering basic read-through, TTL expiry, ttl<=0 bypass, LRU eviction, single-flight, `onEvent`, and rejection behaviour.
- `tests/unit/cached-route.test.js` (new): 10 tests covering key composition, `sendSuccess` shape splitting, `X-Cache` header, hit/miss metric labelling, `Cache-Control` header, and error forwarding to `next()`.

**Test results:** 455/455 passing across unit + integration + sample suites. (The e2e suite has 12 pre-existing failures unrelated to this change — they assert on header names like `X-Cache-Status` and fields like `data.total` that this codebase has never produced. Two e2e tests that previously failed now pass.)

**Deviations from plan:**
- The plan said `sendSuccess(res, rows)` without metadata. To preserve the existing API contract (`metadata.pagination`, `metadata.filters`, etc.), the wrapper detects `{data, metadata}` returns and splits them. Fetchers return the full payload object; the cache stores it whole.
- `Cache-Control` header propagation is handled via an `opts.cacheControlMaxAge` parameter on `cached(...)` so the existing per-route cache lifetimes (24h for `/states`, 1h for `/states/:stateCode`, 5m for `/search`) survive untouched.

**Lessons learned:** (none worth adding to `tasks/lessons.md` — the work tracked the plan closely)

**Open follow-ups:** none.
