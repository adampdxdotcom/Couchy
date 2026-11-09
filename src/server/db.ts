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
}
