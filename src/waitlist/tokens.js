/**
 * Stateless waitlist tokens (confirm / unsubscribe).
 *
 * Format: "v2." + base64url(siv[16] | AES-256-GCM ciphertext | tag[16]).
 * The plaintext is { p: purpose, e: email, a: audience, x: expiry (s) }.
 * Encryption keeps the address out of the link if a token leaks; the GCM
 * tag authenticates it. Keys are derived per purpose from the dedicated
 * signing secret with HKDF, so a confirm token can never act as an
 * unsubscribe token (and vice versa), and the audience binds a token to this
 * segment + frontend origin, so a token minted for another business's
 * configuration is rejected even if it shares the secret.
 *
 * Deterministic on purpose: the same inputs give the same token, so a
 * retried confirmation email is byte-identical and the provider's
 * Idempotency-Key accepts it (even after a restart). This is done without
 * GCM nonce reuse, SIV-style: siv = HMAC(macKey, plaintext); a one-time
 * key + nonce are derived from siv with HKDF. Distinct plaintexts get
 * distinct sivs (128-bit), hence distinct keys, so no key/nonce pair ever
 * encrypts two different messages. Opening recomputes the HMAC over the
 * decrypted plaintext and requires it to equal siv. The only thing an
 * observer learns is that two tokens are equal, which they are by design.
 *
 * No server-side state: replay safety comes from provider state
 * (membership + the dedicated suppression segment; see service.js).
 */

const crypto = require('crypto');

const VERSION = 'v2';
const PURPOSES = new Set(['confirm', 'unsubscribe']);
const MAX_TOKEN_LENGTH = 1024;
const SIV_BYTES = 16;
const TAG_BYTES = 16;
const TOKEN_RE = /^v2\.([A-Za-z0-9_-]+)$/;

function makeTokenCodec({ secret, segmentId, frontendOrigin, now = Date.now }) {
    if (typeof secret !== 'string' || secret.length < 32) {
        throw new Error('waitlist token secret must be at least 32 characters');
    }
    const audience = crypto.createHash('sha256')
        .update(`${String(segmentId).toLowerCase()}|${frontendOrigin}`)
        .digest('base64url')
        .slice(0, 22);

    const derive = (info, length) => Buffer.from(crypto.hkdfSync('sha256', secret, 'localcoffeeshop-waitlist', info, length));
    const keys = new Map();
    for (const purpose of PURPOSES) {
        keys.set(purpose, {
            mac: derive(`token:${purpose}:${VERSION}:mac`, 32),
            enc: derive(`token:${purpose}:${VERSION}:enc`, 32),
        });
    }

    /** One-time AES key + GCM nonce for exactly one plaintext (identified by its siv). */
    function messageKey(purpose, siv) {
        const okm = Buffer.from(crypto.hkdfSync('sha256', keys.get(purpose).enc, siv, 'message', 32 + 12));
        return { key: okm.subarray(0, 32), nonce: okm.subarray(32) };
    }

    const sivOf = (purpose, plaintext) => crypto.createHmac('sha256', keys.get(purpose).mac).update(plaintext).digest().subarray(0, SIV_BYTES);

    /**
     * @param {string} purpose 'confirm' | 'unsubscribe'
     * @param {string} email normalized address
     * @param {number} ttlSeconds lifetime
     * @param {number} [baseMs] start of the lifetime (defaults to now). Callers
     *   pass a bucket boundary so retries inside the bucket produce the same token.
     */
    function seal(purpose, email, ttlSeconds, baseMs = now()) {
        if (!PURPOSES.has(purpose)) throw new Error(`unknown token purpose ${purpose}`);
        const plaintext = Buffer.from(JSON.stringify({ p: purpose, e: email, a: audience, x: Math.floor(baseMs / 1000) + ttlSeconds }), 'utf8');
        const siv = sivOf(purpose, plaintext);
        const { key, nonce } = messageKey(purpose, siv);
        const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
        cipher.setAAD(siv);
        const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
        return `${VERSION}.${Buffer.concat([siv, ct, cipher.getAuthTag()]).toString('base64url')}`;
    }

    /** @returns {{ok: true, email: string} | {ok: false, reason: 'invalid'|'expired'}} */
    function open(purpose, token) {
        const invalid = { ok: false, reason: 'invalid' };
        if (!PURPOSES.has(purpose) || typeof token !== 'string' || token.length > MAX_TOKEN_LENGTH) return invalid;
        const m = token.match(TOKEN_RE);
        if (!m) return invalid;
        const raw = Buffer.from(m[1], 'base64url');
        if (raw.length <= SIV_BYTES + TAG_BYTES) return invalid;
        const siv = raw.subarray(0, SIV_BYTES);
        let plaintext;
        let payload;
        try {
            const { key, nonce } = messageKey(purpose, siv);
            const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce);
            decipher.setAAD(siv);
            decipher.setAuthTag(raw.subarray(raw.length - TAG_BYTES));
            plaintext = Buffer.concat([decipher.update(raw.subarray(SIV_BYTES, raw.length - TAG_BYTES)), decipher.final()]);
            payload = JSON.parse(plaintext.toString('utf8'));
        } catch {
            return invalid;
        }
        if (!crypto.timingSafeEqual(sivOf(purpose, plaintext), siv)) return invalid;
        if (!payload || payload.p !== purpose || payload.a !== audience || typeof payload.e !== 'string' || !Number.isInteger(payload.x)) {
            return invalid;
        }
        if (Math.floor(now() / 1000) >= payload.x) return { ok: false, reason: 'expired' };
        return { ok: true, email: payload.e };
    }

    return { seal, open };
}

module.exports = { makeTokenCodec, MAX_TOKEN_LENGTH };
