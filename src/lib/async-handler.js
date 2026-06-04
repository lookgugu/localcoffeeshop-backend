/**
 * Async Handler Helper
 *
 * Wraps an async route handler so unhandled rejections propagate to Express
 * via `next(err)` instead of crashing the process.
 */

const asyncHandler = (fn) => (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
};

module.exports = { asyncHandler };
