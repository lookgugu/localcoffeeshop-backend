-- Migration: Remove duplicate listings
-- Created: 2026-10-30
--
-- The seed data holds the same shop several times (401 extra rows in 77
-- groups; "Dua DC Coffee" at 923 15th St NW, Washington, DC appears 38 times),
-- which inflated state counts and repeated shops in listings. Copies agree in
-- every field, so this keeps the lowest id of each (name, address) group, the
-- id the earliest links and coordinates refer to.
--
-- coffee_shops_fts is not touched: no migration creates it, search inner-joins
-- it to coffee_shops (src/usecases/searchShops.js), and ids are AUTOINCREMENT,
-- so a removed row's leftover index entry never surfaces.
--
-- Forward-only, like the 20261017 migrations: no down section.

-- migration:up

DELETE FROM coffee_shops
WHERE id NOT IN (
    SELECT MIN(id) FROM coffee_shops GROUP BY lower(name), address
);
