import Database from 'better-sqlite3';
import { appConfig } from './config.ts';
import { migrationsCore, type SchemaMigration } from './db/migrationsCore.ts';
import { migrationsV2ToV14 } from './db/migrationsV2ToV14.ts';
import { migrationsV15ToV28 } from './db/migrationsV15ToV28.ts';
import { migrationsV29 } from './db/migrationsV29.ts';
import { seedPromptsAndLlmSettings } from './db/seedPromptsAndLlm.ts';
import { seedWorkflowsAndInstances } from './db/seedWorkflowsAndInstances.ts';

/**
 * Initialize SQLite database in WAL mode with foreign keys enabled.
 */
export const db = new Database(appConfig.databasePath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

const ALL_MIGRATIONS: SchemaMigration[] = [
  ...migrationsCore,
  ...migrationsV2ToV14,
  ...migrationsV15ToV28,
  ...migrationsV29,
];

/**
 * Runs pending versioned schema migrations and idempotent startup seeders.
 */
export function runMigrations(targetDb: Database.Database = db): void {
  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const applied = new Set<number>(
    (targetDb.prepare('SELECT version FROM schema_migrations').all() as { version: number }[]).map(
      (r) => r.version
    )
  );

  const insertMigration = targetDb.prepare(
    'INSERT INTO schema_migrations (version, name) VALUES (?, ?)'
  );
  for (const migration of ALL_MIGRATIONS) {
    if (!applied.has(migration.version)) {
      const tx = targetDb.transaction(() => {
        targetDb.exec(migration.sql);
        insertMigration.run(migration.version, migration.name);
      });
      tx();
    }
  }

  seedPromptsAndLlmSettings(targetDb);
  seedWorkflowsAndInstances(targetDb);
}
