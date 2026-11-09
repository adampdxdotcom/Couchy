import { Router } from 'express';
import { db } from '../db.ts';
import {
  getCharacterProfileById,
  listCharacterProfiles,
  mergeCharacters,
  runAssistedCharacterIdentificationForAll,
} from '../services/characterService.ts';

export const charactersRouter = Router();

/**
 * GET /api/characters
 * Lists all first-class character profiles with statistics and relationships.
 */
charactersRouter.get('/', (_req, res) => {
  try {
    res.json({ items: listCharacterProfiles() });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to list characters' });
  }
});

/**
 * GET /api/characters/:id
 * Returns a single character profile with full associations.
 */
charactersRouter.get('/:id', (req, res) => {
  try {
    const profile = getCharacterProfileById(Number(req.params.id));
    if (!profile) {
      res.status(404).json({ error: 'Character not found' });
      return;
    }
    res.json({ character: profile });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to load character profile' });
  }
});

/**
 * POST /api/characters
 * Creates a new character profile with optional aliases, linked LoRAs, and description.
 */
charactersRouter.post('/', (req, res) => {
  try {
    const { name, description, notes, aliases, portraitImageId } = req.body || {};
    if (!name || !String(name).trim()) {
      res.status(400).json({ error: 'Character name is required' });
      return;
    }

    let portraitHash: string | null = null;
    if (portraitImageId) {
      const img = db
        .prepare('SELECT content_hash FROM images WHERE id = ?')
        .get(Number(portraitImageId)) as { content_hash: string } | undefined;
      portraitHash = img?.content_hash || null;
    }

    const info = db
      .prepare(
        `INSERT INTO characters (name, description, notes, portrait_image_id, portrait_content_hash)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(
        String(name).trim(),
        String(description || ''),
        String(notes || ''),
        portraitImageId ? Number(portraitImageId) : null,
        portraitHash
      );
    const charId = Number(info.lastInsertRowid);

    if (Array.isArray(aliases)) {
      for (const a of aliases) {
        if (String(a).trim()) {
          db.prepare('INSERT OR IGNORE INTO character_aliases (character_id, alias) VALUES (?, ?)').run(
            charId,
            String(a).trim()
          );
        }
      }
    }

    // Run assisted identification for the newly created character
    runAssistedCharacterIdentificationForAll();

    res.json({ character: getCharacterProfileById(charId) });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Failed to create character' });
  }
});

/**
 * PATCH /api/characters/:id
 * Updates a character profile's name, description, notes, portrait, aliases, tags, or collections.
 */
charactersRouter.patch('/:id', (req, res) => {
  try {
    const charId = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM characters WHERE id = ?').get(charId) as any;
    if (!existing) {
      res.status(404).json({ error: 'Character not found' });
      return;
    }

    const { name, description, notes, portraitImageId, aliases, tagIds, collectionIds } =
      req.body || {};

    let portraitId = existing.portrait_image_id;
    let portraitHash = existing.portrait_content_hash;
    if (portraitImageId !== undefined) {
      if (portraitImageId === null) {
        portraitId = null;
        portraitHash = null;
      } else {
        portraitId = Number(portraitImageId);
        const img = db
          .prepare('SELECT content_hash FROM images WHERE id = ?')
          .get(portraitId) as { content_hash: string } | undefined;
        portraitHash = img?.content_hash || null;
      }
    }

    db.prepare(
      `UPDATE characters
       SET name = ?, description = ?, notes = ?, portrait_image_id = ?, portrait_content_hash = ?,
           updated_at = datetime('now')
       WHERE id = ?`
    ).run(
      name !== undefined ? String(name).trim() : existing.name,
      description !== undefined ? String(description) : existing.description,
      notes !== undefined ? String(notes) : existing.notes,
      portraitId,
      portraitHash,
      charId
    );

    if (Array.isArray(aliases)) {
      db.prepare('DELETE FROM character_aliases WHERE character_id = ?').run(charId);
      for (const a of aliases) {
        if (String(a).trim()) {
          db.prepare('INSERT OR IGNORE INTO character_aliases (character_id, alias) VALUES (?, ?)').run(
            charId,
            String(a).trim()
          );
        }
      }
    }

    if (Array.isArray(tagIds)) {
      db.prepare('DELETE FROM character_tags WHERE character_id = ?').run(charId);
      for (const tid of tagIds) {
        db.prepare('INSERT OR IGNORE INTO character_tags (character_id, tag_id) VALUES (?, ?)').run(
          charId,
          Number(tid)
        );
      }
    }

    if (Array.isArray(collectionIds)) {
      db.prepare('DELETE FROM character_collections WHERE character_id = ?').run(charId);
      for (const cid of collectionIds) {
        db.prepare(
          'INSERT OR IGNORE INTO character_collections (character_id, collection_id) VALUES (?, ?)'
        ).run(charId, Number(cid));
      }
    }

    runAssistedCharacterIdentificationForAll();
    res.json({ character: getCharacterProfileById(charId) });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Failed to update character' });
  }
});

/**
 * DELETE /api/characters/:id
 */
charactersRouter.delete('/:id', (req, res) => {
  try {
    db.prepare('DELETE FROM characters WHERE id = ?').run(Number(req.params.id));
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to delete character' });
  }
});

/**
 * POST /api/characters/:id/merge
 * Merges sourceCharacterId into target character :id without losing any associations or notes.
 */
charactersRouter.post('/:id/merge', (req, res) => {
  try {
    const targetId = Number(req.params.id);
    const sourceId = Number(req.body?.sourceCharacterId);
    const merged = mergeCharacters(targetId, sourceId);
    res.json({ character: merged });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Character merge failed' });
  }
});

/**
 * POST /api/characters/:id/loras
 * Associates a LoRA with a character (with optional appearanceLabel and loraCategory).
 */
charactersRouter.post('/:id/loras', (req, res) => {
  try {
    const charId = Number(req.params.id);
    const { loraName, appearanceLabel, loraCategory, notes } = req.body || {};
    if (!loraName || !String(loraName).trim()) {
      res.status(400).json({ error: 'loraName is required' });
      return;
    }

    const cleanName = String(loraName).trim();
    const modelRow = db
      .prepare('SELECT id, sha256_hash FROM models WHERE LOWER(filename) = LOWER(?) LIMIT 1')
      .get(cleanName) as { id: number; sha256_hash: string | null } | undefined;

    db.prepare(
      `INSERT INTO character_loras
        (character_id, model_id, lora_name, lora_hash, lora_category, appearance_label, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(character_id, lora_name) DO UPDATE SET
         lora_category = excluded.lora_category,
         appearance_label = excluded.appearance_label,
         notes = excluded.notes`
    ).run(
      charId,
      modelRow?.id ?? null,
      cleanName,
      modelRow?.sha256_hash ?? null,
      loraCategory || 'character',
      appearanceLabel || 'Default',
      notes || ''
    );

    runAssistedCharacterIdentificationForAll();
    res.json({ character: getCharacterProfileById(charId) });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Failed to associate LoRA with character' });
  }
});

/**
 * DELETE /api/characters/:id/loras/:linkId
 */
charactersRouter.delete('/:id/loras/:linkId', (req, res) => {
  try {
    const charId = Number(req.params.id);
    db.prepare('DELETE FROM character_loras WHERE id = ? AND character_id = ?').run(
      Number(req.params.linkId),
      charId
    );
    res.json({ character: getCharacterProfileById(charId) });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to unlink LoRA' });
  }
});

/**
 * POST /api/characters/:id/workflows
 * Links a saved workflow to a character.
 */
charactersRouter.post('/:id/workflows', (req, res) => {
  try {
    const charId = Number(req.params.id);
    const { workflowId, roleLabel } = req.body || {};
    db.prepare(
      `INSERT INTO character_workflows (character_id, workflow_id, role_label)
       VALUES (?, ?, ?)
       ON CONFLICT(character_id, workflow_id) DO UPDATE SET role_label = excluded.role_label`
    ).run(charId, Number(workflowId), roleLabel || 'Standard Workflow');
    runAssistedCharacterIdentificationForAll();
    res.json({ character: getCharacterProfileById(charId) });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Failed to link workflow' });
  }
});

/**
 * POST /api/characters/associations/status
 * Accepts (confirmed), rejects (rejected), or removes an image-character link or suggestion.
 */
charactersRouter.post('/associations/status', (req, res) => {
  try {
    const { imageId, characterId, status, appearanceLabel } = req.body || {};
    const img = db
      .prepare('SELECT id, content_hash FROM images WHERE id = ?')
      .get(Number(imageId)) as { id: number; content_hash: string } | undefined;

    if (!img) {
      res.status(404).json({ error: 'Image not found' });
      return;
    }

    if (status === 'remove') {
      db.prepare(
        'DELETE FROM image_characters WHERE image_content_hash = ? AND character_id = ?'
      ).run(img.content_hash, Number(characterId));
    } else {
      db.prepare(
        `INSERT INTO image_characters
          (image_id, image_content_hash, character_id, status, source, confidence, appearance_label, updated_at)
         VALUES (?, ?, ?, ?, 'manual', 1.0, ?, datetime('now'))
         ON CONFLICT(image_content_hash, character_id) DO UPDATE SET
           status = excluded.status,
           appearance_label = COALESCE(excluded.appearance_label, image_characters.appearance_label),
           updated_at = datetime('now')`
      ).run(
        img.id,
        img.content_hash,
        Number(characterId),
        status,
        appearanceLabel || null
      );
    }

    res.json({ ok: true });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Failed to update character association' });
  }
});

/**
 * POST /api/characters/run-suggestions
 * Runs the Assisted Character Identification suggestion pass across all indexed images.
 */
charactersRouter.post('/run-suggestions', (_req, res) => {
  try {
    const newSuggestions = runAssistedCharacterIdentificationForAll();
    res.json({ ok: true, newSuggestions });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Suggestion pass failed' });
  }
});
