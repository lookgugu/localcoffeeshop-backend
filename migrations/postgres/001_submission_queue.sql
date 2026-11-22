-- Postgres migration 001: durable community-submission queue
--
-- Moves the three objects that must survive deploys out of the ephemeral
-- SQLite file baked into the image (docs/security/community-submissions.md):
--
--   shop_submissions    the moderation queue (same columns and CHECKs as
--                       migrations/20261017_01_create_shop_submissions.sql)
--   submission_reviews  append-only decision audit (as 20261017_03)
--   idempotency_keys    write dedup, in the same database as the queue so
--                       enqueue and reservation share one storage
--
-- The published directory (coffee_shops) stays in SQLite.
--
-- Least privilege is enforced here, not by convention:
--   lcs_app       the public API. May enqueue and count submissions and manage
--                 idempotency keys. Cannot change a submission or see the
--                 review audit, so it cannot approve or publish anything.
--   lcs_reviewer  the moderation tool. May read submissions, change ONLY their
--                 status, and append to the audit.
-- Both are NOLOGIN group roles: grant them to login users (see
-- docs/security/community-submissions.md, "Database roles").
--
-- Timestamps are epoch seconds (BIGINT) to match the SQLite schema and the
-- review CLI's payload digest.
--
-- The runner applies this file in one transaction. Forward-only.

CREATE TABLE IF NOT EXISTS shop_submissions (
    id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    kind           TEXT    NOT NULL CHECK (kind IN ('create', 'update')),
    -- IS NOT NULL is required: a CHECK whose result is NULL passes.
    target_shop_id BIGINT  CHECK (
                       (kind = 'create' AND target_shop_id IS NULL)
                       OR (kind = 'update' AND target_shop_id IS NOT NULL AND target_shop_id > 0)
                   ),
    name           TEXT    NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
    address        TEXT    NOT NULL CHECK (char_length(address) BETWEEN 1 AND 300),
    state          TEXT    NOT NULL CHECK (char_length(state) = 2),
    price_level    TEXT    CHECK (price_level IS NULL OR price_level IN (
                       'PRICE_LEVEL_INEXPENSIVE', 'PRICE_LEVEL_MODERATE', 'PRICE_LEVEL_EXPENSIVE'
                   )),
    phone_number   TEXT    CHECK (phone_number IS NULL OR char_length(phone_number) <= 32),
    website        TEXT    CHECK (website IS NULL OR char_length(website) <= 300),
    description    TEXT    CHECK (description IS NULL OR char_length(description) <= 1000),
    language_code  TEXT    NOT NULL DEFAULT 'en' CHECK (char_length(language_code) BETWEEN 2 AND 16),
    status         TEXT    NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    created_at     BIGINT  NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_shop_submissions_status_created
    ON shop_submissions (status, created_at);

-- A submission's content is immutable and its status moves only
-- pending -> approved|rejected, whoever holds UPDATE.
CREATE OR REPLACE FUNCTION shop_submissions_guard_update() RETURNS trigger AS $$
BEGIN
    IF (NEW.id, NEW.kind, NEW.target_shop_id, NEW.name, NEW.address, NEW.state,
        NEW.price_level, NEW.phone_number, NEW.website, NEW.description,
        NEW.language_code, NEW.created_at)
       IS DISTINCT FROM
       (OLD.id, OLD.kind, OLD.target_shop_id, OLD.name, OLD.address, OLD.state,
        OLD.price_level, OLD.phone_number, OLD.website, OLD.description,
        OLD.language_code, OLD.created_at) THEN
        RAISE EXCEPTION 'shop_submissions content is immutable';
    END IF;
    IF OLD.status <> 'pending' OR NEW.status NOT IN ('approved', 'rejected') THEN
        RAISE EXCEPTION 'shop_submissions status may only move from pending to approved or rejected';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS shop_submissions_guard_update ON shop_submissions;
CREATE TRIGGER shop_submissions_guard_update
    BEFORE UPDATE ON shop_submissions
    FOR EACH ROW EXECUTE FUNCTION shop_submissions_guard_update();

CREATE TABLE IF NOT EXISTS submission_reviews (
    id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    submission_id  BIGINT NOT NULL UNIQUE REFERENCES shop_submissions (id),
    old_status     TEXT   NOT NULL CHECK (old_status = 'pending'),
    new_status     TEXT   NOT NULL CHECK (new_status IN ('approved', 'rejected')),
    reviewer       TEXT   NOT NULL CHECK (char_length(reviewer) BETWEEN 1 AND 64),
    reason         TEXT   NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 500),
    payload_sha256 TEXT   NOT NULL CHECK (payload_sha256 ~ '^[0-9a-f]{64}$'),
    decided_at     BIGINT NOT NULL
);

CREATE OR REPLACE FUNCTION submission_reviews_append_only() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'submission_reviews is append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS submission_reviews_append_only ON submission_reviews;
CREATE TRIGGER submission_reviews_append_only
    BEFORE UPDATE OR DELETE ON submission_reviews
    FOR EACH ROW EXECUTE FUNCTION submission_reviews_append_only();

CREATE TABLE IF NOT EXISTS idempotency_keys (
    key          TEXT    PRIMARY KEY CHECK (key ~ '^[A-Za-z0-9._:-]{1,128}$'),
    endpoint     TEXT    NOT NULL,
    status       TEXT    NOT NULL CHECK (status IN ('pending', 'completed')),
    status_code  INTEGER NOT NULL,
    response     TEXT    NOT NULL,
    request_hash TEXT    NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
    created_at   BIGINT  NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_idempotency_keys_created_at
    ON idempotency_keys (created_at);

-- Roles. Creating them needs CREATEROLE (DigitalOcean's doadmin has it).
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lcs_app') THEN
        CREATE ROLE lcs_app NOLOGIN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lcs_reviewer') THEN
        CREATE ROLE lcs_reviewer NOLOGIN;
    END IF;
END
$$;

REVOKE ALL ON shop_submissions, submission_reviews, idempotency_keys FROM PUBLIC;

GRANT SELECT, INSERT ON shop_submissions TO lcs_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON idempotency_keys TO lcs_app;

GRANT SELECT, UPDATE (status) ON shop_submissions TO lcs_reviewer;
GRANT SELECT, INSERT ON submission_reviews TO lcs_reviewer;
