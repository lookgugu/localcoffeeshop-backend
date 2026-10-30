/**
 * Integration Tests — every shop in the committed database can be found by /nearby
 *
 * /nearby only returns shops with coordinates. A shop added to
 * data/coffee_shops.db without them silently disappears from "Find Near Me",
 * so this fails until `npm run geocode:missing` has been run. Shops that no
 * source can place are listed in data/ungeocodable-shops.json.
 */

const path = require('path');
const sqlite3 = require('sqlite3');

const ROOT = path.join(__dirname, '..', '..');
const ungeocodable = require(path.join(ROOT, 'data', 'ungeocodable-shops.json'));

function missingCoordinateIds() {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(path.join(ROOT, 'data', 'coffee_shops.db'), sqlite3.OPEN_READONLY, (err) => {
      if (err) return reject(err);
      db.all(
        'SELECT id FROM coffee_shops WHERE latitude IS NULL OR longitude IS NULL ORDER BY id',
        (e, rows) => db.close(() => (e ? reject(e) : resolve(rows.map((r) => r.id)))),
      );
    });
  });
}

describe('committed database coordinate coverage', () => {
  it('has coordinates for every shop not listed in data/ungeocodable-shops.json', async () => {
    const allowed = new Set(ungeocodable);
    const missing = (await missingCoordinateIds()).filter((id) => !allowed.has(id));
    if (missing.length) {
      throw new Error(
        `${missing.length} shop(s) have no coordinates and won't appear in Find Near Me `
        + `(ids: ${missing.slice(0, 20).join(', ')}${missing.length > 20 ? ', ...' : ''}). `
        + 'Run `npm run geocode:missing` and commit data/coffee_shops.db and data/ungeocodable-shops.json.',
      );
    }
  });
});
