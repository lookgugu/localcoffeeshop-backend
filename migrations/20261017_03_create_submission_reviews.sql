-- Migration: create_submission_reviews
-- Created: 2026-10-17
--
-- Append-only audit of moderation decisions on shop_submissions, written only
-- by the private operator CLI scripts/review-submissions.js (never by the
-- HTTP app). A decision is a moderation outcome ONLY: 'approved' does not
-- publish anything and nothing reads this table to change coffee_shops.
-- See docs/security/submission-review-cli.md.
--
-- Additive only: no existing table, row, or index is modified.
--
-- - UNIQUE(submission_id): at most one decision per submission, so a replayed
--   or concurrent decision fails closed even if the status guard regressed.
-- - old_status is always 'pending': only pending submissions can be decided.
-- - payload_sha256 is the digest the reviewer saw in `show` (lowercase hex).
-- - reviewer is attribution supplied by the operator, NOT authentication.
-- - Triggers make rows immutable once written.

-- migration:up

CREATE TABLE IF NOT EXISTS submission_reviews (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    submission_id  INTEGER NOT NULL UNIQUE REFERENCES shop_submissions(id),
    old_status     TEXT    NOT NULL CHECK (old_status = 'pending'),
    new_status     TEXT    NOT NULL CHECK (new_status IN ('approved', 'rejected')),
    reviewer       TEXT    NOT NULL CHECK (length(reviewer) BETWEEN 1 AND 64),
    reason         TEXT    NOT NULL CHECK (length(reason) BETWEEN 1 AND 500),
    payload_sha256 TEXT    NOT NULL CHECK (length(payload_sha256) = 64 AND payload_sha256 NOT GLOB '*[^0-9a-f]*'),
    decided_at     INTEGER NOT NULL
);

CREATE TRIGGER IF NOT EXISTS submission_reviews_append_only_update
BEFORE UPDATE ON submission_reviews
BEGIN
    SELECT RAISE(ABORT, 'submission_reviews is append-only');
END;

CREATE TRIGGER IF NOT EXISTS submission_reviews_append_only_delete
BEFORE DELETE ON submission_reviews
BEGIN
    SELECT RAISE(ABORT, 'submission_reviews is append-only');
END;

-- Forward-only by design: there is intentionally no down section, so
-- `migrate down` refuses this file (non-zero exit, ledger untouched) and the
-- decision audit can never be destroyed by a migration rollback. The table is
-- inert to code that does not reference it.
