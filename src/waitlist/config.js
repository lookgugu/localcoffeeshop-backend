/**
 * Waitlist configuration (monthly roaster subscription — interest only).
 *
 * Fail-closed: the waitlist is enabled only when WAITLIST_ENABLED is exactly
 * "true" AND every dedicated WAITLIST_* setting is present and valid.
 * Anything missing or invalid leaves it disabled (503) without failing the
 * rest of the API. There are deliberately no fallbacks to generic names
 * (RESEND_API_KEY, RESEND_SEGMENT_ID, audience ids, ...) so a key or segment
 * belonging to another business on a shared host can never be picked up.
 *
 * `problems` lists variable names and rules only — never values.
 */

const { boundedInt } = require('../lib/bounded-int');

const SEGMENT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const API_KEY_RE = /^re_[A-Za-z0-9_]{8,200}$/;
const ADDRESS_RE = /^[A-Za-z0-9._%+-]{1,64}@([A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63})+)$/;
const DISPLAY_NAME_RE = /^[A-Za-z0-9 .,'&()-]{1,64}$/;
const MIN_SECRET_LENGTH = 32;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);

function str(env, name) {
    const v = env[name];
    return v === undefined || v === null ? '' : String(v).trim();
}

/** "Name <addr@host>" or "addr@host" → { address, domain } or null. */
function parseFrom(value) {
    const angled = value.match(/^(.+?)\s*<([^<>]+)>$/);
    const name = angled ? angled[1].trim() : null;
    const address = angled ? angled[2].trim() : value;
    if (name !== null && !DISPLAY_NAME_RE.test(name)) return null;
    const m = address.match(ADDRESS_RE);
    return m ? { address, domain: m[1].toLowerCase() } : null;
}

/** Exact origin (scheme://host[:port], no path/query/fragment) or null. */
function parseOrigin(value) {
    let u;
    try {
        u = new URL(value);
    } catch {
        return null;
    }
    if (u.origin === 'null' || `${u.origin}` !== value.replace(/\/$/, '') || u.username || u.password) return null;
    return u;
}

const compact = (name) => name.toLowerCase().replace(/[^a-z0-9]/g, '');

/** The segment name must visibly belong to this business. */
function isDedicatedSegmentName(name) {
    return name.length <= 100 && compact(name).includes('localcoffeeshop');
}

/** ...and the suppression segment must also visibly be a suppression list. */
function isSuppressionSegmentName(name) {
    return isDedicatedSegmentName(name) && /suppress|unsubscrib|optout/.test(compact(name));
}

/**
 * @param {NodeJS.ProcessEnv} env
 * @param {{ nodeEnv: string, corsOrigins: string[]|false, metricsAuthToken: string }} ctx
 */
function loadWaitlistConfig(env, { nodeEnv, corsOrigins, metricsAuthToken }) {
    if (str(env, 'WAITLIST_ENABLED').toLowerCase() !== 'true') {
        return Object.freeze({ enabled: false, reason: 'disabled', problems: Object.freeze([]) });
    }

    const problems = [];
    const production = nodeEnv === 'production';

    const apiKey = str(env, 'WAITLIST_RESEND_API_KEY');
    if (!apiKey) problems.push('WAITLIST_RESEND_API_KEY is required');
    else if (!API_KEY_RE.test(apiKey)) problems.push('WAITLIST_RESEND_API_KEY must be a Resend API key (re_...)');

    const segmentId = str(env, 'WAITLIST_RESEND_SEGMENT_ID');
    if (!segmentId) problems.push('WAITLIST_RESEND_SEGMENT_ID is required');
    else if (!SEGMENT_ID_RE.test(segmentId)) problems.push('WAITLIST_RESEND_SEGMENT_ID must be a segment UUID');

    const segmentName = str(env, 'WAITLIST_RESEND_SEGMENT_NAME');
    if (!segmentName) problems.push('WAITLIST_RESEND_SEGMENT_NAME is required');
    else if (!isDedicatedSegmentName(segmentName)) {
        problems.push('WAITLIST_RESEND_SEGMENT_NAME must name a segment dedicated to LocalCoffeeShop (contain "localcoffeeshop")');
    }

    // CoffeeShop-scoped opt-out list (durable across restarts, provider-held).
    // A separate, already-provisioned segment: never the list itself, never
    // another business's segment. The app does not create segments.
    const suppressionSegmentId = str(env, 'WAITLIST_RESEND_SUPPRESSION_SEGMENT_ID');
    if (!suppressionSegmentId) problems.push('WAITLIST_RESEND_SUPPRESSION_SEGMENT_ID is required');
    else if (!SEGMENT_ID_RE.test(suppressionSegmentId)) problems.push('WAITLIST_RESEND_SUPPRESSION_SEGMENT_ID must be a segment UUID');
    else if (suppressionSegmentId.toLowerCase() === segmentId.toLowerCase()) {
        problems.push('WAITLIST_RESEND_SUPPRESSION_SEGMENT_ID must differ from WAITLIST_RESEND_SEGMENT_ID');
    }

    const suppressionSegmentName = str(env, 'WAITLIST_RESEND_SUPPRESSION_SEGMENT_NAME');
    if (!suppressionSegmentName) problems.push('WAITLIST_RESEND_SUPPRESSION_SEGMENT_NAME is required');
    else if (!isSuppressionSegmentName(suppressionSegmentName)) {
        problems.push('WAITLIST_RESEND_SUPPRESSION_SEGMENT_NAME must name a LocalCoffeeShop suppression segment (contain "localcoffeeshop" and "suppression"/"unsubscribe"/"opt-out")');
    } else if (suppressionSegmentName === segmentName) {
        problems.push('WAITLIST_RESEND_SUPPRESSION_SEGMENT_NAME must differ from WAITLIST_RESEND_SEGMENT_NAME');
    }

    const signingSecret = str(env, 'WAITLIST_SIGNING_SECRET');
    if (!signingSecret) problems.push('WAITLIST_SIGNING_SECRET is required');
    else if (signingSecret.length < MIN_SECRET_LENGTH) problems.push(`WAITLIST_SIGNING_SECRET must be at least ${MIN_SECRET_LENGTH} characters`);
    else if (signingSecret === apiKey || (metricsAuthToken && signingSecret === metricsAuthToken)) {
        problems.push('WAITLIST_SIGNING_SECRET must be dedicated (not reused from another secret)');
    }

    const originRaw = str(env, 'WAITLIST_FRONTEND_ORIGIN');
    const origin = originRaw ? parseOrigin(originRaw) : null;
    let frontendOrigin;
    if (!originRaw) problems.push('WAITLIST_FRONTEND_ORIGIN is required');
    else if (!origin) problems.push('WAITLIST_FRONTEND_ORIGIN must be a bare origin (scheme://host[:port])');
    else {
        const local = LOCAL_HOSTS.has(origin.hostname);
        if (origin.protocol !== 'https:' && !(local && !production && origin.protocol === 'http:')) {
            problems.push('WAITLIST_FRONTEND_ORIGIN must use https (http only for localhost outside production)');
        } else if (!Array.isArray(corsOrigins) || !corsOrigins.includes(origin.origin)) {
            // No CORS_ORIGIN means browsers cannot call the API cross-origin at all.
            problems.push('WAITLIST_FRONTEND_ORIGIN must be one of CORS_ORIGIN');
        } else {
            frontendOrigin = origin.origin;
        }
    }

    const fromRaw = str(env, 'WAITLIST_FROM');
    const from = fromRaw ? parseFrom(fromRaw) : null;
    if (!fromRaw) problems.push('WAITLIST_FROM is required');
    else if (!from) problems.push('WAITLIST_FROM must be "Name <address@domain>" or an address');
    else if (origin && !LOCAL_HOSTS.has(origin.hostname)) {
        const site = origin.hostname.replace(/^www\./, '');
        if (from.domain !== site && !from.domain.endsWith(`.${site}`)) {
            problems.push('WAITLIST_FROM must send from the frontend domain or a subdomain of it');
        }
    }

    let confirmTtlHours = 48;
    let limits = {};
    try {
        confirmTtlHours = boundedInt(env, 'WAITLIST_CONFIRM_TTL_HOURS', { min: 1, max: 168, fallback: 48 });
        limits = {
            ipMax: boundedInt(env, 'WAITLIST_IP_MAX', { min: 1, max: 1000, fallback: 5 }),
            ipWindowMs: boundedInt(env, 'WAITLIST_IP_WINDOW_MS', { min: 1000, max: 86400000, fallback: 3600000 }),
            emailMaxPerDay: boundedInt(env, 'WAITLIST_EMAIL_MAX_PER_DAY', { min: 1, max: 20, fallback: 3 }),
            globalSendsPerHour: boundedInt(env, 'WAITLIST_GLOBAL_SENDS_PER_HOUR', { min: 1, max: 10000, fallback: 200 }),
            providerTimeoutMs: boundedInt(env, 'WAITLIST_PROVIDER_TIMEOUT_MS', { min: 500, max: 20000, fallback: 5000 }),
        };
    } catch (err) {
        // boundedInt messages contain the raw value; keep only the variable name and rule.
        problems.push(err.message.replace(/\s*\(got "[^"]*"\)$/, ''));
    }

    if (problems.length) {
        return Object.freeze({ enabled: false, reason: 'misconfigured', problems: Object.freeze(problems) });
    }

    const replyToRaw = str(env, 'WAITLIST_REPLY_TO');
    const replyTo = replyToRaw && ADDRESS_RE.test(replyToRaw) ? replyToRaw : null;

    return Object.freeze({
        enabled: true,
        reason: null,
        problems: Object.freeze([]),
        apiKey,
        segmentId: segmentId.toLowerCase(),
        segmentName,
        suppressionSegmentId: suppressionSegmentId.toLowerCase(),
        suppressionSegmentName,
        signingSecret,
        from: fromRaw,
        replyTo,
        frontendOrigin,
        confirmTtlSeconds: confirmTtlHours * 3600,
        // Unsubscribe links must keep working long after the email arrives.
        unsubscribeTtlSeconds: 400 * 24 * 3600,
        ...limits,
    });
}

module.exports = { loadWaitlistConfig, isDedicatedSegmentName, isSuppressionSegmentName };
