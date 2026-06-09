/**
 * Nearby Routes
 *
 * GET /nearby?lat=&lon=&limit= — nearest coordinate-bearing shops.
 */

const { sendError } = require('../lib/responses');
const { ValidationError } = require('../usecases/errors');
const { validateNearbyInput } = require('../usecases/nearbyShops');

function mountNearby(router, { nearbyShopsUseCase, cached }) {
    const fetchNearbyResults = cached(async (req) => nearbyShopsUseCase({
        lat: req.query.lat,
        lon: req.query.lon,
        lng: req.query.lng,
        limit: req.query.limit,
    }), { ttlSeconds: 300, cacheControlMaxAge: 300 });

    router.get('/nearby', (req, res, next) => {
        try {
            validateNearbyInput({
                lat: req.query.lat,
                lon: req.query.lon,
                lng: req.query.lng,
                limit: req.query.limit,
            });
        } catch (err) {
            if (err instanceof ValidationError) {
                return sendError(res, 400, err.message);
            }
            return next(err);
        }
        return fetchNearbyResults(req, res, next);
    });
}

module.exports = { mountNearby };
