-- Add geographic coordinates for nearby coffee shop search.

-- migration:up
ALTER TABLE coffee_shops ADD COLUMN latitude REAL;
ALTER TABLE coffee_shops ADD COLUMN longitude REAL;
CREATE INDEX IF NOT EXISTS idx_coffee_shops_coordinates ON coffee_shops(latitude, longitude)
  WHERE latitude IS NOT NULL AND longitude IS NOT NULL;

-- migration:down
DROP INDEX IF EXISTS idx_coffee_shops_coordinates;
ALTER TABLE coffee_shops DROP COLUMN longitude;
ALTER TABLE coffee_shops DROP COLUMN latitude;
