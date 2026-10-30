#!/usr/bin/env node

/**
 * Geocode every shop that has no coordinates, then record the ones that
 * couldn't be placed in data/ungeocodable-shops.json.
 *
 * Usage:
 *   DB_PATH=./data/coffee_shops.db npm run geocode:missing
 *
 * Run it after adding shops to the database, and commit both the database
 * and the JSON file. tests/integration/coordinate-coverage.test.js fails
 * when a shop has no coordinates and isn't listed in that file.
 */

const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3');
const { makeGeocoder } = require('../src/lib/geocoder');
const { makeGeocodeMissingShopsUseCase } = require('../src/usecases/geocodeMissingShops');

const dbPath = process.env.DB_PATH || './data/coffee_shops.db';
const UNGEOCODABLE_PATH = path.join(__dirname, '..', 'data', 'ungeocodable-shops.json');

function open(file) {
    const raw = new sqlite3.Database(file);
    return {
        all: (sql, params) => new Promise((resolve, reject) => raw.all(sql, params, (e, r) => (e ? reject(e) : resolve(r)))),
        run: (sql, params) => new Promise((resolve, reject) => raw.run(sql, params, (e) => (e ? reject(e) : resolve()))),
        close: () => new Promise((resolve) => raw.close(() => resolve())),
    };
}

async function main() {
    const db = open(dbPath);
    try {
        const geocodeMissingShops = makeGeocodeMissingShopsUseCase({ db, geocode: makeGeocoder() });
        const { checked, updated, unresolved } = await geocodeMissingShops();
        fs.writeFileSync(UNGEOCODABLE_PATH, `${JSON.stringify(unresolved, null, 2)}\n`);
        console.log(
            `Geocoding complete: checked=${checked} street=${updated.street} zip=${updated.zip} unresolved=${unresolved.length}`,
        );
    } finally {
        await db.close();
    }
}

main().catch((err) => {
    console.error(`Geocoding failed: ${err.message}`);
    process.exit(1);
});
