/**
 * Unit tests for geocodeMissingShops use case.
 */

const { makeGeocodeMissingShopsUseCase } = require('../../../src/usecases/geocodeMissingShops');

describe('geocodeMissingShops use case', () => {
  it('stores coordinates for shops it can place and reports the rest', async () => {
    const db = {
      all: jest.fn().mockResolvedValue([
        { id: 1, address: '1 Tremont St, Boston, MA 02108' },
        { id: 2, address: 'Ponce, 00716, Puerto Rico' },
        { id: 3, address: 'JXJ8+7M, Mammoth Lakes, CA, USA' },
      ]),
      run: jest.fn().mockResolvedValue({ changes: 1 }),
    };
    const geocode = jest.fn(async (address) => {
      if (address.includes('Boston')) return { latitude: 42.36, longitude: -71.06, source: 'street' };
      if (address.includes('Ponce')) return { latitude: 18.0, longitude: -66.6, source: 'zip' };
      return null;
    });

    const result = await makeGeocodeMissingShopsUseCase({ db, geocode })();

    expect(db.all.mock.calls[0][0]).toMatch(/latitude IS NULL OR longitude IS NULL/);
    expect(db.run.mock.calls.map((c) => c[1])).toEqual([[42.36, -71.06, 1], [18.0, -66.6, 2]]);
    expect(result).toEqual({ checked: 3, updated: { street: 1, zip: 1 }, unresolved: [3] });
  });
});
