/**
 * Reviewer email notification for community submissions: configuration.
 *
 * When a proposal is queued, the reviewer gets an email with its contents
 * (src/submissions/email-notifier.js). This is a convenience, not part of
 * the queue: a missing or invalid setting disables the email and never
 * affects submissions themselves.
 *
 * Enabled only when SUBMISSION_NOTIFY_ENABLED is exactly "true" and every
 * setting below is valid. Dedicated names only, with no fallback to the
 * waitlist's key, so turning one feature off never silently changes the other.
 *
 *   SUBMISSION_NOTIFY_TO               reviewer address
 *   SUBMISSION_NOTIFY_FROM             "Name <addr@domain>" on a Resend-verified domain
 *   SUBMISSION_NOTIFY_RESEND_API_KEY   Resend key (a sending-only key is enough)
 *   SUBMISSION_NOTIFY_MAX_PER_HOUR     cap on emails per process per hour (default 20)
 *
 * `problems` lists variable names and rules only, never values.
 */

const { boundedInt } = require('../lib/bounded-int');

const API_KEY_RE = /^re_[A-Za-z0-9_]{8,200}$/;
const ADDRESS_RE = /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63})+$/;
const DISPLAY_NAME_RE = /^[A-Za-z0-9 .,'&()-]{1,64}$/;

function str(env, name) {
    const v = env[name];
    return v === undefined || v === null ? '' : String(v).trim();
}

/** "Name <addr@host>" or "addr@host" → true if well formed. */
function isValidFrom(value) {
    const angled = value.match(/^(.+?)\s*<([^<>]+)>$/);
    if (angled && !DISPLAY_NAME_RE.test(angled[1].trim())) return false;
    return ADDRESS_RE.test(angled ? angled[2].trim() : value);
}

/**
 * @param {NodeJS.ProcessEnv} env
 * @returns {Readonly<{enabled: boolean, reason: string|null, problems: readonly string[],
 *   apiKey?: string, to?: string, from?: string, maxPerHour?: number}>}
 */
function loadSubmissionNotifyConfig(env) {
    if (str(env, 'SUBMISSION_NOTIFY_ENABLED').toLowerCase() !== 'true') {
        return Object.freeze({ enabled: false, reason: 'disabled', problems: Object.freeze([]) });
    }
    const problems = [];

    const apiKey = str(env, 'SUBMISSION_NOTIFY_RESEND_API_KEY');
    if (!apiKey) problems.push('SUBMISSION_NOTIFY_RESEND_API_KEY is required');
    else if (!API_KEY_RE.test(apiKey)) problems.push('SUBMISSION_NOTIFY_RESEND_API_KEY must be a Resend API key (re_...)');

    const to = str(env, 'SUBMISSION_NOTIFY_TO');
    if (!to) problems.push('SUBMISSION_NOTIFY_TO is required');
    else if (!ADDRESS_RE.test(to)) problems.push('SUBMISSION_NOTIFY_TO must be a single email address');

    const from = str(env, 'SUBMISSION_NOTIFY_FROM');
    if (!from) problems.push('SUBMISSION_NOTIFY_FROM is required');
    else if (!isValidFrom(from)) problems.push('SUBMISSION_NOTIFY_FROM must be "Name <address@domain>" or an address');

    let maxPerHour = 20;
    try {
        maxPerHour = boundedInt(env, 'SUBMISSION_NOTIFY_MAX_PER_HOUR', { min: 1, max: 1000, fallback: 20 });
    } catch (err) {
        problems.push(err.message.replace(/\s*\(got "[^"]*"\)$/, ''));
    }

    if (problems.length) {
        return Object.freeze({ enabled: false, reason: 'misconfigured', problems: Object.freeze(problems) });
    }
    return Object.freeze({
        enabled: true, reason: null, problems: Object.freeze([]), apiKey, to, from, maxPerHour,
    });
}

module.exports = { loadSubmissionNotifyConfig };
