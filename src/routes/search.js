/**
 * Search Route
 *
 * Delegates to the searchShops use case. The route is the thinnest possible
 * shell: pull params from req.query, run the use case, map ValidationError
 * to 400, let everything else fall through to the global error handler.
 */

const { sendError } = require('../lib/responses');
const { ValidationError } = require('../usecases/errors');

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
        // Run validation eagerly so 400s never hit the cache.
        // The use case re-validates internally; this pre-flight only exists
        // to return errors before we compute a cache key from bad input.
        try {
            preflightValidation({
                searchTerm: req.query.q,
                state: req.query.state,
                price: req.query.price,
                page: req.query.page,
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

// Mirrors the use case's validation rules. Kept in sync by sharing the same
// ValidationError class. The use case is still authoritative — this just
// shifts the failure point to before the cache lookup.
const VALID_PRICE_LEVELS = new Set([
    'PRICE_LEVEL_INEXPENSIVE',
    'PRICE_LEVEL_MODERATE',
    'PRICE_LEVEL_EXPENSIVE',
]);
function preflightValidation({ searchTerm, state, price, page }) {
    const term = typeof searchTerm === 'string' ? searchTerm : '';
    const st = typeof state === 'string' ? state : '';
    const pr = typeof price === 'string' ? price : '';
    const pg = Math.max(1, parseInt(String(page ?? 1), 10) || 1);

    if (pg > 1000) {
        throw new ValidationError('Page number too high. Maximum page is 1000.');
    }
    if (st && !/^[A-Z]{2}$/.test(st.toUpperCase())) {
        throw new ValidationError('Invalid state code format. Expected 2-letter state abbreviation.');
    }
    if (pr && !VALID_PRICE_LEVELS.has(pr)) {
        throw new ValidationError('Invalid price level. Must be one of: PRICE_LEVEL_INEXPENSIVE, PRICE_LEVEL_MODERATE, PRICE_LEVEL_EXPENSIVE');
    }
    if (term && term.length > 100) {
        throw new ValidationError('Search term too long. Maximum 100 characters.');
    }
    if (term && !/^[a-zA-Z0-9\s\-'.,&]+$/.test(term)) {
        throw new ValidationError('Search term contains invalid characters. Only letters, numbers, spaces, and common punctuation allowed.');
    }
}

module.exports = { mountSearch };
