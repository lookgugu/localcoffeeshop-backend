/**
 * Waitlist Routes — monthly roaster subscription, INTEREST ONLY
 *
 * POST /waitlist/subscribe    { email, consent: true, source, company(honeypot) }
 *                             → 202 { status: 'pending_confirmation' }
 * POST /waitlist/confirm      { token } → 200 { status: 'confirmed' |
 *                             'already_confirmed' | 'unsubscribed_globally' | 'suppressed',
 *                             conversion: 'observed_new' | 'ambiguous' | 'none' }
 * POST /waitlist/unsubscribe  { token } → 200 { status: 'unsubscribed' | 'not_subscribed' }
 *                             (both record a durable CoffeeShop opt-out)
 *
 * There are deliberately no GET routes: email link scanners prefetch links,
 * so confirming/unsubscribing needs an explicit POST from the page's button.
 * Tokens travel in the JSON body (never in a URL that access logs record).
 *
 * Every write under /api has already passed the shared write limiter; the
 * subscribe route adds a stricter per-IP budget. Responses are no-store.
 * Disabled/misconfigured → 503 WAITLIST_UNAVAILABLE (see src/waitlist/config.js).
 */

const rateLimit = require('express-rate-limit');
const { asyncHandler } = require('../lib/async-handler');
const { sendError } = require('../lib/responses');
const { validateSignupBody, validateTokenBody, FieldValidationError } = require('../waitlist/validation');
const { WaitlistError } = require('../waitlist/service');

function noStore(req, res, next) {
    res.set('Cache-Control', 'no-store');
    next();
}

function mountWaitlist(router, { config, waitlistService }) {
    const wl = config.waitlist;
    const allowedOrigins = new Set([
        ...(Array.isArray(config.corsOrigins) ? config.corsOrigins : []),
        ...(wl.frontendOrigin ? [wl.frontendOrigin] : []),
    ]);

    function sendWaitlistError(res, err) {
        if (err.retryAfterSeconds) res.set('Retry-After', String(err.retryAfterSeconds));
        return sendError(res, err.status, err.message, null, { code: err.code, nodeEnv: config.nodeEnv });
    }

    // Closed before any parsing work when the feature is off.
    function requireEnabled(req, res, next) {
        if (waitlistService.enabled) return next();
        return sendWaitlistError(res, new WaitlistError('WAITLIST_UNAVAILABLE', 503, 'The waitlist is not open right now. Please try again later.', 3600));
    }

    // Browsers always send Origin on cross-origin POSTs; a foreign one is refused.
    function checkOrigin(req, res, next) {
        const origin = req.get('Origin');
        if (!origin || allowedOrigins.has(origin)) return next();
        return sendWaitlistError(res, new WaitlistError('WAITLIST_ORIGIN_FORBIDDEN', 403, 'This request is not allowed from this site.'));
    }

    const subscribeLimiter = /** @type {any} */ (rateLimit)({
        windowMs: wl.ipWindowMs || 3600000,
        max: wl.ipMax || 5,
        standardHeaders: true,
        legacyHeaders: false,
        handler: (req, res, next, options) => {
            res.set('Cache-Control', 'no-store');
            return sendError(res, options.statusCode, 'Too many sign-up attempts from this network. Please try again later.', null, { code: 'WAITLIST_RATE_LIMITED' });
        },
    });

    // Validation errors carry per-field codes for accessible client messages.
    function validated(parse, key) {
        return (req, res, next) => {
            try {
                req[key] = parse(req.body);
                next();
            } catch (err) {
                if (err instanceof FieldValidationError) {
                    return res.status(400).json({
                        success: false,
                        error: { code: 'VALIDATION_FAILED', message: err.message, statusCode: 400, fields: err.fields, requestId: req.id },
                    });
                }
                next(err);
            }
        };
    }

    const respond = (status, fn) => asyncHandler(async (req, res) => {
        try {
            const data = await fn(req);
            res.status(status).json({ success: true, data });
        } catch (err) {
            if (err instanceof WaitlistError) return sendWaitlistError(res, err);
            throw err;
        }
    });

    const common = [noStore, requireEnabled, checkOrigin];

    router.post('/waitlist/subscribe', ...common, subscribeLimiter, validated(validateSignupBody, 'signup'),
        respond(202, (req) => waitlistService.requestSignup(req.signup)));
    router.post('/waitlist/confirm', ...common, validated(validateTokenBody, 'token'),
        respond(200, (req) => waitlistService.confirm(req.token)));
    router.post('/waitlist/unsubscribe', ...common, validated(validateTokenBody, 'token'),
        respond(200, (req) => waitlistService.unsubscribe(req.token)));
}

module.exports = { mountWaitlist };
