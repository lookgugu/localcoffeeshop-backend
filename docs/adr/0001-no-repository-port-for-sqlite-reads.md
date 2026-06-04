# ADR-0001 — No repository port for SQLite reads

- **Status:** Accepted
- **Date:** 2026-06-01

## Context

When splitting `server.js` (see report candidate #3), a layered / ports-and-adapters design was considered. That design would have introduced a `ShopRepository` port with two adapters:

- `sqliteShopRepository` for production
- `inMemoryShopRepository` for tests (an array-backed JS implementation)

The argument for it: use-case tests could exercise `searchShops`, `listStates`, etc. without booting SQLite or building SQL strings.

## Decision

We will not introduce a `ShopRepository` port. The data-access layer will remain a thin `db.js` module wrapping `sqlite3` directly. Use-case modules will receive `db` as a dependency.

For tests:
- Pure use-case logic that doesn't need data: stub `db.all` / `db.get` with `vi.fn()`.
- Tests that genuinely need data: run against SQLite in `:memory:` mode (already supported by the existing test infrastructure).

## Reasoning

An in-memory `ShopRepository` adapter would have to re-implement, in JavaScript:

- SQLite's `WHERE` clause semantics, including type coercion and `NULL` handling
- FTS5 tokenisation and prefix-matching for `/search`
- `ORDER BY` collation
- `LIMIT` / `OFFSET` cursor behaviour

The likely outcome: use-case tests pass against the in-memory adapter while the SQLite-backed production code diverges in edge cases (tokenisation, accent folding, sort order). The tests would lie, silently.

SQLite already provides `:memory:` mode — it is a configuration-level substitute, not a code-level one. That is a single adapter with a substitutable runtime mode, not two adapters with a shared interface.

Per the principle: **one adapter means a hypothetical seam; two adapters means a real one.** A second in-memory adapter that re-implements query semantics in a foreign language is worse than no second adapter at all.

## Consequences

**Easier:**
- Use-case tests stub `db` at the function level — fewer moving parts.
- Test fixtures load the real schema via migrations; no parallel schema definition to drift.
- Adding a use case means adding a function, not a method on a port + a method on each adapter.

**Harder:**
- True ports-and-adapters purity is unavailable; use cases coupled to "something that quacks like our `db` module" rather than a named interface.
- If we ever do migrate off SQLite (e.g., to Postgres), the swap is a `db.js` rewrite rather than swapping one adapter. Acceptable: that migration would require rewriting all the SQL anyway.

## When to revisit

Reopen this decision if any of the following becomes true:

- We need to support a second persistent backend simultaneously (not a migration — actual parallel use).
- The query logic moves out of SQL into application code such that the in-memory adapter would no longer need to replicate FTS5/WHERE semantics.
- Use-case test setup becomes the dominant cost in the test suite.
