/**
 * States Routes
 *
 * GET /states                    — list all states with shop counts (24h cache)
 * GET /states/:stateCode         — paginated shops for one state (1h cache)
 *
 * Validation runs before `cached(...)` is invoked so 400s never poison the
 * cache.
 */

const { sendError } = require('../lib/responses');

function mountStates(router, { db, cached }) {
    router.get('/states', cached(async () => {
        const query = `
            SELECT
                state as state_code,
                COUNT(*) as shop_count,
                AVG(CASE
                    WHEN price_level = 'PRICE_LEVEL_INEXPENSIVE' THEN 1
                    WHEN price_level = 'PRICE_LEVEL_MODERATE' THEN 2
                    WHEN price_level = 'PRICE_LEVEL_EXPENSIVE' THEN 3
                    ELSE NULL
                END) as avg_price_level
            FROM coffee_shops
            WHERE state IS NOT NULL
            GROUP BY state
            ORDER BY state
        `;
        const rows = await db.all(query, [], 'get_all_states');
        const metadata = { count: rows.length, cached_at: new Date().toISOString() };
        return { data: rows, metadata };
    }, { ttlSeconds: 86400, cacheControlMaxAge: 86400 }));

    const fetchStateShops = cached(async (req) => {
        const stateCode = req.params.stateCode.toUpperCase();
        const page = parseInt(String(req.query.page || 1)) || 1;
        const limit = Math.min(parseInt(String(req.query.limit || 100)) || 100, 500);
        const offset = (page - 1) * limit;

        const countRow = await db.get(
            'SELECT COUNT(*) as total FROM coffee_shops WHERE state = ?',
            [stateCode],
            'count_state_shops',
        );
        const total = countRow.total;
        const totalPages = Math.ceil(total / limit);

        const rows = await db.all(`
            SELECT
                id,
                name,
                address,
                price_level,
                language_code
            FROM coffee_shops
            WHERE state = ?
            ORDER BY name
            LIMIT ? OFFSET ?
        `, [stateCode, limit, offset], 'get_state_shops');

        const shops = rows.map((row) => ({
            id: row.id,
            displayName: {
                text: row.name,
                languageCode: row.language_code,
            },
            formattedAddress: row.address,
            priceLevel: row.price_level,
            state: stateCode,
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
            state: stateCode,
        };
        return { data: shops, metadata };
    }, { ttlSeconds: 3600, cacheControlMaxAge: 3600 });

    router.get('/states/:stateCode', (req, res, next) => {
        const stateCode = req.params.stateCode.toUpperCase();
        const page = parseInt(String(req.query.page || 1)) || 1;
        const limit = parseInt(String(req.query.limit || 100)) || 100;

        if (!/^[A-Z]{2}$/.test(stateCode)) {
            return sendError(res, 400, 'Invalid state code format. Expected 2-letter state abbreviation.');
        }
        if (page < 1) {
            return sendError(res, 400, 'Page number must be >= 1');
        }
        if (limit < 1) {
            return sendError(res, 400, 'Limit must be >= 1');
        }
        return fetchStateShops(req, res, next);
    });
}

module.exports = { mountStates };
