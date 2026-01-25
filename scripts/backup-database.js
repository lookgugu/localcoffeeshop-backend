#!/usr/bin/env node

/**
 * Database Backup Script
 *
 * Creates timestamped backups of the SQLite database.
 * Supports automatic cleanup of old backups based on retention policy.
 *
 * Usage:
 *   node backup-database.js              - Create backup with default settings
 *   node backup-database.js --keep 30    - Keep backups for 30 days
 *   node backup-database.js --dir ./backups  - Use custom backup directory
 *
 * Schedule with cron (daily at 2 AM):
 *   0 2 * * * cd /path/to/project && node backup-database.js >> logs/backup.log 2>&1
 */

const fs = require('fs');
const path = require('path');
const { promisify } = require('util');

const copyFile = promisify(fs.copyFile);
const readdir = promisify(fs.readdir);
const stat = promisify(fs.stat);
const unlink = promisify(fs.unlink);

// Configuration
const DB_PATH = process.env.DB_PATH || './coffee_shops.db';
const BACKUP_DIR = process.argv.includes('--dir') 
    ? process.argv[process.argv.indexOf('--dir') + 1] 
    : './backups';
const KEEP_DAYS = process.argv.includes('--keep')
    ? parseInt(process.argv[process.argv.indexOf('--keep') + 1])
    : 7; // Default: keep backups for 7 days

/**
 * Create a backup of the database
 */
async function createBackup() {
    try {
        // Ensure backup directory exists
        if (!fs.existsSync(BACKUP_DIR)) {
            fs.mkdirSync(BACKUP_DIR, { recursive: true });
            console.log(`✓ Created backup directory: ${BACKUP_DIR}`);
        }

        // Check if database exists
        if (!fs.existsSync(DB_PATH)) {
            throw new Error(`Database not found: ${DB_PATH}`);
        }

        // Get database file size
        const dbStats = await stat(DB_PATH);
        const sizeMB = (dbStats.size / (1024 * 1024)).toFixed(2);

        // Generate backup filename with timestamp
        const timestamp = new Date().toISOString()
            .replace(/[-:]/g, '')
            .replace(/\..+/, '')
            .replace('T', '_');
        const dbName = path.basename(DB_PATH, '.db');
        const backupFilename = `${dbName}_${timestamp}.db`;
        const backupPath = path.join(BACKUP_DIR, backupFilename);

        // Copy database file
        console.log(`\nCreating backup...`);
        console.log(`  Source: ${DB_PATH} (${sizeMB} MB)`);
        console.log(`  Destination: ${backupPath}`);

        await copyFile(DB_PATH, backupPath);

        // Verify backup was created
        const backupStats = await stat(backupPath);
        if (backupStats.size !== dbStats.size) {
            throw new Error('Backup file size mismatch');
        }

        console.log(`✓ Backup created successfully`);
        console.log(`  Size: ${(backupStats.size / (1024 * 1024)).toFixed(2)} MB`);

        return backupPath;
    } catch (error) {
        console.error('✗ Backup failed:', error.message);
        throw error;
    }
}

/**
 * Clean up old backups based on retention policy
 */
async function cleanupOldBackups() {
    try {
        if (!fs.existsSync(BACKUP_DIR)) {
            return;
        }

        const files = await readdir(BACKUP_DIR);
        const backupFiles = files.filter(f => f.endsWith('.db'));

        if (backupFiles.length === 0) {
            return;
        }

        const now = Date.now();
        const maxAge = KEEP_DAYS * 24 * 60 * 60 * 1000; // Convert days to milliseconds

        let deletedCount = 0;

        for (const file of backupFiles) {
            const filePath = path.join(BACKUP_DIR, file);
            const fileStats = await stat(filePath);
            const age = now - fileStats.mtime.getTime();

            if (age > maxAge) {
                await unlink(filePath);
                deletedCount++;
                console.log(`  Deleted old backup: ${file} (${Math.floor(age / (24 * 60 * 60 * 1000))} days old)`);
            }
        }

        if (deletedCount > 0) {
            console.log(`✓ Cleaned up ${deletedCount} old backup(s)`);
        } else {
            console.log(`✓ No old backups to clean up (keeping last ${KEEP_DAYS} days)`);
        }

        // Show current backup count
        const remainingBackups = await readdir(BACKUP_DIR);
        const remainingCount = remainingBackups.filter(f => f.endsWith('.db')).length;
        console.log(`  Current backup count: ${remainingCount}`);
    } catch (error) {
        console.error('✗ Cleanup failed:', error.message);
    }
}

/**
 * Show backup statistics
 */
async function showStats() {
    try {
        if (!fs.existsSync(BACKUP_DIR)) {
            console.log('\nNo backups found.');
            return;
        }

        const files = await readdir(BACKUP_DIR);
        const backupFiles = files.filter(f => f.endsWith('.db'));

        if (backupFiles.length === 0) {
            console.log('\nNo backups found.');
            return;
        }

        console.log('\n' + '─'.repeat(60));
        console.log('Backup Statistics');
        console.log('─'.repeat(60));

        let totalSize = 0;
        const backupInfo = [];

        for (const file of backupFiles) {
            const filePath = path.join(BACKUP_DIR, file);
            const fileStats = await stat(filePath);
            totalSize += fileStats.size;

            backupInfo.push({
                name: file,
                size: fileStats.size,
                date: fileStats.mtime
            });
        }

        // Sort by date (newest first)
        backupInfo.sort((a, b) => b.date - a.date);

        console.log(`Total backups: ${backupInfo.length}`);
        console.log(`Total size: ${(totalSize / (1024 * 1024)).toFixed(2)} MB`);
        console.log(`Retention: ${KEEP_DAYS} days`);
        console.log('\nRecent backups:');

        // Show last 5 backups
        for (let i = 0; i < Math.min(5, backupInfo.length); i++) {
            const backup = backupInfo[i];
            const sizeMB = (backup.size / (1024 * 1024)).toFixed(2);
            const date = backup.date.toISOString().replace('T', ' ').split('.')[0];
            console.log(`  ${backup.name} (${sizeMB} MB, ${date})`);
        }

        if (backupInfo.length > 5) {
            console.log(`  ... and ${backupInfo.length - 5} more`);
        }

        console.log('─'.repeat(60));
    } catch (error) {
        console.error('Error showing stats:', error.message);
    }
}

/**
 * Main function
 */
async function main() {
    console.log('\nDatabase Backup Tool');
    console.log('═'.repeat(60));

    try {
        // Create backup
        await createBackup();

        // Cleanup old backups
        console.log('\nCleaning up old backups...');
        await cleanupOldBackups();

        // Show statistics
        await showStats();

        console.log('\n✓ Backup completed successfully\n');
        process.exit(0);
    } catch (error) {
        console.error('\n✗ Backup process failed\n');
        process.exit(1);
    }
}

// Run if executed directly
if (require.main === module) {
    main();
}

module.exports = { createBackup, cleanupOldBackups };
