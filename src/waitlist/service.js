/**
 * Waitlist service — double opt-in for the roaster-subscription interest list.
 *
 *   requestSignup: send a confirmation email. Provider acceptance means the
 *                  email was handed off — the person is PENDING, not on the
 *                  list. No contact or segment is written. Addresses that are
 *                  globally unsubscribed or on the CoffeeShop suppression
 *                  segment get the same 202 but no email.
 *   confirm:       token holder explicitly confirms (POST). Only now is the
 *                  contact created if absent and added to the dedicated
 *                  segment — unless the address is on the suppression
 *                  segment. Returns { status, conversion } (see below).
 *   unsubscribe:   adds the contact to the dedicated CoffeeShop suppression
 *                  segment (creating the contact if needed), THEN removes list
 *                  membership. Suppression is durable in the provider, so an
 *                  old confirm token can never re-add the address, across
 *                  restarts and instances, even if it unsubscribed before
 *                  ever confirming. Rejoining after an unsubscribe is an
 *                  operator action (docs/waitlist.md).
 *
 * `conversion` on confirm results is honest about what one request can know:
 *   'observed_new' — this request saw no membership and its add succeeded.
 *                    Best evidence of a new signup, but NOT globally unique:
 *                    Resend has no conditional add, so two instances racing
 *                    on the same token can both observe it.
 *   'ambiguous'    — the address is now a member but this request cannot tell
 *                    whether its add created that (add errored, then the
 *                    re-read showed membership).
 *   'none'         — no new membership (already a member, suppressed,
 *                    globally unsubscribed).
 *
 * Globally unsubscribed contacts are never re-subscribed or added. Nothing
 * is stored locally (no SQLite): tokens are stateless and the provider holds
 * the list and the suppression state. In-memory state (rate limits, send
 * dedup, in-flight confirms) is an optimisation and abuse bound only;
 * correctness never depends on it. Logs carry event names and provider
 * status codes, never the address or a token.
 */

const crypto = require('crypto');
const { makeTokenCodec } = require('./tokens');
const { buildConfirmationEmail } = require('./email');
const { ProviderError, IsolationError } = require('./resend-provider');
const { makeWindowCounter } = require('./window-counter');

// Retried signups in this window produce the same (deterministic) email and
// idempotency key, so a double-click, client retry or retry on another
// instance doesn't send a second email or burn a second quota unit.
const IDEMPOTENCY_BUCKET_MS = 10 * 60 * 1000;
const MAX_TRACKED_SENDS = 20000;
const DAY_MS = 24 * 3600 * 1000;
const HOUR_MS = 3600 * 1000;

class WaitlistError extends Error {
    constructor(code, status, message, retryAfterSeconds = null) {
        super(message);
        this.name = 'WaitlistError';
        this.code = code;
        this.status = status;
        this.retryAfterSeconds = retryAfterSeconds;
    }
}

const unavailable = () => new WaitlistError('WAITLIST_UNAVAILABLE', 503, 'The waitlist is not open right now. Please try again later.', 3600);
const providerFailure = () => new WaitlistError('WAITLIST_PROVIDER_ERROR', 502, 'We could not reach our email provider. Please try again in a few minutes.');

function makeWaitlistService({ waitlist, provider, logger, now = Date.now }) {
    if (!waitlist || !waitlist.enabled || !provider) {
        const closed = async () => { throw unavailable(); };
        return { enabled: false, requestSignup: closed, confirm: closed, unsubscribe: closed };
    }

    const tokens = makeTokenCodec({
        secret: waitlist.signingSecret,
        segmentId: waitlist.segmentId,
        frontendOrigin: waitlist.frontendOrigin,
        now,
    });
    // Keyed by an HMAC of the address so raw addresses are not held in memory.
    const keyFor = (purpose, value) => crypto.createHmac('sha256', waitlist.signingSecret).update(`${purpose}:${value}`).digest('base64url');
    const perEmail = makeWindowCounter({ max: waitlist.emailMaxPerDay, windowMs: DAY_MS, maxKeys: 20000, now });
    const globalSends = makeWindowCounter({ max: waitlist.globalSendsPerHour, windowMs: HOUR_MS, maxKeys: 1, now });
    // (address, bucket) → { expiresAt, promise | null, done, release }. One quota
    // reservation per address per bucket, shared by every retry in that bucket.
    const sends = new Map();
    const inFlightConfirms = new Map();
    const PENDING = Object.freeze({ status: 'pending_confirmation' });

    function log(level, event, extra = {}) {
        logger?.[level]?.({ event, ...extra }, event);
    }

    /** Map adapter failures to client errors; IsolationError fails closed. */
    function mapProviderError(err, op) {
        if (err instanceof IsolationError) {
            log('error', 'waitlist_isolation_failed', { op, reason: err.reason });
            return unavailable();
        }
        if (err instanceof ProviderError) {
            log('warn', 'waitlist_provider_error', { op, kind: err.kind, status: err.status, code: err.code });
            return providerFailure();
        }
        return err;
    }

    /**
     * Did the provider definitely NOT accept a send? Only then is the quota
     * released. Timeouts, network errors, 5xx, 408/409/429 may have landed.
     */
    function definitelyNotSent(err, sendAttempted) {
        if (!sendAttempted || err instanceof IsolationError) return true;
        return err instanceof ProviderError && err.kind === 'http'
            && err.status >= 400 && err.status < 500 && ![408, 409, 429].includes(err.status);
    }

    function openToken(purpose, token) {
        const opened = tokens.open(purpose, token);
        if (opened.ok) return opened.email;
        if (opened.reason === 'expired') {
            throw new WaitlistError('WAITLIST_TOKEN_EXPIRED', 410, 'This link has expired. Please sign up again to get a new one.');
        }
        throw new WaitlistError('WAITLIST_TOKEN_INVALID', 400, 'This link is not valid. Please use the most recent email we sent, or sign up again.');
    }

    function pruneSends() {
        const t = now();
        for (const [key, entry] of sends) {
            if (entry.expiresAt > t && sends.size <= MAX_TRACKED_SENDS) break;
            if (entry.promise && entry.expiresAt > t) break; // never drop a live in-flight entry early
            sends.delete(key);
        }
    }

    /** Provider work for one (address, bucket). Deterministic payload → same idempotency key. */
    async function sendConfirmation(email, bucket, source, attempt) {
        await provider.verifySegments();
        const contact = await provider.getContact(email);
        if (contact) {
            // Same 202 either way: the response never reveals list/opt-out state.
            if (contact.unsubscribed) {
                log('info', 'waitlist_send_skipped', { reason: 'unsubscribed_globally', source });
                return PENDING;
            }
            if ((await provider.memberships(contact.id)).suppressed) {
                log('info', 'waitlist_send_skipped', { reason: 'suppressed', source });
                return PENDING;
            }
        }
        // Token lifetimes start at the bucket's end so every retry in the
        // bucket (any instance, any restart) seals byte-identical tokens.
        const base = (bucket + 1) * IDEMPOTENCY_BUCKET_MS;
        const message = buildConfirmationEmail({
            frontendOrigin: waitlist.frontendOrigin,
            confirmToken: tokens.seal('confirm', email, waitlist.confirmTtlSeconds, base),
            unsubscribeToken: tokens.seal('unsubscribe', email, waitlist.unsubscribeTtlSeconds, base),
            confirmTtlHours: Math.round(waitlist.confirmTtlSeconds / 3600),
        });
        const payload = { from: waitlist.from, to: email, replyTo: waitlist.replyTo, subject: message.subject, html: message.html, text: message.text };
        // Keyed by the payload itself: identical payload ⇔ identical key, so the
        // provider can never see one key with two different bodies (409).
        const idempotencyKey = `waitlist-confirm-${keyFor('send', JSON.stringify(payload))}`;
        attempt.sendAttempted = true;
        await provider.sendEmail({ ...payload, idempotencyKey });
        log('info', 'waitlist_confirmation_sent', { source });
        return PENDING;
    }

    function requestSignup({ email, source, honeypotTripped }) {
        if (honeypotTripped) {
            log('info', 'waitlist_honeypot', { source });
            return Promise.resolve(PENDING);
        }
        pruneSends();
        const bucket = Math.floor(now() / IDEMPOTENCY_BUCKET_MS);
        const sendKey = keyFor(`bucket:${bucket}`, email);
        let entry = sends.get(sendKey);
        if (entry?.promise) return entry.promise; // same address, same bucket, in flight: share it
        if (entry?.done) return Promise.resolve(PENDING); // already accepted in this bucket

        if (!entry) {
            // Reserve synchronously, before any await, so concurrent requests
            // cannot all pass the check.
            const releaseEmail = perEmail.reserve(keyFor('rate', email));
            if (!releaseEmail) {
                return Promise.reject(new WaitlistError('WAITLIST_RATE_LIMITED', 429, 'Too many requests for this address. Please check your inbox or try again tomorrow.', 3600));
            }
            const releaseGlobal = globalSends.reserve('all');
            if (!releaseGlobal) {
                releaseEmail();
                log('warn', 'waitlist_global_send_cap');
                return Promise.reject(unavailable());
            }
            entry = {
                expiresAt: (bucket + 1) * IDEMPOTENCY_BUCKET_MS,
                promise: null,
                done: false,
                release: () => { releaseEmail(); releaseGlobal(); },
            };
            sends.set(sendKey, entry);
        }
        // else: an earlier attempt in this bucket may have landed; retry under
        // the same reservation (and the same idempotency key).

        const current = entry;
        const attempt = { sendAttempted: false };
        current.promise = sendConfirmation(email, bucket, source, attempt).then(
            (result) => {
                current.promise = null;
                current.done = true;
                return result;
            },
            (err) => {
                current.promise = null;
                if (definitelyNotSent(err, attempt.sendAttempted)) {
                    current.release();
                    if (sends.get(sendKey) === current) sends.delete(sendKey);
                }
                throw mapProviderError(err, 'send_confirmation');
            },
        );
        return current.promise;
    }

    const suppressedResult = () => ({ status: 'suppressed', conversion: 'none' });

    async function confirmEmail(email) {
        await provider.verifySegments();
        let contact = await provider.getContact(email);
        let created = false;
        if (!contact) {
            try {
                contact = { ...(await provider.createContact(email)), unsubscribed: false };
                created = true;
            } catch (err) {
                // Lost race or undocumented "already exists": trust provider state.
                contact = await provider.getContact(email);
                if (!contact) throw err;
            }
        }
        if (contact.unsubscribed) return { status: 'unsubscribed_globally', conversion: 'none' };

        const before = created ? { member: false, suppressed: false } : await provider.memberships(contact.id);
        if (before.suppressed) {
            if (before.member) await provider.removeFromSegment(contact.id); // finish an interrupted cleanup
            return suppressedResult();
        }
        if (before.member) return { status: 'already_confirmed', conversion: 'none' };

        let addError = null;
        try {
            await provider.addToSegment(contact.id);
        } catch (err) {
            addError = err;
        }
        // Re-read after the add: reconciles an add that landed despite an
        // error, and lets an unsubscribe that raced us win (it writes the
        // suppression before removing membership, so one of us sees the other).
        const after = await provider.memberships(contact.id);
        if (after.suppressed) {
            if (after.member) await provider.removeFromSegment(contact.id);
            return suppressedResult();
        }
        if (addError) {
            if (!after.member) throw addError;
            return { status: 'confirmed', conversion: 'ambiguous' };
        }
        return { status: 'confirmed', conversion: 'observed_new' };
    }

    async function confirm(token) {
        const email = openToken('confirm', token);
        const key = keyFor('confirm', email);
        const pending = inFlightConfirms.get(key);
        if (pending) {
            // Same address being confirmed right now in this process (double
            // click, two tabs): only the first request may report a conversion.
            const result = await pending.catch(() => null);
            if (result && result.status === 'confirmed') return { status: 'already_confirmed', conversion: 'none' };
            if (result) return result;
        }
        const work = confirmEmail(email);
        inFlightConfirms.set(key, work);
        try {
            const result = await work;
            log('info', result.status === 'confirmed' ? 'waitlist_confirmed' : `waitlist_confirm_${result.status}`, { conversion: result.conversion });
            return result;
        } catch (err) {
            throw mapProviderError(err, 'confirm');
        } finally {
            if (inFlightConfirms.get(key) === work) inFlightConfirms.delete(key);
        }
    }

    async function unsubscribe(token) {
        const email = openToken('unsubscribe', token);
        try {
            await provider.verifySegments();
            let contact = await provider.getContact(email);
            if (!contact) {
                // Unsubscribed before ever confirming: record the opt-out anyway,
                // or the still-valid confirm token could add them later.
                try {
                    contact = await provider.createContact(email);
                } catch (err) {
                    contact = await provider.getContact(email);
                    if (!contact) throw err;
                }
            }
            const state = await provider.memberships(contact.id);
            // Suppression first, removal second: if we fail in between, the
            // address is still blocked from (re-)confirming.
            if (!state.suppressed) await provider.addToSuppression(contact.id);
            if (state.member) await provider.removeFromSegment(contact.id);
            log('info', state.member ? 'waitlist_unsubscribed' : 'waitlist_unsubscribe_not_member');
            return { status: state.member ? 'unsubscribed' : 'not_subscribed' };
        } catch (err) {
            throw mapProviderError(err, 'unsubscribe');
        }
    }

    return { enabled: true, requestSignup, confirm, unsubscribe };
}

module.exports = { makeWaitlistService, WaitlistError };
