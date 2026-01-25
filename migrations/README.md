# Database Migrations

This directory contains database migration files for managing schema changes.

## Migration System

The migration system tracks applied migrations in a `migrations` table in the database.
Each migration file contains both "up" (apply) and "down" (rollback) SQL statements.

## Usage

### View Migration Status
```bash
node migrate.js status
```

### Create a New Migration
```bash
node migrate.js create add_new_column
```
This creates a timestamped migration file in the `migrations/` directory.

### Apply Pending Migrations
```bash
node migrate.js up
```
Runs all migrations that haven't been applied yet.

### Rollback Last Migration
```bash
node migrate.js down
```
Rolls back the most recently applied migration.

## Migration File Format

Migration files use the following format:

```sql
-- Migration: Description of changes
-- Created: 2025-01-12T12:00:00.000Z

-- migration:up
-- SQL statements to apply the migration
ALTER TABLE coffee_shops ADD COLUMN new_field TEXT;
CREATE INDEX idx_new_field ON coffee_shops(new_field);

-- migration:down
-- SQL statements to rollback the migration
DROP INDEX IF EXISTS idx_new_field;
-- Note: SQLite doesn't support DROP COLUMN in ALTER TABLE
-- You may need to recreate the table without the column
```

## Best Practices

1. **Always test migrations** on a copy of your database first
2. **Create backups** before running migrations in production
3. **Keep migrations small** - one logical change per migration
4. **Write rollback SQL** - always include a working "down" migration
5. **Never edit applied migrations** - create a new migration instead
6. **Use transactions** - migrations run in transactions automatically

## SQLite Limitations

SQLite has limited ALTER TABLE support:
- ✅ Can add columns
- ✅ Can rename tables
- ❌ Cannot drop columns (requires table recreation)
- ❌ Cannot modify column types (requires table recreation)

For complex changes, you may need to:
1. Create new table with desired schema
2. Copy data from old table
3. Drop old table
4. Rename new table

## Example: Table Recreation

```sql
-- migration:up
BEGIN TRANSACTION;

-- Create new table with updated schema
CREATE TABLE coffee_shops_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    address TEXT NOT NULL,
    state TEXT,
    price_level TEXT,
    language_code TEXT DEFAULT 'en',
    source_file TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Copy data from old table
INSERT INTO coffee_shops_new SELECT * FROM coffee_shops;

-- Drop old table
DROP TABLE coffee_shops;

-- Rename new table
ALTER TABLE coffee_shops_new RENAME TO coffee_shops;

-- Recreate indexes
CREATE INDEX idx_state ON coffee_shops(state);
CREATE INDEX idx_name ON coffee_shops(name);
CREATE INDEX idx_address ON coffee_shops(address);
CREATE INDEX idx_price_level ON coffee_shops(price_level);

COMMIT;

-- migration:down
-- Rollback would require reversing these steps
```

## Troubleshooting

### Migration Failed
If a migration fails, it will be rolled back automatically. Fix the SQL and try again.

### Database is Locked
Ensure no other processes are accessing the database during migration.

### Cannot Rollback
Some migrations (like data deletion) may not be reversible. Document limitations in migration comments.
