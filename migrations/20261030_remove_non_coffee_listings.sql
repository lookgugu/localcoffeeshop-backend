-- Migration: Remove listings that are not coffee shops
-- Created: 2026-10-30
--
-- The directory was seeded from place searches that also returned restaurants
-- and bars that happen to serve coffee. This removes listings verified as not
-- being coffee shops. Each row is matched on id AND name AND address, so a
-- reused id can never remove a different shop.
--
-- Removed:
--   27841  Woods Hill Table, 24 Commonwealth Ave, Concord, MA (restaurant/bar)
--
-- coffee_shops_fts is not touched: no migration creates it (fresh databases
-- lack it, and SQLite rejects a statement naming a missing table). Search
-- inner-joins it to coffee_shops (src/usecases/searchShops.js) and ids are
-- AUTOINCREMENT, so a removed listing's leftover index row never surfaces.
--
-- Forward-only, like the 20261017 migrations: no down section, so
-- `migrate.js down` refuses rather than resurrecting removed listings.

-- migration:up

-- One (id, name, address) row per removed listing; keep in sync with the
-- list above and REMOVED_LISTINGS in tests/integration/migrations.test.js.
DELETE FROM coffee_shops
WHERE (id, name, address) IN (VALUES
    (27841, 'Woods Hill Table', '24 Commonwealth Ave, Concord, MA 01742, USA')
);
