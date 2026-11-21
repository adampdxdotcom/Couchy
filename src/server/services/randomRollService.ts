import { db } from '../db.ts';
import { logger } from '../logger.ts';
import {
  type GenerationBatchRecord,
  type GenerationLoraSelection,
} from '../../shared/types.ts';
import { resolveClosestAspectRatio } from '../../shared/utils.ts';
import { isBatchCancelled } from './comfyuiLiveMonitor.ts';
import {
  dispatchGenerationBatch,
  dispatchPendingGenerationItem,
  touchBatchPendingItems,
  type PendingBatchSlot,
} from './generationDispatchService.ts';
import { filterCharacterIdentityTags, normalizeLoraMatchKey } from './llm/llmPromptUtils.ts';
import {
  composeRandomRollPrompt,
  extractLoraCheckFromRandomRollResponse,
  extractPromptFromRandomRollResponse,
  resolveSelectedBaseCandidate,
  verifyPromptReflectsLoraCheck,
  type BaseModelCandidate,
} from './randomRollPromptService.ts';
import { getWorkflowDefaults } from './workflowCompilerService.ts';

export {
  extractLoraCheckFromRandomRollResponse,
  extractPromptFromRandomRollResponse,
  resolveSelectedBaseCandidate,
  verifyPromptReflectsLoraCheck,
  type BaseModelCandidate,
};

export interface WeightedCandidate<T> {
  item: T;
  weight: number;
  cooldownKey?: string;
}

export interface RandomRollSummary {
  characterId: number;
  characterName: string;
  checkpointName: string | null;
  loraNames: string[];
  tags: string[];
  aspectRatio: string;
  usedLmStudio: boolean;
  prompt: string;
  totalCount: number;
}

const recentCharacterIds: number[] = [];
const recentLoraKeys: string[] = [];
const recentCheckpointKeys: string[] = [];

function recordRecentRoll(
  charId: number,
  styleLoras: string[],
  checkpointName?: string | null
): void {
  recentCharacterIds.unshift(charId);
  if (recentCharacterIds.length > 4) recentCharacterIds.length = 4;
  for (const l of styleLoras) {
    const key = normalizeLoraMatchKey(l);
    if (!key) continue;
    recentLoraKeys.unshift(key);
  }
  if (recentLoraKeys.length > 6) recentLoraKeys.length = 6;

  if (checkpointName) {
    const ckptKey = normalizeLoraMatchKey(checkpointName);
    if (ckptKey) {
      recentCheckpointKeys.unshift(ckptKey);
      if (recentCheckpointKeys.length > 2) recentCheckpointKeys.length = 2;
    }
  }
}

function getCheckpointCooldownTier(filename: string): 0 | 1 | 2 {
  const key = normalizeLoraMatchKey(filename);
  if (!key) return 0;
  if (recentCheckpointKeys[0] === key) return 1;
  if (recentCheckpointKeys[1] === key) return 2;
  return 0;
}

/**
 * Computes smoothed sublinear popularity weight so popular items are favored
 * without starving rarer characters, models, or tags.
 */
export function computeSublinearPopularityWeight(
  usageCount: number,
  favoriteCount = 0,
  isRecentlyUsed = false
): number {
  const base = 1 + Math.sqrt(Math.max(0, usageCount));
  const favBoost = favoriteCount > 0 ? 1 + Math.min(0.6, Math.sqrt(favoriteCount) * 0.15) : 1;
  const cooldownPenalty = isRecentlyUsed ? 0.15 : 1;
  return Math.max(0.05, base * favBoost * cooldownPenalty);
}

/**
 * Picks one item randomly proportional to non-negative weights.
 */
export function pickWeightedItem<T>(candidates: WeightedCandidate<T>[]): T | null {
  if (candidates.length === 0) return null;
  const total = candidates.reduce((acc, c) => acc + Math.max(0.01, c.weight), 0);
  let target = Math.random() * total;
  for (const c of candidates) {
    target -= Math.max(0.01, c.weight);
    if (target <= 0) return c.item;
  }
  return candidates[candidates.length - 1].item;
}

export function normalizeBaseModelGroup(raw: string | null | undefined): string {
  const s = (raw || '').trim().toLowerCase();
  if (!s) return '';
  if (s.includes('krea') || s.includes('flux')) return 'flux';
  if (s.includes('pony')) return 'pony';
  if (s.includes('illustrious') || s.includes('noob')) return 'illustrious';
  if (s.includes('sdxl')) return 'sdxl';
  if (s.includes('sd 1.5') || s.includes('sd15') || s.includes('1.5')) return 'sd15';
  return s;
}

export function selectRolledCharacter(preferredCharacterId?: number | null) {
  let picked:
    | {
        id: number;
        name: string;
        description: string;
        physical_description: string;
        usage_count?: number;
        fav_count?: number;
      }
    | undefined;

  if (
    preferredCharacterId !== undefined &&
    preferredCharacterId !== null &&
    Number.isFinite(Number(preferredCharacterId)) &&
    Number(preferredCharacterId) > 0
  ) {
    picked = db
      .prepare(
        `SELECT id, name, description, physical_description
         FROM characters
         WHERE id = ?`
      )
      .get(Number(preferredCharacterId)) as
      | {
          id: number;
          name: string;
          description: string;
          physical_description: string;
        }
      | undefined;

    if (!picked) {
      throw new Error(`Selected character #${preferredCharacterId} was not found.`);
    }
  } else {
    const rows = db
      .prepare(
        `SELECT
           c.id,
           c.name,
           c.description,
           c.physical_description,
           COUNT(DISTINCT CASE WHEN i.id IS NOT NULL THEN ic.image_content_hash END) AS usage_count,
           COUNT(DISTINCT CASE WHEN i.id IS NOT NULL AND COALESCE(r.is_favorite, 0) = 1 THEN ic.image_content_hash END) AS fav_count
         FROM characters c
         LEFT JOIN image_characters ic ON ic.character_id = c.id AND ic.status = 'confirmed'
         LEFT JOIN images i ON i.content_hash = ic.image_content_hash
           AND i.is_missing = 0
           AND COALESCE(i.is_uploaded_reference, 0) = 0
         LEFT JOIN ratings r ON r.content_hash = i.content_hash
         WHERE (COALESCE(r.is_rejected, 0) = 0 OR i.id IS NULL)
           AND EXISTS (
             SELECT 1
             FROM character_loras cl
             JOIN models m ON m.id = cl.model_id OR LOWER(m.filename) = LOWER(cl.lora_name)
             WHERE cl.character_id = c.id
               AND COALESCE(m.is_installed, 0) = 1
           )
         GROUP BY c.id`
      )
      .all() as Array<{
      id: number;
      name: string;
      description: string;
      physical_description: string;
      usage_count: number;
      fav_count: number;
    }>;

    if (rows.length === 0) {
      throw new Error('No characters with an installed LoRA are available for Random Roll.');
    }

    picked = pickWeightedItem(
      rows.map((row) => ({
        item: row,
        weight: computeSublinearPopularityWeight(
          Number(row.usage_count || 0),
          Number(row.fav_count || 0),
          rows.length > 1 && recentCharacterIds.includes(row.id)
        ),
      }))
    )!;
  }

  // Pick among installed character LoRAs attached to this character
  const charLoras = db
    .prepare(
      `SELECT
         cl.lora_name,
         COALESCE(NULLIF(TRIM(cl.trigger_word), ''), m.trigger_word, '') AS trigger_word,
         m.base_model,
         COALESCE(m.default_model_strength, 1.0) AS default_model_strength,
         COALESCE(m.default_clip_strength, 1.0) AS default_clip_strength
       FROM character_loras cl
       JOIN models m ON m.id = cl.model_id OR LOWER(m.filename) = LOWER(cl.lora_name)
       WHERE cl.character_id = ?
         AND COALESCE(m.is_installed, 0) = 1
       GROUP BY cl.id`
    )
    .all(picked.id) as Array<{
    lora_name: string;
    trigger_word: string;
    base_model: string | null;
    default_model_strength: number;
    default_clip_strength: number;
  }>;

  const installedCharLora =
    charLoras.length > 0 ? charLoras[Math.floor(Math.random() * charLoras.length)] : null;
  return { character: picked, charLora: installedCharLora };
}

/**
 * Returns mention-enabled, installed, non-hidden base models that have a populated
 * Model Details & Strengths description, filtered to match the active architecture group.
 */
export function getEligibleDescribedCheckpoints(preferredBaseGroup: string): BaseModelCandidate[] {
  const rows = db
    .prepare(
      `SELECT
         m.filename,
         m.name,
         m.nickname,
         m.base_model,
         TRIM(COALESCE(m.llm_description, '')) AS llm_description,
         COUNT(DISTINCT i.id) AS usage_count,
         COUNT(DISTINCT CASE WHEN COALESCE(r.is_favorite, 0) = 1 THEN i.id END) AS fav_count
       FROM models m
       LEFT JOIN image_metadata im ON LOWER(im.checkpoint_name) = LOWER(m.filename)
       LEFT JOIN images i ON i.id = im.image_id AND i.is_missing = 0 AND COALESCE(i.is_uploaded_reference, 0) = 0
       LEFT JOIN ratings r ON r.content_hash = i.content_hash
       WHERE m.model_type IN ('checkpoint', 'diffusion')
         AND COALESCE(m.is_installed, 0) = 1
         AND COALESCE(m.is_hidden, 0) = 0
         AND COALESCE(m.mention_enabled, 0) = 1
         AND TRIM(COALESCE(m.llm_description, '')) != ''
         AND (COALESCE(r.is_rejected, 0) = 0 OR i.id IS NULL)
       GROUP BY m.id`
    )
    .all() as BaseModelCandidate[];

  if (rows.length === 0) return [];

  const compatible = preferredBaseGroup
    ? rows.filter((r) => {
        const g = normalizeBaseModelGroup(r.base_model);
        return !g || g === preferredBaseGroup;
      })
    : rows;

  return compatible.length > 0 ? compatible : rows;
}

/**
 * Picks a fallback checkpoint using popularity + favorites with a soft cooldown
 * (down-weights recent picks instead of banning them so 2-3 model pools stay valid).
 */
function pickWeightedCheckpointFallback(
  candidates: BaseModelCandidate[],
  fallbackCheckpoint: string | null
): string | null {
  if (candidates.length === 0) return fallbackCheckpoint;

  const picked = pickWeightedItem(
    candidates.map((r) => {
      const baseWeight = computeSublinearPopularityWeight(
        Number(r.usage_count || 0),
        Number(r.fav_count || 0)
      );
      const tier = candidates.length > 1 ? getCheckpointCooldownTier(r.filename) : 0;
      const softCooldown = tier === 1 ? 0.25 : tier === 2 ? 0.6 : 1;
      return {
        item: r,
        weight: Math.max(0.05, baseWeight * softCooldown),
      };
    })
  );

  return picked?.filename || fallbackCheckpoint;
}

export function selectRolledStyleLoras(baseGroup: string): Array<{
  filename: string;
  baseModel: string | null;
  triggerWord: string;
  modelStrength: number;
  clipStrength: number;
}> {
  // 10% 0 style LoRAs (char LoRA only), 45% 1 style LoRA (2 total), 45% 2 style LoRAs (3 total)
  const roll = Math.random();
  const targetCount = roll < 0.1 ? 0 : roll < 0.55 ? 1 : 2;
  if (targetCount === 0) return [];

  const rows = db
    .prepare(
      `SELECT
         m.filename,
         m.base_model,
         COALESCE(m.trigger_word, '') AS trigger_word,
         COALESCE(m.default_model_strength, 1.0) AS default_model_strength,
         COALESCE(m.default_clip_strength, 1.0) AS default_clip_strength,
         COUNT(DISTINCT i.id) AS usage_count,
         COUNT(DISTINCT CASE WHEN COALESCE(r.is_favorite, 0) = 1 THEN i.id END) AS fav_count
       FROM models m
       LEFT JOIN image_loras il ON LOWER(il.lora_name) = LOWER(m.filename)
       LEFT JOIN images i ON i.id = il.image_id AND i.is_missing = 0 AND COALESCE(i.is_uploaded_reference, 0) = 0
       LEFT JOIN ratings r ON r.content_hash = i.content_hash
       WHERE m.model_type = 'lora'
         AND COALESCE(m.is_installed, 0) = 1
         AND COALESCE(m.is_hidden, 0) = 0
         AND COALESCE(m.mention_enabled, 0) = 1
         AND LOWER(COALESCE(m.lora_category, 'unclassified')) != 'character'
         AND NOT EXISTS (
           SELECT 1 FROM character_loras cl
           WHERE cl.model_id = m.id OR LOWER(cl.lora_name) = LOWER(m.filename)
         )
         AND (COALESCE(r.is_rejected, 0) = 0 OR i.id IS NULL)
       GROUP BY m.id`
    )
    .all() as Array<{
    filename: string;
    base_model: string | null;
    trigger_word: string;
    default_model_strength: number;
    default_clip_strength: number;
    usage_count: number;
    fav_count: number;
  }>;

  const compatible = baseGroup
    ? rows.filter((r) => {
        const g = normalizeBaseModelGroup(r.base_model);
        return !g || g === baseGroup;
      })
    : rows;
  const pool = [...(compatible.length > 0 ? compatible : rows)];
  const selected: Array<{
    filename: string;
    baseModel: string | null;
    triggerWord: string;
    modelStrength: number;
    clipStrength: number;
  }> = [];

  while (selected.length < targetCount && pool.length > 0) {
    const picked = pickWeightedItem(
      pool.map((r) => ({
        item: r,
        weight: computeSublinearPopularityWeight(
          Number(r.usage_count || 0),
          Number(r.fav_count || 0),
          pool.length > 2 && recentLoraKeys.includes(normalizeLoraMatchKey(r.filename))
        ),
      }))
    );
    if (!picked) break;
    selected.push({
      filename: picked.filename,
      baseModel: picked.base_model,
      triggerWord: picked.trigger_word || '',
      modelStrength: Number(picked.default_model_strength ?? 1.0),
      clipStrength: Number(picked.default_clip_strength ?? 1.0),
    });
    const idx = pool.findIndex((p) => p.filename === picked.filename);
    if (idx >= 0) pool.splice(idx, 1);
  }

  return selected;
}

export function isIdentityOrDemographicTag(tag: string): boolean {
  const clean = tag.trim();
  if (!clean) return true;
  if (filterCharacterIdentityTags([clean]).length === 0) return true;
  if (
    /^(?:\d+\s*(?:girl|boy|female|male|other)s?|solo|multiple\s+(?:girls|boys|females|males)|woman|man|girl|boy|female|male|mature\s+(?:female|male)|female\s+focus|male\s+focus|looking\s+at\s+viewer|simple\s+background)$/i.test(
      clean
    )
  ) {
    return true;
  }
  return /\b(?:caucasian|white\s+skin|pale\s+skin|fair\s+skin|dark\s+skin|dark-skinned|tan\s+skin|olive\s+skin|ebony|asian|east\s+asian|japanese|korean|chinese|latina|latino|hispanic|african|indian|middle\s+eastern|arab|indigenous|biracial|mixed\s+race|hair|blonde|blond|brunette|redhead|eyes|heterochromia|freckles|skin|tanlines|breasts|bust|chest|hips|waist|thighs|curvy|petite|slender|voluptuous|muscular|athletic|chubby|plump)\b/i.test(
    clean
  );
}

export function selectRolledTags(desiredCount = 5): string[] {
  const userTagRows = db
    .prepare(
      `SELECT t.name AS tag, COUNT(*) AS usage_count
       FROM image_tags it
       JOIN tags t ON t.id = it.tag_id
       JOIN images i ON i.content_hash = it.image_content_hash AND i.is_missing = 0
       LEFT JOIN ratings r ON r.content_hash = i.content_hash
       WHERE COALESCE(r.is_rejected, 0) = 0
       GROUP BY t.id
       ORDER BY usage_count DESC
       LIMIT 60`
    )
    .all() as Array<{ tag: string; usage_count: number }>;

  const visualTagRows = db
    .prepare(
      `SELECT ivt.tag AS tag, COUNT(*) AS usage_count
       FROM image_visual_tags ivt
       JOIN images i ON i.content_hash = ivt.image_content_hash AND i.is_missing = 0
       LEFT JOIN ratings r ON r.content_hash = i.content_hash
       WHERE COALESCE(r.is_rejected, 0) = 0
         AND LENGTH(TRIM(ivt.tag)) >= 3
       GROUP BY LOWER(ivt.tag)
       ORDER BY usage_count DESC
       LIMIT 80`
    )
    .all() as Array<{ tag: string; usage_count: number }>;

  const tagMap = new Map<string, { label: string; count: number }>();

  for (const row of [...userTagRows, ...visualTagRows]) {
    const clean = row.tag.trim();
    const key = clean.toLowerCase();
    // Skip gender, race/ethnicity, hair/eye, and body tags so rolled motifs never override the subject
    if (!clean || isIdentityOrDemographicTag(clean)) continue;
    const prev = tagMap.get(key);
    tagMap.set(key, {
      label: prev?.label || clean,
      count: (prev?.count || 0) + Number(row.usage_count || 0),
    });
  }

  const pool = Array.from(tagMap.values());
  const chosen: string[] = [];
  while (chosen.length < desiredCount && pool.length > 0) {
    const picked = pickWeightedItem(
      pool.map((t) => ({
        item: t,
        weight: computeSublinearPopularityWeight(t.count),
      }))
    );
    if (!picked) break;
    chosen.push(picked.label);
    const idx = pool.findIndex((p) => p.label.toLowerCase() === picked.label.toLowerCase());
    if (idx >= 0) pool.splice(idx, 1);
  }

  return chosen;
}

function selectRolledAspectRatio(fallbackRatio: string | null): string {
  const rows = db
    .prepare(
      `SELECT i.width, i.height, COALESCE(r.is_favorite, 0) AS is_fav
       FROM images i
       LEFT JOIN ratings r ON r.content_hash = i.content_hash
       WHERE i.is_missing = 0
         AND COALESCE(i.is_uploaded_reference, 0) = 0
         AND COALESCE(r.is_rejected, 0) = 0
         AND i.width > 0
         AND i.height > 0`
    )
    .all() as Array<{ width: number; height: number; is_fav: number }>;

  if (rows.length === 0) {
    return fallbackRatio || '2:3 (Portrait Photo)';
  }

  const ratioCounts = new Map<string, { usage: number; fav: number }>();
  for (const row of rows) {
    const preset = resolveClosestAspectRatio(row.width, row.height);
    const cur = ratioCounts.get(preset) || { usage: 0, fav: 0 };
    cur.usage += 1;
    if (row.is_fav) cur.fav += 1;
    ratioCounts.set(preset, cur);
  }

  return (
    pickWeightedItem(
      Array.from(ratioCounts.entries()).map(([ratio, stats]) => ({
        item: ratio,
        weight: computeSublinearPopularityWeight(stats.usage, stats.fav),
      }))
    ) ||
    fallbackRatio ||
    '2:3 (Portrait Photo)'
  );
}

/**
 * Sequentially authors Shots 2..N via the Local LLM agent (sharing prior shot prompts
 * to avoid repetition) and dispatches each shot to ComfyUI as soon as its prompt is ready.
 */
async function runProgressiveRandomRollShots(params: {
  batchId: number;
  workflowId: number;
  pendingSlots: PendingBatchSlot[];
  totalCount: number;
  initialPrompt: string;
  characterId: number;
  characterName: string;
  characterDescription: string;
  characterPhysicalDescription: string;
  loras: GenerationLoraSelection[];
  hasStyleLoras: boolean;
  tags: string[];
  aspectRatio: string;
  triggerWord: string;
  baseCandidates: BaseModelCandidate[];
  lockedCheckpoint: string | null;
}): Promise<void> {
  const previousPrompts = [params.initialPrompt];

  for (const slot of params.pendingSlots) {
    if (!db.open || isBatchCancelled(params.batchId)) {
      break;
    }

    try {
      touchBatchPendingItems(params.batchId);

      const { prompt } = await composeRandomRollPrompt({
        characterName: params.characterName,
        characterDescription: params.characterDescription,
        characterPhysicalDescription: params.characterPhysicalDescription,
        loraNames: params.loras.map((l) => l.loraName),
        hasStyleLoras: params.hasStyleLoras,
        tags: params.tags,
        baseCandidates: params.baseCandidates,
        fallbackCheckpoint: params.lockedCheckpoint,
        recentCheckpointKeys,
        shotNumber: slot.itemIndex,
        totalShots: params.totalCount,
        previousPrompts,
        lockedCheckpoint: params.lockedCheckpoint,
      });

      if (!db.open || isBatchCancelled(params.batchId)) {
        break;
      }

      previousPrompts.push(prompt);
      const { cancelled } = await dispatchPendingGenerationItem({
        batchId: params.batchId,
        itemId: slot.itemId,
        prompt,
        seed: slot.seed,
        workflowId: params.workflowId,
        aspectRatio: params.aspectRatio,
        triggerWord: params.triggerWord,
        negativePrompt: '',
        loras: params.loras,
        checkpointName: params.lockedCheckpoint,
        characterId: params.characterId,
      });

      if (cancelled) break;
    } catch (err: any) {
      logger.error(
        'ComfyUI',
        `Progressive Random Roll batch #${params.batchId} shot #${slot.itemIndex} failed`,
        err?.message || err
      );
      if (db.open) {
        db.prepare(
          `UPDATE generation_items
           SET status = 'failed', error_message = ?, completed_at = datetime('now')
           WHERE id = ? AND status = 'pending'`
        ).run(err?.message || 'Failed during progressive Random Roll generation', slot.itemId);
      }
    }
  }
}

/**
 * Picks a popularity-weighted character (or uses the user's pinned characterId when provided),
 * compatible style LoRAs, tags, and aspect ratio, then authors Shot 1 and dispatches immediately.
 * When `count > 1`, Shots 2..N are generated sequentially by the agent in the background and
 * appended to the same batch and multi-shot series as each prompt completes.
 */
export async function executeRandomRoll(options?: {
  characterId?: number | null;
  count?: number | null;
}): Promise<{
  batch: GenerationBatchRecord;
  batches: GenerationBatchRecord[];
  rollSummary: RandomRollSummary;
  progressiveTask?: Promise<void>;
}> {
  const defaultWf = db
    .prepare(
      'SELECT id FROM workflows ORDER BY is_default DESC, is_saved_library DESC, id ASC LIMIT 1'
    )
    .get() as { id: number } | undefined;
  if (!defaultWf) {
    throw new Error('No default ComfyUI workflow configured.');
  }

  const totalCount = Math.max(
    1,
    Math.min(8, Math.round(Number(options?.count ?? 1)) || 1)
  );
  const wfDefaults = getWorkflowDefaults(defaultWf.id);
  const { character, charLora } = selectRolledCharacter(options?.characterId);
  const charBaseGroup = normalizeBaseModelGroup(charLora?.base_model);
  const styleLoras = selectRolledStyleLoras(charBaseGroup);
  const effectiveBaseGroup =
    charBaseGroup ||
    styleLoras.map((sl) => normalizeBaseModelGroup(sl.baseModel)).find(Boolean) ||
    '';

  const tags = selectRolledTags(5);
  const aspectRatio = selectRolledAspectRatio(wfDefaults.defaultAspectRatio ?? null);
  const baseCandidates = getEligibleDescribedCheckpoints(effectiveBaseGroup);
  const fallbackCheckpoint = pickWeightedCheckpointFallback(
    baseCandidates,
    wfDefaults.defaultCheckpoint ?? null
  );

  const loras: GenerationLoraSelection[] = [];
  if (charLora) {
    loras.push({
      loraName: charLora.lora_name,
      modelStrength: Number(charLora.default_model_strength ?? 1.0),
      clipStrength: Number(charLora.default_clip_strength ?? 1.0),
      triggerWord: charLora.trigger_word || '',
    });
  }
  for (const sl of styleLoras) {
    loras.push({
      loraName: sl.filename,
      modelStrength: sl.modelStrength,
      clipStrength: sl.clipStrength,
      triggerWord: sl.triggerWord,
    });
  }

  const triggerWord = Array.from(
    new Set(
      [charLora?.trigger_word, ...styleLoras.map((sl) => sl.triggerWord)]
        .flatMap((t) => (t || '').split(','))
        .map((t) => t.trim())
        .filter(Boolean)
    )
  ).join(', ');

  const { prompt, checkpointName, usedLmStudio } = await composeRandomRollPrompt({
    characterName: character.name,
    characterDescription: character.description || '',
    characterPhysicalDescription: character.physical_description || '',
    loraNames: loras.map((l) => l.loraName),
    hasStyleLoras: styleLoras.length > 0,
    tags,
    baseCandidates,
    fallbackCheckpoint,
    recentCheckpointKeys,
    shotNumber: 1,
    totalShots: totalCount,
  });

  recordRecentRoll(
    character.id,
    styleLoras.map((l) => l.filename),
    checkpointName
  );

  // Omit megapixels and steps so dispatch uses the default workflow's native resolution & steps
  const { batch, batches, pendingSlots } = await dispatchGenerationBatch({
    characterId: character.id,
    workflowId: defaultWf.id,
    mode: totalCount > 1 ? 'theme_set' : 'single',
    themeTitle: totalCount > 1 ? 'Random Roll Set' : 'Random Roll',
    aspectRatio,
    prompts: [prompt],
    totalPlannedCount: totalCount,
    triggerWord,
    negativePrompt: '',
    loras,
    checkpointName,
  });

  const progressiveTask =
    totalCount > 1 && pendingSlots && pendingSlots.length > 0
      ? runProgressiveRandomRollShots({
          batchId: batch.id,
          workflowId: defaultWf.id,
          pendingSlots,
          totalCount,
          initialPrompt: prompt,
          characterId: character.id,
          characterName: character.name,
          characterDescription: character.description || '',
          characterPhysicalDescription: character.physical_description || '',
          loras,
          hasStyleLoras: styleLoras.length > 0,
          tags,
          aspectRatio,
          triggerWord,
          baseCandidates,
          lockedCheckpoint: checkpointName,
        })
      : undefined;

  const rollSummary: RandomRollSummary = {
    characterId: character.id,
    characterName: character.name,
    checkpointName,
    loraNames: loras.map((l) => l.loraName),
    tags,
    aspectRatio,
    usedLmStudio,
    prompt,
    totalCount,
  };

  logger.info(
    'ComfyUI',
    `Random Roll queued batch #${batch.id} (${totalCount} shot${totalCount === 1 ? '' : 's'}): char=${character.name} ckpt=${checkpointName || 'default'} loras=${loras.length} ar=${aspectRatio} llm=${usedLmStudio}`
  );

  return progressiveTask
    ? { batch, batches, rollSummary, progressiveTask }
    : { batch, batches, rollSummary };
}
