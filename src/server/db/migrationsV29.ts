import type { SchemaMigration } from './migrationsCore.ts';

/**
 * Schema migration v29: per-character Civitai sharing opt-in flag and draft submission log.
 */
export const migrationsV29: SchemaMigration[] = [
  {
    version: 29,
    name: 'civitai_draft_sharing',
    sql: `
      ALTER TABLE characters ADD COLUMN allow_civitai_share INTEGER NOT NULL DEFAULT 0;

      CREATE TABLE IF NOT EXISTS image_civitai_drafts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        image_id INTEGER NOT NULL REFERENCES images(id) ON DELETE CASCADE,
        image_content_hash TEXT NOT NULL,
        civitai_post_id INTEGER NOT NULL,
        draft_url TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        upload_mode TEXT NOT NULL DEFAULT 'original_png',
        model_version_id INTEGER,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_image_civitai_drafts_image
        ON image_civitai_drafts(image_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_image_civitai_drafts_hash
        ON image_civitai_drafts(image_content_hash);
    `,
  },
];
