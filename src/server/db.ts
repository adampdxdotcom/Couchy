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
Given a Character Name, Character LoRA / appearance details, a base prompt style, and a Photo Set Theme, generate an array of distinct, cohesive image generation prompts for a full photo set.
Vary the camera framing (close-up portrait, medium candid, wide environmental shot, over-the-shoulder, dynamic angle), poses, lighting nuances, and micro-actions within the theme while keeping the character identity consistent.
Return ONLY a JSON array of prompt strings, or one complete prompt per line with no extra commentary.`
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
Your job is to take a Photo Set Theme, a Character identity, and a Base Prompt Style, and write {count} distinct, cohesive image generation prompts for a multi-photo set.
Vary the camera framing across the set (e.g., intimate close-up portrait, medium three-quarter candid, wide full-body environmental shot, dramatic over-the-shoulder angle), vary poses and micro-expressions, and enrich the lighting and background details to match the theme.
Return ONLY a valid JSON array of {count} prompt strings (e.g. ["prompt 1", "prompt 2"]) with no markdown formatting or extra commentary.`,
      `Generate {count} distinct image prompts for a cohesive photo set:
Character: {character}
LoRA / Appearance Triggers: {lora}
Photo Set Theme: {theme}
Base Prompt Style to Incorporate: {base_prompt}

Return ONLY a JSON array of {count} complete prompt strings.`,
      1
    );

    insertGuiding.run(
      'Cinematic Storyboard Sequence',
      `You are a film director and cinematographer scripting a sequential {count}-shot storyboard for a character scene.
Progress the scene chronologically across the {count} shots: start with an establishing atmospheric shot, move into medium action/interaction within the setting, then capture an emotional close-up and a dramatic climax angle.
Keep the character ({character}) and LoRA triggers ({lora}) consistent in every prompt.
Return ONLY a valid JSON array of {count} prompt strings.`,
      `Create a {count}-shot sequential cinematic storyboard:
Character: {character}
LoRA Triggers: {lora}
Scene / Theme: {theme}
Visual Style Foundation: {base_prompt}

Return ONLY a JSON array of {count} complete prompt strings.`,
      0
    );

    insertGuiding.run(
      'Pose, Angle & Lighting Lookbook Variations',
      `You are a studio fashion & portrait photographer directing a {count}-image lookbook session.
Keep the setting and theme ({theme}) consistent, but systematically vary the pose, camera lens (35mm, 50mm, 85mm, 135mm), camera angle (eye-level, low angle, profile, three-quarter), and lighting mood across all {count} prompts.
Return ONLY a valid JSON array of {count} prompt strings.`,
      `Generate {count} lookbook variation prompts:
Character: {character}
LoRA Triggers: {lora}
Theme & Wardrobe Context: {theme}
Base Prompt Template: {base_prompt}

Return ONLY a JSON array of {count} complete prompt strings.`,
      0
    );
  }

  // Seed a default Standard Character + LoRA API Workflow if no workflows exist yet
  const wfCount = (db.prepare('SELECT COUNT(*) as c FROM workflows').get() as { c: number }).c;
  if (wfCount === 0) {
    const defaultApiWorkflow = {
      '1': {
        class_type: 'CheckpointLoaderSimple',
        _meta: { title: 'Load Checkpoint' },
        inputs: { ckpt_name: 'sd_xl_base_1.0.safetensors' },
      },
      '2': {
        class_type: 'LoraLoader',
        _meta: { title: 'Primary Character LoRA Loader' },
        inputs: {
          lora_name: 'character_default.safetensors',
          strength_model: 1.0,
          strength_clip: 1.0,
          model: ['1', 0],
          clip: ['1', 1],
        },
      },
      '3': {
        class_type: 'CLIPTextEncode',
        _meta: { title: 'Positive Prompt' },
        inputs: {
          text: 'masterpiece, best quality, portrait of character',
          clip: ['2', 1],
        },
      },
      '4': {
        class_type: 'CLIPTextEncode',
        _meta: { title: 'Negative Prompt' },
        inputs: {
          text: 'worst quality, low quality, blurry, deformed',
          clip: ['2', 1],
        },
      },
      '5': {
        class_type: 'EmptyLatentImage',
        _meta: { title: 'Resolution & Aspect Ratio (Megapixels)' },
        inputs: {
          aspect_ratio: '3:4',
          megapixels: 1.0,
          width: 896,
          height: 1152,
          batch_size: 1,
        },
      },
      '6': {
        class_type: 'KSampler',
        _meta: { title: 'KSampler' },
        inputs: {
          seed: 123456789,
          steps: 28,
          cfg: 6.5,
          sampler_name: 'dpmpp_2m',
          scheduler: 'karras',
          denoise: 1.0,
          model: ['2', 0],
          positive: ['3', 0],
          negative: ['4', 0],
          latent_image: ['5', 0],
        },
      },
      '7': {
        class_type: 'VAEDecode',
        _meta: { title: 'VAE Decode' },
        inputs: {
          samples: ['6', 0],
          vae: ['1', 2],
        },
      },
      '8': {
        class_type: 'SaveImage',
        _meta: { title: 'Save Image' },
        inputs: {
          filename_prefix: 'Couchy_Gen',
          images: ['7', 0],
        },
      },
    };
    db.prepare(`
      INSERT INTO workflows (name, description, is_saved_library, api_workflow_json, workflow_hash)
      VALUES (?, ?, 1, ?, 'default-couchy-character-lora-workflow')
    `).run(
      'Standard Character + LoRA Studio Workflow',
      'Default adaptable ComfyUI API workflow with Checkpoint, LoRA Loader, Positive/Negative CLIP Text Encode, EmptyLatentImage aspect ratio control, and KSampler.',
      JSON.stringify(defaultApiWorkflow, null, 2)
    );
  }
}

