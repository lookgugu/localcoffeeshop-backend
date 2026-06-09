/**
 * Unit tests for nearbyShops use case.
 */

const { makeNearbyShopsUseCase, validateNearbyInput, distanceKm, boundingBox } = require('../../../src/usecases/nearbyShops');
const { ValidationError } = require('../../../src/usecases/errors');

function makeDb(rows = []) {
  return {
    all: jest.fn().mockResolvedValue(rows),
  };
}

describe('nearbyShops use case', () => {
  it('returns coordinate-bearing shops ordered by distance with distance metadata', async () => {
    const db = makeDb([
      {
        id: 1,
        name: 'Far Cafe',
        address: '1 Market St, San Francisco, CA',
        state: 'CA',
        price_level: 'PRICE_LEVEL_EXPENSIVE',
        language_code: 'en',
        latitude: 37.7749,
        longitude: -122.4194,
      },
      {
        id: 2,
        name: 'Close Cafe',
        address: '1 Main St, Concord, MA',
        state: 'MA',
        price_level: 'PRICE_LEVEL_MODERATE',
        language_code: 'en',
        latitude: 42.4604,
        longitude: -71.3489,
      },
    ]);
    const nearbyShops = makeNearbyShopsUseCase({ db });

    const result = await nearbyShops({ lat: 42.4604, lon: -71.3489, limit: 5 });

    expect(result.data.map((shop) => shop.displayName.text)).toEqual(['Close Cafe', 'Far Cafe']);
    expect(result.data[0]).toMatchObject({
      formattedAddress: '1 Main St, Concord, MA',
      state: 'MA',
      latitude: 42.4604,
      longitude: -71.3489,
    });
    expect(result.data[0].distanceKm).toBeLessThan(0.1);
    expect(result.data[1].distanceKm).toBeGreaterThan(4000);
    expect(result.metadata).toMatchObject({ count: 2, limit: 5, origin: { lat: 42.4604, lon: -71.3489 } });
    expect(db.all.mock.calls[0][0]).toMatch(/latitude BETWEEN \? AND \?/);
    expect(db.all.mock.calls[0][0]).toMatch(/longitude BETWEEN \? AND \?/);
    expect(db.all.mock.calls[0][1]).toHaveLength(4);
  });

  it('clamps haversine intermediate values and keeps antipodal distance finite', () => {
    expect(Number.isFinite(distanceKm(0, 0, 0, 180))).toBe(true);
    expect(distanceKm(0, 0, 0, 180)).toBeGreaterThan(20000);
  });

  it('builds a bounded SQL candidate window around the origin', () => {
    const box = boundingBox(42.4604, -71.3489);
    expect(box.minLat).toBeLessThan(42.4604);
    expect(box.maxLat).toBeGreaterThan(42.4604);
    expect(box.minLon).toBeLessThan(-71.3489);
    expect(box.maxLon).toBeGreaterThan(-71.3489);
    expect(box.minLat).toBeGreaterThanOrEqual(-90);
    expect(box.maxLat).toBeLessThanOrEqual(90);
    expect(box.minLon).toBeGreaterThanOrEqual(-180);
    expect(box.maxLon).toBeLessThanOrEqual(180);
    expect(box.crossesDateLine).toBe(false);
  });

  it('uses all longitudes when a radius reaches a pole', () => {
    const box = boundingBox(60, 0, 5000);
    expect(box.allLongitudes).toBe(true);
    expect(box.minLon).toBe(-180);
    expect(box.maxLon).toBe(180);
  });

  it('uses a wrapped longitude predicate when the bounding box crosses the date line', async () => {
    const db = makeDb([]);
    const nearbyShops = makeNearbyShopsUseCase({ db });

    await nearbyShops({ lat: 0, lon: 179.5, limit: 5 });

    expect(db.all.mock.calls[0][0]).toMatch(/longitude >= \? OR longitude <= \?/);
    expect(db.all.mock.calls[0][1][2]).toBeGreaterThan(170);
    expect(db.all.mock.calls[0][1][3]).toBeLessThan(-170);
  });

  it('accepts lng as a longitude alias', () => {
    expect(validateNearbyInput({ lat: '42.1', lng: '-71.2', limit: '10' })).toEqual({
      lat: 42.1,
      lon: -71.2,
      limit: 10,
    });
  });

  it('normalizes malformed limits to the default and clamps bounds', async () => {
    const nearbyShops = makeNearbyShopsUseCase({ db: makeDb([]) });

    await expect(nearbyShops({ lat: 42, lon: -71, limit: '0' })).resolves.toMatchObject({
      metadata: { limit: 25 },
    });
    await expect(nearbyShops({ lat: 42, lon: -71, limit: '-5' })).resolves.toMatchObject({
      metadata: { limit: 1 },
    });
    await expect(nearbyShops({ lat: 42, lon: -71, limit: 'abc' })).resolves.toMatchObject({
      metadata: { limit: 25 },
    });
    await expect(nearbyShops({ lat: 42, lon: -71, limit: '2.9' })).resolves.toMatchObject({
      metadata: { limit: 2 },
    });
    await expect(nearbyShops({ lat: 42, lon: -71, limit: '999' })).resolves.toMatchObject({
      metadata: { limit: 100 },
    });
  });

  it('rejects invalid coordinates', () => {
    expect(() => validateNearbyInput({ lat: 999, lon: -71 })).toThrow(ValidationError);
    expect(() => validateNearbyInput({ lat: 42, lon: -999 })).toThrow(/longitude/i);
    expect(() => validateNearbyInput({ lat: 'x', lon: -71 })).toThrow(/latitude/i);
    expect(() => validateNearbyInput({ lat: 'Infinity', lon: -71 })).toThrow(/latitude/i);
    expect(() => validateNearbyInput({ lat: 'NaN', lon: -71 })).toThrow(/latitude/i);
    expect(() => validateNearbyInput({ lat: '', lon: -71 })).toThrow(/latitude/i);
    expect(() => validateNearbyInput({ lat: '   ', lon: -71 })).toThrow(/latitude/i);
    expect(() => validateNearbyInput({ lat: 42, lon: '' })).toThrow(/longitude/i);
    expect(() => validateNearbyInput({ lat: 42 })).toThrow(/longitude/i);
  });
});
