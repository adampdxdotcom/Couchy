import fs from 'fs';
import path from 'path';
import { db } from '../db.ts';
import { appConfig } from '../config.ts';

let backupTimer: NodeJS.Timeout | null = null;

/**
 * Creates a safe SQLite binary backup in BACKUP_PATH and runs PRAGMA integrity_check.
 */
export async function createDatabaseBackup(label = 'manual'): Promise<{
  filename: string;
  filePath: string;
  sizeBytes: number;
  createdAt: string;
  integrityOk: boolean;
}> {
  fs.mkdirSync(appConfig.backupPath, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safeLabel = label.replace(/[^a-zA-Z0-9_-]/g, '');
  const filename = `gallery-backup-${safeLabel}-${timestamp}.db`;
  const destPath = path.join(appConfig.backupPath, filename);

  await db.backup(destPath);
  const stat = fs.statSync(destPath);
  const integrityRow = db.pragma('integrity_check', { simple: true });

  return {
    filename,
    filePath: destPath,
    sizeBytes: stat.size,
    createdAt: new Date().toISOString(),
    integrityOk: integrityRow === 'ok',
  };
}

export function listDatabaseBackups() {
  if (!fs.existsSync(appConfig.backupPath)) return [];
  return fs
    .readdirSync(appConfig.backupPath)
    .filter((f) => f.endsWith('.db') || f.endsWith('.json'))
    .map((f) => {
      const full = path.join(appConfig.backupPath, f);
      const stat = fs.statSync(full);
      return {
        filename: f,
        sizeBytes: stat.size,
        createdAt: stat.mtime.toISOString(),
        type: f.endsWith('.db') ? 'sqlite_binary' : 'annotations_json',
      };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * Exports all user-created annotations (ratings, favorites, notes, tags, collections,
 * saved searches, saved workflows, and character profiles/aliases/links) independently
 * of machine-derived metadata.
 */
export function exportUserAnnotationsJson() {
  return {
    exportedAt: new Date().toISOString(),
    version: 1,
    ratings: db.prepare('SELECT * FROM ratings').all(),
    tags: db.prepare('SELECT * FROM tags').all(),
    imageTags: db.prepare('SELECT * FROM image_tags').all(),
    collections: db.prepare('SELECT * FROM collections').all(),
    collectionImages: db.prepare('SELECT * FROM collection_images').all(),
    savedSearches: db.prepare('SELECT * FROM saved_searches').all(),
    savedWorkflows: db.prepare('SELECT * FROM workflows WHERE is_saved_library = 1').all(),
    characters: db.prepare('SELECT * FROM characters').all(),
    characterAliases: db.prepare('SELECT * FROM character_aliases').all(),
    characterLoras: db.prepare('SELECT * FROM character_loras').all(),
    imageCharacters: db.prepare('SELECT * FROM image_characters').all(),
    characterTags: db.prepare('SELECT * FROM character_tags').all(),
    characterCollections: db.prepare('SELECT * FROM character_collections').all(),
  };
}

/**
 * Restores user annotations from an exported JSON payload without losing or altering image files.
 */
export function restoreUserAnnotationsJson(payload: any): { restoredCounts: Record<string, number> } {
  const counts: Record<string, number> = {
    ratings: 0,
    tags: 0,
    collections: 0,
    characters: 0,
    imageCharacters: 0,
    savedWorkflows: 0,
  };

  const tx = db.transaction(() => {
    for (const r of payload.ratings || []) {
      db.prepare(
        `INSERT INTO ratings (content_hash, rating, is_favorite, is_rejected, is_archived, notes, favorited_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(content_hash) DO UPDATE SET
           rating = excluded.rating,
           is_favorite = excluded.is_favorite,
           is_rejected = excluded.is_rejected,
           is_archived = excluded.is_archived,
           notes = excluded.notes,
           favorited_at = excluded.favorited_at`
      ).run(
        r.content_hash,
        r.rating || 0,
        r.is_favorite || 0,
        r.is_rejected || 0,
        r.is_archived || 0,
        r.notes || '',
        r.favorited_at || null,
        r.updated_at || new Date().toISOString()
      );
      counts.ratings++;
    }

    for (const t of payload.tags || []) {
      db.prepare('INSERT OR IGNORE INTO tags (id, name, color) VALUES (?, ?, ?)').run(
        t.id,
        t.name,
        t.color || '#6366f1'
      );
      counts.tags++;
    }

    for (const it of payload.imageTags || []) {
      db.prepare(
        'INSERT OR IGNORE INTO image_tags (image_content_hash, tag_id) VALUES (?, ?)'
      ).run(it.image_content_hash, it.tag_id);
    }

    for (const col of payload.collections || []) {
      db.prepare(
        'INSERT OR IGNORE INTO collections (id, name, description, created_at) VALUES (?, ?, ?, ?)'
      ).run(col.id, col.name, col.description || '', col.created_at || new Date().toISOString());
      counts.collections++;
    }

    for (const ci of payload.collectionImages || []) {
      db.prepare(
        'INSERT OR IGNORE INTO collection_images (collection_id, image_content_hash, added_at) VALUES (?, ?, ?)'
      ).run(ci.collection_id, ci.image_content_hash, ci.added_at || new Date().toISOString());
    }

    for (const wf of payload.savedWorkflows || []) {
      db.prepare(
        `INSERT INTO workflows (name, description, is_saved_library, visual_workflow_json, api_workflow_json, workflow_hash)
         VALUES (?, ?, 1, ?, ?, ?)
         ON CONFLICT(workflow_hash) DO UPDATE SET
           name = excluded.name,
           description = excluded.description,
           is_saved_library = 1`
      ).run(
        wf.name,
        wf.description || '',
        wf.visual_workflow_json || null,
        wf.api_workflow_json || null,
        wf.workflow_hash
      );
      counts.savedWorkflows++;
    }

    for (const ch of payload.characters || []) {
      db.prepare(
        `INSERT INTO characters (id, name, description, notes, portrait_content_hash, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(name) DO UPDATE SET
           description = excluded.description,
           notes = excluded.notes,
           portrait_content_hash = COALESCE(excluded.portrait_content_hash, characters.portrait_content_hash)`
      ).run(
        ch.id,
        ch.name,
        ch.description || '',
        ch.notes || '',
        ch.portrait_content_hash || null,
        ch.created_at || new Date().toISOString(),
        ch.updated_at || new Date().toISOString()
      );
      counts.characters++;
    }

    for (const ca of payload.characterAliases || []) {
      db.prepare(
        'INSERT OR IGNORE INTO character_aliases (character_id, alias) VALUES (?, ?)'
      ).run(ca.character_id, ca.alias);
    }

    for (const cl of payload.characterLoras || []) {
      db.prepare(
        `INSERT OR IGNORE INTO character_loras
          (character_id, lora_name, lora_hash, lora_category, appearance_label, notes)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(
        cl.character_id,
        cl.lora_name,
        cl.lora_hash || null,
        cl.lora_category || 'character',
        cl.appearance_label || 'Default',
        cl.notes || ''
      );
    }

    for (const ic of payload.imageCharacters || []) {
      db.prepare(
        `INSERT OR REPLACE INTO image_characters
          (image_content_hash, character_id, status, source, confidence, match_reason, appearance_label)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(
        ic.image_content_hash,
        ic.character_id,
        ic.status || 'confirmed',
        ic.source || 'manual',
        ic.confidence ?? 1.0,
        ic.match_reason || null,
        ic.appearance_label || null
      );
      counts.imageCharacters++;
    }
  });

  tx();
  return { restoredCounts: counts };
}

export function configureScheduledBackups(hours: number): void {
  appConfig.scheduledBackupHours = hours;
  if (backupTimer) {
    clearInterval(backupTimer);
    backupTimer = null;
  }
  if (hours > 0) {
    backupTimer = setInterval(() => {
      createDatabaseBackup('scheduled').catch((err) =>
        console.error('Scheduled backup failed:', err)
      );
    }, hours * 3600 * 1000);
  }
}
