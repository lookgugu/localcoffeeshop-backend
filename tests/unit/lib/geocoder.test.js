/**
 * Unit tests for the street-then-ZIP geocoder. No network: fetch is injected.
 */

const { makeGeocoder, extractZip, loadZipCentroids } = require('../../../src/lib/geocoder');

const zipCentroids = new Map([['00716', { latitude: 18.0, longitude: -66.6 }]]);

function censusResponse(matches) {
  return { ok: true, json: async () => ({ result: { addressMatches: matches } }) };
}

describe('extractZip', () => {
  it.each([
    ['121 Avenida Hostos, Ponce, 00716, Puerto Rico', '00716'],
    ['12345 Main St, Austin, TX 78701-1234, USA', '78701'],
    ['12345 Main St, Austin', null],
    ['1112 Chem. du Golf, La Malbaie, QC G5A 2W5, Canada', null],
    ['', null],
  ])('%s -> %s', (address, zip) => {
    expect(extractZip(address)).toBe(zip);
  });
});

describe('geocoder', () => {
  it('uses the Census street match (x is longitude, y is latitude)', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(censusResponse([{ coordinates: { x: -71.06, y: 42.36 } }]));
    const geocode = makeGeocoder({ fetchImpl, zipCentroids });

    await expect(geocode('1 Tremont St, Boston, MA 02108')).resolves
      .toEqual({ latitude: 42.36, longitude: -71.06, source: 'street' });
    const url = fetchImpl.mock.calls[0][0];
    expect(url.searchParams.get('address')).toBe('1 Tremont St, Boston, MA 02108');
    expect(url.searchParams.get('benchmark')).toBe('Public_AR_Current');
  });

  it('falls back to the ZIP centroid when the street address does not match', async () => {
    const geocode = makeGeocoder({ fetchImpl: jest.fn().mockResolvedValue(censusResponse([])), zipCentroids });
    await expect(geocode('121 Avenida Hostos, Ponce, 00716, Puerto Rico')).resolves
      .toEqual({ latitude: 18.0, longitude: -66.6, source: 'zip' });
  });

  it('falls back to the ZIP centroid when Census is down', async () => {
    const geocode = makeGeocoder({ fetchImpl: jest.fn().mockRejectedValue(new Error('ECONNRESET')), zipCentroids });
    await expect(geocode('121 Avenida Hostos, Ponce, 00716, Puerto Rico')).resolves
      .toMatchObject({ source: 'zip' });
  });

  it('returns null when neither source can place the address', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ ok: false, json: async () => ({}) });
    const geocode = makeGeocoder({ fetchImpl, zipCentroids });
    await expect(geocode('JXJ8+7M, Mammoth Lakes, CA, USA')).resolves.toBeNull();
    await expect(geocode('')).resolves.toBeNull();
  });

  it('ships ZIP centroids for the US and Puerto Rico', () => {
    const centroids = loadZipCentroids();
    expect(centroids.size).toBeGreaterThan(30000);
    expect(centroids.get('02108')).toEqual({ latitude: expect.closeTo(42.36, 1), longitude: expect.closeTo(-71.07, 1) });
    expect(centroids.has('00716')).toBe(true);
  });
});
