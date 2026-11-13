import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import { appConfig } from './config.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PRIMARY_WORKFLOW_PATH = path.resolve(__dirname, './workflows/primary_workflow.json');

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

  const defaultConversationPrompt = `You are an interactive photography director and text-to-image prompt collaborator.
Help the user develop and refine their image idea through brief, natural conversation.

## Guidelines

1. Keep conversational replies concise (1–3 short sentences). If the user's idea is still vague, ask at most 1–2 focused questions about lighting, camera framing, setting, wardrobe, or mood.

2. Whenever you have enough detail to suggest a strong image prompt—or whenever the user asks for one—include the ready-to-generate prompt wrapped in <proposed_prompt>...</proposed_prompt> tags alongside a brief conversational reply.

3. Inside <proposed_prompt>, write a single cohesive, descriptive text-to-image paragraph detailing framing, pose, lighting, environment, wardrobe, and atmosphere. Specify concrete, locked visual anchors rather than broad labels: exact garment cuts, colors, fabrics, straps/closures, footwear, and accessories; specific room surfaces, 3–5 fixed background props/furniture with their spatial locations; and consistent lighting direction and color temperature. Use explicit, concrete visual language wherever necessary for accurate image generation. Favor spatial relationships, physical positioning, anatomy, and observable details over suggestive or literary language.

4. Refer to the subject neutrally (e.g., "the subject", "they", "a person") when a character is attached, and NEVER include character names or model/LoRA filenames (such as .safetensors).

5. Describe visible actions, not labels. When describing physical interactions, intimacy, or sexual activity, never rely solely on the name of an act, position, or technique. Translate the action into concrete, visually observable details that an image-generation model can actually render.

   Describe:
   - The precise positioning and orientation of each participant.
   - Body posture, limb placement, and relative positioning.
   - Physical contact and points of contact.
   - Visible movement, interaction, and body mechanics.
   - Camera angle and framing that clearly communicate the intended action.
   - Which visual details are foregrounded, obscured, or visible.

   Avoid substituting terminology for visual description. Naming a position or act is supplementary, not a replacement for describing what is physically happening.

   Prioritize visual specificity over euphemisms, vague language, or abstract descriptions. Write as though explaining the composition to a photographer who needs to physically arrange the scene, not as though writing a caption describing what the scene is called.

   Preserve the user's intended action and composition rather than sanitizing, reinterpreting, or changing the scene.

6. Series Continuity & Anchor Locking. When continuing, refining, or branching from a previous <proposed_prompt> in the conversation, treat the latest <proposed_prompt> as a locked scene sheet:
   - Carry forward all unchanged wardrobe details (garment types, exact cuts, colors, patterns, fabrics, straps/fasteners, footwear, and accessories) and environment details (architecture, background furniture/props and their positions, lighting direction, and color temperature) verbatim or near-verbatim, even when repetitive.
   - Only update the pose, physical positioning, contact points, facial expression, action, and camera angle/framing requested by the user (plus any clothing or setting adjustments they explicitly ask to change).
   - Never silently drop, generalize, or paraphrase established wardrobe or room details into shorter labels across turns.

## Krea 2 Visual Translation

Before finalizing any proposed prompt, mentally evaluate whether every important action has been translated into a concrete visual composition.

Do not assume Krea 2 will infer physical positioning from the name of an action or pose.

Prioritize:

1. Spatial relationships: Explicitly establish the positioning of each subject relative to the others and to fixed environmental props.
2. Physical positioning: Describe body posture, orientation, limb placement, and alignment.
3. Contact points: Clearly establish where and how subjects physically interact with each other or surrounding surfaces.
4. Camera placement: Specify the viewing angle and framing needed to make the intended composition readable.
5. Visual hierarchy: Make the primary interaction the central compositional feature rather than a secondary detail.
6. Visual clarity: Specify which important details should be visible and avoid ambiguous descriptions.

Remove poetic filler or vague mood-only adjectives when they compete with important spatial information, but never delete, summarize, or alter concrete wardrobe, material, or environment anchors established in earlier turns. Favor precise, unambiguous descriptions over flowery prose.

The final objective is a prompt that communicates exactly what the camera should capture and keeps the scene and wardrobe continuous across iterations, rather than simply naming what is happening.`;

  // Seed default LM Studio settings if row 1 does not exist
  const existingLm = db
    .prepare('SELECT id, conversation_system_prompt FROM lm_studio_settings WHERE id = 1')
    .get() as { id: number; conversation_system_prompt?: string } | undefined;
  if (!existingLm) {
    db.prepare(`
      INSERT INTO lm_studio_settings (id, base_url, selected_model, system_prompt, conversation_system_prompt)
      VALUES (1, ?, '', ?, ?)
    `).run(
      appConfig.lmStudioUrl,
      `You are a creative photography director and Stable Diffusion / Flux prompt engineer.
Given a Photo Set Theme and Base Scene Style, generate an array of distinct, cohesive image generation prompts for a full photo set.
Refer to the subject neutrally (e.g. "they", "them", "the subject", "a person") without including specific character names or LoRA/model filenames.
Vary the camera framing (close-up portrait, medium candid, wide environmental shot, over-the-shoulder, dynamic angle), poses, lighting nuances, and micro-actions within the theme.
Return ONLY a JSON array of prompt strings.`,
      defaultConversationPrompt
    );
  } else if (!existingLm.conversation_system_prompt || !existingLm.conversation_system_prompt.trim()) {
    db.prepare(
      'UPDATE lm_studio_settings SET conversation_system_prompt = ? WHERE id = 1'
    ).run(defaultConversationPrompt);
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

  // Load primary Krea2_turbo workflow directly from src/server/workflows/primary_workflow.json
  const krea2TurboApiWorkflow: Record<string, any> = JSON.parse(
    fs.readFileSync(PRIMARY_WORKFLOW_PATH, 'utf-8')
  );

  // Replace old placeholder default workflow if present or insert/upgrade Krea2_turbo primary workflow
  const legacyDefault = db
    .prepare("SELECT id FROM workflows WHERE workflow_hash = 'default-couchy-character-lora-workflow'")
    .get() as { id: number } | undefined;
  const kreaDefault = db
    .prepare("SELECT id, api_workflow_json FROM workflows WHERE workflow_hash = 'default-krea2-turbo-workflow'")
    .get() as { id: number; api_workflow_json?: string } | undefined;

  let kreaWorkflowId: number | null = kreaDefault?.id ?? null;

  if (legacyDefault && !kreaDefault) {
    db.prepare(`
      UPDATE workflows
      SET name = ?, description = ?, api_workflow_json = ?, workflow_hash = 'default-krea2-turbo-workflow', updated_at = datetime('now')
      WHERE id = ?
    `).run(
      'Krea2_turbo Studio Workflow (Default)',
      'Primary Krea2_turbo workflow with conditional inline 4x-ESRGAN upscaling (>3.0 MP via Switch #51 & Scale #52), Power Lora Loader (#50), ResolutionSelector (#49), and KSampler (#30_3).',
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
      'Primary Krea2_turbo workflow with conditional inline 4x-ESRGAN upscaling (>3.0 MP via Switch #51 & Scale #52), Power Lora Loader (#50), ResolutionSelector (#49), and KSampler (#30_3).',
      JSON.stringify(krea2TurboApiWorkflow, null, 2)
    );
    kreaWorkflowId = Number(info.lastInsertRowid);
  } else if (kreaDefault.api_workflow_json) {
    // Upgrade older default-krea2-turbo-workflow DB rows that predate inline upscale nodes #51-#54
    try {
      const currentGraph = JSON.parse(kreaDefault.api_workflow_json) as Record<string, any>;
      if (!currentGraph['51'] || currentGraph['51']?.class_type !== 'ComfySwitchNode') {
        const upgradedGraph = JSON.parse(JSON.stringify(krea2TurboApiWorkflow)) as Record<string, any>;
        if (currentGraph['49']?.inputs && upgradedGraph['49']?.inputs) {
          if (currentGraph['49'].inputs.aspect_ratio) {
            upgradedGraph['49'].inputs.aspect_ratio = currentGraph['49'].inputs.aspect_ratio;
          }
          if (typeof currentGraph['49'].inputs.megapixels === 'number') {
            upgradedGraph['49'].inputs.megapixels = currentGraph['49'].inputs.megapixels;
          }
        }
        if (currentGraph['30_10']?.inputs?.unet_name && upgradedGraph['30_10']?.inputs) {
          upgradedGraph['30_10'].inputs.unet_name = currentGraph['30_10'].inputs.unet_name;
        }
        db.prepare(`
          UPDATE workflows
          SET description = ?, api_workflow_json = ?, updated_at = datetime('now')
          WHERE id = ?
        `).run(
          'Primary Krea2_turbo workflow with conditional inline 4x-ESRGAN upscaling (>3.0 MP via Switch #51 & Scale #52), Power Lora Loader (#50), ResolutionSelector (#49), and KSampler (#30_3).',
          JSON.stringify(upgradedGraph, null, 2),
          kreaDefault.id
        );
      }
    } catch {
      // ignore parse failures
    }
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

  // Ensure any existing default workflow record has a valid diffusion model in Node 30_10
  const defaultWf = db
    .prepare(
      "SELECT id, api_workflow_json FROM workflows WHERE workflow_hash = 'default-krea2-turbo-workflow' OR id = 1 LIMIT 1"
    )
    .get() as { id: number; api_workflow_json: string } | undefined;
  const fallbackUnet =
    krea2TurboApiWorkflow['30_10']?.inputs?.unet_name || 'krea_muse_INT8-ConvRot.safetensors';
  if (defaultWf?.api_workflow_json) {
    try {
      const parsed = JSON.parse(defaultWf.api_workflow_json);
      if (
        parsed['30_10']?.inputs &&
        (!parsed['30_10'].inputs.unet_name || !parsed['30_10'].inputs.unet_name.trim())
      ) {
        parsed['30_10'].inputs.unet_name = fallbackUnet;
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

  // Ensure primary default diffusion model is registered in models table
  const unetStem = fallbackUnet.replace(/\.(safetensors|ckpt|pt|bin)$/i, '');
  db.prepare(`
    INSERT INTO models (name, filename, model_type, is_installed, source_type)
    VALUES (?, ?, 'diffusion', 1, 'workflow_default')
    ON CONFLICT(filename) DO UPDATE SET model_type = 'diffusion', is_installed = 1
  `).run(unetStem, fallbackUnet);
}


