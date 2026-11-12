import Database from 'better-sqlite3';
import { appConfig } from './config.ts';

/**
 * Initialize SQLite database in WAL mode with foreign keys enabled
 * and run versioned schema migrations for all 22 tables.
 */
export const db = new Database(appConfig.databasePath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

export function runMigrations(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const applied = new Set<number>(
    (db.prepare('SELECT version FROM schema_migrations').all() as { version: number }[]).map((r) => r.version)
  );

  const migrations: { version: number; name: string; sql: string }[] = [
    {
      version: 1,
      name: 'initial_core_and_character_schema',
      sql: `
        -- 1. Images (content-hash identity independent of filenames)
        CREATE TABLE IF NOT EXISTS images (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          content_hash TEXT NOT NULL,
          relative_path TEXT NOT NULL UNIQUE,
          filename TEXT NOT NULL,
          file_size INTEGER NOT NULL,
          width INTEGER NOT NULL DEFAULT 0,
          height INTEGER NOT NULL DEFAULT 0,
          format TEXT NOT NULL DEFAULT 'PNG',
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          file_mtime TEXT NOT NULL,
          is_missing INTEGER NOT NULL DEFAULT 0,
          thumbnail_path TEXT,
          dependency_status TEXT NOT NULL DEFAULT 'unknown'
        );
        CREATE INDEX IF NOT EXISTS idx_images_content_hash ON images(content_hash);
        CREATE INDEX IF NOT EXISTS idx_images_filename ON images(filename);
        CREATE INDEX IF NOT EXISTS idx_images_mtime ON images(file_mtime DESC);
        CREATE INDEX IF NOT EXISTS idx_images_dep_status ON images(dependency_status);

        -- 2. Machine-extracted generation metadata
        CREATE TABLE IF NOT EXISTS image_metadata (
          image_id INTEGER PRIMARY KEY REFERENCES images(id) ON DELETE CASCADE,
          positive_prompt TEXT,
          negative_prompt TEXT,
          seed TEXT,
          steps INTEGER,
          cfg REAL,
          sampler TEXT,
          scheduler TEXT,
          denoise REAL,
          batch_size INTEGER,
          batch_index INTEGER,
          generation_date TEXT,
          checkpoint_name TEXT,
          checkpoint_hash TEXT,
          vae_name TEXT,
          missing_fields_json TEXT NOT NULL DEFAULT '[]',
          provenance_json TEXT NOT NULL DEFAULT '{}',
          raw_metadata_json TEXT NOT NULL DEFAULT '{}'
        );
        CREATE INDEX IF NOT EXISTS idx_metadata_checkpoint ON image_metadata(checkpoint_name);

        -- 3. Known model inventory (ComfyUI API + filesystem + historical)
        CREATE TABLE IF NOT EXISTS models (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          filename TEXT NOT NULL UNIQUE,
          model_type TEXT NOT NULL DEFAULT 'other',
          lora_category TEXT NOT NULL DEFAULT 'unclassified',
          file_path TEXT,
          file_size INTEGER,
          sha256_hash TEXT,
          autov2_hash TEXT,
          is_installed INTEGER NOT NULL DEFAULT 0,
          source_type TEXT NOT NULL DEFAULT 'historical',
          download_url TEXT,
          civitai_id TEXT,
          hf_repo_id TEXT,
          user_notes TEXT,
          last_seen_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_models_type ON models(model_type);
        CREATE INDEX IF NOT EXISTS idx_models_hash ON models(sha256_hash);
        CREATE INDEX IF NOT EXISTS idx_models_autov2 ON models(autov2_hash);

        -- 4. Image-to-LoRA extraction records
        CREATE TABLE IF NOT EXISTS image_loras (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          image_id INTEGER NOT NULL REFERENCES images(id) ON DELETE CASCADE,
          model_id INTEGER REFERENCES models(id) ON DELETE SET NULL,
          lora_name TEXT NOT NULL,
          lora_path TEXT,
          lora_hash TEXT,
          model_strength REAL NOT NULL DEFAULT 1.0,
          clip_strength REAL NOT NULL DEFAULT 1.0,
          node_id TEXT,
          node_type TEXT,
          provenance TEXT NOT NULL DEFAULT 'visual_workflow'
        );
        CREATE INDEX IF NOT EXISTS idx_image_loras_image ON image_loras(image_id);
        CREATE INDEX IF NOT EXISTS idx_image_loras_name ON image_loras(lora_name);

        -- 5. Image-to-Model dependency records
        CREATE TABLE IF NOT EXISTS image_models (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          image_id INTEGER NOT NULL REFERENCES images(id) ON DELETE CASCADE,
          model_id INTEGER REFERENCES models(id) ON DELETE SET NULL,
          model_name TEXT NOT NULL,
          model_type TEXT NOT NULL,
          model_hash TEXT,
          node_id TEXT,
          node_type TEXT,
          provenance TEXT NOT NULL DEFAULT 'visual_workflow',
          status TEXT NOT NULL DEFAULT 'unknown'
        );
        CREATE INDEX IF NOT EXISTS idx_image_models_image ON image_models(image_id);
        CREATE INDEX IF NOT EXISTS idx_image_models_name ON image_models(model_name);

        -- 6. First-Class Characters
        CREATE TABLE IF NOT EXISTS characters (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE COLLATE NOCASE,
          description TEXT NOT NULL DEFAULT '',
          notes TEXT NOT NULL DEFAULT '',
          portrait_image_id INTEGER REFERENCES images(id) ON DELETE SET NULL,
          portrait_content_hash TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        -- 7. Character Aliases
        CREATE TABLE IF NOT EXISTS character_aliases (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
          alias TEXT NOT NULL COLLATE NOCASE,
          UNIQUE(character_id, alias)
        );
        CREATE INDEX IF NOT EXISTS idx_char_aliases_alias ON character_aliases(alias);

        -- 8. Character-to-LoRA many-to-many
        CREATE TABLE IF NOT EXISTS character_loras (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
          model_id INTEGER REFERENCES models(id) ON DELETE SET NULL,
          lora_name TEXT NOT NULL COLLATE NOCASE,
          lora_hash TEXT,
          lora_category TEXT NOT NULL DEFAULT 'character',
          appearance_label TEXT NOT NULL DEFAULT 'Default',
          notes TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(character_id, lora_name)
        );
        CREATE INDEX IF NOT EXISTS idx_char_loras_name ON character_loras(lora_name);

        -- 9. Image-to-Character associations (confirmed, suggested, rejected)
        CREATE TABLE IF NOT EXISTS image_characters (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          image_id INTEGER REFERENCES images(id) ON DELETE SET NULL,
          image_content_hash TEXT NOT NULL,
          character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
          status TEXT NOT NULL DEFAULT 'confirmed',
          source TEXT NOT NULL DEFAULT 'manual',
          confidence REAL NOT NULL DEFAULT 1.0,
          match_reason TEXT,
          appearance_label TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(image_content_hash, character_id)
        );
        CREATE INDEX IF NOT EXISTS idx_img_chars_hash ON image_characters(image_content_hash);
        CREATE INDEX IF NOT EXISTS idx_img_chars_char ON image_characters(character_id, status);

        -- 10. User Tags
        CREATE TABLE IF NOT EXISTS tags (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE COLLATE NOCASE,
          color TEXT NOT NULL DEFAULT '#6366f1'
        );

        -- 11. Image-to-Tags (keyed by content_hash so rescans preserve tags)
        CREATE TABLE IF NOT EXISTS image_tags (
          image_content_hash TEXT NOT NULL,
          image_id INTEGER REFERENCES images(id) ON DELETE SET NULL,
          tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
          PRIMARY KEY (image_content_hash, tag_id)
        );

        -- 12. Character-to-Tags
        CREATE TABLE IF NOT EXISTS character_tags (
          character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
          tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
          PRIMARY KEY (character_id, tag_id)
        );

        -- 13. Independent Workflows Library & Image Workflows
        CREATE TABLE IF NOT EXISTS workflows (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          is_saved_library INTEGER NOT NULL DEFAULT 0,
          visual_workflow_json TEXT,
          api_workflow_json TEXT,
          workflow_hash TEXT NOT NULL UNIQUE,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_workflows_hash ON workflows(workflow_hash);

        -- 14. Image-to-Workflows
        CREATE TABLE IF NOT EXISTS image_workflows (
          image_id INTEGER NOT NULL REFERENCES images(id) ON DELETE CASCADE,
          image_content_hash TEXT NOT NULL,
          workflow_id INTEGER NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
          PRIMARY KEY (image_id, workflow_id)
        );

        -- 15. Character-to-Workflows
        CREATE TABLE IF NOT EXISTS character_workflows (
          character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
          workflow_id INTEGER NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
          role_label TEXT NOT NULL DEFAULT 'Standard Workflow',
          PRIMARY KEY (character_id, workflow_id)
        );

        -- 16. Virtual Collections
        CREATE TABLE IF NOT EXISTS collections (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE COLLATE NOCASE,
          description TEXT NOT NULL DEFAULT '',
          cover_image_id INTEGER REFERENCES images(id) ON DELETE SET NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        -- 17. Collection Images (keyed by content_hash for permanence)
        CREATE TABLE IF NOT EXISTS collection_images (
          collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
          image_content_hash TEXT NOT NULL,
          image_id INTEGER REFERENCES images(id) ON DELETE SET NULL,
          added_at TEXT NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY (collection_id, image_content_hash)
        );

        -- 18. Character-to-Collections
        CREATE TABLE IF NOT EXISTS character_collections (
          character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
          collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
          PRIMARY KEY (character_id, collection_id)
        );

        -- 19. User Ratings, Favorites, Rejections & Notes (keyed by content_hash)
        CREATE TABLE IF NOT EXISTS ratings (
          content_hash TEXT PRIMARY KEY,
          image_id INTEGER REFERENCES images(id) ON DELETE SET NULL,
          rating INTEGER NOT NULL DEFAULT 0,
          is_favorite INTEGER NOT NULL DEFAULT 0,
          is_rejected INTEGER NOT NULL DEFAULT 0,
          is_archived INTEGER NOT NULL DEFAULT 0,
          notes TEXT NOT NULL DEFAULT '',
          favorited_at TEXT,
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        -- 20. Saved Searches
        CREATE TABLE IF NOT EXISTS saved_searches (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE COLLATE NOCASE,
          query_string TEXT NOT NULL DEFAULT '',
          filter_json TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        -- 21. ComfyUI Instances & Reproduction Jobs
        CREATE TABLE IF NOT EXISTS comfyui_instances (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL DEFAULT 'Primary ComfyUI',
          base_url TEXT NOT NULL,
          is_default INTEGER NOT NULL DEFAULT 1,
          last_status TEXT NOT NULL DEFAULT 'unknown',
          last_checked_at TEXT,
          system_stats_json TEXT
        );

        CREATE TABLE IF NOT EXISTS reproduction_jobs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          source_image_id INTEGER REFERENCES images(id) ON DELETE SET NULL,
          workflow_id INTEGER REFERENCES workflows(id) ON DELETE SET NULL,
          comfyui_prompt_id TEXT,
          status TEXT NOT NULL DEFAULT 'queued',
          readiness_status TEXT NOT NULL DEFAULT 'unknown',
          missing_dependencies_json TEXT NOT NULL DEFAULT '[]',
          execution_error TEXT,
          output_image_ids_json TEXT NOT NULL DEFAULT '[]',
          submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
          completed_at TEXT
        );

        -- 22. Scan Jobs & Download Jobs
        CREATE TABLE IF NOT EXISTS scan_jobs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          status TEXT NOT NULL DEFAULT 'running',
          scan_type TEXT NOT NULL DEFAULT 'incremental',
          total_files INTEGER NOT NULL DEFAULT 0,
          processed_files INTEGER NOT NULL DEFAULT 0,
          added_count INTEGER NOT NULL DEFAULT 0,
          modified_count INTEGER NOT NULL DEFAULT 0,
          deleted_count INTEGER NOT NULL DEFAULT 0,
          error_log TEXT NOT NULL DEFAULT '[]',
          started_at TEXT NOT NULL DEFAULT (datetime('now')),
          completed_at TEXT
        );

        CREATE TABLE IF NOT EXISTS download_jobs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          provider TEXT NOT NULL,
          model_name TEXT NOT NULL,
          model_type TEXT NOT NULL,
          source_url TEXT NOT NULL,
          destination_path TEXT NOT NULL,
          expected_hash TEXT,
          actual_hash TEXT,
          hash_verified INTEGER NOT NULL DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'downloading',
          bytes_downloaded INTEGER NOT NULL DEFAULT 0,
          total_bytes INTEGER NOT NULL DEFAULT 0,
          error_message TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          completed_at TEXT
        );
      `,
    },
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
  ];

  const insertMigration = db.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)');
  for (const m of migrations) {
    if (!applied.has(m.version)) {
      const tx = db.transaction(() => {
        db.exec(m.sql);
        insertMigration.run(m.version, m.name);
      });
      tx();
    }
  }

  // Ensure default ComfyUI instance record exists
  const existingInstance = db.prepare('SELECT id FROM comfyui_instances WHERE is_default = 1').get();
  if (!existingInstance) {
    db.prepare('INSERT INTO comfyui_instances (name, base_url, is_default) VALUES (?, ?, 1)').run(
      'Primary ComfyUI',
      appConfig.comfyuiUrl
    );
  }

  // Seed default Prompt Templates if none exist
  const templateCount = (db.prepare('SELECT COUNT(*) as c FROM prompt_templates').get() as { c: number }).c;
  if (templateCount === 0) {
    const insertTemplate = db.prepare(`
      INSERT INTO prompt_templates (name, positive_template, negative_template, is_default, category)
      VALUES (?, ?, ?, ?, ?)
    `);
    insertTemplate.run(
      'Default Character Portrait & Theme Set',
      'masterpiece, best quality, ultra-detailed editorial photography of {character}, {lora}, {theme}, natural skin texture, sharp focus on eyes, cinematic rim lighting, shot on 85mm f/1.4 lens, shallow depth of field',
      'worst quality, low quality, blurry, deformed, bad anatomy, extra limbs, mutated hands, watermark, text, signature, oversaturated',
      1,
      'character'
    );
    insertTemplate.run(
      'Cinematic Environmental Full-Body',
      'cinematic wide angle shot of {character}, {lora}, {theme}, dynamic posture, atmospheric volumetric lighting, detailed background environment, film grain, 35mm anamorphic lens, 8k resolution',
      'worst quality, low quality, blurry, bad proportions, cropped feet, watermark, text, plastic skin',
      0,
      'cinematic'
    );
  }

  // Seed default LM Studio settings if row 1 does not exist
  const existingLm = db.prepare('SELECT id FROM lm_studio_settings WHERE id = 1').get();
  if (!existingLm) {
    db.prepare(`
      INSERT INTO lm_studio_settings (id, base_url, selected_model, system_prompt)
      VALUES (1, ?, '', ?)
    `).run(
      appConfig.lmStudioUrl,
      `You are a creative photography director and Stable Diffusion / Flux prompt engineer.
Given a Photo Set Theme and Base Scene Style, generate an array of distinct, cohesive image generation prompts for a full photo set.
Refer to the subject neutrally (e.g. "they", "them", "the subject", "a person") without including specific character names or LoRA/model filenames.
Vary the camera framing (close-up portrait, medium candid, wide environmental shot, over-the-shoulder, dynamic angle), poses, lighting nuances, and micro-actions within the theme.
Return ONLY a JSON array of prompt strings.`
    );
  }

  // Seed multiple saved LM Studio Guiding Prompt Templates if none exist
  const guidingCount = (
    db.prepare('SELECT COUNT(*) as c FROM lm_studio_prompt_templates').get() as { c: number }
  ).c;
  if (guidingCount === 0) {
    const insertGuiding = db.prepare(`
      INSERT INTO lm_studio_prompt_templates (name, system_prompt, user_prompt_template, is_default)
      VALUES (?, ?, ?, ?)
    `);

    insertGuiding.run(
      'Editorial Photo Set Director (Default)',
      `You are a creative photography director and ComfyUI prompt engineer.
Your job is to take a Photo Set Theme and Base Scene Style, and write {count} distinct, cohesive image generation prompts for a multi-photo set.
Vary the camera framing across the set (e.g., intimate close-up portrait, medium three-quarter candid, wide full-body environmental shot, dramatic over-the-shoulder angle), vary poses and micro-expressions, and enrich the lighting and background details to match the theme.
Refer to the subject neutrally (e.g., "they", "them", "the subject", "a person") without including specific character names or model/LoRA filenames.
Return ONLY a valid JSON array of {count} prompt strings (e.g. ["prompt 1", "prompt 2"]) with no markdown formatting or extra commentary.`,
      `Generate {count} distinct image prompts for a cohesive photo set:
Subject: The subject (refer to them using neutral terms like "they", "them", or "the subject")
Photo Set Theme: {theme}
Base Scene Style: {base_prompt}

Rules:
- Refer to the subject neutrally (e.g. "they", "them", "the subject", "a person").
- Do NOT include character names, model filenames, or file extensions (e.g. no .safetensors).
- Focus on setting, lighting, framing, poses, and clothing/mood.
- Return ONLY a JSON array of {count} complete prompt strings.`,
      1
    );

    insertGuiding.run(
      'Cinematic Storyboard Sequence',
      `You are a film director and cinematographer scripting a sequential {count}-shot storyboard for a character scene.
Progress the scene chronologically across the {count} shots: start with an establishing atmospheric shot, move into medium action/interaction within the setting, then capture an emotional close-up and a dramatic climax angle.
Refer to the subject neutrally (e.g. "they", "the subject") without including character names or LoRA filenames.
Return ONLY a valid JSON array of {count} prompt strings.`,
      `Create a {count}-shot sequential cinematic storyboard:
Subject: The subject (refer to them using neutral terms like "they" or "the subject")
Scene / Theme: {theme}
Visual Style Foundation: {base_prompt}

Rules:
- Refer to the subject neutrally (e.g. "they", "the subject").
- Do NOT include character names or model/LoRA filenames.
- Return ONLY a JSON array of {count} complete prompt strings.`,
      0
    );

    insertGuiding.run(
      'Pose, Angle & Lighting Lookbook Variations',
      `You are a studio fashion & portrait photographer directing a {count}-image lookbook session.
Keep the setting and theme ({theme}) consistent, but systematically vary the pose, camera lens (35mm, 50mm, 85mm, 135mm), camera angle (eye-level, low angle, profile, three-quarter), and lighting mood across all {count} prompts.
Refer to the subject neutrally without hardcoding names or model filenames.
Return ONLY a valid JSON array of {count} prompt strings.`,
      `Generate {count} lookbook variation prompts:
Subject: The subject (refer to them using neutral terms like "they" or "the subject")
Theme & Wardrobe Context: {theme}
Base Prompt Template: {base_prompt}

Rules:
- Refer to the subject neutrally (e.g. "they", "the subject").
- Do NOT include character names or model/LoRA filenames.
- Return ONLY a JSON array of {count} complete prompt strings.`,
      0
    );
  }

  // Migration: sanitize existing database templates so they do not prompt LLM for {lora} filenames or character names
  try {
    db.prepare(`
      UPDATE lm_studio_prompt_templates
      SET system_prompt = REPLACE(
            REPLACE(system_prompt, 'Keep the character ({character}) and LoRA triggers ({lora}) consistent in every prompt.', 'Refer to the subject neutrally (e.g. "they", "the subject") without including character names or LoRA filenames.'),
            'a Character identity, and a Base Prompt Style', 'and a Base Scene Style'
          ),
          user_prompt_template = REPLACE(
            REPLACE(
              REPLACE(user_prompt_template, 'Character: {character}\nLoRA / Appearance Triggers: {lora}\n', 'Subject: The subject (refer to them using neutral terms like "they" or "the subject")\n'),
              'Character: {character}\nLoRA Triggers: {lora}\n', 'Subject: The subject (refer to them using neutral terms like "they" or "the subject")\n'
            ),
            'Character: {character}\n', ''
          )
      WHERE user_prompt_template LIKE '%{lora}%' OR user_prompt_template LIKE '%{character}%'
    `).run();
  } catch {
    // ignore if table doesn't have matching rows
  }

  // Ensure the Krea2_turbo Base Default Workflow exists and is mapped
  const krea2TurboApiWorkflow = {
    '29': {
      inputs: {
        filename_prefix: 'Krea2_turbo',
        images: ['30_8', 0],
      },
      class_type: 'SaveImage',
      _meta: {
        title: 'Save Image',
        cnr_id: 'comfy-core',
        ver: '0.43.0',
      },
    },
    '49': {
      inputs: {
        aspect_ratio: '2:3 (Portrait Photo)',
        megapixels: 3,
        multiple: 8,
      },
      class_type: 'ResolutionSelector',
      _meta: {
        title: 'Resolution Selector',
        cnr_id: 'comfy-core',
        ver: '0.43.0',
      },
    },
    '50': {
      inputs: {
        PowerLoraLoaderHeaderWidget: {
          type: 'PowerLoraLoaderHeaderWidget',
        },
        '➕ Add Lora': '',
        model: ['30_10', 0],
        clip: ['30_11', 0],
      },
      class_type: 'Power Lora Loader (rgthree)',
      _meta: {
        title: 'Power Lora Loader (rgthree)',
        cnr_id: 'rgthree-comfy',
        ver: '1.0.0',
      },
    },
    '30_11': {
      inputs: {
        clip_name: 'qwen3vl_4b_fp8_scaled.safetensors',
        type: 'krea2',
        device: 'default',
      },
      class_type: 'CLIPLoader',
      _meta: {
        title: 'Load CLIP',
        cnr_id: 'comfy-core',
        ver: '0.43.0',
      },
    },
    '30_12': {
      inputs: {
        vae_name: 'qwen_image_vae.safetensors',
      },
      class_type: 'VAELoader',
      _meta: {
        title: 'Load VAE',
        cnr_id: 'comfy-core',
        ver: '0.43.0',
      },
    },
    '30_18': {
      inputs: {
        value:
          'You are an expert prompt engineer for text-to-image models. Your task is to expand the user\'s prompt into a highly effective image-generation prompt.\n\nThink step by step about the request before writing the answer:\n- What is the subject and mood?\n- What visual styles, mediums, and lighting options would fit? Consider two or three alternatives and pick the one that best serves the caption.\n- What composition, framing, and grounded details will help the text-to-image model?\n\nThen output a single expanded prompt paragraph.\n\nFollow these rules strictly:\n1. **Faithfulness First:** Preserve all original subjects, actions, colors, and spatial relationships. Do not add new objects, props, characters, or animals unless the user clearly implies them.\n2. **Practical T2I Structure:** Write a prompt that a text-to-image model can parse cleanly. Group subjects with their own attributes and actions. Use grounded phrasing for poses, interactions, and spatial layout.\n3. **Style Planning Stays Internal:** Use your internal reasoning to choose style, medium, framing, and lighting. Do not emit planning tags or wrappers in the visible answer body.\n4. **Text Rendering:** If the user requests visible text, quotes, labels, or typography, specify the exact text clearly and wrap requested words in quotes.\n5. **Avoid Over-Specification:** Do not invent highly specific clothing, colors, materials, or scene details unless the input supports them.\n6. **Structure:** Write one cohesive paragraph after the thinking block. No bullets, JSON, or markdown.\n7. **Respect Existing Detail:** If the user\'s prompt is already detailed, lightly polish and finalize rather than heavily expanding — preserve their phrasing and direction.\n8. **Respect the Human Form:** Treat depictions of people with dignity. Assume clothing covers genitals and intimate anatomy.\n9. **Preserve User Medium:** When the user explicitly requests a medium (e.g. "photo of", "photograph of", "illustration of", "painting of", "sketch of", "3D render of"), honor it. Do not pivot to a different medium to avoid difficulty — match the user\'s stated intent.\n\nUser\'s Input:\n\n',
      },
      class_type: 'PrimitiveStringMultiline',
      _meta: {
        title: 'Text String (System Prompt)',
        cnr_id: 'comfy-core',
        ver: '0.43.0',
      },
    },
    '30_19': {
      inputs: {
        value: 'Your example prompt.',
      },
      class_type: 'PrimitiveStringMultiline',
      _meta: {
        title: 'Text String (User Prompt)',
        cnr_id: 'comfy-core',
        ver: '0.43.0',
      },
    },
    '30_23': {
      inputs: {
        value: true,
      },
      class_type: 'PrimitiveBoolean',
      _meta: {
        title: 'Boolean (Enable LoRA?)',
        cnr_id: 'comfy-core',
        ver: '0.43.0',
      },
    },
    '30_24': {
      inputs: {
        value: false,
      },
      class_type: 'PrimitiveBoolean',
      _meta: {
        title: 'Boolean (Refine Prompt?)',
        cnr_id: 'comfy-core',
        ver: '0.43.0',
      },
    },
    '30_10': {
      inputs: {
        unet_name: 'lustifyNSFWCheckpoint_v10Krea2.safetensors',
        weight_dtype: 'default',
      },
      class_type: 'UNETLoader',
      _meta: {
        title: 'Load Diffusion Model',
        cnr_id: 'comfy-core',
        ver: '0.43.0',
      },
    },
    '30_5': {
      inputs: {
        width: ['49', 0],
        height: ['49', 1],
        batch_size: 1,
      },
      class_type: 'EmptyLatentImage',
      _meta: {
        title: 'Empty Latent Image',
        cnr_id: 'comfy-core',
        ver: '0.43.0',
      },
    },
    '30_17': {
      inputs: {
        string_a: ['30_18', 0],
        string_b: ['30_19', 0],
        delimiter: '',
      },
      class_type: 'StringConcatenate',
      _meta: {
        title: 'Concatenate Text',
        cnr_id: 'comfy-core',
        ver: '0.43.0',
      },
    },
    '30_16': {
      inputs: {
        prompt: ['30_17', 0],
        max_length: 512,
        sampling_mode: 'on',
        'sampling_mode.temperature': 0.7,
        'sampling_mode.top_k': 64,
        'sampling_mode.top_p': 0.95,
        'sampling_mode.min_p': 0.05,
        'sampling_mode.repetition_penalty': 1.05,
        'sampling_mode.seed': 0,
        'sampling_mode.presence_penalty': 0,
        thinking: false,
        use_default_template: true,
        mtp: 'auto',
        clip: ['30_11', 0],
      },
      class_type: 'TextGenerate',
      _meta: {
        title: 'Generate Text',
        cnr_id: 'comfy-core',
        ver: '0.43.0',
      },
    },
    '30_22': {
      inputs: {
        switch: ['30_23', 0],
        on_false: ['30_10', 0],
        on_true: ['50', 0],
      },
      class_type: 'ComfySwitchNode',
      _meta: {
        title: 'Switch (Model)',
        cnr_id: 'comfy-core',
        ver: '0.43.0',
      },
    },
    '30_21': {
      inputs: {
        switch: ['30_24', 0],
        on_false: ['30_19', 0],
        on_true: ['30_16', 0],
      },
      class_type: 'ComfySwitchNode',
      _meta: {
        title: 'If/Else Switch',
        cnr_id: 'comfy-core',
        ver: '0.43.0',
      },
    },
    '30_20': {
      inputs: {
        source: ['30_21', 0],
      },
      class_type: 'PreviewAny',
      _meta: {
        title: 'Preview as Text',
        cnr_id: 'comfy-core',
        ver: '0.43.0',
      },
    },
    '30_27': {
      inputs: {
        string_a: ['30_20', 0],
        string_b: 'xmelx',
        delimiter: ', ',
      },
      class_type: 'StringConcatenate',
      _meta: {
        title: 'Concatenate Text (LoRA Trigger Word)',
        cnr_id: 'comfy-core',
        ver: '0.43.0',
      },
    },
    '30_28': {
      inputs: {
        switch: ['30_23', 0],
        on_false: ['30_20', 0],
        on_true: ['30_27', 0],
      },
      class_type: 'ComfySwitchNode',
      _meta: {
        title: 'If/Else Switch',
        cnr_id: 'comfy-core',
        ver: '0.43.0',
      },
    },
    '30_6': {
      inputs: {
        text: ['30_28', 0],
        clip: ['50', 1],
      },
      class_type: 'CLIPTextEncode',
      _meta: {
        title: 'CLIP Text Encode (Prompt)',
        cnr_id: 'comfy-core',
        ver: '0.43.0',
      },
    },
    '30_13': {
      inputs: {
        conditioning: ['30_6', 0],
      },
      class_type: 'ConditioningZeroOut',
      _meta: {
        title: 'Conditioning Zero Out',
        cnr_id: 'comfy-core',
        ver: '0.43.0',
      },
    },
    '30_3': {
      inputs: {
        seed: 316273020560949,
        steps: 8,
        cfg: 1,
        sampler_name: 'euler',
        scheduler: 'simple',
        denoise: 1,
        model: ['30_22', 0],
        positive: ['30_6', 0],
        negative: ['30_13', 0],
        latent_image: ['30_5', 0],
      },
      class_type: 'KSampler',
      _meta: {
        title: 'KSampler',
        cnr_id: 'comfy-core',
        ver: '0.43.0',
      },
    },
    '30_8': {
      inputs: {
        samples: ['30_3', 0],
        vae: ['30_12', 0],
      },
      class_type: 'VAEDecode',
      _meta: {
        title: 'VAE Decode',
        cnr_id: 'comfy-core',
        ver: '0.43.0',
      },
    },
  };

  // Replace old placeholder default workflow if present or insert Krea2_turbo as primary default workflow
  const legacyDefault = db
    .prepare("SELECT id FROM workflows WHERE workflow_hash = 'default-couchy-character-lora-workflow'")
    .get() as { id: number } | undefined;
  const kreaDefault = db
    .prepare("SELECT id FROM workflows WHERE workflow_hash = 'default-krea2-turbo-workflow'")
    .get() as { id: number } | undefined;

  let kreaWorkflowId: number | null = kreaDefault?.id ?? null;

  if (legacyDefault && !kreaDefault) {
    db.prepare(`
      UPDATE workflows
      SET name = ?, description = ?, api_workflow_json = ?, workflow_hash = 'default-krea2-turbo-workflow', updated_at = datetime('now')
      WHERE id = ?
    `).run(
      'Krea2_turbo Studio Workflow (Default)',
      'Base default Krea2_turbo workflow with Power Lora Loader (rgthree), Trigger Word StringConcatenate (#30_27), PrimitiveStringMultiline Prompt (#30_19), ResolutionSelector (#49), UNETLoader (#30_10), and KSampler (#30_3).',
      JSON.stringify(krea2TurboApiWorkflow, null, 2),
      legacyDefault.id
    );
    kreaWorkflowId = legacyDefault.id;
  } else if (!kreaDefault) {
    const info = db.prepare(`
      INSERT INTO workflows (name, description, is_saved_library, api_workflow_json, workflow_hash)
      VALUES (?, ?, 1, ?, 'default-krea2-turbo-workflow')
    `).run(
      'Krea2_turbo Studio Workflow (Default)',
      'Base default Krea2_turbo workflow with Power Lora Loader (rgthree), Trigger Word StringConcatenate (#30_27), PrimitiveStringMultiline Prompt (#30_19), ResolutionSelector (#49), UNETLoader (#30_10), and KSampler (#30_3).',
      JSON.stringify(krea2TurboApiWorkflow, null, 2)
    );
    kreaWorkflowId = Number(info.lastInsertRowid);
  }

  if (kreaWorkflowId) {
    const existingMap = db
      .prepare('SELECT workflow_id FROM workflow_mappings WHERE workflow_id = ?')
      .get(kreaWorkflowId);
    if (!existingMap) {
      db.prepare(`
        INSERT INTO workflow_mappings (
          workflow_id,
          positive_prompt_node_id, positive_prompt_field,
          negative_prompt_node_id, negative_prompt_field,
          trigger_word_node_id, trigger_word_field,
          seed_node_id, seed_field,
          steps_node_id, cfg_node_id, sampler_node_id,
          latent_node_id, aspect_ratio_field, megapixels_field,
          checkpoint_node_id, checkpoint_field,
          enable_lora_node_id, enable_lora_field,
          lora_node_ids_json
        ) VALUES (?, '30_19', 'value', NULL, 'text', '30_27', 'string_b', '30_3', 'seed', '30_3', '30_3', '30_3', '49', 'aspect_ratio', 'megapixels', '30_10', 'unet_name', '30_23', 'value', '["50"]')
      `).run(kreaWorkflowId);
    }
  }

  // Ensure any existing default workflow record has lustifyNSFWCheckpoint_v10Krea2.safetensors in Node 30_10
  const defaultWf = db
    .prepare(
      "SELECT id, api_workflow_json FROM workflows WHERE workflow_hash = 'default-krea2-turbo-workflow' OR id = 1 LIMIT 1"
    )
    .get() as { id: number; api_workflow_json: string } | undefined;
  if (defaultWf?.api_workflow_json) {
    try {
      const parsed = JSON.parse(defaultWf.api_workflow_json);
      if (
        parsed['30_10']?.inputs &&
        (!parsed['30_10'].inputs.unet_name || !parsed['30_10'].inputs.unet_name.trim())
      ) {
        parsed['30_10'].inputs.unet_name = 'lustifyNSFWCheckpoint_v10Krea2.safetensors';
        db.prepare('UPDATE workflows SET api_workflow_json = ? WHERE id = ?').run(
          JSON.stringify(parsed, null, 2),
          defaultWf.id
        );
      }
    } catch {
      // ignore
    }
  }

  // Ensure at least one workflow is marked as default
  const anyDefaultWf = db
    .prepare('SELECT id FROM workflows WHERE is_default = 1 LIMIT 1')
    .get() as { id: number } | undefined;
  if (!anyDefaultWf) {
    const targetDefaultId = defaultWf?.id ?? kreaWorkflowId ?? 1;
    db.prepare('UPDATE workflows SET is_default = 1 WHERE id = ?').run(targetDefaultId);
  }

  // Ensure default model is registered in models table
  db.prepare(`
    INSERT INTO models (name, filename, model_type, is_installed, source_type)
    VALUES ('lustifyNSFWCheckpoint_v10Krea2', 'lustifyNSFWCheckpoint_v10Krea2.safetensors', 'diffusion', 1, 'workflow_default')
    ON CONFLICT(filename) DO UPDATE SET model_type = 'diffusion', is_installed = 1
  `).run();
}


