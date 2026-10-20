/**
 * Resend adapter for the waitlist — the provider isolation boundary.
 *
 * Resend contacts are GLOBAL to the Resend team (one contact per address
 * across every segment) and carry a global `unsubscribed` flag
 * (https://resend.com/docs/dashboard/contacts/migrating-from-audiences-to-segments).
 * On a team shared with other businesses, this adapter therefore:
 *   - is bound at construction to exactly TWO dedicated segments: the list
 *     segment and the CoffeeShop suppression (opt-out) segment. No method
 *     accepts a segment id, so it cannot address another business's segment;
 *   - verifies both segments by id AND expected dedicated name before any
 *     write (IsolationError otherwise — the caller fails closed);
 *   - only creates a contact that does not exist yet (email + unsubscribed:
 *     false, nothing else), adds/removes list membership and adds
 *     suppression membership. It never updates contact fields (no PATCH),
 *     never flips the global `unsubscribed` flag, never deletes contacts and
 *     never removes suppression membership (only an operator can).
 *
 * Endpoints used (docs: https://resend.com/docs/api-reference/):
 *   GET    /segments/{segment_id}
 *   POST   /emails                                   (Idempotency-Key header)
 *   GET    /contacts/{email}
 *   POST   /contacts
 *   GET    /contacts/{contact_id}/segments           (paginated: limit/after)
 *   POST   /contacts/{contact_id}/segments/{segment_id}   (list or suppression)
 *   DELETE /contacts/{contact_id}/segments/{segment_id}   (list only)
 * Not documented by Resend (handled by re-reading provider state, never by
 * assuming): the status for creating a contact that already exists, for
 * adding a contact that is already a member, and for a missing contact
 * (treated as 404).
 *
 * Errors are ProviderErrors with { kind, status, code }: `code` is the
 * provider's error name only if it matches a safe pattern. Response bodies
 * are never put in messages or logs (they can echo the address).
 */

const API = 'https://api.resend.com';
const USER_AGENT = 'localcoffeeshop-backend-waitlist/1.0';
const MAX_RETRY_AFTER_MS = 2000;
const MAX_SEGMENT_PAGES = 20;

class ProviderError extends Error {
    constructor(kind, { status = null, code = null } = {}) {
        super(`waitlist provider ${kind}${status ? ` ${status}` : ''}${code ? ` ${code}` : ''}`);
        this.name = 'ProviderError';
        this.kind = kind; // 'timeout' | 'network' | 'http' | 'shape'
        this.status = status;
        this.code = code;
    }
}

class IsolationError extends Error {
    constructor(reason) {
        super(`waitlist segment isolation check failed: ${reason}`);
        this.name = 'IsolationError';
        this.reason = reason;
    }
}

const safeCode = (name) => (typeof name === 'string' && /^[a-z_]{1,64}$/.test(name) ? name : 'unknown');

function isRetryable(err) {
    if (err.kind === 'timeout' || err.kind === 'network') return true;
    if (err.kind !== 'http') return false;
    if (err.status === 429 || err.status >= 500) return true;
    return err.status === 409 && err.code === 'concurrent_idempotent_requests';
}

function makeResendProvider({
    apiKey,
    segmentId,
    segmentName,
    suppressionSegmentId,
    suppressionSegmentName,
    fetchImpl = globalThis.fetch,
    timeoutMs = 5000,
    maxRetries = 2,
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
}) {
    if (!apiKey || !segmentId || !segmentName || !suppressionSegmentId || !suppressionSegmentName || typeof fetchImpl !== 'function') {
        throw new Error('makeResendProvider: apiKey, both segment ids/names and fetch are required');
    }
    if (suppressionSegmentId === segmentId || suppressionSegmentName === segmentName) {
        throw new Error('makeResendProvider: the suppression segment must be separate from the list segment');
    }
    const segment = encodeURIComponent(segmentId);
    const suppression = encodeURIComponent(suppressionSegmentId);
    let segmentsVerified = null; // Promise once verification has succeeded / is in flight

    async function once(method, path, body, idempotencyKey) {
        const headers = {
            Authorization: `Bearer ${apiKey}`,
            'User-Agent': USER_AGENT,
            Accept: 'application/json',
        };
        if (body !== undefined) headers['Content-Type'] = 'application/json';
        if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        let res;
        try {
            res = await fetchImpl(`${API}${path}`, {
                method,
                headers,
                body: body === undefined ? undefined : JSON.stringify(body),
                signal: controller.signal,
            });
        } catch (err) {
            throw new ProviderError(controller.signal.aborted || err?.name === 'AbortError' ? 'timeout' : 'network');
        } finally {
            clearTimeout(timer);
        }
        let json = null;
        try {
            json = await res.json();
        } catch {
            json = null;
        }
        if (!res.ok) {
            const err = new ProviderError('http', { status: res.status, code: safeCode(json?.name) });
            const retryAfter = Number(res.headers?.get?.('retry-after'));
            err.retryAfterMs = Number.isFinite(retryAfter) && retryAfter >= 0 ? Math.min(retryAfter * 1000, MAX_RETRY_AFTER_MS) : null;
            throw err;
        }
        return json;
    }

    async function call(method, path, { body, idempotencyKey, retries = maxRetries } = {}) {
        for (let attempt = 0; ; attempt++) {
            try {
                return await once(method, path, body, idempotencyKey);
            } catch (err) {
                if (attempt >= retries || !isRetryable(err)) throw err;
                await sleep(err.retryAfterMs ?? Math.min(250 * 2 ** attempt, MAX_RETRY_AFTER_MS));
            }
        }
    }

    async function verifyOne(id, name, label) {
        let json;
        try {
            json = await call('GET', `/segments/${encodeURIComponent(id)}`);
        } catch (err) {
            if (err instanceof ProviderError && err.kind === 'http' && (err.status === 404 || err.status === 422)) {
                throw new IsolationError(`${label} segment not found`);
            }
            throw err;
        }
        if (!json || json.id !== id || json.name !== name) throw new IsolationError(`${label} segment name/id mismatch`);
    }

    /** Both dedicated segments must exist with their exact expected names. */
    function verifySegments() {
        if (!segmentsVerified) {
            segmentsVerified = (async () => {
                await verifyOne(segmentId, segmentName, 'list');
                await verifyOne(suppressionSegmentId, suppressionSegmentName, 'suppression');
            })().catch((err) => {
                segmentsVerified = null; // allow a later retry
                throw err;
            });
        }
        return segmentsVerified;
    }

    async function sendEmail({ from, to, subject, html, text, replyTo, idempotencyKey }) {
        const body = { from, to: [to], subject, html, text };
        if (replyTo) body.reply_to = replyTo;
        const json = await call('POST', '/emails', { body, idempotencyKey });
        if (!json || typeof json.id !== 'string') throw new ProviderError('shape');
        return { id: json.id };
    }

    /** @returns {Promise<{id: string, unsubscribed: boolean} | null>} */
    async function getContact(email) {
        try {
            const json = await call('GET', `/contacts/${encodeURIComponent(email)}`);
            if (!json || typeof json.id !== 'string') throw new ProviderError('shape');
            return { id: json.id, unsubscribed: json.unsubscribed === true };
        } catch (err) {
            if (err instanceof ProviderError && err.kind === 'http' && err.status === 404) return null;
            throw err;
        }
    }

    async function createContact(email) {
        // Not retried: a lost response would make a retry look like a
        // conflict. The service re-reads provider state on any failure.
        const json = await call('POST', '/contacts', { body: { email, unsubscribed: false }, retries: 0 });
        if (!json || typeof json.id !== 'string') throw new ProviderError('shape');
        return { id: json.id };
    }

    /** @returns {Promise<{member: boolean, suppressed: boolean}>} list + suppression membership, one paged read */
    async function memberships(contactId) {
        const found = { member: false, suppressed: false };
        let after = null;
        for (let page = 0; page < MAX_SEGMENT_PAGES; page++) {
            const qs = new URLSearchParams({ limit: '100' });
            if (after) qs.set('after', after);
            const json = await call('GET', `/contacts/${encodeURIComponent(contactId)}/segments?${qs}`);
            const data = Array.isArray(json?.data) ? json.data : null;
            if (!data) throw new ProviderError('shape');
            for (const s of data) {
                if (s?.id === segmentId) found.member = true;
                if (s?.id === suppressionSegmentId) found.suppressed = true;
            }
            if ((found.member && found.suppressed) || !json.has_more || !data.length) return found;
            after = data[data.length - 1].id;
        }
        throw new ProviderError('shape');
    }

    async function addToSegment(contactId) {
        await call('POST', `/contacts/${encodeURIComponent(contactId)}/segments/${segment}`);
    }

    async function removeFromSegment(contactId) {
        await call('DELETE', `/contacts/${encodeURIComponent(contactId)}/segments/${segment}`);
    }

    async function addToSuppression(contactId) {
        await call('POST', `/contacts/${encodeURIComponent(contactId)}/segments/${suppression}`);
    }

    return { verifySegments, sendEmail, getContact, createContact, memberships, addToSegment, removeFromSegment, addToSuppression };
}

module.exports = { makeResendProvider, ProviderError, IsolationError };
