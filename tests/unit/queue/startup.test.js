/**
 * Unit Tests — queue startup (src/queue/index.js) and Postgres TLS options
 * (src/queue/postgres-pool.js). No database needed.
 */

const { startQueueStore } = require('../../../src/queue');
const { connectionOptions } = require('../../../src/queue/postgres-pool');

const silent = { info() {}, warn() {}, error() {}, debug() {} };

function fakePool() {
    return {
        on: jest.fn(),
        query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
        end: jest.fn().mockResolvedValue(undefined),
    };
}

const queueConfig = (overrides = {}) => ({
    queue: { databaseUrl: 'postgresql://app@db.example/lcs', migrationDatabaseUrl: '', caCert: '', ...overrides },
});

describe('startQueueStore', () => {
    it('retries a failed boot migration in the background and opens once it succeeds', async () => {
        const migrate = jest.fn()
            .mockRejectedValueOnce(new Error('connection refused'))
            .mockResolvedValueOnce({ applied: ['001_submission_queue.sql'] });
        const store = await startQueueStore({
            config: queueConfig(), db: null, logger: silent, createPoolImpl: fakePool, migrate, retryMs: 10,
        });

        expect(store.ready).toBe(false);
        await expect(store.reserveKey({})).rejects.toMatchObject({ code: 'SUBMISSIONS_UNAVAILABLE' });

        await new Promise((r) => setTimeout(r, 50));
        expect(migrate).toHaveBeenCalledTimes(2);
        expect(store.ready).toBe(true);
        await store.close();
    });

    it('close() stops a pending retry', async () => {
        const migrate = jest.fn().mockRejectedValue(new Error('down'));
        const store = await startQueueStore({
            config: queueConfig(), db: null, logger: silent, createPoolImpl: fakePool, migrate, retryMs: 20,
        });
        await store.close();
        await new Promise((r) => setTimeout(r, 60));
        expect(migrate).toHaveBeenCalledTimes(1);
    });

    it('runs migrations through MIGRATION_DATABASE_URL when it differs, then closes that pool', async () => {
        const pools = [];
        const createPoolImpl = jest.fn((opts) => {
            const pool = fakePool();
            pool.opts = opts;
            pools.push(pool);
            return pool;
        });
        const migrate = jest.fn().mockResolvedValue({ applied: [] });

        const store = await startQueueStore({
            config: queueConfig({ migrationDatabaseUrl: 'postgresql://admin@db.example/lcs', caCert: 'PEM' }),
            db: null, logger: silent, createPoolImpl, migrate,
        });

        expect(pools.map((p) => p.opts.databaseUrl)).toEqual([
            'postgresql://app@db.example/lcs', 'postgresql://admin@db.example/lcs',
        ]);
        expect(pools.every((p) => p.opts.caCert === 'PEM')).toBe(true);
        expect(migrate).toHaveBeenCalledWith(pools[1]);
        expect(pools[1].end).toHaveBeenCalled();
        expect(pools[0].end).not.toHaveBeenCalled();
        expect(store.ready).toBe(true);
    });
});

describe('connectionOptions (TLS)', () => {
    it('DigitalOcean-style sslmode=require with a CA → verified against that CA, sslmode stripped', () => {
        const { connectionString, ssl } = connectionOptions(
            'postgresql://doadmin:pw@db.example:25060/defaultdb?sslmode=require', 'PEM',
        );
        expect(ssl).toEqual({ ca: 'PEM', rejectUnauthorized: true });
        expect(connectionString).not.toMatch(/sslmode/);
        expect(connectionString).toMatch(/^postgresql:\/\/doadmin:pw@db\.example:25060\/defaultdb$/);
    });

    it('sslmode without a CA → TLS verified against system CAs (never unverified)', () => {
        expect(connectionOptions('postgresql://u@h/d?sslmode=require').ssl).toEqual({ rejectUnauthorized: true });
        expect(connectionOptions('postgresql://u@h/d?sslmode=no-verify').ssl).toEqual({ rejectUnauthorized: true });
    });

    it('no sslmode (local/CI) or sslmode=disable → plain connection', () => {
        expect(connectionOptions('postgresql://u@localhost/d').ssl).toBe(false);
        expect(connectionOptions('postgresql://u@localhost/d?sslmode=disable').ssl).toBe(false);
    });

    it('keeps non-TLS query parameters', () => {
        const { connectionString } = connectionOptions('postgresql://u@h/d?sslmode=require&application_name=x', 'PEM');
        expect(new URL(connectionString).searchParams.get('application_name')).toBe('x');
    });
});
