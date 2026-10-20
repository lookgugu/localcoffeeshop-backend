/**
 * Unit Tests — waitlist request validation
 *
 * Bounded, allowlisted bodies only. Errors carry a field + stable code the
 * frontend maps to accessible messages; they never echo the input.
 */

const { validateSignupBody, validateTokenBody, normalizeEmail } = require('../../../src/waitlist/validation');
const { ValidationError } = require('../../../src/usecases/errors');

function errorOf(fn) {
    try {
        fn();
    } catch (err) {
        return err;
    }
    throw new Error('expected a ValidationError');
}

const valid = (overrides = {}) => ({ email: 'Person@Example.com', consent: true, source: 'home', company: '', ...overrides });

describe('validateSignupBody', () => {
    it('normalises a valid signup', () => {
        expect(validateSignupBody(valid())).toEqual({ email: 'person@example.com', source: 'home', honeypotTripped: false });
        expect(validateSignupBody(valid({ source: 'roasters' })).source).toBe('roasters');
    });

    it('flags the honeypot instead of rejecting (bots get the normal response)', () => {
        expect(validateSignupBody(valid({ company: 'Acme' })).honeypotTripped).toBe(true);
    });

    it.each([
        [{ email: '' }, 'email', 'email_required'],
        [{ email: undefined }, 'email', 'email_required'],
        [{ email: 'no-at-sign' }, 'email', 'email_invalid'],
        [{ email: 'a@b' }, 'email', 'email_invalid'],
        [{ email: 'a b@example.com' }, 'email', 'email_invalid'],
        [{ email: 'a@exa mple.com' }, 'email', 'email_invalid'],
        [{ email: 'a@example.com\r\nBcc: x@y.z' }, 'email', 'email_invalid'],
        [{ email: `${'a'.repeat(65)}@example.com` }, 'email', 'email_invalid'],
        [{ email: `a@${'b'.repeat(250)}.com` }, 'email', 'email_invalid'],
        [{ email: 42 }, 'email', 'email_invalid'],
        [{ consent: false }, 'consent', 'consent_required'],
        [{ consent: 'true' }, 'consent', 'consent_required'],
        [{ consent: undefined }, 'consent', 'consent_required'],
        [{ source: 'popup' }, 'source', 'source_invalid'],
        [{ company: 'x'.repeat(201) }, 'company', 'field_invalid'],
    ])('%j → %s/%s', (overrides, field, code) => {
        const err = errorOf(() => validateSignupBody(valid(overrides)));
        expect(err).toBeInstanceOf(ValidationError);
        expect(err.fields).toContainEqual({ field, code });
        expect(err.message).not.toContain('example.com');
    });

    it('reports every invalid field at once', () => {
        const err = errorOf(() => validateSignupBody({ email: '', consent: false, source: 'home' }));
        expect(err.fields).toEqual([{ field: 'email', code: 'email_required' }, { field: 'consent', code: 'consent_required' }]);
    });

    it.each([[null], [[]], ['string'], [{ ...valid(), extra: 'x' }], [{ ...valid(), __proto__x: 1 }]])('rejects a non-allowlisted body %j', (input) => {
        expect(errorOf(() => validateSignupBody(input))).toBeInstanceOf(ValidationError);
    });
});

describe('validateTokenBody', () => {
    it('accepts a bounded token string', () => {
        expect(validateTokenBody({ token: 'v1.abc_-' })).toBe('v1.abc_-');
    });

    it.each([[{}], [{ token: '' }], [{ token: 5 }], [{ token: 'x'.repeat(1025) }], [{ token: 'bad token' }], [{ token: 'v1.a', other: 1 }]])('rejects %j', (input) => {
        const err = errorOf(() => validateTokenBody(input));
        expect(err.fields).toContainEqual({ field: 'token', code: 'token_invalid' });
    });
});

describe('normalizeEmail', () => {
    it('trims and lowercases', () => {
        expect(normalizeEmail('  A.B@Example.COM ')).toBe('a.b@example.com');
    });
});
