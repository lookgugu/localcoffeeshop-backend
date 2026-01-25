-- migration:up
-- Add composite indexes for common multi-column query patterns

-- Index for queries filtering by state and ordering by name
-- Improves performance of: SELECT ... WHERE state = ? ORDER BY name
CREATE INDEX IF NOT EXISTS idx_state_name ON coffee_shops(state, name);

-- Index for queries filtering by state and price level
-- Improves performance of: SELECT ... WHERE state = ? AND price_level = ?
CREATE INDEX IF NOT EXISTS idx_state_price ON coffee_shops(state, price_level);

-- Covering index for common search pattern (state + price + name)
-- Improves performance of: SELECT ... WHERE state = ? AND price_level = ? ORDER BY name
CREATE INDEX IF NOT EXISTS idx_state_price_name ON coffee_shops(state, price_level, name);

-- migration:down
-- Remove composite indexes

DROP INDEX IF EXISTS idx_state_name;
DROP INDEX IF EXISTS idx_state_price;
DROP INDEX IF EXISTS idx_state_price_name;
