/**
 * Unit Tests for searchShops Use Case
 *
 * Exercises validation, FTS sanitisation, and result shaping with no
 * Express and no real SQLite — the `db` dependency is a pair of jest mocks.
 */

const { makeSearchShopsUseCase } = require('../../../src/usecases/searchShops');
const { ValidationError } = require('../../../src/usecases/errors');

function makeDb({ countRow = { total: 0 }, rows = [] } = {}) {
  return {
    get: jest.fn().mockResolvedValue(countRow),
    all: jest.fn().mockResolvedValue(rows),
  };
}

describe('searchShops use case', () => {
  describe('validation', () => {
    it('rejects page numbers > 1000', async () => {
      const searchShops = makeSearchShopsUseCase({ db: makeDb() });
      await expect(searchShops({ page: 1001 })).rejects.toBeInstanceOf(ValidationError);
    });

    it('rejects invalid state codes', async () => {
      const searchShops = makeSearchShopsUseCase({ db: makeDb() });
      await expect(searchShops({ state: 'California' })).rejects.toThrow(/Invalid state code/i);
    });

    it('accepts lowercase state codes', async () => {
      const searchShops = makeSearchShopsUseCase({ db: makeDb() });
      await expect(searchShops({ state: 'ca' })).resolves.toBeDefined();
    });

    it('rejects unknown price levels', async () => {
      const searchShops = makeSearchShopsUseCase({ db: makeDb() });
      await expect(searchShops({ price: 'CHEAP' })).rejects.toThrow(/Invalid price/i);
    });

    it('rejects search terms longer than 100 characters', async () => {
      const searchShops = makeSearchShopsUseCase({ db: makeDb() });
      await expect(searchShops({ searchTerm: 'a'.repeat(101) })).rejects.toThrow(/too long/i);
    });

    it('rejects search terms with invalid characters', async () => {
      const searchShops = makeSearchShopsUseCase({ db: makeDb() });
      await expect(searchShops({ searchTerm: 'foo<script>' })).rejects.toThrow(/invalid characters/i);
    });

    it('allows search terms with permitted punctuation', async () => {
      const searchShops = makeSearchShopsUseCase({ db: makeDb() });
      await expect(searchShops({ searchTerm: "Mike's Coffee & Co." })).resolves.toBeDefined();
    });
  });

  describe('FTS sanitisation', () => {
    it('strips quotes and tokenises with prefix matching', async () => {
      const db = makeDb();
      const searchShops = makeSearchShopsUseCase({ db });
      await searchShops({ searchTerm: 'blue bottle' });

      // First param of count query is the FTS expression.
      const ftsExpr = db.get.mock.calls[0][1][0];
      expect(ftsExpr).toBe('"blue"* "bottle"*');
    });

    it('strips double-quotes from search term before tokenising', async () => {
      const db = makeDb();
      const searchShops = makeSearchShopsUseCase({ db });
      // The search-term validator rejects literal " characters, but the
      // sanitiser still runs first against any quotes that snuck through
      // — exercise the sanitiser via an apostrophe (allowed char).
      await searchShops({ searchTerm: "Mike's" });
      const ftsExpr = db.get.mock.calls[0][1][0];
      // Apostrophe stripped by replace(/['"]/g, '')
      expect(ftsExpr).toBe('"Mikes"*');
    });

    it('does not add FTS join when searchTerm is empty', async () => {
      const db = makeDb();
      const searchShops = makeSearchShopsUseCase({ db });
      await searchShops({ state: 'CA' });

      const countSql = db.get.mock.calls[0][0];
      expect(countSql).not.toMatch(/coffee_shops_fts/);
    });
  });

  describe('SQL composition', () => {
    it('binds state code uppercased and price as-is', async () => {
      const db = makeDb();
      const searchShops = makeSearchShopsUseCase({ db });
      await searchShops({ searchTerm: 'coffee', state: 'ny', price: 'PRICE_LEVEL_MODERATE' });

      const countParams = db.get.mock.calls[0][1];
      expect(countParams).toEqual(['"coffee"*', 'NY', 'PRICE_LEVEL_MODERATE']);
    });

    it('appends limit and offset to the data query', async () => {
      const db = makeDb();
      const searchShops = makeSearchShopsUseCase({ db });
      await searchShops({ page: 2, limit: 25 });

      const allParams = db.all.mock.calls[0][1];
      // params are [...filterParams, limit, offset]
      expect(allParams).toEqual([25, 25]); // limit=25, offset=(2-1)*25
    });

    it('caps limit at 500', async () => {
      const db = makeDb();
      const searchShops = makeSearchShopsUseCase({ db });
      const result = await searchShops({ limit: 9999 });
      expect(result.metadata.pagination.limit).toBe(500);
    });
  });

  describe('response shape', () => {
    it('returns { data, metadata } with pagination and filters', async () => {
      const rows = [{
        id: 1,
        name: 'Blue Bottle',
        address: '66 Mint St',
        state: 'CA',
        price_level: 'PRICE_LEVEL_MODERATE',
        language_code: 'en',
      }];
      const db = makeDb({ countRow: { total: 1 }, rows });
      const searchShops = makeSearchShopsUseCase({ db });

      const result = await searchShops({ searchTerm: 'blue', state: 'CA' });
      expect(result.data).toHaveLength(1);
      expect(result.data[0]).toEqual({
        id: 1,
        displayName: { text: 'Blue Bottle', languageCode: 'en' },
        formattedAddress: '66 Mint St',
        priceLevel: 'PRICE_LEVEL_MODERATE',
        state: 'CA',
      });
      expect(result.metadata).toEqual({
        pagination: {
          page: 1,
          limit: 100,
          total: 1,
          totalPages: 1,
          hasNext: false,
          hasPrev: false,
        },
        filters: { searchTerm: 'blue', state: 'CA', price: '' },
      });
    });

    it('defaults state to "Unknown" when row.state is null', async () => {
      const rows = [{
        id: 1,
        name: 'X',
        address: 'Y',
        state: null,
        price_level: null,
        language_code: 'en',
      }];
      const db = makeDb({ countRow: { total: 1 }, rows });
      const searchShops = makeSearchShopsUseCase({ db });
      const result = await searchShops({});
      expect(result.data[0].state).toBe('Unknown');
    });

    it('computes hasNext/hasPrev correctly for middle pages', async () => {
      const db = makeDb({ countRow: { total: 250 }, rows: [] });
      const searchShops = makeSearchShopsUseCase({ db });
      const result = await searchShops({ page: 2, limit: 100 });
      expect(result.metadata.pagination).toMatchObject({
        page: 2,
        totalPages: 3,
        hasNext: true,
        hasPrev: true,
      });
    });
  });
});
