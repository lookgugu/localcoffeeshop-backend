-- Migration: create_idempotency_keys
-- Created: 2026-06-03
--
-- Backs the `withIdempotency` middleware (src/lib/idempotency.js). Stores the
-- replay payload for any write request that arrives with an `Idempotency-Key`
-- header, so an at-most-once guarantee can be honoured across retries.

-- migration:up

CREATE TABLE idempotency_keys (
    key         TEXT PRIMARY KEY,
    endpoint    TEXT NOT NULL,
    status_code INTEGER NOT NULL,
    response    TEXT NOT NULL,
    created_at  INTEGER NOT NULL
);

CREATE INDEX idx_idempotency_created_at ON idempotency_keys(created_at);

-- migration:down

DROP INDEX IF EXISTS idx_idempotency_created_at;
DROP TABLE IF EXISTS idempotency_keys;
