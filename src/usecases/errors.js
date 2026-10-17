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

/**
 * A bounded resource is exhausted or a feature is switched off. The route
 * layer maps this to 503 with a Retry-After hint; `code` is the stable
 * machine-readable reason.
 */
class UnavailableError extends Error {
    constructor(code, message, retryAfterSeconds = 3600) {
        super(message);
        this.name = 'UnavailableError';
        this.code = code;
        this.retryAfterSeconds = retryAfterSeconds;
    }
}

module.exports = { ValidationError, UnavailableError };
