#!/usr/bin/env node

/**
 * Import latitude/longitude values for existing coffee shops from CSV.
 *
 * Usage:
 *   DB_PATH=./data/coffee_shops.db node scripts/import-coordinates.js coordinates.csv
 *
 * CSV columns:
 *   id,latitude,longitude
 *
 * The script intentionally updates by coffee_shops.id so imports are stable and
 * do not depend on fuzzy address matching. Rows with invalid/missing coordinates
 * are skipped and reported.
 */

const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();

const dbPath = process.env.DB_PATH || './coffee_shops.db';
const csvPath = process.argv[2];

if (!csvPath) {
    console.error('Usage: DB_PATH=./data/coffee_shops.db node scripts/import-coordinates.js coordinates.csv');
    process.exit(1);
}

function parseCsv(text) {
    const rows = [];
    let field = '';
    let row = [];
    let inQuotes = false;

    for (let i = 0; i < text.length; i += 1) {
        const ch = text[i];
        const next = text[i + 1];

        if (ch === '"') {
            if (inQuotes && next === '"') {
                field += '"';
                i += 1;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (ch === ',' && !inQuotes) {
            row.push(field);
            field = '';
        } else if ((ch === '\n' || ch === '\r') && !inQuotes) {
            if (ch === '\r' && next === '\n') i += 1;
            row.push(field);
            if (row.some((value) => value.trim() !== '')) rows.push(row);
            field = '';
            row = [];
        } else {
            field += ch;
        }
    }

    row.push(field);
    if (row.some((value) => value.trim() !== '')) rows.push(row);
    return rows;
}

function parseId(value) {
    const text = String(value ?? '').trim();
    if (!/^\d+$/.test(text)) return null;
    const parsed = Number(text);
    if (!Number.isSafeInteger(parsed) || parsed < 1) return null;
    return parsed;
}

function parseCoordinate(value, min, max) {
    if (value === undefined || value === null || String(value).trim() === '') return null;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < min || parsed > max) return null;
    return parsed;
}

function run(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
            if (err) reject(err);
            else resolve(this);
        });
    });
}

async function main() {
    const text = fs.readFileSync(csvPath, 'utf8');
    const rows = parseCsv(text);
    if (rows.length < 2) throw new Error('CSV must include a header and at least one data row');

    const header = rows[0].map((value) => value.trim().toLowerCase());
    const idIndex = header.indexOf('id');
    const latIndex = header.indexOf('latitude');
    const lonIndex = header.indexOf('longitude');

    if (idIndex === -1 || latIndex === -1 || lonIndex === -1) {
        throw new Error('CSV header must include id,latitude,longitude');
    }

    const db = new sqlite3.Database(dbPath);
    let updated = 0;
    let skipped = 0;

    await run(db, 'BEGIN TRANSACTION');
    try {
        for (const row of rows.slice(1)) {
            const id = parseId(row[idIndex]);
            const latitude = parseCoordinate(row[latIndex], -90, 90);
            const longitude = parseCoordinate(row[lonIndex], -180, 180);

            if (!Number.isInteger(id) || latitude === null || longitude === null) {
                skipped += 1;
                continue;
            }

            const result = await run(
                db,
                'UPDATE coffee_shops SET latitude = ?, longitude = ? WHERE id = ?',
                [latitude, longitude, id],
            );
            if (result.changes > 0) updated += result.changes;
            else skipped += 1;
        }
        await run(db, 'COMMIT');
    } catch (err) {
        await run(db, 'ROLLBACK');
        throw err;
    } finally {
        db.close();
    }

    console.log(`Coordinate import complete: updated=${updated} skipped=${skipped}`);
}

main().catch((err) => {
    console.error(`Coordinate import failed: ${err.message}`);
    process.exit(1);
});
