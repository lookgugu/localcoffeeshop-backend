-- Migration: create_shop_submissions
-- Created: 2026-10-17
--
-- Moderation queue for anonymous community proposals. Public
-- POST /coffee-shops and PUT /coffee-shops/:id write here (status 'pending')
-- and never touch the published `coffee_shops` table. Nothing in the app
-- publishes from this table yet; see docs/security/community-submissions.md.
--
-- Additive only: no existing table, row, or index is modified.
--
-- The CHECK constraints duplicate the route-level validation in
-- src/usecases/submissions.js so a bug there cannot store unbounded or
-- out-of-vocabulary values.

-- migration:up

CREATE TABLE IF NOT EXISTS shop_submissions (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    kind           TEXT    NOT NULL CHECK (kind IN ('create', 'update')),
    -- IS NOT NULL is required: a CHECK whose result is NULL passes in SQLite.
    target_shop_id INTEGER CHECK (
                       (kind = 'create' AND target_shop_id IS NULL)
                       OR (kind = 'update' AND target_shop_id IS NOT NULL AND target_shop_id > 0)
                   ),
    name           TEXT    NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
    address        TEXT    NOT NULL CHECK (length(address) BETWEEN 1 AND 300),
    state          TEXT    NOT NULL CHECK (length(state) = 2),
    price_level    TEXT    CHECK (price_level IS NULL OR price_level IN (
                       'PRICE_LEVEL_INEXPENSIVE', 'PRICE_LEVEL_MODERATE', 'PRICE_LEVEL_EXPENSIVE'
                   )),
    phone_number   TEXT    CHECK (phone_number IS NULL OR length(phone_number) <= 32),
    website        TEXT    CHECK (website IS NULL OR length(website) <= 300),
    description    TEXT    CHECK (description IS NULL OR length(description) <= 1000),
    language_code  TEXT    NOT NULL DEFAULT 'en' CHECK (length(language_code) BETWEEN 2 AND 16),
    status         TEXT    NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    created_at     INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_shop_submissions_status_created
    ON shop_submissions(status, created_at);

-- Forward-only by design: there is intentionally no down section, so
-- `migrate down` refuses this file (non-zero exit, ledger untouched) and
-- queued proposals can never be destroyed by a migration rollback. The table
-- is inert to code that does not reference it.
