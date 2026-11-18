import type { SchemaMigration } from './migrationsCore.ts';

/**
 * Schema migrations v2 through v14: generation studio, Krea2 mappings,
 * app settings, visual tagger, LoRA mentions, image series, and Civitai metadata.
 */
export const migrationsV2ToV14: SchemaMigration[] = [
  {
    version: 2,
    name: 'generation_studio_schema',
    sql: `
      -- 23. Prompt Templates (stored in database with {character}, {lora}, {theme} placeholders)
      CREATE TABLE IF NOT EXISTS prompt_templates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        positive_template TEXT NOT NULL,
        negative_template TEXT NOT NULL DEFAULT '',
        is_default INTEGER NOT NULL DEFAULT 0,
        category TEXT NOT NULL DEFAULT 'character',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- 24. Workflow Node Mappings (auto-detected & user-overridable node slots)
      CREATE TABLE IF NOT EXISTS workflow_mappings (
        workflow_id INTEGER PRIMARY KEY REFERENCES workflows(id) ON DELETE CASCADE,
        positive_prompt_node_id TEXT,
        positive_prompt_field TEXT NOT NULL DEFAULT 'text',
        negative_prompt_node_id TEXT,
        negative_prompt_field TEXT NOT NULL DEFAULT 'text',
        seed_node_id TEXT,
        seed_field TEXT NOT NULL DEFAULT 'seed',
        steps_node_id TEXT,
        cfg_node_id TEXT,
        sampler_node_id TEXT,
        latent_node_id TEXT,
        width_field TEXT NOT NULL DEFAULT 'width',
        height_field TEXT NOT NULL DEFAULT 'height',
        batch_size_field TEXT NOT NULL DEFAULT 'batch_size',
        checkpoint_node_id TEXT,
        lora_node_ids_json TEXT NOT NULL DEFAULT '[]',
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- 25. Generation Batches & Individual Prompt Items
      CREATE TABLE IF NOT EXISTS generation_batches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        character_id INTEGER REFERENCES characters(id) ON DELETE SET NULL,
        workflow_id INTEGER REFERENCES workflows(id) ON DELETE SET NULL,
        theme_title TEXT,
        mode TEXT NOT NULL DEFAULT 'single',
        total_count INTEGER NOT NULL DEFAULT 1,
        aspect_ratio TEXT NOT NULL DEFAULT '1:1',
        width INTEGER NOT NULL DEFAULT 1024,
        height INTEGER NOT NULL DEFAULT 1024,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS generation_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        batch_id INTEGER NOT NULL REFERENCES generation_batches(id) ON DELETE CASCADE,
        item_index INTEGER NOT NULL,
        prompt TEXT NOT NULL,
        negative_prompt TEXT NOT NULL DEFAULT '',
        seed TEXT NOT NULL,
        comfyui_prompt_id TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        error_message TEXT,
        output_image_id INTEGER REFERENCES images(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        completed_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_gen_items_batch ON generation_items(batch_id);
      CREATE INDEX IF NOT EXISTS idx_gen_items_prompt_id ON generation_items(comfyui_prompt_id);

      -- 26. LM Studio Agent Settings
      CREATE TABLE IF NOT EXISTS lm_studio_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        base_url TEXT NOT NULL DEFAULT 'http://localhost:1234/v1',
        selected_model TEXT NOT NULL DEFAULT '',
        system_prompt TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `,
  },
  {
    version: 3,
    name: 'megapixel_resolution_and_lmstudio_guiding_templates',
    sql: `
      -- 27. Multiple saved LM Studio Guiding Prompt Templates
      CREATE TABLE IF NOT EXISTS lm_studio_prompt_templates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        system_prompt TEXT NOT NULL,
        user_prompt_template TEXT NOT NULL,
        is_default INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- Add aspect_ratio_field and megapixels_field to workflow_mappings
      ALTER TABLE workflow_mappings ADD COLUMN aspect_ratio_field TEXT NOT NULL DEFAULT 'aspect_ratio';
      ALTER TABLE workflow_mappings ADD COLUMN megapixels_field TEXT NOT NULL DEFAULT 'megapixels';

      -- Add megapixels to generation_batches
      ALTER TABLE generation_batches ADD COLUMN megapixels REAL NOT NULL DEFAULT 1.0;
    `,
  },
  {
    version: 4,
    name: 'krea2_turbo_base_workflow_and_trigger_words',
    sql: `
      -- Add trigger_word to character_loras
      ALTER TABLE character_loras ADD COLUMN trigger_word TEXT NOT NULL DEFAULT '';

      -- Add trigger_word, enable_lora, and checkpoint_field mappings to workflow_mappings
      ALTER TABLE workflow_mappings ADD COLUMN trigger_word_node_id TEXT;
      ALTER TABLE workflow_mappings ADD COLUMN trigger_word_field TEXT NOT NULL DEFAULT 'string_b';
      ALTER TABLE workflow_mappings ADD COLUMN enable_lora_node_id TEXT;
      ALTER TABLE workflow_mappings ADD COLUMN enable_lora_field TEXT NOT NULL DEFAULT 'value';
      ALTER TABLE workflow_mappings ADD COLUMN checkpoint_field TEXT NOT NULL DEFAULT 'unet_name';
    `,
  },
  {
    version: 5,
    name: 'app_settings_and_high_scale_indexes',
    sql: `
      -- Application key-value settings table (UI preferences & one-time backfill flags)
      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- High-scale indexes for 2,000+ image libraries
      CREATE INDEX IF NOT EXISTS idx_models_filename_lower ON models(LOWER(filename));
      CREATE INDEX IF NOT EXISTS idx_image_loras_name_lower ON image_loras(LOWER(lora_name));
      CREATE INDEX IF NOT EXISTS idx_image_workflows_wf ON image_workflows(workflow_id);
      CREATE INDEX IF NOT EXISTS idx_image_tags_hash ON image_tags(image_content_hash);
      CREATE INDEX IF NOT EXISTS idx_collection_images_hash ON collection_images(image_content_hash);
    `,
  },
  {
    version: 6,
    name: 'workflows_is_default_flag',
    sql: `
      ALTER TABLE workflows ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0;
    `,
  },
  {
    version: 7,
    name: 'visual_keyword_tagger_schema',
    sql: `
      ALTER TABLE images ADD COLUMN visual_tags_scanned_at TEXT;

      CREATE TABLE IF NOT EXISTS image_visual_tags (
        image_content_hash TEXT NOT NULL,
        image_id INTEGER REFERENCES images(id) ON DELETE SET NULL,
        tag TEXT NOT NULL COLLATE NOCASE,
        confidence REAL NOT NULL DEFAULT 1.0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (image_content_hash, tag)
      );
      CREATE INDEX IF NOT EXISTS idx_img_visual_tags_hash ON image_visual_tags(image_content_hash);
      CREATE INDEX IF NOT EXISTS idx_img_visual_tags_tag ON image_visual_tags(LOWER(tag));
    `,
  },
  {
    version: 8,
    name: 'lora_mentions_and_nicknames',
    sql: `
      ALTER TABLE models ADD COLUMN nickname TEXT;
      ALTER TABLE models ADD COLUMN mention_enabled INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE models ADD COLUMN default_model_strength REAL NOT NULL DEFAULT 1.0;
      ALTER TABLE models ADD COLUMN default_clip_strength REAL NOT NULL DEFAULT 1.0;

      CREATE INDEX IF NOT EXISTS idx_models_nickname ON models(LOWER(nickname));
      CREATE INDEX IF NOT EXISTS idx_models_mention_enabled ON models(mention_enabled);
    `,
  },
  {
    version: 9,
    name: 'generation_batch_ghost_metadata',
    sql: `
      ALTER TABLE generation_batches ADD COLUMN checkpoint_name TEXT;
      ALTER TABLE generation_batches ADD COLUMN lora_count INTEGER NOT NULL DEFAULT 0;
    `,
  },
  {
    version: 10,
    name: 'lm_studio_conversation_system_prompt',
    sql: `
      ALTER TABLE lm_studio_settings ADD COLUMN conversation_system_prompt TEXT NOT NULL DEFAULT '';
    `,
  },
  {
    version: 11,
    name: 'image_series_and_conversation_history',
    sql: `
      CREATE TABLE IF NOT EXISTS image_series (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        poster_image_id INTEGER REFERENCES images(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS image_series_items (
        series_id INTEGER NOT NULL REFERENCES image_series(id) ON DELETE CASCADE,
        image_id INTEGER NOT NULL REFERENCES images(id) ON DELETE CASCADE,
        step_order INTEGER NOT NULL DEFAULT 0,
        chat_snapshot_json TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (series_id, image_id)
      );
      CREATE INDEX IF NOT EXISTS idx_image_series_items_image ON image_series_items(image_id);
      CREATE INDEX IF NOT EXISTS idx_image_series_items_series_step ON image_series_items(series_id, step_order);
      ALTER TABLE generation_batches ADD COLUMN series_id INTEGER;
      ALTER TABLE generation_batches ADD COLUMN branch_from_image_id INTEGER;
      ALTER TABLE generation_batches ADD COLUMN chat_snapshot_json TEXT;
    `,
  },
  {
    version: 12,
    name: 'lora_trigger_words_and_agent_descriptions',
    sql: `
      ALTER TABLE models ADD COLUMN trigger_word TEXT;
      ALTER TABLE models ADD COLUMN llm_description TEXT;
    `,
  },
  {
    version: 13,
    name: 'civitai_model_metadata_and_previews',
    sql: `
      ALTER TABLE models ADD COLUMN civitai_version_id TEXT;
      ALTER TABLE models ADD COLUMN civitai_url TEXT;
      ALTER TABLE models ADD COLUMN base_model TEXT;
      ALTER TABLE models ADD COLUMN recommended_weight REAL;
      ALTER TABLE models ADD COLUMN civitai_description TEXT;
      ALTER TABLE models ADD COLUMN preview_images_json TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE models ADD COLUMN civitai_fetched_at TEXT;
    `,
  },
  {
    version: 14,
    name: 'models_is_hidden_visibility',
    sql: `
      ALTER TABLE models ADD COLUMN is_hidden INTEGER NOT NULL DEFAULT 0;
      CREATE INDEX IF NOT EXISTS idx_models_is_hidden ON models(is_hidden);
    `,
  },
];
