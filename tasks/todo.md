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

- [x] Delete `prepare()`, `serialize()`, `getInstance()` from `src/db.js` (lines 70–75, 146–156)
- [x] Update `module.exports` block — interface goes from 8 methods to 5
- [x] Delete test blocks in `tests/unit/db.test.js`:
  - [x] `describe('getInstance()')` (lines 117–135)
  - [x] `describe('prepare()')` (lines 313–357)
  - [x] `describe('serialize()')` (lines 358–403)
- [x] Cull tests that test sqlite3 itself (not our wrapper):
  - [x] Parameterised-query injection-safety tests in `describe('get()')` and `describe('all()')`
  - [x] Multi-row-return assertions that mirror sqlite3 behaviour
  - [x] LIMIT/OFFSET behaviour tests
  - [x] Keep: tests that assert our wrapping behaviour (metrics recorded, logger called, errors propagate, `isHealthy` semantics)
- [x] Refactor tests that used `db.getInstance()` for test-table setup — use `tests/helpers/testDb.js` (already opens its own sqlite3 connection)
- [x] Update JSDoc header in `src/db.js` — the "easier database swapping" claim is now truthful since `getInstance` no longer leaks

> **Note:** `db.run()` does NOT land here. It lands as part of #5 (idempotency), when there's a real production write that needs parameterisation.

---

## 3. Consolidate enums (candidate #2 — backend half)

Coordinated with frontend repo. Each repo commits its own copy of `enums.js`; a GitHub Action on each repo verifies they match.

- [x] Create `src/enums.js`:
  - [x] `State` as a namespace of functions over a frozen private map (no field cluster): `stateName`, `stateCodeFromName`, `isStateCode`, `allStates`, `allStateCodes`
  - [x] `Price` as a typed enum with attached fields: `Price.MODERATE.label`, `Price.MODERATE.cssClass`, `Price.MODERATE.numeric`, `Price.fromKey()`, `Price.average()`, etc.
- [x] Replace `server.js` lines 959–974 — drop the hand-rolled `STATE_NAMES` + `stateNameToCode`; import `stateCodeFromName` from `src/enums.js`
- [x] Add GitHub Action `.github/workflows/enums-drift.yml`:
  - [x] On push, diff `src/enums.js` against the frontend repo's `public/enums.js` via raw URL
  - [x] Fail the build if they differ
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

### Candidate #6 (db.js shrink) — landed

**What changed:**
- `src/db.js`: 203 → 176 LOC. Deleted `getInstance()`, `prepare()`, `serialize()` and their `module.exports` entries. Interface narrowed from 8 methods to 5: `initialize`, `get`, `all`, `close`, `isHealthy`. Updated the header JSDoc to reflect the now-truthful "easier swap to PostgreSQL" claim and to explicitly note the removed escape hatch.
- `tests/unit/db.test.js`: 635 → 288 LOC. Deleted the three `describe` blocks for the removed methods. Culled tests that asserted sqlite3 behaviour rather than our wrapper (SQL injection prevention via `?` binding, multi-row return shape, empty-array return, LIMIT/OFFSET passthrough, "missing table errors" duplicate). Refactored the surviving `get()`/`all()` tests to no longer need a populated table — they use `SELECT 1` and `SELECT 1 UNION ...` directly, since the goal is to assert our metrics/logger wiring, not sqlite3's data retrieval. No new escape hatch added.
- Test count: 33 → 18 (15 deleted). All 18 surviving tests pass.

**Test results:** Full suite 449/461 passing (up from 446/461 baseline). The 12 e2e failures are the pre-existing `tests/e2e/full-workflow.test.js` regressions noted under candidate #1 — unrelated to this change. `tests/unit/db.test.js` runs clean (18/18).

**Deviations from plan:** Plan suggested using `tests/helpers/testDb.js` to populate a real table for the surviving `get()`/`all()` tests. In practice none of the surviving tests need real data — `SELECT 1` and `SELECT 1 UNION SELECT 2 UNION SELECT 3` exercise our wrapper code paths without any setup. Avoiding the helper kept the test file simpler.

**Lessons learned:** none worth promoting to `tasks/lessons.md`.

**Open follow-ups:** `db.run()` is still missing — lands with candidate #5 (idempotency) where there's a real production writer.

### Candidate #2 backend half (enums consolidation) — landed

**What changed:**
- `src/enums.js` (167 LOC, new): UMD-style module that works as CommonJS in Node and as `window.CoffeeShopEnums` in the browser. Exports a `State` helper namespace (`stateName`, `stateCodeFromName`, `isStateCode`, `allStateCodes`, `allStates`) over a frozen private 52-entry map (50 states + DC + PR — extracted verbatim from the frontend repo's `public/constants.js`). Exports `Price` as a typed enum with frozen singleton instances (`INEXPENSIVE`/`MODERATE`/`EXPENSIVE`/`UNKNOWN`) carrying `{key, numeric, label, cssClass}` plus `all/fromKey/fromNumeric/average/averageFromNumeric` namespace methods. Reverse name→code index and sorted arrays pre-computed once at module init.
- `src/server.js`: dropped the 17-LOC hand-rolled `STATE_NAMES` literal + the `stateNameToCode` derivation at lines 763–778, plus the now-stale comment header. Replaced with `const { stateCodeFromName } = require('./enums');` at the top of the file. The `/pages/states/:stateName.html` redirect handler now calls `stateCodeFromName(stateName)` directly (case-insensitive lookup matches old `toLowerCase()` semantics).
- `.github/workflows/enums-drift.yml` (new): runs on push + pull_request, fetches the frontend repo's `public/enums.js` via `curl` against the GitHub raw URL, and `diff`s it against this repo's `src/enums.js`. Build fails with an `::error::` annotation if the two diverge. Expected to fail until the frontend repo's matching candidate lands.
- `tests/unit/enums.test.js` (new, 47 tests): covers every State helper (known/unknown codes, case-insensitivity, whitespace trimming, non-string input, count/sort/frozen guarantees for `allStateCodes`/`allStates`), every Price method (singleton reference equality from `fromKey`/`fromNumeric`, UNKNOWN sentinel for bogus input, `average` ignoring UNKNOWN entries, empty-array handling, boundary behaviour of the `<1.5 / <2.5 / else` thresholds, ordering and freezing of `Price.all()`). Documents that `[MODERATE, EXPENSIVE]` averages to `EXPENSIVE` (avg 2.5 is not `<2.5` under the specified rule).

**Test results:** 496/508 passing across the full suite (up from 449/461 baseline — the 47 new enums tests all pass; the 12 pre-existing `tests/e2e/full-workflow.test.js` failures noted in candidates #1 and #6 are unchanged and unrelated). `node -e "require('./src/enums').stateName('CA')"` returns `California`, confirming CommonJS import works. `grep STATE_NAMES src/server.js` returns nothing.

**Deviations from plan:** Plan said "51 entries (50 states + DC + PR)" — the canonical frontend `constants.js` actually has 52 entries (counted via `Object.keys().length`). Used the real count and updated the test assertion accordingly. The "Coordinate with frontend repo" item is intentionally left unchecked since it's the hand-off to the other repo, not a backend action.

**Lessons learned:** none worth promoting to `tasks/lessons.md`.

**Open follow-ups:** Frontend repo must commit a byte-identical copy of `src/enums.js` to `public/enums.js` (per its own `tasks/todo.md` section 1) and update its `app.js`/`state.html` callers to import from `CoffeeShopEnums` instead of the inline `STATE_NAMES`/`PRICE_LEVELS` in `constants.js`. The `enums-drift` workflow will fail on every push until that lands — by design.
