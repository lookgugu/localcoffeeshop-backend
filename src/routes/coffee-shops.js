/**
 * Coffee Shops Write Routes
 *
 * POST /coffee-shops        — create a new shop
 * PUT  /coffee-shops/:id    — update an existing shop
 *
 * Both endpoints sit behind `withIdempotency`, so a retried request that
 * carries the same `Idempotency-Key` header replays the original response
 * rather than inserting/updating again.
 *
 * Body shape mirrors what the frontend `public/submit.js` sends:
 *   { shop: { displayName: { text }, formattedAddress, state,
 *             priceLevel, phoneNumber?, website?, description? } }
 *
 * (Only the fields the `coffee_shops` table actually persists are written —
 * the schema today is name/address/price_level/state/language_code/source_file.
 * The extra fields are accepted but currently ignored, matching the existing
 * table.)
 */

const { asyncHandler } = require('../lib/async-handler');
const { sendSuccess } = require('../lib/responses');
const { withIdempotency } = require('../lib/idempotency');
const { ValidationError } = require('../usecases/errors');

function extractShop(body) {
    if (!body || typeof body !== 'object') {
        throw new ValidationError('Request body must be a JSON object');
    }
    const shop = body.shop;
    if (!shop || typeof shop !== 'object') {
        throw new ValidationError('Request body must contain a "shop" object');
    }
    const name = shop.displayName?.text;
    const address = shop.formattedAddress;
    const state = shop.state;
    const priceLevel = shop.priceLevel || null;
    const languageCode = shop.displayName?.languageCode || 'en';

    if (!name || typeof name !== 'string' || !name.trim()) {
        throw new ValidationError('shop.displayName.text is required');
    }
    if (!address || typeof address !== 'string' || !address.trim()) {
        throw new ValidationError('shop.formattedAddress is required');
    }
    if (!state || typeof state !== 'string' || !/^[A-Z]{2}$/.test(state.toUpperCase())) {
        throw new ValidationError('shop.state is required and must be a 2-letter state code');
    }

    return {
        name: name.trim(),
        address: address.trim(),
        state: state.toUpperCase(),
        priceLevel,
        languageCode,
    };
}

function mountCoffeeShops(router, deps) {
    const { db, logger } = deps;
    const idempotent = withIdempotency({ db, logger });

    router.post(
        '/coffee-shops',
        idempotent,
        asyncHandler(async (req, res) => {
            const shop = extractShop(req.body);
            const { lastID } = await db.run(
                `INSERT INTO coffee_shops (name, address, price_level, language_code, state, source_file)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [shop.name, shop.address, shop.priceLevel, shop.languageCode, shop.state, 'api_submission'],
                'insert_coffee_shop',
            );

            return sendSuccess(res, {
                id: lastID,
                displayName: { text: shop.name, languageCode: shop.languageCode },
                formattedAddress: shop.address,
                state: shop.state,
                priceLevel: shop.priceLevel,
            });
        }),
    );

    router.put(
        '/coffee-shops/:id',
        idempotent,
        asyncHandler(async (req, res) => {
            const id = parseInt(req.params.id, 10);
            if (!Number.isInteger(id) || id <= 0) {
                throw new ValidationError('Invalid shop id');
            }
            const shop = extractShop(req.body);
            const { changes } = await db.run(
                `UPDATE coffee_shops
                 SET name = ?, address = ?, price_level = ?, language_code = ?, state = ?
                 WHERE id = ?`,
                [shop.name, shop.address, shop.priceLevel, shop.languageCode, shop.state, id],
                'update_coffee_shop',
            );

            if (changes === 0) {
                throw new ValidationError(`Coffee shop with id ${id} not found`);
            }

            return sendSuccess(res, {
                id,
                displayName: { text: shop.name, languageCode: shop.languageCode },
                formattedAddress: shop.address,
                state: shop.state,
                priceLevel: shop.priceLevel,
            });
        }),
    );
}

module.exports = { mountCoffeeShops };
