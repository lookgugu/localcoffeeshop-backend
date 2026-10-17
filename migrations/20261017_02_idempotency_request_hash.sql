-- Migration: idempotency_request_hash
-- Created: 2026-10-17
--
-- Stores a SHA-256 fingerprint of the request (method, route, params, body)
-- alongside each Idempotency-Key reservation. Reusing a key with a different
-- request is answered 422 IDEMPOTENCY_KEY_REUSED instead of replaying an
-- unrelated response. (See src/lib/idempotency.js.)
--
-- Additive only. Rows written before this migration have request_hash NULL;
-- they fail closed (422 IDEMPOTENCY_KEY_REUSED, never replayed) until they
-- expire (24h TTL).
--
-- Forward-only by design: there is intentionally no down section, so
-- `migrate down` refuses this file (non-zero exit, ledger untouched) and
-- stored fingerprints are retained. A no-op down would remove the ledger
-- row and make the next `up` fail on a duplicate ADD COLUMN.

-- migration:up

ALTER TABLE idempotency_keys ADD COLUMN request_hash TEXT;
