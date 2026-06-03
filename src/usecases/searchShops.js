/**
 * Search Shops Use Case
 *
 * Owns validation, FTS query construction, parameter binding, and result
 * shaping for /api/v1/search. Calls `db.all` / `db.get` directly per ADR-0001
 * (no repository port).
 *
 * Pure async function of `{ db }` + query inputs. Transport-agnostic.
 */

const { ValidationError } = require('./errors');

const VALID_PRICE_LEVELS = new Set([
    'PRICE_LEVEL_INEXPENSIVE',
    'PRICE_LEVEL_MODERATE',
    'PRICE_LEVEL_EXPENSIVE',
]);

const MAX_PAGE = 1000;
const MAX_LIMIT = 500;
const MAX_SEARCH_TERM_LENGTH = 100;
const SEARCH_TERM_PATTERN = /^[a-zA-Z0-9\s\-'.,&]+$/;
const STATE_CODE_PATTERN = /^[A-Z]{2}$/;

/**
 * Build a search-shops use case bound to a `db` dependency.
 *
 * @param {{ db: Object }} deps
 * @returns {(input: Object) => Promise<{data: Array, metadata: Object}>}
 */
function makeSearchShopsUseCase({ db }) {
    return async function searchShops(input = {}) {
        const searchTerm = typeof input.searchTerm === 'string' ? input.searchTerm : '';
        const state = typeof input.state === 'string' ? input.state : '';
        const price = typeof input.price === 'string' ? input.price : '';
        const page = Math.max(1, parseInt(String(input.page ?? 1), 10) || 1);
        const limit = Math.min(
            Math.max(1, parseInt(String(input.limit ?? 100), 10) || 100),
            MAX_LIMIT,
        );

        // Validation — throw ValidationError; transport maps to 400.
        if (page > MAX_PAGE) {
            throw new ValidationError(`Page number too high. Maximum page is ${MAX_PAGE}.`);
        }
        if (state && !STATE_CODE_PATTERN.test(state.toUpperCase())) {
            throw new ValidationError('Invalid state code format. Expected 2-letter state abbreviation.');
        }
        if (price && !VALID_PRICE_LEVELS.has(price)) {
            throw new ValidationError('Invalid price level. Must be one of: PRICE_LEVEL_INEXPENSIVE, PRICE_LEVEL_MODERATE, PRICE_LEVEL_EXPENSIVE');
        }
        if (searchTerm && searchTerm.length > MAX_SEARCH_TERM_LENGTH) {
            throw new ValidationError('Search term too long. Maximum 100 characters.');
        }
        if (searchTerm && !SEARCH_TERM_PATTERN.test(searchTerm)) {
            throw new ValidationError('Search term contains invalid characters. Only letters, numbers, spaces, and common punctuation allowed.');
        }

        const offset = (page - 1) * limit;

        let whereClause = 'WHERE 1=1';
        let fromClause = 'coffee_shops';
        const params = [];

        if (searchTerm) {
            fromClause = 'coffee_shops INNER JOIN coffee_shops_fts ON coffee_shops.id = coffee_shops_fts.rowid';
            whereClause += ' AND coffee_shops_fts MATCH ?';
            // Preserve exact original behaviour — don't filter empty tokens.
            // Whitespace-only terms produce `""* ""*` which SQLite FTS5
            // tolerates (matches nothing) rather than throwing.
            const ftsSearchTerm = searchTerm
                .replace(/['"]/g, '')
                .split(/\s+/)
                .map((t) => `"${t}"*`)
                .join(' ');
            params.push(ftsSearchTerm);
        }

        if (state) {
            whereClause += ' AND coffee_shops.state = ?';
            params.push(state.toUpperCase());
        }

        if (price) {
            whereClause += ' AND coffee_shops.price_level = ?';
            params.push(price);
        }

        const countQuery = `SELECT COUNT(*) as total FROM ${fromClause} ${whereClause}`;
        const countRow = await db.get(countQuery, params, 'count_search_results');
        const total = countRow.total;
        const totalPages = Math.ceil(total / limit);

        const query = `
            SELECT
                coffee_shops.id,
                coffee_shops.name,
                coffee_shops.address,
                coffee_shops.state,
                coffee_shops.price_level,
                coffee_shops.language_code
            FROM ${fromClause}
            ${whereClause}
            ORDER BY coffee_shops.name
            LIMIT ? OFFSET ?
        `;
        const rows = await db.all(query, [...params, limit, offset], 'search_shops');

        const shops = rows.map((row) => ({
            id: row.id,
            displayName: {
                text: row.name,
                languageCode: row.language_code,
            },
            formattedAddress: row.address,
            priceLevel: row.price_level,
            state: row.state || 'Unknown',
        }));

        const metadata = {
            pagination: {
                page,
                limit,
                total,
                totalPages,
                hasNext: page < totalPages,
                hasPrev: page > 1,
            },
            filters: { searchTerm, state, price },
        };

        return { data: shops, metadata };
    };
}

module.exports = { makeSearchShopsUseCase };
