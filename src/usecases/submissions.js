/**
 * Community Submissions Use Case
 *
 * Anonymous visitors may *propose* a new shop or a change to an existing one.
 * Proposals land in the `shop_submissions` moderation queue with status
 * 'pending'. Nothing here reads from or writes to the published
 * `coffee_shops` table except the existence check for update proposals —
 * publication is a separate, privileged step that does not exist yet.
 *
 * `validateShopProposal` and `parseShopId` are pure; the route layer runs
 * them BEFORE idempotency so a malformed request can never reserve a key or
 * reach storage.
 */

const { ValidationError, UnavailableError } = require('./errors');

const SHOP_ID_PATTERN = /^[1-9][0-9]{0,9}$/;

// Mirrored by CHECK constraints in migrations/20261017_01_create_shop_submissions.sql.
const LIMITS = Object.freeze({
    name: 200,
    address: 300,
    phoneNumber: 32,
    website: 300,
    description: 1000,
    languageCode: 16,
});

const PHONE_PATTERN = /^[0-9+().\- ]+$/;
const LANGUAGE_CODE_PATTERN = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;
// Single-line fields: no C0 controls or DEL at all.
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/;
// Multi-line fields: tab, LF and CR are allowed.
const CONTROL_CHARS_MULTILINE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

/**
 * Parse a path `:id` strictly. `parseInt` would accept '12abc' and '1e3'.
 *
 * @param {string} raw
 * @returns {number}
 */
function parseShopId(raw) {
    if (typeof raw !== 'string' || !SHOP_ID_PATTERN.test(raw)) {
        throw new ValidationError('Invalid shop id');
    }
    return Number(raw);
}

/**
 * Validate one free-text field. Returns the trimmed string, or null for an
 * absent/empty optional field (the frontend sends '' for blank inputs).
 */
function textField(value, field, { max, required = false, multiline = false }) {
    if (value === undefined || value === null || value === '') {
        if (required) throw new ValidationError(`${field} is required`);
        return null;
    }
    if (typeof value !== 'string') {
        throw new ValidationError(`${field} must be a string`);
    }
    const trimmed = value.trim();
    if (trimmed === '') {
        if (required) throw new ValidationError(`${field} is required`);
        return null;
    }
    if (trimmed.length > max) {
        throw new ValidationError(`${field} must be at most ${max} characters`);
    }
    if ((multiline ? CONTROL_CHARS_MULTILINE : CONTROL_CHARS).test(trimmed)) {
        throw new ValidationError(`${field} contains invalid control characters`);
    }
    return trimmed;
}

function priceLevelField(value, enums) {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value !== 'string' || !enums.Price.all().some((p) => p.key === value)) {
        throw new ValidationError('shop.priceLevel must be one of PRICE_LEVEL_INEXPENSIVE, PRICE_LEVEL_MODERATE, PRICE_LEVEL_EXPENSIVE');
    }
    return value;
}

function phoneField(value) {
    const phone = textField(value, 'shop.phoneNumber', { max: LIMITS.phoneNumber });
    if (phone !== null && !PHONE_PATTERN.test(phone)) {
        throw new ValidationError('shop.phoneNumber may contain only digits, spaces and + ( ) . -');
    }
    return phone;
}

function websiteField(value) {
    const website = textField(value, 'shop.website', { max: LIMITS.website });
    if (website === null) return null;
    let url;
    try {
        url = new URL(website);
    } catch {
        throw new ValidationError('shop.website must be an absolute http(s) URL');
    }
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) {
        throw new ValidationError('shop.website must be an absolute http(s) URL without credentials');
    }
    return website;
}

function languageCodeField(value) {
    if (value === undefined || value === null || value === '') return 'en';
    if (typeof value !== 'string' || value.length > LIMITS.languageCode || !LANGUAGE_CODE_PATTERN.test(value)) {
        throw new ValidationError('shop.displayName.languageCode must be a BCP 47 language tag such as "en" or "en-US"');
    }
    return value;
}

/**
 * Validate and normalise the `{ shop: {...} }` body sent by the frontend's
 * public/submit.js. Unknown fields (including the client-generated `id`) are
 * ignored and never stored.
 *
 * @param {*} body Parsed JSON body
 * @param {Object} enums Enums module
 * @returns {{name: string, address: string, state: string, priceLevel: string|null,
 *            phoneNumber: string|null, website: string|null, description: string|null,
 *            languageCode: string}}
 */
function validateShopProposal(body, enums) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw new ValidationError('Request body must be a JSON object');
    }
    const shop = body.shop;
    if (!shop || typeof shop !== 'object' || Array.isArray(shop)) {
        throw new ValidationError('Request body must contain a "shop" object');
    }

    const displayName = shop.displayName;
    if (!displayName || typeof displayName !== 'object' || Array.isArray(displayName)) {
        throw new ValidationError('shop.displayName.text is required');
    }

    const state = shop.state;
    if (!state || typeof state !== 'string' || !enums.isStateCode(state)) {
        throw new ValidationError('shop.state is required and must be a valid US state code');
    }

    return {
        name: textField(displayName.text, 'shop.displayName.text', { max: LIMITS.name, required: true }),
        address: textField(shop.formattedAddress, 'shop.formattedAddress', { max: LIMITS.address, required: true }),
        state: state.toUpperCase(),
        priceLevel: priceLevelField(shop.priceLevel, enums),
        phoneNumber: phoneField(shop.phoneNumber),
        website: websiteField(shop.website),
        description: textField(shop.description, 'shop.description', { max: LIMITS.description, multiline: true }),
        languageCode: languageCodeField(displayName.languageCode),
    };
}

/**
 * Build the use case that queues a validated proposal.
 *
 * @param {Object} deps
 * @param {Object} deps.db Database module (get, run)
 * @param {number} deps.queueMax Maximum number of pending submissions
 * @param {() => number} [deps.now] Epoch-seconds clock (injectable for tests)
 * @returns {(input: {kind: 'create'|'update', targetShopId: number|null, proposal: Object})
 *           => Promise<{submissionId: number}>}
 */
function makeSubmitShopProposalUseCase({ db, queueMax, now = () => Math.floor(Date.now() / 1000) }) {
    return async function submitShopProposal({ kind, targetShopId, proposal }) {
        if (kind === 'update') {
            const target = await db.get(
                'SELECT id FROM coffee_shops WHERE id = ?',
                [targetShopId],
                'submission_target_lookup',
            );
            if (!target) {
                throw new ValidationError(`Coffee shop with id ${targetShopId} not found`);
            }
        }

        // Single statement, so the capacity check and the insert are atomic
        // under SQLite's write lock — concurrent requests cannot overshoot.
        const { lastID, changes } = await db.run(
            `INSERT INTO shop_submissions
                (kind, target_shop_id, name, address, state, price_level,
                 phone_number, website, description, language_code, status, created_at)
             SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?
             WHERE (SELECT COUNT(*) FROM shop_submissions WHERE status = 'pending') < ?`,
            [
                kind, targetShopId, proposal.name, proposal.address, proposal.state,
                proposal.priceLevel, proposal.phoneNumber, proposal.website,
                proposal.description, proposal.languageCode, now(), queueMax,
            ],
            'insert_shop_submission',
        );

        if (changes === 0) {
            throw new UnavailableError(
                'SUBMISSION_QUEUE_FULL',
                'The review queue is full. Please try again later.',
            );
        }
        return { submissionId: lastID };
    };
}

module.exports = {
    LIMITS,
    parseShopId,
    validateShopProposal,
    makeSubmitShopProposalUseCase,
};
