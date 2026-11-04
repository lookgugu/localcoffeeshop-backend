/**
 * Address geocoding for shops that have no coordinates yet.
 *
 * Tries the US Census one-line street geocoder first, then falls back to the
 * centroid of the address's 5-digit ZIP code (Census 2024 ZCTA gazetteer,
 * shipped as data/zip-centroids.csv). A ZIP centroid is only a few miles off,
 * which is good enough for "Find Near Me". Both sources are free and keyless.
 *
 * Census will match a street in another town or state when the given one has
 * no such address ("15 Church St, Liberty Corner, NJ" -> Liberty, NY), so a
 * street match is only accepted when its state agrees with the address and
 * its ZIP or city does too.
 *
 * Network access is injected (`fetchImpl`) so tests never leave the process.
 */

const fs = require('fs');
const path = require('path');

const CENSUS_URL = 'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress';
const ZIP_CENTROIDS_PATH = path.join(__dirname, '..', '..', 'data', 'zip-centroids.csv');
// A 5-digit ZIP (optional +4) after a comma or a 2-letter state code, so a
// street number like "12345 Main St" is never mistaken for one.
const ZIP_PATTERN = /(?:,\s*|\b[A-Z]{2}\s+)(\d{5})(?:-\d{4})?\b/g;

function loadZipCentroids(file = ZIP_CENTROIDS_PATH) {
    const centroids = new Map();
    const lines = fs.readFileSync(file, 'utf8').split('\n').slice(1);
    for (const line of lines) {
        const [zip, lat, lon] = line.split(',');
        if (zip && lat && lon) centroids.set(zip, { latitude: Number(lat), longitude: Number(lon) });
    }
    return centroids;
}

function extractZip(address) {
    const matches = [...String(address || '').matchAll(ZIP_PATTERN)];
    return matches.length ? matches[matches.length - 1][1] : null;
}

const normalizeCity = (city) => String(city || '').toUpperCase().replace(/[^A-Z0-9 ]/g, '').replace(/\s+/g, ' ').trim();

/**
 * The state, ZIP and city an address names, or null if it doesn't say.
 * Handles "..., City, ST 12345, USA" and "..., City, 00716, Puerto Rico".
 */
function parseLocality(address) {
    const parts = String(address || '').split(',').map((p) => p.trim()).filter(Boolean);
    if (/^(USA|United States)$/i.test(parts[parts.length - 1])) parts.pop();
    if (/^Puerto Rico$/i.test(parts[parts.length - 1]) && /^\d{5}$/.test(parts[parts.length - 2] || '')) {
        return { state: 'PR', zip: parts[parts.length - 2], city: normalizeCity(parts[parts.length - 3]) };
    }
    const last = /^([A-Z]{2})\s+(\d{5})(?:-\d{4})?$/.exec(parts[parts.length - 1] || '');
    if (!last) return null;
    return { state: last[1], zip: last[2], city: normalizeCity(parts[parts.length - 2]) };
}

/** Whether a Census match is in the place the address names. */
function matchesLocality(components, locality) {
    if (!components || components.state !== locality.state) return false;
    return components.zip === locality.zip || normalizeCity(components.city) === locality.city;
}

function isValidPoint(lat, lon) {
    return Number.isFinite(lat) && Number.isFinite(lon)
        && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
}

/**
 * @param {Object} [deps]
 * @param {typeof fetch} [deps.fetchImpl]
 * @param {Map<string, {latitude: number, longitude: number}>} [deps.zipCentroids]
 * @param {number} [deps.timeoutMs]
 * @returns {(address: string) => Promise<{latitude: number, longitude: number, source: 'street'|'zip'}|null>}
 */
function makeGeocoder({ fetchImpl = fetch, zipCentroids = loadZipCentroids(), timeoutMs = 15000 } = {}) {
    async function census(address) {
        const url = new URL(CENSUS_URL);
        url.searchParams.set('address', address);
        url.searchParams.set('benchmark', 'Public_AR_Current');
        url.searchParams.set('format', 'json');
        try {
            const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
            if (!res.ok) return null;
            const body = await res.json();
            const locality = parseLocality(address);
            if (!locality) return null;
            const match = (body?.result?.addressMatches || [])
                .find((m) => matchesLocality(m.addressComponents, locality))?.coordinates;
            // Census returns x = longitude, y = latitude.
            if (match && isValidPoint(match.y, match.x)) {
                return { latitude: match.y, longitude: match.x, source: 'street' };
            }
        } catch {
            // Network errors and timeouts fall through to the ZIP centroid.
        }
        return null;
    }

    return async function geocode(address) {
        if (!address || !String(address).trim()) return null;
        const street = await census(String(address));
        if (street) return street;
        const zip = extractZip(address);
        const centroid = zip && zipCentroids.get(zip);
        return centroid ? { ...centroid, source: 'zip' } : null;
    };
}

module.exports = { makeGeocoder, loadZipCentroids, extractZip, parseLocality };
