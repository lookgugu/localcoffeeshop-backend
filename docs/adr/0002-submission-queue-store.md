# ADR-0002 — A queue-store port for community submissions

- **Status:** Accepted
- **Date:** 2026-11-22
- **Relates to:** [ADR-0001](0001-no-repository-port-for-sqlite-reads.md) (not superseded)

## Context

Community submissions were queued in the SQLite file baked into the API image. App Platform replaces that file on every deploy, restart and instance replacement, so production kept submissions closed (`docs/security/community-submissions.md`). The release gate asks for the queue, its idempotency keys and its review audit to move together to durable storage.

ADR-0001 declined a repository port for reads because SQLite was the only real backend. It named one condition for revisiting: *"We need to support a second persistent backend simultaneously."* The submission queue now meets it. Production needs Postgres, and development, the existing test suite and the local review CLI keep working on SQLite.

## Decision

Introduce a narrow **queue store** (`src/queue/`) owning exactly the write-side tables: `shop_submissions`, `submission_reviews` and `idempotency_keys`. It has two adapters, `sqlite-store.js` and `postgres-store.js`. The API picks Postgres when `DATABASE_URL` is set.

The port is shaped around operations (`enqueueSubmission`, `reserveKey`, `completeKey`, ...), not around SQL, because the two databases need different mechanics for the same guarantee. SQLite makes the capacity check atomic with its database-wide write lock. Postgres needs a transaction-scoped advisory lock; without it, 25 concurrent submissions against a cap of 5 stored 7–9 rows in testing.

Reads of the published directory (`coffee_shops`) are unchanged and stay on the SQLite `db` module. ADR-0001 still applies to them.

The Postgres driver is plain `pg` with forward-only SQL migrations in `migrations/postgres/`, not an ORM. The tables are small, the guarantees depend on exact SQL (upserts, advisory locks, triggers, grants), and this matches the rest of the codebase.

## Why this does not repeat ADR-0001's concern

ADR-0001 rejected an *in-memory* adapter that would re-implement SQL semantics in JavaScript and let tests pass while production diverged. Both adapters here are real databases. One contract suite (`tests/integration/queue-store.test.js`) runs every case against both, and CI runs the Postgres half against a real `postgres:16` service, so the adapters cannot drift silently.

## Consequences

**Easier:**
- Submissions survive deploys once `DATABASE_URL` is set.
- Least privilege is enforced by Postgres roles (`lcs_app` cannot approve or publish), not by code review.
- Development and the existing tests need no Postgres.

**Harder:**
- Two implementations of six operations must be kept in step. The contract suite is the guard; a change to one adapter needs a contract test.
- CI needs a Postgres service, and local Postgres tests need `PG_TEST_DATABASE_URL`.
- Schema exists twice (SQLite migrations and `migrations/postgres/`). Both carry the same CHECK constraints.

## When to revisit

- If the published directory also moves to Postgres, fold the queue store into that data-access layer and drop the SQLite adapter.
- If a third queue backend is ever proposed, prefer removing SQLite from the write path instead.
