import { db } from '../../db.ts';
import { runAssistedCharacterIdentificationForImage } from '../characterService.ts';
import { parseImageMetadataFromChunks } from '../pngMetadataParser.ts';
import { getBoolSetting, setBoolSetting } from '../settingsService.ts';
import { confirmImageCharacterLink, upsertImageMetadata } from './scannerPersistenceHelpers.ts';

/**
 * Backfills positive/negative prompts for any already-indexed images in SQLite whose
 * prompt was previously unextracted (e.g. Krea2_turbo PrimitiveStringMultiline #30_19).
 */
export function backfillMissingImagePrompts(force = false): number {
  if (!force && getBoolSetting('prompt_backfill_v1_done', false)) {
    return 0;
  }
  const rows = db
    .prepare(
      `SELECT
         m.image_id,
         m.raw_metadata_json,
         w.api_workflow_json,
         w.visual_workflow_json
       FROM image_metadata m
       LEFT JOIN image_workflows iw ON iw.image_id = m.image_id
       LEFT JOIN workflows w ON w.id = iw.workflow_id
       WHERE m.positive_prompt IS NULL OR TRIM(m.positive_prompt) = ''`
    )
    .all() as {
    image_id: number;
    raw_metadata_json: string | null;
    api_workflow_json: string | null;
    visual_workflow_json: string | null;
  }[];

  if (rows.length === 0) {
    setBoolSetting('prompt_backfill_v1_done', true);
    return 0;
  }

  let updatedCount = 0;
  const updateStmt = db.prepare(
    `UPDATE image_metadata
     SET positive_prompt = COALESCE(?, positive_prompt),
         negative_prompt = COALESCE(?, negative_prompt),
         missing_fields_json = ?,
         provenance_json = ?
     WHERE image_id = ?`
  );

  for (const row of rows) {
    let chunks: Record<string, string> = {};
    if (row.raw_metadata_json) {
      try {
        const parsedRaw = JSON.parse(row.raw_metadata_json);
        if (parsedRaw && typeof parsedRaw === 'object') {
          chunks = { ...parsedRaw };
        }
      } catch {
        // ignore invalid raw metadata JSON
      }
    }
    if (!chunks.prompt && row.api_workflow_json) {
      chunks.prompt = row.api_workflow_json;
    }
    if (!chunks.workflow && row.visual_workflow_json) {
      chunks.workflow = row.visual_workflow_json;
    }
    if (Object.keys(chunks).length === 0) continue;

    const reparsed = parseImageMetadataFromChunks(chunks);
    if (reparsed.positivePrompt) {
      updateStmt.run(
        reparsed.positivePrompt,
        reparsed.negativePrompt,
        JSON.stringify(reparsed.missingFields),
        JSON.stringify(reparsed.provenance),
        row.image_id
      );
      runAssistedCharacterIdentificationForImage(row.image_id);
      updatedCount++;
    }
  }

  setBoolSetting('prompt_backfill_v1_done', true);
  return updatedCount;
}

/**
 * Copies generation metadata, LoRA stack, model dependencies, workflow link,
 * and confirmed character associations from a source image onto a derived (e.g. upscaled) image.
 */
export function copyImageMetadataToDerivedImage(
  sourceImageId: number,
  derivedImageId: number
): void {
  if (!sourceImageId || !derivedImageId || sourceImageId === derivedImageId) return;
  try {
    const baseImg = db
      .prepare('SELECT dependency_status FROM images WHERE id = ?')
      .get(sourceImageId) as { dependency_status: string } | undefined;
    const derivedImg = db
      .prepare('SELECT content_hash FROM images WHERE id = ?')
      .get(derivedImageId) as { content_hash: string } | undefined;
    const baseMeta = db
      .prepare('SELECT * FROM image_metadata WHERE image_id = ?')
      .get(sourceImageId) as any;

    const tx = db.transaction(() => {
      if (baseImg?.dependency_status) {
        db.prepare('UPDATE images SET dependency_status = ? WHERE id = ?').run(
          baseImg.dependency_status,
          derivedImageId
        );
      }

      if (baseMeta) {
        upsertImageMetadata(derivedImageId, {
          positivePrompt: baseMeta.positive_prompt,
          negativePrompt: baseMeta.negative_prompt,
          seed: baseMeta.seed,
          steps: baseMeta.steps,
          cfg: baseMeta.cfg,
          sampler: baseMeta.sampler,
          scheduler: baseMeta.scheduler,
          denoise: baseMeta.denoise,
          batchSize: baseMeta.batch_size,
          batchIndex: baseMeta.batch_index,
          generationDate: baseMeta.generation_date,
          checkpointName: baseMeta.checkpoint_name,
          checkpointHash: baseMeta.checkpoint_hash,
          vaeName: baseMeta.vae_name,
          missingFieldsJson: baseMeta.missing_fields_json,
          provenanceJson: baseMeta.provenance_json,
          rawMetadataJson: baseMeta.raw_metadata_json,
        });
      }

      const baseLoras = db
        .prepare('SELECT * FROM image_loras WHERE image_id = ?')
        .all(sourceImageId) as any[];
      if (baseLoras.length > 0) {
        db.prepare('DELETE FROM image_loras WHERE image_id = ?').run(derivedImageId);
        const insLora = db.prepare(
          `INSERT INTO image_loras
            (image_id, model_id, lora_name, lora_path, lora_hash, model_strength, clip_strength, node_id, node_type, provenance)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        );
        for (const l of baseLoras) {
          insLora.run(
            derivedImageId,
            l.model_id,
            l.lora_name,
            l.lora_path,
            l.lora_hash,
            l.model_strength,
            l.clip_strength,
            l.node_id,
            l.node_type,
            l.provenance
          );
        }
      }

      const baseModels = db
        .prepare('SELECT * FROM image_models WHERE image_id = ?')
        .all(sourceImageId) as any[];
      if (baseModels.length > 0) {
        db.prepare('DELETE FROM image_models WHERE image_id = ?').run(derivedImageId);
        const insModel = db.prepare(
          `INSERT INTO image_models
            (image_id, model_id, model_name, model_type, model_hash, status, node_id, node_type, provenance)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        );
        for (const m of baseModels) {
          insModel.run(
            derivedImageId,
            m.model_id,
            m.model_name,
            m.model_type,
            m.model_hash,
            m.status,
            m.node_id,
            m.node_type,
            m.provenance
          );
        }
      }

      const baseWf = db
        .prepare('SELECT * FROM image_workflows WHERE image_id = ?')
        .get(sourceImageId) as any;
      if (baseWf) {
        db.prepare(
          `INSERT INTO image_workflows (image_id, workflow_id, format_type)
           VALUES (?, ?, ?)
           ON CONFLICT(image_id) DO UPDATE SET
             workflow_id = excluded.workflow_id,
             format_type = excluded.format_type`
        ).run(derivedImageId, baseWf.workflow_id, baseWf.format_type);
      }

      if (derivedImg?.content_hash) {
        const baseChars = db
          .prepare("SELECT * FROM image_characters WHERE image_id = ? AND status = 'confirmed'")
          .all(sourceImageId) as any[];
        for (const ch of baseChars) {
          confirmImageCharacterLink({
            imageId: derivedImageId,
            contentHash: derivedImg.content_hash,
            characterId: ch.character_id,
            source: ch.source || 'upscale',
            confidence: ch.confidence ?? 1.0,
            matchReason: ch.match_reason || 'Inherited from upscaled source image',
            explicitAppearanceLabel: ch.appearance_label || 'Default',
          });
        }
      }
    });

    tx();
  } catch (err) {
    console.warn('Failed to copy source metadata to derived image:', err);
  }
}
