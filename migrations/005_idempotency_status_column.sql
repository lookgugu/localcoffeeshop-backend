-- Migration: idempotency_status_column
-- Created: 2026-06-03
--
-- Adds a `status` column to `idempotency_keys` so the middleware can reserve
-- a key with `status = 'pending'` BEFORE the write handler runs and flip it
-- to `'completed'` after the response. Without this column two concurrent
-- requests with the same Idempotency-Key both pass the SELECT, both run the
-- handler, and both write business data — defeating the at-most-once
-- guarantee. (See src/lib/idempotency.js.)
--
-- Default 'completed' preserves the contract for rows written before this
-- migration: any pre-existing row continues to be treated as a finished
-- replay payload.

-- migration:up

ALTER TABLE idempotency_keys ADD COLUMN status TEXT NOT NULL DEFAULT 'completed';

-- migration:down

-- SQLite < 3.35 cannot DROP COLUMN. The rollback would require a
-- create-copy-drop dance; intentionally left empty (irreversible).
