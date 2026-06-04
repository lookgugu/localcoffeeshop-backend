/**
 * Test Server Utilities
 *
 * Builds an Express app via `buildApp` with test-friendly dependencies
 * (silent logger, no-op metrics, optional test database), then starts
 * the server on a random port so each test suite runs in isolation.
 */

const pino = require('pino');
const { buildApp } = require('../../src/app');
const { loadConfig } = require('../../src/config');
const { buildMetrics } = require('../../src/lib/metrics');
const { QueryCache } = require('../../src/lib/cache');
const db = require('../../src/db');
const enums = require('../../src/enums');

let server = null;
let serverUrl = null;

// pino-http expects a real pino instance, not a stub — using level: 'silent'
// is the supported way to suppress output without breaking the middleware.
function silentLogger() {
  return pino({ level: 'silent' });
}

/**
 * Start a test server on a random available port.
 * @param {import('sqlite3').Database} [testDb] Optional test database
 * @returns {Promise<{server: import('http').Server, url: string, port: number}>}
 */
async function startTestServer(testDb = null) {
  const logger = silentLogger();
  const metrics = buildMetrics();
  const cache = new QueryCache({ maxEntries: 10000 });
  const config = loadConfig(process.env);

  if (testDb) {
    // Initialize the db module so it has a valid logger/metrics for any code
    // path that calls db methods we *don't* override below.
    const mockMetrics = {
      queryDuration: { labels: () => ({ observe: () => {} }) },
      errors: { labels: () => ({ inc: () => {} }) },
    };
    await db.initialize({ dbPath: ':memory:', logger, metrics: mockMetrics });

    // Route db.get / db.all / db.run through the test database instance so suites
    // get their seeded fixtures rather than the empty in-memory db.
    db.get = (query, params) => new Promise((resolve, reject) => {
      testDb.get(query, params, (err, row) => (err ? reject(err) : resolve(row)));
    });
    db.all = (query, params) => new Promise((resolve, reject) => {
      testDb.all(query, params, (err, rows) => (err ? reject(err) : resolve(rows)));
    });
    db.run = (query, params) => new Promise((resolve, reject) => {
      // 'function' (not arrow) — sqlite3 surfaces lastID/changes on `this`.
      testDb.run(query, params, function (err) {
        if (err) return reject(err);
        resolve({ lastID: this.lastID, changes: this.changes });
      });
    });
  }

  const app = buildApp({ config, db, cache, logger, metrics, enums });

  return new Promise((resolve, reject) => {
    server = app.listen(0, (err) => {
      if (err) {
        reject(err);
        return;
      }
      const port = server.address().port;
      serverUrl = `http://localhost:${port}`;
      resolve({ server, url: serverUrl, port });
    });
  });
}

async function stopTestServer() {
  return new Promise((resolve) => {
    if (!server) {
      resolve();
      return;
    }
    server.close(() => {
      server = null;
      serverUrl = null;
      resolve();
    });
  });
}

function getTestServerUrl() {
  if (!serverUrl) {
    throw new Error('Test server not started. Call startTestServer() first.');
  }
  return serverUrl;
}

function getTestServer() {
  if (!server) {
    throw new Error('Test server not started. Call startTestServer() first.');
  }
  return server;
}

function isServerRunning() {
  return server !== null;
}

module.exports = {
  startTestServer,
  stopTestServer,
  getTestServerUrl,
  getTestServer,
  isServerRunning,
};
