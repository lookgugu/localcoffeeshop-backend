/**
 * Search Route
 *
 * Delegates to the searchShops use case. The route is the thinnest possible
 * shell: pull params from req.query, run the use case, map ValidationError
 * to 400, let everything else fall through to the global error handler.
 */

const { sendError } = require('../lib/responses');
const { ValidationError } = require('../usecases/errors');
const { validateSearchInput } = require('../usecases/searchShops');

function mountSearch(router, { searchShopsUseCase, cached }) {
    const fetchSearchResults = cached(async (req) => {
        return searchShopsUseCase({
            searchTerm: req.query.q,
            state: req.query.state,
            price: req.query.price,
            page: req.query.page,
            limit: req.query.limit,
        });
    }, { ttlSeconds: 300, cacheControlMaxAge: 300 });

    router.get('/search', (req, res, next) => {
        // Pre-validate eagerly so 400s never hit the cache. The use case
        // re-validates internally (it's authoritative); this just shifts the
        // failure point to before the cache lookup so bad input doesn't
        // pollute the keyspace. Both call sites share the same validator
        // exported from `usecases/searchShops` — no duplicated rules.
        try {
            validateSearchInput({
                searchTerm: req.query.q,
                state: req.query.state,
                price: req.query.price,
                page: req.query.page,
                limit: req.query.limit,
            });
        } catch (err) {
            if (err instanceof ValidationError) {
                return sendError(res, 400, err.message);
            }
            return next(err);
        }
        return fetchSearchResults(req, res, next);
    });
}

module.exports = { mountSearch };
