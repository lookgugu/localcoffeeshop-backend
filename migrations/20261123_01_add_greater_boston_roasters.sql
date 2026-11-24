-- Migration: Add verified Greater Boston coffee roasters
-- Created: 2026-11-23
--
-- Adds 23 Greater Boston roasters and roaster-cafes from the owner's
-- "Greater Boston Coffee Roasters" sheet. Each one was checked on its Google
-- Maps listing on 2026-11-23: it has a full Massachusetts street address, a
-- coffee category (coffee roastery, coffee shop or cafe), and is not marked
-- closed. Atomic Coffee Roasters HQ (Wholesale Only) is included at the
-- owner's request. Price levels come from the Google listing where it shows a
-- price range ($1-10 inexpensive, $10-20 moderate); otherwise empty, like the
-- seed data.
--
-- Not added: rows already listed (Broadsheet, Cafenation, Recreo, Saxonville
-- Mills, Jaho x6); rows Google lists with no street address (service-area
-- businesses); The VU (Google category: video store); PEAK Coffee and Tea
-- (Google category: tea store); Beacon Hill Coffee Roasters (Google: "This
-- place may be closed"); Farmer Brothers (national company).
--
-- Coordinates are the centroid of each address's ZIP code from
-- data/zip-centroids.csv, the same fallback src/lib/geocoder.js uses, so each
-- shop appears in Find Near Me.
--
-- Each row is skipped if a listing with the same name (any case) and address
-- already exists. Rows are only added to a database that holds the seeded
-- Massachusetts listings (source_file 'state_ma.json'), so fresh and test
-- databases built from the schema stay empty. New rows are added to
-- coffee_shops_fts so search finds them, unless an insert trigger already
-- keeps the index in sync (as in the test schema); the IF NOT EXISTS only
-- matters on a database built from the base schema, which has no index yet.
--
-- Forward-only, like the 20261030 and 20261118 migrations: no down section.

-- migration:up

INSERT INTO coffee_shops (name, address, price_level, language_code, source_file, created_at, state, latitude, longitude)
SELECT v.column1, v.column2, v.column3, 'en', 'greater_boston_roasters_2026-11.sheet', '2026-11-23 00:00:00', 'MA', v.column4, v.column5
FROM (VALUES
    ('Boston''s Best Coffee Roasters', 'Turnpike Ave, South Easton, MA 02375, USA', '', 42.00569, -71.07804),
    ('Del''s Coffee Roasters', '100 Felton St Ste 105, Waltham, MA 02453, USA', '', 42.36868, -71.24110),
    ('Alta Coffee Roasters', '805 Massachusetts Ave, Arlington, MA 02476, USA', '', 42.41648, -71.17349),
    ('Fazenda Coffee Roasters', '95 Commerce Way, Dedham, MA 02026, USA', '', 42.24687, -71.17946),
    ('George Howell Coffee Co', '312 School St, Acton, MA 01720, USA', '', 42.48395, -71.43850),
    ('Hogan Brothers Coffee Roasters', '82 Herbert St #2, Framingham, MA 01702, USA', '', 42.28238, -71.43662),
    ('Atomic Coffee Roasters (Roastery)', '5B Webster St, Peabody, MA 01960, USA', '', 42.53431, -70.96944),
    ('Atomic Coffee Roasters HQ (Wholesale Only)', '107 Water St, Danvers, MA 01923, USA', '', 42.57417, -70.95052),
    ('Bento Cafe', '65 Industrial Park Rd, Hingham, MA 02043, USA', '', 42.21610, -70.88127),
    ('Cicero''s Roast', '9 Glenwood Ave, Foxborough, MA 02035, USA', '', 42.06134, -71.24580),
    ('Backbeat Coffee Roasters', '31A Park St, Beverly, MA 01915, USA', '', 42.57044, -70.86769),
    ('Volcanic Cult Coffee Roaster', '165 Main St, Cambridge, MA 02142, USA', '', 42.36250, -71.08096),
    ('Charlestown Coffee', '32 Cambridge St, Charlestown, MA 02129, USA', '', 42.37966, -71.06149),
    ('Flor do Brasil', '130 Bishop Allen Dr Fl 5, Cambridge, MA 02139, USA', '', 42.36239, -71.10234),
    ('Common Ground Coffee Roasters at Pioneer', '1760 Revere Beach Pkwy #520, Everett, MA 02149, USA', 'PRICE_LEVEL_MODERATE', 42.40594, -71.05465),
    ('Common Ground Coffee Roasters', '1727 Revere Beach Pkwy, Everett, MA 02149, USA', 'PRICE_LEVEL_MODERATE', 42.40594, -71.05465),
    ('Redeye Coffee Roasters', '3 Otis St, Hingham, MA 02043, USA', 'PRICE_LEVEL_INEXPENSIVE', 42.21610, -70.88127),
    ('SlackTide Coffee Roasters', '283 Columbia Rd, Hanover, MA 02339, USA', 'PRICE_LEVEL_MODERATE', 42.12296, -70.85631),
    ('For Five Coffee Roasters', 'Dana Building First Floor, Jimmy Fund Way, Boston, MA 02215, USA', 'PRICE_LEVEL_INEXPENSIVE', 42.34763, -71.10308),
    ('Happy Beans Roaster', '9 Glen St, Framingham, MA 01702, USA', '', 42.28238, -71.43662),
    ('ACK Roasters', '34 Old Forge Rd, Scituate, MA 02066, USA', '', 42.20227, -70.75818),
    ('4A Coffee Roasters', '30 Riverdale Ave, Newton, MA 02458, USA', '', 42.35359, -71.18819),
    ('Brewgold Cafe & Artisan Roastery', '160 Broadway, Everett, MA 02149, USA', '', 42.40594, -71.05465)
) AS v
WHERE NOT EXISTS (
    SELECT 1 FROM coffee_shops c WHERE lower(c.name) = lower(v.column1) AND c.address = v.column2
)
AND EXISTS (SELECT 1 FROM coffee_shops WHERE source_file = 'state_ma.json');

CREATE VIRTUAL TABLE IF NOT EXISTS coffee_shops_fts USING fts5(name, address, content='coffee_shops', content_rowid='id');

INSERT INTO coffee_shops_fts (rowid, name, address)
SELECT id, name, address FROM coffee_shops WHERE source_file = 'greater_boston_roasters_2026-11.sheet'
AND NOT EXISTS (SELECT 1 FROM sqlite_master WHERE type = 'trigger' AND name = 'coffee_shops_ai');
