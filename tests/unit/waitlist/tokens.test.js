/**
 * Unit Tests — stateless waitlist tokens
 *
 * Tokens are authenticated-encrypted (AES-256-GCM, purpose-separated keys
 * derived from the dedicated signing secret), expire, and are bound to this
 * waitlist's audience (segment + frontend origin) so a token minted for a
 * different segment/business is rejected.
 */

const { makeTokenCodec } = require('../../../src/waitlist/tokens');

const SECRET = 'test-signing-secret-0123456789abcdef-0123456789';
const AUD = { segmentId: '11111111-2222-4333-8444-555555555555', frontendOrigin: 'https://localcoffeeshop.co' };

function codec(overrides = {}, now = () => 1_800_000_000_000) {
    return makeTokenCodec({ secret: SECRET, ...AUD, ...overrides, now });
}

describe('waitlist tokens', () => {
    it('round-trips the email for the same purpose', () => {
        const c = codec();
        const token = c.seal('confirm', 'person@example.com', 3600);
        expect(c.open('confirm', token)).toEqual({ ok: true, email: 'person@example.com' });
    });

    it('does not expose the email in the token', () => {
        const token = codec().seal('confirm', 'person@example.com', 3600);
        expect(token).not.toMatch(/person|example/);
        expect(Buffer.from(token.split('.')[1], 'base64url').toString('latin1')).not.toMatch(/person@example/);
        expect(token).toMatch(/^v2\.[A-Za-z0-9_-]+$/);
    });

    it('rejects a token used for the other purpose', () => {
        const c = codec();
        expect(c.open('unsubscribe', c.seal('confirm', 'p@example.com', 3600))).toEqual({ ok: false, reason: 'invalid' });
        expect(c.open('confirm', c.seal('unsubscribe', 'p@example.com', 3600))).toEqual({ ok: false, reason: 'invalid' });
    });

    it('expires', () => {
        let now = 1_800_000_000_000;
        const c = makeTokenCodec({ secret: SECRET, ...AUD, now: () => now });
        const token = c.seal('confirm', 'p@example.com', 60);
        now += 59_000;
        expect(c.open('confirm', token).ok).toBe(true);
        now += 2_000;
        expect(c.open('confirm', token)).toEqual({ ok: false, reason: 'expired' });
    });

    it('rejects tokens for another segment or another frontend origin (cross-business)', () => {
        const token = codec().seal('confirm', 'p@example.com', 3600);
        expect(codec({ segmentId: '99999999-8888-4777-8666-555555555555' }).open('confirm', token)).toEqual({ ok: false, reason: 'invalid' });
        expect(codec({ frontendOrigin: 'https://other.example' }).open('confirm', token)).toEqual({ ok: false, reason: 'invalid' });
    });

    it('rejects tokens sealed with a different secret', () => {
        const token = codec({ secret: 'another-signing-secret-0123456789abcdef-xyz' }).seal('confirm', 'p@example.com', 3600);
        expect(codec().open('confirm', token)).toEqual({ ok: false, reason: 'invalid' });
    });

    it.each([
        ['empty', ''],
        ['garbage', 'hello'],
        ['wrong version', 'v1.AAAA'],
        ['truncated', null],
        ['bit-flipped', 'flip'],
        ['non-string', 42],
        ['too long', `v2.${'A'.repeat(2000)}`],
    ])('rejects %s tokens without throwing', (_label, value) => {
        const c = codec();
        let token = value;
        const good = c.seal('confirm', 'p@example.com', 3600);
        if (value === null) token = good.slice(0, good.length - 10);
        if (value === 'flip') {
            const raw = Buffer.from(good.slice(3), 'base64url');
            raw[raw.length - 20] ^= 1;
            token = `v2.${raw.toString('base64url')}`;
        }
        expect(c.open('confirm', token)).toEqual({ ok: false, reason: 'invalid' });
    });

    it('is deterministic for identical inputs (byte-identical retried emails)', () => {
        expect(codec().seal('confirm', 'p@example.com', 3600)).toBe(codec().seal('confirm', 'p@example.com', 3600));
        expect(codec().seal('confirm', 'p@example.com', 3600, 1_700_000_000_000)).toBe(codec().seal('confirm', 'p@example.com', 3600, 1_700_000_000_000));
    });

    it('distinct plaintexts get distinct synthetic IVs (so distinct one-time key/nonce; no GCM nonce reuse)', () => {
        const c = codec();
        const sivs = new Set();
        const tokens = [
            c.seal('confirm', 'a@example.com', 3600), c.seal('confirm', 'b@example.com', 3600),
            c.seal('unsubscribe', 'a@example.com', 3600), c.seal('confirm', 'a@example.com', 3601),
            c.seal('confirm', 'a@example.com', 3600, 1_700_000_000_000),
        ];
        for (const t of tokens) sivs.add(Buffer.from(t.slice(3), 'base64url').subarray(0, 16).toString('hex'));
        expect(sivs.size).toBe(tokens.length);
    });

    it('rejects a token whose synthetic IV was swapped from another token', () => {
        const c = codec();
        const a = Buffer.from(c.seal('confirm', 'a@example.com', 3600).slice(3), 'base64url');
        const b = Buffer.from(c.seal('confirm', 'b@example.com', 3600).slice(3), 'base64url');
        const spliced = Buffer.concat([b.subarray(0, 16), a.subarray(16)]);
        expect(c.open('confirm', `v2.${spliced.toString('base64url')}`)).toEqual({ ok: false, reason: 'invalid' });
    });

    it('expiry is measured from the supplied base time', () => {
        let now = 1_800_000_000_000;
        const c = makeTokenCodec({ secret: SECRET, ...AUD, now: () => now });
        const token = c.seal('confirm', 'p@example.com', 60, now + 600_000);
        now += 600_000 + 59_000;
        expect(c.open('confirm', token).ok).toBe(true);
        now += 2_000;
        expect(c.open('confirm', token)).toEqual({ ok: false, reason: 'expired' });
    });

    it('requires a long secret', () => {
        expect(() => makeTokenCodec({ secret: 'short', ...AUD })).toThrow(/secret/);
    });
});
