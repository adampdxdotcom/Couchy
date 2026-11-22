import type { SchemaMigration } from './migrationsCore.ts';

/**
 * Schema migration v30: tracks Civitai post publish state, reaction/comment counts,
 * seen-activity baselines, and last sync timestamp on `image_civitai_drafts`.
 */
export const migrationsV30: SchemaMigration[] = [
  {
    version: 30,
    name: 'civitai_share_activity',
    sql: `
      ALTER TABLE image_civitai_drafts ADD COLUMN status TEXT NOT NULL DEFAULT 'draft';
      ALTER TABLE image_civitai_drafts ADD COLUMN civitai_image_id INTEGER;
      ALTER TABLE image_civitai_drafts ADD COLUMN published_url TEXT;
      ALTER TABLE image_civitai_drafts ADD COLUMN reaction_count INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE image_civitai_drafts ADD COLUMN comment_count INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE image_civitai_drafts ADD COLUMN seen_reaction_count INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE image_civitai_drafts ADD COLUMN seen_comment_count INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE image_civitai_drafts ADD COLUMN stats_synced_at TEXT;

      CREATE INDEX IF NOT EXISTS idx_image_civitai_drafts_status
        ON image_civitai_drafts(status, stats_synced_at);
    `,
  },
];
