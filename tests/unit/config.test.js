/**
 * Unit Tests — loadConfig: community-submission and write-limit fields
 *
 * Only the fields introduced for community submissions are covered here;
 * pre-existing config parsing is unchanged.
 *
 * Contract:
 *   - unset or empty → documented default
 *   - otherwise must be a plain base-10 integer within [min, max], or
 *     loadConfig throws (boot fails closed rather than running with junk)
 *   - SUBMISSION_QUEUE_MAX=0 is valid and means "accept nothing"
 *     (every submission → 503 SUBMISSION_QUEUE_FULL)
 *   - WRITE_RATE_LIMIT_MAX=0 is rejected (use SUBMISSIONS_ENABLED to close)
 */

const { loadConfig } = require('../../src/config');

describe('loadConfig — submission limits', () => {
    it('uses documented defaults when unset or empty', () => {
        for (const env of [{}, { SUBMISSION_QUEUE_MAX: '', WRITE_RATE_LIMIT_MAX: '', WRITE_RATE_LIMIT_WINDOW_MS: '' }]) {
            const config = loadConfig(env);
            expect(config.submissionQueueMax).toBe(500);
            expect(config.writeRateLimitMax).toBe(10);
            expect(config.writeRateLimitWindowMs).toBe(3600000);
        }
    });

    it('accepts in-range integers, including surrounding whitespace', () => {
        const config = loadConfig({ SUBMISSION_QUEUE_MAX: ' 25 ', WRITE_RATE_LIMIT_MAX: '3', WRITE_RATE_LIMIT_WINDOW_MS: '60000' });
        expect(config.submissionQueueMax).toBe(25);
        expect(config.writeRateLimitMax).toBe(3);
        expect(config.writeRateLimitWindowMs).toBe(60000);
    });

    it('SUBMISSION_QUEUE_MAX=0 is honoured (queue accepts nothing), not replaced by the default', () => {
        expect(loadConfig({ SUBMISSION_QUEUE_MAX: '0' }).submissionQueueMax).toBe(0);
    });

    it('WRITE_RATE_LIMIT_MAX=0 is rejected', () => {
        expect(() => loadConfig({ WRITE_RATE_LIMIT_MAX: '0' })).toThrow(/WRITE_RATE_LIMIT_MAX/);
    });

    it.each([
        ['SUBMISSION_QUEUE_MAX', '-1'],
        ['SUBMISSION_QUEUE_MAX', '100001'],
        ['SUBMISSION_QUEUE_MAX', '10abc'],
        ['SUBMISSION_QUEUE_MAX', '1e3'],
        ['SUBMISSION_QUEUE_MAX', '2.5'],
        ['SUBMISSION_QUEUE_MAX', '0x10'],
        ['WRITE_RATE_LIMIT_MAX', '-5'],
        ['WRITE_RATE_LIMIT_MAX', '10001'],
        ['WRITE_RATE_LIMIT_MAX', 'ten'],
        ['WRITE_RATE_LIMIT_WINDOW_MS', '-100'],
        ['WRITE_RATE_LIMIT_WINDOW_MS', '0'],
        ['WRITE_RATE_LIMIT_WINDOW_MS', '999'],
        // Above 24h; also guards the 2^31-1 ms setTimeout overflow.
        ['WRITE_RATE_LIMIT_WINDOW_MS', '86400001'],
        ['WRITE_RATE_LIMIT_WINDOW_MS', '2147483648'],
        ['WRITE_RATE_LIMIT_WINDOW_MS', '99999999999999999999'],
        ['WRITE_RATE_LIMIT_WINDOW_MS', '15m'],
    ])('%s=%p is rejected with a message naming the variable', (name, value) => {
        expect(() => loadConfig({ [name]: value })).toThrow(new RegExp(name));
    });

    it('accepts the inclusive bounds', () => {
        const low = loadConfig({ WRITE_RATE_LIMIT_MAX: '1', WRITE_RATE_LIMIT_WINDOW_MS: '1000' });
        expect([low.writeRateLimitMax, low.writeRateLimitWindowMs]).toEqual([1, 1000]);
        const high = loadConfig({ SUBMISSION_QUEUE_MAX: '100000', WRITE_RATE_LIMIT_MAX: '10000', WRITE_RATE_LIMIT_WINDOW_MS: '86400000' });
        expect([high.submissionQueueMax, high.writeRateLimitMax, high.writeRateLimitWindowMs]).toEqual([100000, 10000, 86400000]);
    });
});

describe('loadConfig — submissionsEnabled', () => {
    it.each([[undefined], [''], ['1'], ['yes'], ['TRUE '], ['false']])(
        'production with SUBMISSIONS_ENABLED=%p: only exact "true" (case/space-insensitive) opens',
        (value) => {
            const env = { NODE_ENV: 'production', ...(value === undefined ? {} : { SUBMISSIONS_ENABLED: value }) };
            expect(loadConfig(env).submissionsEnabled).toBe(value === 'TRUE ');
        },
    );

    it.each([[undefined, true], ['', true], ['true', true], ['false', false], ['0', false], ['off', false], ['no', false]])(
        'non-production with SUBMISSIONS_ENABLED=%p → %p',
        (value, expected) => {
            const env = { NODE_ENV: 'test', ...(value === undefined ? {} : { SUBMISSIONS_ENABLED: value }) };
            expect(loadConfig(env).submissionsEnabled).toBe(expected);
        },
    );
});
