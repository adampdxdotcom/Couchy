import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type Database from 'better-sqlite3';

export interface TempDbContext {
  db: Database.Database;
  dbPath: string;
  cleanup: () => void;
}

/**
 * Sets DATABASE_PATH to a unique temp SQLite file before importing `db.ts`,
 * runs all migrations + default seeders, and provides a safe cleanup hook.
 */
export async function initTempDb(prefix = 'couchy-test'): Promise<TempDbContext> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
  const dbPath = path.join(dir, 'test-gallery.db');
  process.env.DATABASE_PATH = dbPath;

  const { db, runMigrations } = await import('../../src/server/db.ts');
  runMigrations(db);

  const cleanup = () => {
    try {
      db.close();
    } catch {
      // ignore already closed
    }
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore temp cleanup failure
    }
  };

  return { db, dbPath, cleanup };
}
