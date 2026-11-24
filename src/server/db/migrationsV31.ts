import type { SchemaMigration } from './migrationsCore.ts';

/**
 * Schema migration v31: stores Civitai reaction breakdowns (hearts vs emoji likes/laughs/cries),
 * per-image post mappings, and cached comment threads on `image_civitai_drafts`.
 */
export const migrationsV31: SchemaMigration[] = [
  {
    version: 31,
    name: 'civitai_feedback_details',
    sql: `
      ALTER TABLE image_civitai_drafts ADD COLUMN heart_count INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE image_civitai_drafts ADD COLUMN like_count INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE image_civitai_drafts ADD COLUMN laugh_count INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE image_civitai_drafts ADD COLUMN cry_count INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE image_civitai_drafts ADD COLUMN post_images_json TEXT;
      ALTER TABLE image_civitai_drafts ADD COLUMN comments_json TEXT;
      ALTER TABLE image_civitai_drafts ADD COLUMN comments_synced_at TEXT;
    `,
  },
];
