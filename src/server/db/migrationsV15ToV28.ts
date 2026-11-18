import type { SchemaMigration } from './migrationsCore.ts';

/**
 * Schema migrations v15 through v28: scheduled downloads, series kind,
 * cleanup tracking, character portraits/faces, LoRA presets, and agent flags.
 */
export const migrationsV15ToV28: SchemaMigration[] = [
  {
    version: 15,
    name: 'download_jobs_early_access_schedule',
    sql: `
      ALTER TABLE download_jobs ADD COLUMN scheduled_for TEXT;
      ALTER TABLE download_jobs ADD COLUMN payload_json TEXT;
      CREATE INDEX IF NOT EXISTS idx_download_jobs_status_scheduled ON download_jobs(status, scheduled_for);
    `,
  },
  {
    version: 16,
    name: 'image_series_kind',
    sql: `
      ALTER TABLE image_series ADD COLUMN series_kind TEXT NOT NULL DEFAULT 'iterative';
      UPDATE image_series
      SET series_kind = 'multi_shot'
      WHERE id IN (
        SELECT gb.series_id
        FROM generation_batches gb
        WHERE gb.series_id IS NOT NULL
          AND gb.total_count > 1
          AND gb.branch_from_image_id IS NULL
          AND (
            SELECT COUNT(*)
            FROM generation_batches gb2
            WHERE gb2.series_id = gb.series_id
          ) = 1
      );
    `,
  },
  {
    version: 17,
    name: 'downloaded_model_cleanup_tracking',
    sql: `
      CREATE TABLE IF NOT EXISTS downloaded_model_copies (
        download_path TEXT PRIMARY KEY,
        filename TEXT NOT NULL,
        file_size INTEGER NOT NULL,
        dl_mtime_ms INTEGER NOT NULL,
        comfy_path TEXT,
        comfy_mtime_ms INTEGER,
        verified_sha256 TEXT,
        verified_at TEXT,
        last_checked_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_downloaded_model_copies_verified
        ON downloaded_model_copies(verified_at);
    `,
  },
  {
    version: 18,
    name: 'lm_studio_batch_expansion_prompt',
    sql: `
      ALTER TABLE lm_studio_settings ADD COLUMN batch_expansion_prompt TEXT NOT NULL DEFAULT '';
    `,
  },
  {
    version: 19,
    name: 'character_physical_description',
    sql: `
      ALTER TABLE characters ADD COLUMN physical_description TEXT NOT NULL DEFAULT '';
    `,
  },
  {
    version: 20,
    name: 'character_portrait_crop',
    sql: `
      ALTER TABLE characters ADD COLUMN portrait_crop_json TEXT DEFAULT NULL;
    `,
  },
  {
    version: 21,
    name: 'model_comfyui_vs_download_paths',
    sql: `
      ALTER TABLE models ADD COLUMN comfyui_path TEXT;
      ALTER TABLE models ADD COLUMN download_file_path TEXT;
    `,
  },
  {
    version: 22,
    name: 'generation_batch_loras_json',
    sql: `
      ALTER TABLE generation_batches ADD COLUMN lora_names_json TEXT;
    `,
  },
  {
    version: 23,
    name: 'uploaded_inspiration_reference_images',
    sql: `
      ALTER TABLE images ADD COLUMN is_uploaded_reference INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE generation_batches ADD COLUMN inspiration_image_id INTEGER;
      CREATE INDEX IF NOT EXISTS idx_images_uploaded_ref ON images(is_uploaded_reference);
    `,
  },
  {
    version: 24,
    name: 'pending_lora_character_headshot_tasks',
    sql: `
      CREATE TABLE IF NOT EXISTS pending_lora_character_tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        download_job_id INTEGER REFERENCES download_jobs(id) ON DELETE SET NULL,
        lora_filename TEXT NOT NULL,
        character_name TEXT NOT NULL,
        trigger_word TEXT NOT NULL DEFAULT '',
        recommended_weight REAL,
        generate_headshot INTEGER NOT NULL DEFAULT 1,
        character_id INTEGER REFERENCES characters(id) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT 'awaiting_comfy',
        generation_item_id INTEGER,
        error_message TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_pending_lora_char_status
        ON pending_lora_character_tasks(status);
    `,
  },
  {
    version: 25,
    name: 'character_face_embeddings_cache',
    sql: `
      CREATE TABLE IF NOT EXISTS character_face_embeddings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
        image_id INTEGER REFERENCES images(id) ON DELETE CASCADE,
        image_content_hash TEXT NOT NULL,
        source_kind TEXT NOT NULL DEFAULT 'portrait',
        face_index INTEGER NOT NULL DEFAULT 0,
        embedding_b64 TEXT NOT NULL,
        det_score REAL NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(character_id, image_content_hash, face_index)
      );
      CREATE INDEX IF NOT EXISTS idx_char_face_embeddings_char
        ON character_face_embeddings(character_id, source_kind);
    `,
  },
  {
    version: 26,
    name: 'pin_existing_character_portraits',
    sql: `
      UPDATE characters
      SET portrait_image_id = (
            SELECT i.id
            FROM image_characters ic
            JOIN images i ON i.content_hash = ic.image_content_hash AND i.is_missing = 0
            LEFT JOIN ratings r ON r.content_hash = i.content_hash
            WHERE ic.character_id = characters.id
              AND ic.status = 'confirmed'
              AND COALESCE(i.is_uploaded_reference, 0) = 0
            ORDER BY COALESCE(r.rating, 0) DESC, i.file_mtime DESC, i.id DESC
            LIMIT 1
          ),
          portrait_content_hash = (
            SELECT i.content_hash
            FROM image_characters ic
            JOIN images i ON i.content_hash = ic.image_content_hash AND i.is_missing = 0
            LEFT JOIN ratings r ON r.content_hash = i.content_hash
            WHERE ic.character_id = characters.id
              AND ic.status = 'confirmed'
              AND COALESCE(i.is_uploaded_reference, 0) = 0
            ORDER BY COALESCE(r.rating, 0) DESC, i.file_mtime DESC, i.id DESC
            LIMIT 1
          )
      WHERE portrait_image_id IS NULL
        AND portrait_content_hash IS NULL
        AND EXISTS (
          SELECT 1
          FROM image_characters ic
          JOIN images i ON i.content_hash = ic.image_content_hash AND i.is_missing = 0
          WHERE ic.character_id = characters.id
            AND ic.status = 'confirmed'
            AND COALESCE(i.is_uploaded_reference, 0) = 0
        );
    `,
  },
  {
    version: 27,
    name: 'lm_studio_follow_loaded_model',
    sql: `
      ALTER TABLE lm_studio_settings ADD COLUMN follow_loaded_model INTEGER NOT NULL DEFAULT 1;
    `,
  },
  {
    version: 28,
    name: 'lora_presets',
    sql: `
      CREATE TABLE IF NOT EXISTS lora_presets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        nickname TEXT NOT NULL DEFAULT '',
        user_description TEXT NOT NULL DEFAULT '',
        agent_description TEXT NOT NULL DEFAULT '',
        pill_color TEXT NOT NULL DEFAULT 'fuchsia',
        checkpoint_name TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS lora_preset_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        preset_id INTEGER NOT NULL REFERENCES lora_presets(id) ON DELETE CASCADE,
        lora_name TEXT NOT NULL,
        model_strength REAL NOT NULL DEFAULT 1.0,
        clip_strength REAL NOT NULL DEFAULT 1.0,
        sort_order INTEGER NOT NULL DEFAULT 0,
        UNIQUE(preset_id, lora_name)
      );
    `,
  },
];
