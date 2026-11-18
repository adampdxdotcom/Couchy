import { db } from '../../db.ts';
import { ensureCharacterPortraitIfUnset } from '../characterService.ts';
import type { DependencyStatus } from '../../../shared/types.ts';

export interface ImageMetadataUpsertInput {
  positivePrompt: string | null;
  negativePrompt: string | null;
  seed: string | null;
  steps: number | null;
  cfg: number | null;
  sampler: string | null;
  scheduler: string | null;
  denoise: number | null;
  batchSize: number | null;
  batchIndex: number | null;
  generationDate: string | null;
  checkpointName: string | null;
  checkpointHash: string | null;
  vaeName: string | null;
  missingFieldsJson: string;
  provenanceJson: string;
  rawMetadataJson: string;
}

export interface ConfirmImageCharacterLinkInput {
  imageId: number;
  contentHash: string;
  characterId: number;
  positivePrompt?: string | null;
  loras?: { loraName: string }[];
  source?: string;
  confidence?: number;
  matchReason?: string;
  explicitAppearanceLabel?: string | null;
}

/**
 * Shared SQLite upsert for `image_metadata`, used by both single-image indexing
 * and derived/upscaled metadata inheritance so column mappings stay in sync.
 */
export function upsertImageMetadata(imageId: number, data: ImageMetadataUpsertInput): void {
  db.prepare(
    `INSERT INTO image_metadata (
      image_id, positive_prompt, negative_prompt, seed, steps, cfg, sampler, scheduler,
      denoise, batch_size, batch_index, generation_date, checkpoint_name, checkpoint_hash,
      vae_name, missing_fields_json, provenance_json, raw_metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(image_id) DO UPDATE SET
      positive_prompt = excluded.positive_prompt,
      negative_prompt = excluded.negative_prompt,
      seed = excluded.seed,
      steps = excluded.steps,
      cfg = excluded.cfg,
      sampler = excluded.sampler,
      scheduler = excluded.scheduler,
      denoise = excluded.denoise,
      batch_size = excluded.batch_size,
      batch_index = excluded.batch_index,
      generation_date = excluded.generation_date,
      checkpoint_name = excluded.checkpoint_name,
      checkpoint_hash = excluded.checkpoint_hash,
      vae_name = excluded.vae_name,
      missing_fields_json = excluded.missing_fields_json,
      provenance_json = excluded.provenance_json,
      raw_metadata_json = excluded.raw_metadata_json`
  ).run(
    imageId,
    data.positivePrompt,
    data.negativePrompt,
    data.seed,
    data.steps,
    data.cfg,
    data.sampler,
    data.scheduler,
    data.denoise,
    data.batchSize,
    data.batchIndex,
    data.generationDate,
    data.checkpointName,
    data.checkpointHash,
    data.vaeName,
    data.missingFieldsJson,
    data.provenanceJson,
    data.rawMetadataJson
  );
}

/**
 * Confirms an image-to-character link, resolving appearance when not explicitly provided,
 * and sets the character's portrait if unset.
 */
export function confirmImageCharacterLink(input: ConfirmImageCharacterLinkInput): void {
  const appearanceLabel =
    input.explicitAppearanceLabel ??
    resolveAppearanceForCharacter(input.characterId, input.positivePrompt ?? null, input.loras ?? []);

  db.prepare(
    `INSERT INTO image_characters
      (image_id, image_content_hash, character_id, status, source, confidence, match_reason, appearance_label)
     VALUES (?, ?, ?, 'confirmed', ?, ?, ?, ?)
     ON CONFLICT(image_content_hash, character_id) DO UPDATE SET
      status = 'confirmed',
      image_id = excluded.image_id,
      appearance_label = COALESCE(excluded.appearance_label, image_characters.appearance_label),
      updated_at = datetime('now')`
  ).run(
    input.imageId,
    input.contentHash,
    input.characterId,
    input.source ?? 'manual',
    input.confidence ?? 1.0,
    input.matchReason ?? 'Generated with character mention',
    appearanceLabel
  );

  ensureCharacterPortraitIfUnset(input.characterId, input.imageId, input.contentHash);
}

/**
 * Evaluates dependency status for an image against known installed models in `models`.
 */
export function recomputeImageDependencyStatus(imageId: number): DependencyStatus {
  const deps = db
    .prepare('SELECT * FROM image_models WHERE image_id = ?')
    .all(imageId) as any[];

  const meta = db
    .prepare('SELECT positive_prompt, checkpoint_name FROM image_metadata WHERE image_id = ?')
    .get(imageId) as { positive_prompt: string | null; checkpoint_name: string | null } | undefined;

  if (deps.length === 0 && !meta?.checkpoint_name) {
    db.prepare('UPDATE images SET dependency_status = ? WHERE id = ?').run('unknown', imageId);
    return 'unknown';
  }

  let allPresent = true;
  let allHashesVerified = deps.length > 0;

  for (const dep of deps) {
    const modelRecord = db
      .prepare(
        `SELECT * FROM models
         WHERE LOWER(filename) = LOWER(?)
            OR LOWER(name) = LOWER(?)
            OR (sha256_hash IS NOT NULL AND sha256_hash = ?)
            OR (autov2_hash IS NOT NULL AND autov2_hash = ?)
         LIMIT 1`
      )
      .get(dep.model_name, dep.model_name.replace(/\.(safetensors|ckpt|pt)$/i, ''), dep.model_hash, dep.model_hash) as any;

    if (!modelRecord || !modelRecord.is_installed) {
      allPresent = false;
      allHashesVerified = false;
      db.prepare('UPDATE image_models SET status = ?, model_id = ? WHERE id = ?').run(
        'missing',
        modelRecord?.id ?? null,
        dep.id
      );
    } else {
      const hashVerified = Boolean(
        dep.model_hash &&
          (modelRecord.sha256_hash === dep.model_hash || modelRecord.autov2_hash === dep.model_hash)
      );
      if (!hashVerified) {
        allHashesVerified = false;
      }
      db.prepare('UPDATE image_models SET status = ?, model_id = ? WHERE id = ?').run(
        hashVerified ? 'exact_match' : 'available',
        modelRecord.id,
        dep.id
      );
      db.prepare('UPDATE image_loras SET model_id = ? WHERE image_id = ? AND LOWER(lora_name) = LOWER(?)').run(
        modelRecord.id,
        imageId,
        dep.model_name
      );
    }
  }

  const finalStatus: DependencyStatus = !allPresent
    ? 'incomplete'
    : allHashesVerified
    ? 'exact_match'
    : 'available';

  db.prepare('UPDATE images SET dependency_status = ? WHERE id = ?').run(finalStatus, imageId);
  return finalStatus;
}

/**
 * Resolves the best-matching appearance label for a character from prompt text and LoRAs.
 */
export function resolveAppearanceForCharacter(
  characterId: number,
  positivePrompt: string | null,
  loras: { loraName: string }[] = []
): string {
  try {
    const charLoras = db
      .prepare(
        'SELECT lora_name, appearance_label FROM character_loras WHERE character_id = ?'
      )
      .all(characterId) as { lora_name: string; appearance_label: string }[];

    const promptLower = (positivePrompt || '').toLowerCase();

    // 1. Check if any LoRA matches a character LoRA with an explicit appearance label
    for (const cl of charLoras) {
      if (!cl.appearance_label || cl.appearance_label === 'Default') continue;
      const clName = cl.lora_name.toLowerCase().replace(/\.(safetensors|pt|ckpt)$/i, '');
      const hitLora = loras.some((l) =>
        l.loraName.toLowerCase().replace(/\.(safetensors|pt|ckpt)$/i, '') === clName
      );
      if (hitLora) {
        return cl.appearance_label;
      }
    }

    // 2. Check if positive prompt mentions any known appearance label for this character
    for (const cl of charLoras) {
      if (!cl.appearance_label || cl.appearance_label === 'Default') continue;
      const appLower = cl.appearance_label.toLowerCase();
      if (promptLower.includes(appLower)) {
        return cl.appearance_label;
      }
    }

    // 3. Check character tags for appearance hints
    const tags = db
      .prepare(
        'SELECT t.name FROM character_tags ct JOIN tags t ON t.id = ct.tag_id WHERE ct.character_id = ?'
      )
      .all(characterId) as { name: string }[];
    for (const tag of tags) {
      if (tag.name && promptLower.includes(tag.name.toLowerCase())) {
        return tag.name;
      }
    }

    return 'Default';
  } catch {
    return 'Default';
  }
}
