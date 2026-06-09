/**
 * Test Database Utilities
 *
 * Provides utilities for creating and managing in-memory SQLite databases
 * for testing. Matches production schema exactly including FTS5 indexes.
 */

const sqlite3 = require('sqlite3').verbose();

/**
 * Create a test database with the production schema
 * Uses in-memory SQLite (:memory:) for fast, isolated tests
 * @returns {Promise<sqlite3.Database>} Database instance
 */
function createTestDatabase() {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(':memory:', (err) => {
      if (err) {
        reject(err);
        return;
      }

      // Create schema matching production exactly
      db.serialize(() => {
        // Main coffee_shops table
        db.run(`
          CREATE TABLE coffee_shops (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            address TEXT NOT NULL,
            price_level TEXT,
            language_code TEXT DEFAULT 'en',
            source_file TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            state TEXT,
            latitude REAL,
            longitude REAL
          )
        `, (err) => {
          if (err) {
            reject(err);
            return;
          }
        });

        // Create FTS5 virtual table for full-text search
        db.run(`
          CREATE VIRTUAL TABLE coffee_shops_fts USING fts5(
            name,
            address,
            content='coffee_shops',
            content_rowid='id'
          )
        `, (err) => {
          if (err) {
            reject(err);
            return;
          }
        });

        // Create triggers to keep FTS table in sync
        db.run(`
          CREATE TRIGGER coffee_shops_ai AFTER INSERT ON coffee_shops BEGIN
            INSERT INTO coffee_shops_fts(rowid, name, address)
            VALUES (new.id, new.name, new.address);
          END
        `);

        db.run(`
          CREATE TRIGGER coffee_shops_ad AFTER DELETE ON coffee_shops BEGIN
            DELETE FROM coffee_shops_fts WHERE rowid = old.id;
          END
        `);

        db.run(`
          CREATE TRIGGER coffee_shops_au AFTER UPDATE ON coffee_shops BEGIN
            UPDATE coffee_shops_fts
            SET name = new.name, address = new.address
            WHERE rowid = new.id;
          END
        `);

        // Create indexes matching production
        db.run('CREATE INDEX idx_name ON coffee_shops(name)');
        db.run('CREATE INDEX idx_address ON coffee_shops(address)');
        db.run('CREATE INDEX idx_price_level ON coffee_shops(price_level)');
        db.run('CREATE INDEX idx_state ON coffee_shops(state)');
        db.run('CREATE INDEX idx_state_name ON coffee_shops(state, name)');
        db.run('CREATE INDEX idx_state_price ON coffee_shops(state, price_level)');
        db.run('CREATE INDEX idx_state_price_name ON coffee_shops(state, price_level, name)');
        db.run('CREATE INDEX idx_created_at ON coffee_shops(created_at DESC)');
        db.run('CREATE INDEX idx_search_covering ON coffee_shops(name, address, state, price_level)');
        db.run('CREATE INDEX idx_coffee_shops_coordinates ON coffee_shops(latitude, longitude) WHERE latitude IS NOT NULL AND longitude IS NOT NULL');

        // Idempotency keys table — backs src/lib/idempotency.js.
        // Combines migrations 004 + 005 (the `status` column was added in 005
        // so the middleware can reserve a row before the handler runs and
        // catch concurrent retries with the same key).
        db.run(`
          CREATE TABLE idempotency_keys (
            key         TEXT PRIMARY KEY,
            endpoint    TEXT NOT NULL,
            status_code INTEGER NOT NULL,
            response    TEXT NOT NULL,
            created_at  INTEGER NOT NULL,
            status      TEXT NOT NULL DEFAULT 'completed'
          )
        `);
        db.run('CREATE INDEX idx_idempotency_created_at ON idempotency_keys(created_at)', (err) => {
          if (err) {
            reject(err);
          } else {
            resolve(db);
          }
        });
      });
    });
  });
}

/**
 * Seed the test database with fixture data
 * @param {sqlite3.Database} db Database instance
 * @param {Array} fixtures Array of coffee shop fixtures
 * @returns {Promise<void>}
 */
function seedTestData(db, fixtures) {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run('BEGIN TRANSACTION', (err) => {
        if (err) {
          reject(err);
          return;
        }
      });

      const stmt = db.prepare(`
        INSERT INTO coffee_shops (name, address, price_level, language_code, state, source_file)
        VALUES (?, ?, ?, ?, ?, ?)
      `);

      for (const shop of fixtures) {
        stmt.run(
          shop.name,
          shop.address,
          shop.price_level,
          shop.language_code || 'en',
          shop.state,
          shop.source_file || 'test_fixture.json'
        );
      }

      stmt.finalize((err) => {
        if (err) {
          db.run('ROLLBACK', () => {
            reject(err);
          });
          return;
        }

        db.run('COMMIT', (err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      });
    });
  });
}

/**
 * Clean the database by deleting all records
 * @param {sqlite3.Database} db Database instance
 * @returns {Promise<void>}
 */
function cleanDatabase(db) {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run('DELETE FROM coffee_shops', (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  });
}

/**
 * Close the database connection
 * @param {sqlite3.Database} db Database instance
 * @returns {Promise<void>}
 */
function closeDatabase(db) {
  return new Promise((resolve, reject) => {
    db.close((err) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

/**
 * Execute a query and return all rows
 * @param {sqlite3.Database} db Database instance
 * @param {string} query SQL query
 * @param {Array} params Query parameters
 * @returns {Promise<Array>}
 */
function queryAll(db, query, params = []) {
  return new Promise((resolve, reject) => {
    db.all(query, params, (err, rows) => {
      if (err) {
        reject(err);
      } else {
        resolve(rows);
      }
    });
  });
}

/**
 * Execute a query and return a single row
 * @param {sqlite3.Database} db Database instance
 * @param {string} query SQL query
 * @param {Array} params Query parameters
 * @returns {Promise<Object>}
 */
function queryGet(db, query, params = []) {
  return new Promise((resolve, reject) => {
    db.get(query, params, (err, row) => {
      if (err) {
        reject(err);
      } else {
        resolve(row);
      }
    });
  });
}

module.exports = {
  createTestDatabase,
  seedTestData,
  cleanDatabase,
  closeDatabase,
  queryAll,
  queryGet,
};
