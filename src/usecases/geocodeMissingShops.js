/**
 * Fill in coordinates for shops that have none, so they appear in /nearby.
 *
 * Shops reach `coffee_shops` as edits to the committed database, and nothing
 * else geocodes them; run `npm run geocode:missing` after adding shops. The
 * ids that no source can place are returned so the caller can record them in
 * data/ungeocodable-shops.json, which the coordinate-coverage test allows.
 */

/**
 * @param {Object} deps
 * @param {Object} deps.db Database module (all, run)
 * @param {(address: string) => Promise<{latitude: number, longitude: number, source: string}|null>} deps.geocode
 * @returns {() => Promise<{checked: number, updated: {street: number, zip: number}, unresolved: number[]}>}
 */
function makeGeocodeMissingShopsUseCase({ db, geocode }) {
    return async function geocodeMissingShops() {
        const rows = await db.all(
            'SELECT id, address FROM coffee_shops WHERE latitude IS NULL OR longitude IS NULL ORDER BY id',
            [],
            'shops_missing_coordinates',
        );
        const updated = { street: 0, zip: 0 };
        const unresolved = [];

        for (const row of rows) {
            const point = await geocode(row.address);
            if (!point) {
                unresolved.push(row.id);
                continue;
            }
            await db.run(
                'UPDATE coffee_shops SET latitude = ?, longitude = ? WHERE id = ?',
                [point.latitude, point.longitude, row.id],
                'set_shop_coordinates',
            );
            updated[point.source] = (updated[point.source] || 0) + 1;
        }

        return { checked: rows.length, updated, unresolved };
    };
}

module.exports = { makeGeocodeMissingShopsUseCase };
