/**
 * Unit Tests for Database Module
 *
 * Tests the database abstraction layer including initialization,
 * query functions, error handling, and connection management.
 *
 * Scope: only asserts behaviour OUR wrapper adds (metrics, structured
 * logging, error propagation, lifecycle). Tests that would only verify
 * sqlite3's own semantics (parameter binding, multi-row return shape,
 * LIMIT/OFFSET) live in the sqlite3 project, not here.
 */

const db = require('../../src/db');

// Mock logger for testing
const mockLogger = {
  info: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  fatal: jest.fn(),
};

// Mock metrics for testing
const mockMetrics = {
  queryDuration: {
    labels: jest.fn(() => ({
      observe: jest.fn(),
    })),
  },
  errors: {
    labels: jest.fn(() => ({
      inc: jest.fn(),
    })),
  },
};

describe('Database Module', () => {
  beforeEach(() => {
    // Clear mock calls
    jest.clearAllMocks();
  });

  afterEach(async () => {
    // Close the database connection after each test
    try {
      const closePromise = db.close();
      const timeoutPromise = new Promise((resolve) =>
        setTimeout(() => resolve(), 3000)
      );
      await Promise.race([closePromise, timeoutPromise]);
    } catch (err) {
      // Ignore errors during cleanup
    }
  }, 10000); // 10 second timeout for afterEach

  describe('initialize()', () => {
    it('should initialize database with valid path', async () => {
      await db.initialize({
        dbPath: ':memory:',
        logger: mockLogger,
        metrics: mockMetrics,
      });

      expect(mockLogger.info).toHaveBeenCalledWith(
        { dbPath: ':memory:' },
        'Connected to the coffee_shops database'
      );
    });

    it('should reject with invalid database path', async () => {
      await expect(async () => {
        await db.initialize({
          dbPath: '/nonexistent/path/to/database.db',
          logger: mockLogger,
          metrics: mockMetrics,
        });
      }).rejects.toThrow();
    }, 5000); // Add timeout for this specific test

    it('should configure SQLite optimizations', async () => {
      await db.initialize({
        dbPath: ':memory:',
        logger: mockLogger,
        metrics: mockMetrics,
      });

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Database optimization settings applied'
      );
    });

    it('should accept metrics as optional parameter', async () => {
      await db.initialize({
        dbPath: ':memory:',
        logger: mockLogger,
        // No metrics
      });

      expect(mockLogger.info).toHaveBeenCalled();
    });
  });

  describe('get() - Single Row Query', () => {
    beforeEach(async () => {
      await db.initialize({
        dbPath: ':memory:',
        logger: mockLogger,
        metrics: mockMetrics,
      });
    });

    it('should track query metrics with the supplied label', async () => {
      await db.get('SELECT 1 as test', [], 'test_query');

      expect(mockMetrics.queryDuration.labels).toHaveBeenCalledWith(
        'test_query'
      );
    });

    it('should reject on invalid SQL and log + count the error', async () => {
      await expect(
        db.get('INVALID SQL STATEMENT', [])
      ).rejects.toThrow();

      expect(mockLogger.error).toHaveBeenCalled();
      expect(mockMetrics.errors.labels).toHaveBeenCalled();
    });

    it('should use default query type if not provided', async () => {
      await db.get('SELECT 1 as test', []);

      expect(mockMetrics.queryDuration.labels).toHaveBeenCalledWith('unknown');
    });
  });

  describe('all() - Multi-Row Query', () => {
    beforeEach(async () => {
      await db.initialize({
        dbPath: ':memory:',
        logger: mockLogger,
        metrics: mockMetrics,
      });
    });

    it('should track query metrics and log row count on success', async () => {
      await db.all(
        'SELECT 1 as n UNION SELECT 2 UNION SELECT 3',
        [],
        'test_all_query'
      );

      expect(mockMetrics.queryDuration.labels).toHaveBeenCalledWith(
        'test_all_query'
      );
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.objectContaining({
          queryType: 'test_all_query',
          rowCount: 3,
        }),
        'Database query completed'
      );
    });

    it('should reject on invalid SQL and log + count the error', async () => {
      await expect(
        db.all('SELECT * FROM nonexistent_table')
      ).rejects.toThrow();

      expect(mockLogger.error).toHaveBeenCalled();
      expect(mockMetrics.errors.labels).toHaveBeenCalled();
    });
  });

  describe('close()', () => {
    it('should close database connection', async () => {
      await db.initialize({
        dbPath: ':memory:',
        logger: mockLogger,
        metrics: mockMetrics,
      });

      await db.close();

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Database connection closed'
      );
    });

    it('should resolve if database is not initialized', async () => {
      await expect(db.close()).resolves.toBeUndefined();
    });
  });

  describe('isHealthy()', () => {
    it('should return true for healthy database', async () => {
      await db.initialize({
        dbPath: ':memory:',
        logger: mockLogger,
        metrics: mockMetrics,
      });

      const healthy = await db.isHealthy();
      expect(healthy).toBe(true);
    });

    it('should return false for unhealthy database', async () => {
      await db.initialize({
        dbPath: ':memory:',
        logger: mockLogger,
        metrics: mockMetrics,
      });

      // Corrupt the database by closing it
      await db.close();

      const healthy = await db.isHealthy();
      expect(healthy).toBe(false);
    });

    it('should return false if database not initialized', async () => {
      const healthy = await db.isHealthy();
      expect(healthy).toBe(false);
    });
  });

  describe('Error Handling', () => {
    beforeEach(async () => {
      await db.initialize({
        dbPath: ':memory:',
        logger: mockLogger,
        metrics: mockMetrics,
      });
    });

    it('should log structured error context on SQL errors', async () => {
      await expect(db.get('SELECT * FORM invalid_table')).rejects.toThrow();

      expect(mockLogger.error).toHaveBeenCalled();
      const errorCall = mockLogger.error.mock.calls[0];
      expect(errorCall[0]).toHaveProperty('err');
      expect(errorCall[0]).toHaveProperty('queryType', 'unknown');
      expect(errorCall[0]).toHaveProperty('duration');
      expect(errorCall[1]).toBe('Database query error');
    });

    it('should track errors in metrics with the supplied label', async () => {
      await expect(
        db.get('INVALID SQL', [], 'error_query')
      ).rejects.toThrow();

      expect(mockMetrics.errors.labels).toHaveBeenCalledWith('error_query');
    });
  });

  describe('Database Connection Management', () => {
    it('should handle multiple initializations', async () => {
      await db.initialize({
        dbPath: ':memory:',
        logger: mockLogger,
        metrics: mockMetrics,
      });

      await db.close();

      await db.initialize({
        dbPath: ':memory:',
        logger: mockLogger,
        metrics: mockMetrics,
      });

      const healthy = await db.isHealthy();
      expect(healthy).toBe(true);
    });

    it('should log debug message after applying optimization settings', async () => {
      await db.initialize({
        dbPath: ':memory:',
        logger: mockLogger,
        metrics: mockMetrics,
      });

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Database optimization settings applied'
      );
    });
  });
});
