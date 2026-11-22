/**
 * Unit Tests — /health submission-queue status (src/routes/ops.js)
 */

const { submissionsHealth } = require('../../../src/routes/ops');

const store = (isHealthy, overrides = {}) => ({ kind: 'postgres', durable: true, isHealthy, ...overrides });

describe('submissionsHealth', () => {
    it('open only when submissions are enabled and the queue is healthy', async () => {
        expect(await submissionsHealth(store(async () => true), { submissionsEnabled: true }))
            .toEqual({ open: true, storage: 'postgres', durable: true, queue: 'ok' });
        expect(await submissionsHealth(store(async () => true), { submissionsEnabled: false }))
            .toMatchObject({ open: false, queue: 'ok' });
        expect(await submissionsHealth(store(async () => false), { submissionsEnabled: true }))
            .toMatchObject({ open: false, queue: 'error' });
    });

    it('a check that throws reports an error, not a failed request', async () => {
        await expect(submissionsHealth(store(async () => { throw new Error('boom'); }), { submissionsEnabled: true }))
            .resolves.toMatchObject({ queue: 'error' });
    });

    it('a slow queue database cannot stall /health past the probe timeout', async () => {
        const never = store(() => new Promise(() => {}));
        const started = Date.now();
        const result = await submissionsHealth(never, { submissionsEnabled: true }, 50);
        expect(Date.now() - started).toBeLessThan(1000);
        expect(result).toMatchObject({ open: false, queue: 'error' });
    });
});
