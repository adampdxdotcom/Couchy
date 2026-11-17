import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { db } from '../db.ts';
import { appConfig } from '../config.ts';
import {
  ensureCharacterPortraitIfUnset,
  getCharacterProfileById,
  listCharacterProfiles,
  mergeCharacters,
  resolveCharacterPortraitId,
  runAssistedCharacterIdentificationForAll,
} from '../services/characterService.ts';
import { analyzeCharacterPortraitPhysicalTraits } from '../services/llm/llmImageAnalysisService.ts';
import { matchFaceToCharacter } from '../services/faceRecognitionService.ts';
import { resolveImageDiskPath } from '../services/scannerService.ts';
import { invalidateInstalledModelsCache } from '../services/civitai/civitaiModelEnrichmentService.ts';
import { normalizePortraitCrop } from '../../shared/utils.ts';

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
    const { name, description, physicalDescription, notes, aliases, portraitImageId } =
      req.body || {};
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
        `INSERT INTO characters (name, description, physical_description, notes, portrait_image_id, portrait_content_hash)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        String(name).trim(),
        String(description || ''),
        String(physicalDescription || ''),
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
const updateCharacterHandler = (req: any, res: any) => {
  try {
    const charId = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM characters WHERE id = ?').get(charId) as any;
    if (!existing) {
      res.status(404).json({ error: 'Character not found' });
      return;
    }

    const {
      name,
      description,
      physicalDescription,
      notes,
      portraitImageId,
      portraitCrop,
      aliases,
      tagIds,
      collectionIds,
    } = req.body || {};

    let portraitId = existing.portrait_image_id;
    let portraitHash = existing.portrait_content_hash;
    let portraitChanged = false;
    if (portraitImageId !== undefined) {
      if (portraitImageId === null) {
        portraitChanged = existing.portrait_image_id !== null || existing.portrait_content_hash !== null;
        portraitId = null;
        portraitHash = null;
      } else {
        portraitId = Number(portraitImageId);
        portraitChanged = portraitId !== existing.portrait_image_id;
        const img = db
          .prepare('SELECT content_hash FROM images WHERE id = ?')
          .get(portraitId) as { content_hash: string } | undefined;
        portraitHash = img?.content_hash || null;

        // Ensure selected portrait image is confirmed for this character
        if (portraitHash) {
          db.prepare(
            `INSERT INTO image_characters
              (image_id, image_content_hash, character_id, status, source, confidence)
             VALUES (?, ?, ?, 'confirmed', 'manual', 1.0)
             ON CONFLICT(image_content_hash, character_id) DO UPDATE SET
              status = 'confirmed',
              image_id = excluded.image_id,
              updated_at = datetime('now')`
          ).run(portraitId, portraitHash, charId);
        }
      }
    }

    let nextPortraitCropJson: string | null = existing.portrait_crop_json ?? null;
    if (portraitCrop !== undefined) {
      if (portraitCrop === null) {
        nextPortraitCropJson = null;
      } else {
        const normalized = normalizePortraitCrop(portraitCrop);
        nextPortraitCropJson = normalized ? JSON.stringify(normalized) : null;
      }
      if (!portraitId && !portraitHash) {
        const fallbackId = resolveCharacterPortraitId(existing);
        if (fallbackId) {
          const fallbackImg = db
            .prepare('SELECT content_hash FROM images WHERE id = ?')
            .get(fallbackId) as { content_hash: string } | undefined;
          portraitId = fallbackId;
          portraitHash = fallbackImg?.content_hash || null;
        }
      }
    } else if (portraitChanged) {
      // Reset framing automatically when assigning a different portrait image
      nextPortraitCropJson = null;
    }

    if (name !== undefined && !String(name).trim()) {
      res.status(400).json({ error: 'Character name cannot be empty.' });
      return;
    }

    db.prepare(
      `UPDATE characters
       SET name = ?, description = ?, physical_description = ?, notes = ?, portrait_image_id = ?, portrait_content_hash = ?, portrait_crop_json = ?,
           updated_at = datetime('now')
       WHERE id = ?`
    ).run(
      name !== undefined ? String(name).trim() : existing.name,
      description !== undefined ? String(description) : existing.description,
      physicalDescription !== undefined
        ? String(physicalDescription)
        : existing.physical_description || '',
      notes !== undefined ? String(notes) : existing.notes,
      portraitId,
      portraitHash,
      nextPortraitCropJson,
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
    if (err?.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      res.status(400).json({ error: 'A character with that name already exists.' });
      return;
    }
    res.status(400).json({ error: err?.message || 'Failed to update character' });
  }
};

charactersRouter.patch('/:id', updateCharacterHandler);
charactersRouter.put('/:id', updateCharacterHandler);

/**
 * POST /api/characters/:id/analyze-portrait
 * Analyzes the character's portrait photo (Vision LLM first, falling back to WD14 + Text LLM or WD14-only)
 * to generate a baseline Physical Description reference guide and saves it to the profile.
 */
charactersRouter.post('/:id/analyze-portrait', async (req, res) => {
  try {
    const charId = Number(req.params.id);
    const charRow = db
      .prepare('SELECT id, name, portrait_image_id, portrait_content_hash FROM characters WHERE id = ?')
      .get(charId) as
      | {
          id: number;
          name: string;
          portrait_image_id: number | null;
          portrait_content_hash: string | null;
        }
      | undefined;

    if (!charRow) {
      res.status(404).json({ error: 'Character not found' });
      return;
    }

    const portraitId = req.body?.imageId
      ? Number(req.body.imageId)
      : resolveCharacterPortraitId(charRow);

    if (!portraitId) {
      res.status(400).json({
        error: 'Set a character portrait image (or confirm an image) before running portrait analysis.',
      });
      return;
    }

    const imgRow = db
      .prepare(
        'SELECT id, relative_path, COALESCE(is_uploaded_reference, 0) AS is_uploaded_reference FROM images WHERE id = ?'
      )
      .get(portraitId) as
      | { id: number; relative_path: string; is_uploaded_reference: number }
      | undefined;

    if (!imgRow) {
      res.status(404).json({ error: 'Portrait image record not found.' });
      return;
    }

    const origPath = resolveImageDiskPath(imgRow);
    if (!fs.existsSync(origPath)) {
      res.status(404).json({ error: 'Portrait image file is missing on disk.' });
      return;
    }

    // Downscale to ~1MP JPEG so Vision LLMs process fast and cleanly
    const resizedBuffer = await sharp(origPath)
      .rotate()
      .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 90 })
      .toBuffer();

    const dataUrl = `data:image/jpeg;base64,${resizedBuffer.toString('base64')}`;

    const analysis = await analyzeCharacterPortraitPhysicalTraits({
      imageBuffer: resizedBuffer,
      imageBase64DataUrl: dataUrl,
      characterName: charRow.name,
    });

    if (req.body?.save !== false) {
      db.prepare(
        `UPDATE characters
         SET physical_description = ?, updated_at = datetime('now')
         WHERE id = ?`
      ).run(analysis.physicalDescription, charId);
    }

    res.json({
      physicalDescription: analysis.physicalDescription,
      pipelineUsed: analysis.pipelineUsed,
      tags: analysis.tags,
      modelUsed: analysis.modelUsed,
      character: getCharacterProfileById(charId),
    });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Failed to analyze character portrait' });
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
 * Associates a LoRA with a character (with optional appearanceLabel, triggerWord, and loraCategory).
 */
charactersRouter.post('/:id/loras', (req, res) => {
  try {
    const charId = Number(req.params.id);
    const { loraName, appearanceLabel, triggerWord, loraCategory, notes } = req.body || {};
    if (!loraName || !String(loraName).trim()) {
      res.status(400).json({ error: 'loraName is required' });
      return;
    }

    // Block non-character classifications on linked character LoRAs
    if (loraCategory !== undefined && loraCategory !== null && String(loraCategory) !== 'character') {
      res.status(400).json({ error: 'Linked character LoRAs must use the "character" classification.' });
      return;
    }

    const cleanName = String(loraName).trim();
    const modelRow = db
      .prepare('SELECT id, sha256_hash, lora_category FROM models WHERE LOWER(filename) = LOWER(?) LIMIT 1')
      .get(cleanName) as { id: number; sha256_hash: string | null; lora_category: string | null } | undefined;

    let resolvedModelId = modelRow?.id ?? null;

    // Auto-classify as 'character' in LoRA Explorer only if not yet classified
    if (modelRow) {
      const upd = db.prepare(
        `UPDATE models
         SET lora_category = 'character'
         WHERE id = ?
           AND COALESCE(NULLIF(TRIM(lora_category), ''), 'unclassified') = 'unclassified'`
      ).run(modelRow.id);
      if (upd.changes > 0) invalidateInstalledModelsCache();
    } else {
      const insertModel = db
        .prepare(
          `INSERT INTO models (name, filename, model_type, lora_category, is_installed)
           VALUES (?, ?, 'lora', 'character', 0)`
        )
        .run(cleanName.replace(/\.(safetensors|pt|ckpt)$/i, ''), cleanName);
      resolvedModelId = Number(insertModel.lastInsertRowid);
      invalidateInstalledModelsCache();
    }

    db.prepare(
      `INSERT INTO character_loras
        (character_id, model_id, lora_name, lora_hash, lora_category, appearance_label, trigger_word, notes)
       VALUES (?, ?, ?, ?, 'character', ?, ?, ?)
       ON CONFLICT(character_id, lora_name) DO UPDATE SET
         model_id = COALESCE(character_loras.model_id, excluded.model_id),
         lora_category = 'character',
         appearance_label = excluded.appearance_label,
         trigger_word = excluded.trigger_word,
         notes = excluded.notes`
    ).run(
      charId,
      resolvedModelId,
      cleanName,
      modelRow?.sha256_hash ?? null,
      appearanceLabel || 'Default',
      triggerWord !== undefined ? String(triggerWord).trim() : '',
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
      if (status === 'confirmed') {
        ensureCharacterPortraitIfUnset(Number(characterId), img.id, img.content_hash);
      }
    }

    res.json({ ok: true });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Failed to update character association' });
  }
});

/**
 * POST /api/characters/associations/bulk-status
 * Batch confirms, rejects, or removes multiple suggested/associated images for a character in one transaction.
 */
charactersRouter.post('/associations/bulk-status', (req, res) => {
  try {
    const { imageIds, characterId, status, appearanceLabel } = req.body || {};
    if (!Array.isArray(imageIds) || imageIds.length === 0 || !characterId) {
      res.status(400).json({ error: 'imageIds array and characterId are required' });
      return;
    }

    const charIdNum = Number(characterId);
    const getImg = db.prepare('SELECT id, content_hash FROM images WHERE id = ?');
    const delStmt = db.prepare(
      'DELETE FROM image_characters WHERE image_content_hash = ? AND character_id = ?'
    );
    const upsertStmt = db.prepare(
      `INSERT INTO image_characters
        (image_id, image_content_hash, character_id, status, source, confidence, appearance_label, updated_at)
       VALUES (?, ?, ?, ?, 'bulk', 1.0, ?, datetime('now'))
       ON CONFLICT(image_content_hash, character_id) DO UPDATE SET
         status = excluded.status,
         appearance_label = COALESCE(excluded.appearance_label, image_characters.appearance_label),
         updated_at = datetime('now')`
    );

    let updatedCount = 0;
    const tx = db.transaction(() => {
      for (const rawId of imageIds) {
        const img = getImg.get(Number(rawId)) as { id: number; content_hash: string } | undefined;
        if (!img) continue;

        if (status === 'remove') {
          delStmt.run(img.content_hash, charIdNum);
        } else {
          upsertStmt.run(img.id, img.content_hash, charIdNum, status, appearanceLabel || null);
          if (status === 'confirmed') {
            ensureCharacterPortraitIfUnset(charIdNum, img.id, img.content_hash);
          }
        }
        updatedCount++;
      }
    });

    tx();
    res.json({ ok: true, count: updatedCount });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Failed to bulk update character associations' });
  }
});

/**
 * POST /api/characters/match-face
 * Detects faces in an uploaded image and matches against cached character face embeddings.
 */
charactersRouter.post('/match-face', async (req, res) => {
  try {
    const { imageBase64DataUrl, minSimilarity } = req.body || {};
    if (!imageBase64DataUrl || typeof imageBase64DataUrl !== 'string') {
      res.status(400).json({ error: 'imageBase64DataUrl is required' });
      return;
    }

    const raw = imageBase64DataUrl.trim();
    const match = raw.match(/^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/);
    const b64 = match ? match[1] : raw;
    if (!b64) {
      res.status(400).json({ error: 'Invalid or empty image payload' });
      return;
    }

    const imageBuffer = Buffer.from(b64, 'base64');
    const threshold =
      typeof minSimilarity === 'number' && Number.isFinite(minSimilarity)
        ? Math.max(0.1, Math.min(0.95, minSimilarity))
        : undefined;

    const result = await matchFaceToCharacter(imageBuffer, threshold);
    const character = result.characterId ? getCharacterProfileById(result.characterId) : null;

    res.json({
      matched: Boolean(result.matched && character),
      character,
      similarity: result.similarity,
      facesDetected: result.facesDetected,
      indexedCharactersCount: result.indexedCharactersCount,
      bestCandidate: result.bestCandidate,
    });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Face matching failed' });
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
