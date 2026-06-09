/**
 * Nearby coffee shop search use case.
 *
 * Returns shops with stored coordinates ordered by Haversine distance from a
 * visitor-provided point. This is intentionally transport-agnostic so the
 * validation, SQL, and result shaping are testable outside Express.
 */

const { ValidationError } = require('./errors');

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
const SEARCH_RADII_KM = [200, 1000, 5000, 21000];

function parseNumber(value, name) {
    if (value === undefined || value === null || String(value).trim() === '') {
        throw new ValidationError(`${name} is required and must be a number`);
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        throw new ValidationError(`${name} is required and must be a number`);
    }
    return parsed;
}

function validateNearbyInput(input = {}) {
    const lat = parseNumber(input.lat, 'latitude');
    const lon = parseNumber(input.lon ?? input.lng, 'longitude');
    const limit = Math.min(
        Math.max(1, parseInt(String(input.limit ?? DEFAULT_LIMIT), 10) || DEFAULT_LIMIT),
        MAX_LIMIT,
    );

    if (lat < -90 || lat > 90) {
        throw new ValidationError('latitude must be between -90 and 90');
    }
    if (lon < -180 || lon > 180) {
        throw new ValidationError('longitude must be between -180 and 180');
    }

    return { lat, lon, limit };
}

function distanceKm(lat1, lon1, lat2, lon2) {
    const toRad = (degrees) => degrees * Math.PI / 180;
    const earthRadiusKm = 6371;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2
        + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    const clampedA = Math.min(1, Math.max(0, a));
    return 2 * earthRadiusKm * Math.atan2(Math.sqrt(clampedA), Math.sqrt(1 - clampedA));
}

function boundingBox(lat, lon, radiusKm = 200) {
    const earthRadiusKm = 6371;
    const toDeg = (radians) => radians * 180 / Math.PI;
    const latRad = lat * Math.PI / 180;
    const angularRadius = Math.min(Math.PI, radiusKm / earthRadiusKm);
    const minLat = Math.max(-90, lat - toDeg(angularRadius));
    const maxLat = Math.min(90, lat + toDeg(angularRadius));

    if (minLat <= -90 || maxLat >= 90 || angularRadius >= Math.PI) {
        return { minLat, maxLat, minLon: -180, maxLon: 180, crossesDateLine: false, allLongitudes: true };
    }

    const lonDelta = toDeg(Math.asin(Math.min(1, Math.sin(angularRadius) / Math.cos(latRad))));
    let minLon = lon - lonDelta;
    let maxLon = lon + lonDelta;
    let crossesDateLine = false;

    if (minLon < -180) {
        minLon += 360;
        crossesDateLine = true;
    }
    if (maxLon > 180) {
        maxLon -= 360;
        crossesDateLine = true;
    }

    return { minLat, maxLat, minLon, maxLon, crossesDateLine, allLongitudes: false };
}

function longitudeWhereClause(box) {
    return box.crossesDateLine
        ? '(longitude >= ? OR longitude <= ?)'
        : 'longitude BETWEEN ? AND ?';
}

function makeNearbyShopsUseCase({ db }) {
    return async function nearbyShops(input = {}) {
        const { lat, lon, limit } = validateNearbyInput(input);
        const seenIds = new Set();
        const rows = [];
        for (const radiusKm of SEARCH_RADII_KM) {
            const box = boundingBox(lat, lon, radiusKm);
            const longitudeClause = longitudeWhereClause(box);
            const candidates = await db.all(`
                SELECT
                    id,
                    name,
                    address,
                    state,
                    price_level,
                    language_code,
                    latitude,
                    longitude
                FROM coffee_shops
                WHERE latitude BETWEEN ? AND ?
                  AND ${longitudeClause}
            `, [box.minLat, box.maxLat, box.minLon, box.maxLon], 'nearby_shops');

            for (const row of candidates) {
                if (seenIds.has(row.id)) continue;
                const exactDistanceKm = distanceKm(lat, lon, row.latitude, row.longitude);
                if (exactDistanceKm <= radiusKm) {
                    seenIds.add(row.id);
                    rows.push({ ...row, distanceKm: exactDistanceKm });
                }
            }

            if (rows.length >= limit) break;
        }

        const shops = rows
            .map((row) => ({
                id: row.id,
                displayName: {
                    text: row.name,
                    languageCode: row.language_code,
                },
                formattedAddress: row.address,
                priceLevel: row.price_level,
                state: row.state || 'Unknown',
                latitude: row.latitude,
                longitude: row.longitude,
                distanceKm: Math.round(row.distanceKm * 100) / 100,
            }))
            .sort((a, b) => a.distanceKm - b.distanceKm)
            .slice(0, limit);

        return {
            data: shops,
            metadata: {
                count: shops.length,
                limit,
                origin: { lat, lon },
            },
        };
    };
}

module.exports = { makeNearbyShopsUseCase, validateNearbyInput, distanceKm, boundingBox };
