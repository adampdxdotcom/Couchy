import type { SchemaMigration } from './migrationsCore.ts';

/**
 * Schema migration v32: stores Civitai creator attribution, model/version upload stats,
 * and cached model-level comment threads on `models`.
 */
export const migrationsV32: SchemaMigration[] = [
  {
    version: 32,
    name: 'civitai_model_stats_and_creator_matching',
    sql: `
      ALTER TABLE models ADD COLUMN civitai_creator_username TEXT;
      ALTER TABLE models ADD COLUMN is_own_civitai_upload INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE models ADD COLUMN civitai_stats_json TEXT;
      ALTER TABLE models ADD COLUMN civitai_comments_json TEXT;
      ALTER TABLE models ADD COLUMN civitai_stats_synced_at TEXT;
    `,
  },
];
