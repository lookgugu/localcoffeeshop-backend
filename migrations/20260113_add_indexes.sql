-- Migration: Add missing database indexes
-- Created: 2026-01-13
-- Adds indexes for:
-- 1. created_at column for sorting by creation date
-- 2. Covering index for search queries (name, address, state)

-- migration:up

-- Index on created_at for sorting by newest shops
CREATE INDEX IF NOT EXISTS idx_created_at ON coffee_shops(created_at DESC);

-- Covering index for search queries that look up name and address
CREATE INDEX IF NOT EXISTS idx_search_covering ON coffee_shops(name, address, state, price_level);

-- migration:down

DROP INDEX IF EXISTS idx_created_at;
DROP INDEX IF EXISTS idx_search_covering;
