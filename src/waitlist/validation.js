/**
 * Waitlist request validation — allowlisted, bounded bodies only.
 *
 * Errors are ValidationErrors carrying `fields: [{ field, code }]` with
 * stable codes the frontend maps to accessible messages. Messages never echo
 * the submitted values.
 */

const { ValidationError } = require('../usecases/errors');
const { MAX_TOKEN_LENGTH } = require('./tokens');

const SOURCES = new Set(['home', 'roasters']);
const SIGNUP_KEYS = new Set(['email', 'consent', 'source', 'company']);
const LABEL = '[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?';
const EMAIL_RE = new RegExp(`^[A-Za-z0-9.!#$%&'*+/=?^_\`{|}~-]{1,64}@(?:${LABEL}\\.)+[A-Za-z]{2,63}$`);
const TOKEN_RE = /^[A-Za-z0-9._-]+$/;
const MAX_HONEYPOT = 200;

class FieldValidationError extends ValidationError {
    constructor(fields) {
        super('Some fields need attention');
        this.fields = fields;
    }
}

function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        && Object.getPrototypeOf(value) === Object.prototype;
}

function normalizeEmail(value) {
    return String(value).trim().toLowerCase();
}

function validateSignupBody(body) {
    if (!isPlainObject(body) || Object.keys(body).some((k) => !SIGNUP_KEYS.has(k))) {
        throw new FieldValidationError([{ field: 'body', code: 'body_invalid' }]);
    }
    const fields = [];

    let email = null;
    if (body.email === undefined || body.email === null || (typeof body.email === 'string' && body.email.trim() === '')) {
        fields.push({ field: 'email', code: 'email_required' });
    } else if (typeof body.email !== 'string' || body.email.length > 320) {
        fields.push({ field: 'email', code: 'email_invalid' });
    } else {
        const candidate = normalizeEmail(body.email);
        if (candidate.length > 254 || !EMAIL_RE.test(candidate)) fields.push({ field: 'email', code: 'email_invalid' });
        else email = candidate;
    }

    // Explicit opt-in: exactly boolean true (the checkbox starts unchecked).
    if (body.consent !== true) fields.push({ field: 'consent', code: 'consent_required' });

    if (!SOURCES.has(body.source)) fields.push({ field: 'source', code: 'source_invalid' });

    const company = body.company === undefined ? '' : body.company;
    if (typeof company !== 'string' || company.length > MAX_HONEYPOT) fields.push({ field: 'company', code: 'field_invalid' });

    if (fields.length) throw new FieldValidationError(fields);
    return { email, source: body.source, honeypotTripped: company.trim() !== '' };
}

function validateTokenBody(body) {
    const ok = isPlainObject(body)
        && Object.keys(body).length === 1
        && typeof body.token === 'string'
        && body.token.length > 0
        && body.token.length <= MAX_TOKEN_LENGTH
        && TOKEN_RE.test(body.token);
    if (!ok) throw new FieldValidationError([{ field: 'token', code: 'token_invalid' }]);
    return body.token;
}

module.exports = { validateSignupBody, validateTokenBody, normalizeEmail, FieldValidationError, SOURCES };
