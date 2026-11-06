/**
 * Unit Tests — waitlist configuration
 *
 * The waitlist is fail-closed: it is enabled only when WAITLIST_ENABLED is
 * exactly "true" AND every dedicated setting is present and valid. A missing
 * or invalid setting disables the feature (503) without taking down the
 * rest of the API, and the reported problems name variables, never values.
 */

const { loadConfig } = require('../../../src/config');
const { loadWaitlistConfig } = require('../../../src/waitlist/config');
const { waitlistEnv } = require('../../helpers/waitlistEnv');

const load = (env) => loadWaitlistConfig(env, {
    nodeEnv: env.NODE_ENV || 'test',
    corsOrigins: env.CORS_ORIGIN ? env.CORS_ORIGIN.split(',').map((s) => s.trim()) : false,
    metricsAuthToken: env.METRICS_AUTH_TOKEN || '',
});

describe('loadWaitlistConfig', () => {
    it('is enabled with a complete dedicated configuration', () => {
        const wl = load(waitlistEnv());
        expect(wl.enabled).toBe(true);
        expect(wl.problems).toEqual([]);
        expect(wl.segmentId).toBe('11111111-2222-4333-8444-555555555555');
        expect(wl.confirmTtlSeconds).toBe(48 * 3600);
        expect(Object.isFrozen(wl)).toBe(true);
    });

    it.each([undefined, '', 'false', '1', 'yes', 'TRUE1'])('WAITLIST_ENABLED=%p keeps it disabled', (value) => {
        const env = waitlistEnv({ WAITLIST_ENABLED: value });
        if (value === undefined) delete env.WAITLIST_ENABLED;
        const wl = load(env);
        expect(wl.enabled).toBe(false);
        expect(wl.reason).toBe('disabled');
    });

    it.each([
        'WAITLIST_RESEND_API_KEY',
        'WAITLIST_RESEND_SEGMENT_ID',
        'WAITLIST_RESEND_SEGMENT_NAME',
        'WAITLIST_RESEND_SUPPRESSION_SEGMENT_ID',
        'WAITLIST_RESEND_SUPPRESSION_SEGMENT_NAME',
        'WAITLIST_SIGNING_SECRET',
        'WAITLIST_FROM',
        'WAITLIST_FRONTEND_ORIGIN',
    ])('fails closed when %s is missing', (name) => {
        const env = waitlistEnv();
        delete env[name];
        const wl = load(env);
        expect(wl.enabled).toBe(false);
        expect(wl.reason).toBe('misconfigured');
        expect(wl.problems.join(' ')).toContain(name);
    });

    it('never falls back to a generic RESEND_API_KEY or another segment variable', () => {
        const env = waitlistEnv({ RESEND_API_KEY: 're_other_business_key_123456', RESEND_SEGMENT_ID: '99999999-8888-4777-8666-555555555555', RESEND_AUDIENCE_ID: 'x' });
        delete env.WAITLIST_RESEND_API_KEY;
        delete env.WAITLIST_RESEND_SEGMENT_ID;
        const wl = load(env);
        expect(wl.enabled).toBe(false);
        expect(wl.apiKey).toBeUndefined();
        expect(wl.segmentId).toBeUndefined();
    });

    it.each([
        ['WAITLIST_RESEND_API_KEY', 'sk_live_wrong_prefix'],
        ['WAITLIST_RESEND_SEGMENT_ID', 'not-a-uuid'],
        ['WAITLIST_RESEND_SEGMENT_NAME', 'Newsletter'], // not visibly dedicated to this business
        ['WAITLIST_RESEND_SUPPRESSION_SEGMENT_ID', 'not-a-uuid'],
        ['WAITLIST_RESEND_SUPPRESSION_SEGMENT_ID', '11111111-2222-4333-8444-555555555555'], // same as the list segment
        ['WAITLIST_RESEND_SUPPRESSION_SEGMENT_NAME', 'Unsubscribes'], // not visibly ours
        ['WAITLIST_RESEND_SUPPRESSION_SEGMENT_NAME', 'LocalCoffeeShop roaster subscription interest'], // not a suppression list
        ['WAITLIST_SIGNING_SECRET', 'too-short'],
        ['WAITLIST_FROM', 'not an address'],
        ['WAITLIST_FROM', 'Other Biz <hello@otherbusiness.com>'], // sender outside our domain
        ['WAITLIST_FRONTEND_ORIGIN', 'https://localcoffeeshop.co/path'],
        ['WAITLIST_FRONTEND_ORIGIN', 'http://localcoffeeshop.co'], // must be https unless localhost
        ['WAITLIST_FRONTEND_ORIGIN', 'https://evil.example'], // not an allowed CORS origin
        ['WAITLIST_CONFIRM_TTL_HOURS', '0'],
        ['WAITLIST_CONFIRM_TTL_HOURS', '169'],
    ])('fails closed when %s=%p is invalid', (name, value) => {
        const wl = load(waitlistEnv({ [name]: value }));
        expect(wl.enabled).toBe(false);
        expect(wl.problems.join(' ')).toContain(name);
    });

    it('rejects a signing secret reused from the API key or metrics token', () => {
        const key = 're_test_fake_key_not_real_0001_padding_padding';
        expect(load(waitlistEnv({ WAITLIST_RESEND_API_KEY: key, WAITLIST_SIGNING_SECRET: key })).enabled).toBe(false);
        const shared = 'shared-secret-0123456789abcdef-0123456789';
        expect(load(waitlistEnv({ METRICS_AUTH_TOKEN: shared, WAITLIST_SIGNING_SECRET: shared })).enabled).toBe(false);
    });

    it('allows an http localhost origin only outside production', () => {
        const local = { WAITLIST_FRONTEND_ORIGIN: 'http://localhost:8080', CORS_ORIGIN: 'http://localhost:8080', WAITLIST_FROM: 'Dev <dev@localcoffeeshop.co>' };
        expect(load(waitlistEnv(local)).enabled).toBe(true);
        expect(load(waitlistEnv({ ...local, NODE_ENV: 'production' })).enabled).toBe(false);
    });

    it('accepts a sender on a subdomain of the frontend domain', () => {
        expect(load(waitlistEnv({ WAITLIST_FROM: 'Local Coffee Shops <hello@mail.localcoffeeshop.co>' })).enabled).toBe(true);
        expect(load(waitlistEnv({ WAITLIST_FROM: 'waitlist@localcoffeeshop.co' })).enabled).toBe(true);
    });

    it('problem messages never contain secret values', () => {
        const env = waitlistEnv({ WAITLIST_SIGNING_SECRET: 'short-secret-value', WAITLIST_RESEND_API_KEY: 'bad_key_value_123' });
        const text = load(env).problems.join(' ');
        expect(text).not.toContain('short-secret-value');
        expect(text).not.toContain('bad_key_value_123');
    });
});

describe('loadConfig wiring', () => {
    it('exposes config.waitlist and reports a misconfiguration as a warning (names only)', () => {
        const env = waitlistEnv();
        delete env.WAITLIST_FROM;
        const config = loadConfig(env);
        expect(config.waitlist.enabled).toBe(false);
        expect(config.warnings.join(' ')).toMatch(/WAITLIST_FROM/);
    });

    it('is disabled by default without any waitlist env', () => {
        expect(loadConfig({}).waitlist.enabled).toBe(false);
    });
});
