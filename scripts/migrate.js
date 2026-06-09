#!/usr/bin/env node

/**
 * Database Migration System
 *
 * Simple migration system for SQLite database schema changes.
 * Tracks applied migrations in a migrations table.
 *
 * Usage:
 *   node migrate.js up              - Run all pending migrations
 *   node migrate.js down            - Rollback last migration
 *   node migrate.js status          - Show migration status
 *   node migrate.js create <name>   - Create a new migration file
 */

const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

const DB_PATH = process.env.DB_PATH || './coffee_shops.db';
const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

// Open database (not read-only for migrations)
const db = new sqlite3.Database(DB_PATH, (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
        process.exit(1);
    }
});

// Ensure migrations table exists
function ensureMigrationsTable() {
    return new Promise((resolve, reject) => {
        db.run(`
            CREATE TABLE IF NOT EXISTS migrations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `, (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
}

// Get list of applied migrations
function getAppliedMigrations() {
    return new Promise((resolve, reject) => {
        db.all('SELECT name FROM migrations ORDER BY name', (err, rows) => {
            if (err) reject(err);
            else resolve(rows.map(row => row.name));
        });
    });
}

// Get list of migration files
function getMigrationFiles() {
    if (!fs.existsSync(MIGRATIONS_DIR)) {
        fs.mkdirSync(MIGRATIONS_DIR, { recursive: true });
    }
    return fs.readdirSync(MIGRATIONS_DIR)
        .filter(f => f.endsWith('.sql'))
        .sort();
}

function runAsync(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
            if (err) reject(err);
            else resolve(this);
        });
    });
}

function execAsync(sql) {
    return new Promise((resolve, reject) => {
        db.exec(sql, (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
}

function getMigrationSql(filename, direction = 'up') {
    const filepath = path.join(MIGRATIONS_DIR, filename);
    const content = fs.readFileSync(filepath, 'utf8');

    // Split by -- migration:up and -- migration:down comments
    const parts = content.split(/-- migration:(up|down)/i);

    let sql;
    if (direction === 'up') {
        // Find the 'up' section
        const upIndex = parts.findIndex(p => p.trim().toLowerCase() === 'up');
        sql = upIndex >= 0 ? parts[upIndex + 1] : content;
    } else {
        // Find the 'down' section
        const downIndex = parts.findIndex(p => p.trim().toLowerCase() === 'down');
        sql = downIndex >= 0 ? parts[downIndex + 1] : '';
    }

    if (!sql || !sql.trim()) {
        throw new Error(`No ${direction} migration found in ${filename}`);
    }

    return sql;
}

// Run a migration file
async function runMigration(filename, direction = 'up') {
    const sql = getMigrationSql(filename, direction);

    await runAsync('BEGIN TRANSACTION');
    try {
        await execAsync(sql);

        if (direction === 'up') {
            // Record migration as applied inside the same transaction.
            await runAsync('INSERT INTO migrations (name) VALUES (?)', [filename]);
        } else {
            // Remove migration record inside the same transaction.
            await runAsync('DELETE FROM migrations WHERE name = ?', [filename]);
        }

        await runAsync('COMMIT');
    } catch (err) {
        try {
            await runAsync('ROLLBACK');
        } catch (rollbackErr) {
            err.message = `${err.message}; rollback failed: ${rollbackErr.message}`;
        }
        throw err;
    }
}

// Migrate up (apply pending migrations)
async function migrateUp() {
    try {
        await ensureMigrationsTable();

        const applied = await getAppliedMigrations();
        const files = getMigrationFiles();
        const pending = files.filter(f => !applied.includes(f));

        if (pending.length === 0) {
            console.log('✓ No pending migrations');
            return;
        }

        console.log(`Running ${pending.length} migration(s)...`);

        for (const file of pending) {
            console.log(`  Applying: ${file}`);
            await runMigration(file, 'up');
            console.log(`  ✓ Applied: ${file}`);
        }

        console.log(`\n✓ Successfully applied ${pending.length} migration(s)`);
    } catch (err) {
        console.error('✗ Migration failed:', err.message);
        process.exit(1);
    }
}

// Migrate down (rollback last migration)
async function migrateDown() {
    try {
        await ensureMigrationsTable();

        const applied = await getAppliedMigrations();

        if (applied.length === 0) {
            console.log('✓ No migrations to rollback');
            return;
        }

        const lastMigration = applied[applied.length - 1];
        console.log(`Rolling back: ${lastMigration}`);

        await runMigration(lastMigration, 'down');
        console.log(`✓ Rolled back: ${lastMigration}`);
    } catch (err) {
        console.error('✗ Rollback failed:', err.message);
        process.exit(1);
    }
}

// Show migration status
async function showStatus() {
    try {
        await ensureMigrationsTable();

        const applied = await getAppliedMigrations();
        const files = getMigrationFiles();

        console.log('\nMigration Status:');
        console.log('─'.repeat(60));

        for (const file of files) {
            const status = applied.includes(file) ? '✓ Applied' : '✗ Pending';
            console.log(`${status}  ${file}`);
        }

        console.log('─'.repeat(60));
        console.log(`Total: ${files.length}, Applied: ${applied.length}, Pending: ${files.length - applied.length}`);
    } catch (err) {
        console.error('Error:', err.message);
        process.exit(1);
    }
}

// Create a new migration file
function createMigration(name) {
    if (!name) {
        console.error('Error: Migration name required');
        console.log('Usage: node migrate.js create <name>');
        process.exit(1);
    }

    // Generate timestamp-based filename
    const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '_');
    const filename = `${timestamp}_${name.replace(/\s+/g, '_')}.sql`;
    const filepath = path.join(MIGRATIONS_DIR, filename);

    // Create migration template
    const template = `-- Migration: ${name}
-- Created: ${new Date().toISOString()}

-- migration:up
-- Write your UP migration SQL here
-- Example:
-- ALTER TABLE coffee_shops ADD COLUMN new_column TEXT;
-- CREATE INDEX idx_new_column ON coffee_shops(new_column);


-- migration:down
-- Write your DOWN migration SQL here (to undo the above changes)
-- Example:
-- DROP INDEX IF EXISTS idx_new_column;
-- ALTER TABLE coffee_shops DROP COLUMN new_column;

`;

    if (!fs.existsSync(MIGRATIONS_DIR)) {
        fs.mkdirSync(MIGRATIONS_DIR, { recursive: true });
    }

    fs.writeFileSync(filepath, template);
    console.log(`✓ Created migration: ${filename}`);
    console.log(`  Edit: ${filepath}`);
}

// Main
async function main() {
    const command = process.argv[2];
    const arg = process.argv[3];

    switch (command) {
        case 'up':
            await migrateUp();
            break;
        case 'down':
            await migrateDown();
            break;
        case 'status':
            await showStatus();
            break;
        case 'create':
            createMigration(arg);
            break;
        default:
            console.log(`
Database Migration System

Usage:
  node migrate.js up              - Run all pending migrations
  node migrate.js down            - Rollback last migration
  node migrate.js status          - Show migration status
  node migrate.js create <name>   - Create a new migration file

Examples:
  node migrate.js create add_state_column
  node migrate.js up
  node migrate.js status
  node migrate.js down
            `);
            process.exit(1);
    }

    db.close();
}

main().catch(err => {
    console.error('Fatal error:', err);
    db.close();
    process.exit(1);
});
