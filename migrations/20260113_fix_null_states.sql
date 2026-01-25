-- Migration: Fix NULL state values
-- Created: 2026-01-13
-- Cleans up state column by:
-- 1. Setting state='DC' for Washington DC addresses
-- 2. Setting state='PR' for Puerto Rico addresses
-- 3. Removing non-US entries (Canada, UK, etc.)

-- migration:up

-- Update Washington DC entries
UPDATE coffee_shops
SET state = 'DC'
WHERE state IS NULL
AND (address LIKE '%, DC %' OR address LIKE '%, D.C. %' OR address LIKE '%Washington, DC%');

-- Update Puerto Rico entries
UPDATE coffee_shops
SET state = 'PR'
WHERE state IS NULL
AND (address LIKE '%Puerto Rico%' OR address LIKE '%, PR %');

-- Delete non-US entries (Canada)
DELETE FROM coffee_shops
WHERE state IS NULL
AND address LIKE '%, Canada';

-- Delete non-US entries (UK)
DELETE FROM coffee_shops
WHERE state IS NULL
AND address LIKE '%, UK';

-- Delete non-US entries (other countries)
DELETE FROM coffee_shops
WHERE state IS NULL
AND (
    address LIKE '%, Greece'
    OR address LIKE '%, Ireland'
    OR address LIKE '%, Denmark'
    OR address LIKE '%, Mexico'
    OR address LIKE '%, Germany'
    OR address LIKE '%, France'
    OR address LIKE '%, Spain'
    OR address LIKE '%, Italy'
);

-- migration:down

-- Note: This is a data cleanup migration
-- Rolling back would require restoring deleted data from backup
-- The down migration only reverts the state updates, not deletions

UPDATE coffee_shops
SET state = NULL
WHERE state = 'DC'
AND (address LIKE '%, DC %' OR address LIKE '%, D.C. %' OR address LIKE '%Washington, DC%');

UPDATE coffee_shops
SET state = NULL
WHERE state = 'PR'
AND (address LIKE '%Puerto Rico%' OR address LIKE '%, PR %');
