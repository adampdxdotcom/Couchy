import { db } from '../db.ts';
import { appConfig } from '../config.ts';
import { logger } from '../logger.ts';
import { syncModelInventory } from './modelInventoryService.ts';
import { runAssistedCharacterIdentificationForAll } from './characterService.ts';
import { copyImageMetadataToDerivedImage } from './scannerService.ts';
import { invalidateInstalledModelsCache } from './civitai/civitaiModelEnrichmentService.ts';
import {
  COUCHY_COMFY_CLIENT_ID,
  invalidateComfyQueueCache,
  notifyImageIndexed,
  recordComfyExecutionError,
} from './comfyuiLiveMonitor.ts';
import { pollComfyPromptCompletion } from './comfyuiService.ts';
import {
  compileUpscaleWorkflow,
  compileWorkflowForGeneration,
  computeDimensionsFromMegapixels,
  findInlineUpscaleNodes,
  getWorkflowDefaults,
} from './workflowCompilerService.ts';
import {
  normalizeResolutionSelectorRatio,
  type CharacterDownloadAutomation,
} from '../../shared/types.ts';

const WATCHER_INTERVAL_MS = 15_000;
let watcherTimer: ReturnType<typeof setInterval> | null = null;
let isProcessingTasks = false;

interface PendingLoraTaskRow {
  id: number;
  download_job_id: number | null;
  lora_filename: string;
  character_name: string;
  trigger_word: string;
  recommended_weight: number | null;
  generate_headshot: number;
  character_id: number | null;
  status: string;
}

/**
 * Creates (or resolves by case-insensitive name) the character profile and links the downloaded LoRA.
 */
function createOrLinkCharacterForDownloadedLora(params: {
  loraFilename: string;
  characterName: string;
  triggerWord: string;
}): number {
  const cleanFilename = params.loraFilename.trim();
  const fallbackStem = cleanFilename.replace(/\.(safetensors|ckpt|pt|pth|bin|gguf|sft)$/i, '');
  const cleanCharName = params.characterName.trim() || fallbackStem || 'New Character';
  const cleanTrigger = params.triggerWord.trim();

  let charRow = db
    .prepare('SELECT id FROM characters WHERE LOWER(name) = LOWER(?) LIMIT 1')
    .get(cleanCharName) as { id: number } | undefined;

  if (!charRow) {
    const info = db
      .prepare(
        `INSERT INTO characters (name, description, physical_description, notes)
         VALUES (?, '', '', '')`
      )
      .run(cleanCharName);
    charRow = { id: Number(info.lastInsertRowid) };
  }

  const modelRow = db
    .prepare(
      'SELECT id, sha256_hash, trigger_word FROM models WHERE LOWER(filename) = LOWER(?) LIMIT 1'
    )
    .get(cleanFilename) as
    | { id: number; sha256_hash: string | null; trigger_word: string | null }
    | undefined;

  if (modelRow) {
    db.prepare(
      `UPDATE models
       SET lora_category = 'character',
           trigger_word = CASE
             WHEN (? <> '' AND COALESCE(NULLIF(TRIM(trigger_word), ''), '') = '') THEN ?
             ELSE trigger_word
           END
       WHERE id = ?`
    ).run(cleanTrigger, cleanTrigger, modelRow.id);
    invalidateInstalledModelsCache();
  }

  db.prepare(
    `INSERT INTO character_loras
      (character_id, model_id, lora_name, lora_hash, lora_category, appearance_label, trigger_word, notes)
     VALUES (?, ?, ?, ?, 'character', 'Default', ?, '')
     ON CONFLICT(character_id, lora_name) DO UPDATE SET
       model_id = COALESCE(character_loras.model_id, excluded.model_id),
       lora_category = 'character',
       trigger_word = CASE
         WHEN excluded.trigger_word <> '' THEN excluded.trigger_word
         ELSE character_loras.trigger_word
       END`
  ).run(charRow.id, modelRow?.id ?? null, cleanFilename, modelRow?.sha256_hash ?? null, cleanTrigger);

  runAssistedCharacterIdentificationForAll();
  notifyImageIndexed();
  return charRow.id;
}

/**
 * Verifies the LoRA is installed on disk AND listed by ComfyUI's live LoraLoader node.
 */
async function resolveConfirmedComfyLoraPath(loraFilename: string): Promise<string | null> {
  const modelRow = db
    .prepare(
      'SELECT is_installed, comfyui_path FROM models WHERE LOWER(filename) = LOWER(?) LIMIT 1'
    )
    .get(loraFilename) as { is_installed: number; comfyui_path: string | null } | undefined;

  if (!modelRow || modelRow.is_installed !== 1) {
    return null;
  }

  const targetLower = loraFilename.trim().toLowerCase();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    const res = await fetch(`${appConfig.comfyuiUrl}/object_info/LoraLoader`, {
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;

    const data = (await res.json()) as Record<string, any>;
    const list = data?.LoraLoader?.input?.required?.lora_name?.[0];
    if (!Array.isArray(list)) return null;

    for (const rawEntry of list) {
      if (typeof rawEntry !== 'string') continue;
      const normalized = rawEntry.replace(/\\/g, '/').trim();
      const base = (normalized.split('/').pop() || normalized).toLowerCase();
      if (base === targetLower) {
        return rawEntry;
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Tracks a dispatched headshot generation job, runs optional >3MP upscale, and sets the portrait.
 */
function trackHeadshotGenerationItem(
  taskId: number,
  characterId: number,
  itemId: number,
  promptId: string,
  fallbackUpscaleMp?: number,
  baseImageId?: number | null
): void {
  pollComfyPromptCompletion({
    promptId,
    characterId,
    onSuccess: async ({ firstImageId, firstOutputSpec }) => {
      if (fallbackUpscaleMp && fallbackUpscaleMp > 3.0 && firstOutputSpec) {
        try {
          const upscalePayload = compileUpscaleWorkflow({
            imageFilename: firstOutputSpec.filename,
            subfolder: firstOutputSpec.subfolder,
            targetMegapixels: fallbackUpscaleMp,
          });
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 8000);
          const upRes = await fetch(`${appConfig.comfyuiUrl}/prompt`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal,
            body: JSON.stringify({
              prompt: upscalePayload,
              client_id: COUCHY_COMFY_CLIENT_ID,
            }),
          });
          clearTimeout(timer);

          if (upRes.ok) {
            const upData = (await upRes.json()) as { prompt_id?: string };
            if (upData.prompt_id) {
              db.prepare(
                `UPDATE generation_items
                 SET comfyui_prompt_id = ?, output_image_id = COALESCE(?, output_image_id)
                 WHERE id = ?`
              ).run(upData.prompt_id, firstImageId, itemId);
              invalidateComfyQueueCache();
              trackHeadshotGenerationItem(
                taskId,
                characterId,
                itemId,
                upData.prompt_id,
                undefined,
                firstImageId
              );
              return;
            }
          }
        } catch {
          // Fall back to base image below
        }
      }

      if (baseImageId && firstImageId && baseImageId !== firstImageId) {
        copyImageMetadataToDerivedImage(baseImageId, firstImageId);
      }

      const resolvedOutputImageId = firstImageId ?? baseImageId ?? null;
      db.prepare(
        `UPDATE generation_items
         SET status = 'completed', output_image_id = COALESCE(?, output_image_id), completed_at = datetime('now')
         WHERE id = ?`
      ).run(resolvedOutputImageId, itemId);

      if (resolvedOutputImageId) {
        const imgRow = db
          .prepare('SELECT content_hash FROM images WHERE id = ?')
          .get(resolvedOutputImageId) as { content_hash: string } | undefined;

        db.prepare(
          `UPDATE characters
           SET portrait_image_id = COALESCE(portrait_image_id, ?),
               portrait_content_hash = COALESCE(portrait_content_hash, ?),
               updated_at = datetime('now')
           WHERE id = ?`
        ).run(resolvedOutputImageId, imgRow?.content_hash || null, characterId);
      }

      db.prepare(
        `UPDATE pending_lora_character_tasks
         SET status = 'completed', error_message = NULL, updated_at = datetime('now')
         WHERE id = ?`
      ).run(taskId);

      notifyImageIndexed();
      logger.info(
        'CharAutomation',
        `Headshot completed for character #${characterId} -> image #${resolvedOutputImageId ?? 'none'}`
      );
    },
    onError: (errMsg) => {
      db.prepare(
        `UPDATE generation_items
         SET status = 'failed', error_message = ?, completed_at = datetime('now')
         WHERE id = ?`
      ).run(errMsg, itemId);
      db.prepare(
        `UPDATE pending_lora_character_tasks
         SET status = 'failed', error_message = ?, updated_at = datetime('now')
         WHERE id = ?`
      ).run(errMsg, taskId);
      recordComfyExecutionError({ promptId, message: errMsg });
      notifyImageIndexed();
    },
    onTimeout: () => {
      db.prepare(
        `UPDATE pending_lora_character_tasks
         SET status = 'failed', error_message = 'Timed out waiting for ComfyUI headshot completion.', updated_at = datetime('now')
         WHERE id = ?`
      ).run(taskId);
    },
  });
}

/**
 * Compiles and submits the default-workflow headshot prompt once the LoRA is ready in ComfyUI.
 */
async function dispatchHeadshotGeneration(
  task: PendingLoraTaskRow,
  comfyLoraPath: string
): Promise<void> {
  const wfRow = (db
    .prepare('SELECT id FROM workflows WHERE is_default = 1 ORDER BY id ASC LIMIT 1')
    .get() ||
    db
      .prepare('SELECT id FROM workflows ORDER BY is_saved_library DESC, id ASC LIMIT 1')
      .get()) as { id: number } | undefined;

  if (!wfRow) {
    throw new Error('No default workflow configured for automatic headshot generation.');
  }
  if (!task.character_id) {
    throw new Error('Missing character ID for automatic headshot task.');
  }

  let wfDefaultMp: number | null = null;
  let wfDefaultAr: string | null = null;
  let wfDefaultCkpt: string | null = null;
  try {
    const wfDefaults = getWorkflowDefaults(wfRow.id);
    wfDefaultMp = wfDefaults.defaultMegapixels ?? null;
    wfDefaultAr = wfDefaults.defaultAspectRatio ?? null;
    wfDefaultCkpt = wfDefaults.defaultCheckpoint ?? null;
  } catch {
    // Use fallback defaults if workflow inspection fails
  }

  const resolvedAr = normalizeResolutionSelectorRatio(wfDefaultAr || undefined);
  const resolvedMp = Math.max(0.5, Math.min(10.0, wfDefaultMp ?? 3.0));
  const { width, height } = computeDimensionsFromMegapixels(resolvedAr, resolvedMp);

  const cleanTrigger = (task.trigger_word || '').trim();
  const promptLead = cleanTrigger || task.character_name.trim();
  const positivePrompt = promptLead
    ? `${promptLead} headshot smiling on neutral background.`
    : 'headshot smiling on neutral background.';
  const loraWeight =
    typeof task.recommended_weight === 'number' && Number.isFinite(task.recommended_weight)
      ? Math.max(-10, Math.min(10, task.recommended_weight))
      : 1.0;

  const batchInfo = db
    .prepare(
      `INSERT INTO generation_batches
        (character_id, workflow_id, theme_title, mode, total_count, aspect_ratio, megapixels, width, height, checkpoint_name, lora_count, lora_names_json)
       VALUES (?, ?, 'Auto Headshot', 'single', 1, ?, ?, ?, ?, ?, 1, ?)`
    )
    .run(
      task.character_id,
      wfRow.id,
      resolvedAr,
      resolvedMp,
      width,
      height,
      wfDefaultCkpt,
      JSON.stringify([comfyLoraPath])
    );
  const batchId = Number(batchInfo.lastInsertRowid);

  const seed = String(Math.floor(Math.random() * 1e15) + 1);
  const itemInfo = db
    .prepare(
      `INSERT INTO generation_items (batch_id, item_index, prompt, negative_prompt, seed, status)
       VALUES (?, 1, ?, '', ?, 'pending')`
    )
    .run(batchId, positivePrompt, seed);
  const itemId = Number(itemInfo.lastInsertRowid);

  // Trigger word is already placed in positivePrompt, so pass '' to avoid #30_27 duplicating it
  const apiPayload = compileWorkflowForGeneration({
    workflowId: wfRow.id,
    positivePrompt,
    triggerWord: '',
    negativePrompt: '',
    seed,
    aspectRatio: resolvedAr,
    megapixels: resolvedMp,
    width,
    height,
    loras: [
      {
        loraName: comfyLoraPath,
        modelStrength: loraWeight,
        clipStrength: loraWeight,
        triggerWord: cleanTrigger,
      },
    ],
    checkpointName: wfDefaultCkpt || undefined,
  });
  const hasInlineUpscale = Boolean(findInlineUpscaleNodes(apiPayload));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  const comfyRes = await fetch(`${appConfig.comfyuiUrl}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: controller.signal,
    body: JSON.stringify({
      prompt: apiPayload,
      client_id: COUCHY_COMFY_CLIENT_ID,
    }),
  });
  clearTimeout(timer);

  if (!comfyRes.ok) {
    const errText = await comfyRes.text();
    db.prepare(
      `UPDATE generation_items
       SET status = 'failed', error_message = ?, completed_at = datetime('now')
       WHERE id = ?`
    ).run(`ComfyUI HTTP ${comfyRes.status}: ${errText}`, itemId);
    throw new Error(`ComfyUI HTTP ${comfyRes.status}: ${errText}`);
  }

  const data = (await comfyRes.json()) as { prompt_id?: string };
  const promptId = data.prompt_id || `prompt-${Date.now()}-${itemId}`;

  db.prepare(
    `UPDATE generation_items SET comfyui_prompt_id = ?, status = 'submitted' WHERE id = ?`
  ).run(promptId, itemId);
  db.prepare(
    `UPDATE pending_lora_character_tasks
     SET status = 'submitted', generation_item_id = ?, updated_at = datetime('now')
     WHERE id = ?`
  ).run(itemId, task.id);

  invalidateComfyQueueCache();
  trackHeadshotGenerationItem(
    task.id,
    task.character_id,
    itemId,
    promptId,
    resolvedMp > 3.0 && !hasInlineUpscale ? resolvedMp : undefined
  );

  logger.info(
    'CharAutomation',
    `Submitted auto-headshot for "${task.character_name}" (${promptId}) using LoRA "${comfyLoraPath}"`
  );
}

/**
 * Checks awaiting headshot tasks against ComfyUI and submits any whose LoRA is confirmed copied.
 */
export async function processPendingLoraHeadshotTasks(): Promise<void> {
  if (isProcessingTasks) return;
  const awaitingCount = (
    db
      .prepare(
        `SELECT COUNT(*) AS c FROM pending_lora_character_tasks WHERE status = 'awaiting_comfy'`
      )
      .get() as { c: number }
  ).c;
  if (awaitingCount === 0) return;

  isProcessingTasks = true;
  try {
    await syncModelInventory();
    const awaiting = db
      .prepare(
        `SELECT * FROM pending_lora_character_tasks
         WHERE status = 'awaiting_comfy'
         ORDER BY id ASC`
      )
      .all() as PendingLoraTaskRow[];

    for (const task of awaiting) {
      const comfyLoraPath = await resolveConfirmedComfyLoraPath(task.lora_filename);
      if (!comfyLoraPath) continue;

      const claim = db
        .prepare(
          `UPDATE pending_lora_character_tasks
           SET status = 'submitting', updated_at = datetime('now')
           WHERE id = ? AND status = 'awaiting_comfy'`
        )
        .run(task.id);
      if (claim.changes !== 1) continue;

      try {
        await dispatchHeadshotGeneration(task, comfyLoraPath);
      } catch (err: any) {
        const msg = err?.message || 'Failed to submit headshot generation';
        db.prepare(
          `UPDATE pending_lora_character_tasks
           SET status = 'failed', error_message = ?, updated_at = datetime('now')
           WHERE id = ?`
        ).run(msg, task.id);
        logger.warn('CharAutomation', `Headshot dispatch failed for task #${task.id}: ${msg}`);
      }
    }
  } catch (err) {
    logger.warn('CharAutomation', 'Pending headshot watcher tick failed', err);
  } finally {
    isProcessingTasks = false;
  }
}

/**
 * Runs post-download character creation and queues Comfy-copy headshot automation if enabled.
 */
export async function handleDownloadedCharacterLoraAutomation(params: {
  downloadJobId: number;
  loraFilename: string;
  recommendedWeight?: number | null;
  automation?: CharacterDownloadAutomation | null;
}): Promise<void> {
  const auto = params.automation;
  if (!auto?.addCharacter) return;

  const characterId = createOrLinkCharacterForDownloadedLora({
    loraFilename: params.loraFilename,
    characterName: auto.characterName,
    triggerWord: auto.triggerWord || '',
  });

  logger.info(
    'CharAutomation',
    `Created/linked character #${characterId} ("${auto.characterName}") for downloaded LoRA "${params.loraFilename}"`
  );

  if (!auto.generateHeadshot) return;

  const validJobId =
    params.downloadJobId > 0
      ? (
          db.prepare('SELECT id FROM download_jobs WHERE id = ?').get(params.downloadJobId) as
            | { id: number }
            | undefined
        )?.id ?? null
      : null;

  db.prepare(
    `INSERT INTO pending_lora_character_tasks
      (download_job_id, lora_filename, character_name, trigger_word, recommended_weight, generate_headshot, character_id, status)
     VALUES (?, ?, ?, ?, ?, 1, ?, 'awaiting_comfy')`
  ).run(
    validJobId,
    params.loraFilename,
    auto.characterName.trim() || params.loraFilename,
    (auto.triggerWord || '').trim(),
    params.recommendedWeight ?? null,
    characterId
  );

  await processPendingLoraHeadshotTasks();
}

/**
 * Starts the periodic watcher that detects newly copied LoRAs in ComfyUI and triggers headshots.
 */
export function startLoraHeadshotWatcher(): ReturnType<typeof setInterval> {
  if (watcherTimer) return watcherTimer;
  // Recover any tasks interrupted mid-submission during a server restart
  db.prepare(
    `UPDATE pending_lora_character_tasks
     SET status = 'awaiting_comfy', updated_at = datetime('now')
     WHERE status = 'submitting'`
  ).run();

  setTimeout(() => {
    processPendingLoraHeadshotTasks().catch(() => {});
  }, 5000);

  watcherTimer = setInterval(() => {
    processPendingLoraHeadshotTasks().catch(() => {});
  }, WATCHER_INTERVAL_MS);

  return watcherTimer;
}
