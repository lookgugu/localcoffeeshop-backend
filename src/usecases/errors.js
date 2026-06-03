/**
 * Use-case Errors
 *
 * Transport-agnostic errors thrown by use cases. The route layer maps these
 * to HTTP status codes; the use cases themselves don't know about HTTP.
 */

class ValidationError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ValidationError';
    }
}

module.exports = { ValidationError };
