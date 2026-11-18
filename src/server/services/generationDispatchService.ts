import { appConfig } from '../config.ts';
import { db } from '../db.ts';
import { logger } from '../logger.ts';
import {
  COUCHY_COMFY_CLIENT_ID,
  invalidateComfyQueueCache,
  isBatchCancelled,
  markPromptsCancelled,
  notifyImageIndexed,
  recordComfyExecutionError,
} from './comfyuiLiveMonitor.ts';
import { pollComfyPromptCompletion } from './comfyuiService.ts';
import {
  copyImageMetadataToDerivedImage,
  indexUploadedInspirationImage,
} from './scannerService.ts';
import {
  attachGenerationItemOutputToSeries,
  preserveFailedGenerationConversation,
} from './seriesService.ts';
import {
  compileUpscaleWorkflow,
  compileWorkflowForGeneration,
  computeDimensionsFromMegapixels,
  findInlineUpscaleNodes,
  getWorkflowDefaults,
} from './workflowCompilerService.ts';
import {
  normalizeResolutionSelectorRatio,
  type GenerationBatchRecord,
  type GenerationLoraSelection,
  type QuickGenChatMessage,
} from '../../shared/types.ts';

export interface DispatchGenerationBatchInput {
  characterId?: number | null;
  workflowId: number;
  mode?: 'single' | 'theme_set';
  themeTitle?: string | null;
  aspectRatio?: string | null;
  megapixels?: number | null;
  steps?: number | null;
  prompts: string[];
  triggerWord?: string;
  negativePrompt?: string;
  loras?: GenerationLoraSelection[];
  checkpointName?: string | null;
  baseSeed?: number;
  seriesId?: number | null;
  branchFromImageId?: number | null;
  inspirationFilename?: string | null;
  chatSnapshot?: QuickGenChatMessage[];
}

/**
 * Lists recent generation batches with their individual item records and resolved thumbnails.
 */
export function listGenerationBatches(limit = 20): GenerationBatchRecord[] {
  const batchRows = db
    .prepare(
      `SELECT gb.*, c.name as character_name, w.name as workflow_name
       FROM generation_batches gb
       LEFT JOIN characters c ON c.id = gb.character_id
       LEFT JOIN workflows w ON w.id = gb.workflow_id
       ORDER BY gb.id DESC
       LIMIT ?`
    )
    .all(limit) as any[];

  const itemStmt = db.prepare(
    `SELECT gi.*, i.id as resolved_image_id
     FROM generation_items gi
     LEFT JOIN images i ON i.id = gi.output_image_id
     WHERE gi.batch_id = ?
     ORDER BY gi.item_index ASC`
  );

  return batchRows.map((b) => {
    const items = (itemStmt.all(b.id) as any[]).map((it) => ({
      id: it.id,
      batchId: it.batch_id,
      itemIndex: it.item_index,
      prompt: it.prompt,
      negativePrompt: it.negative_prompt || '',
      seed: it.seed,
      comfyuiPromptId: it.comfyui_prompt_id,
      status: it.status,
      errorMessage: it.error_message,
      outputImageId: it.resolved_image_id || null,
      outputThumbnailUrl: it.resolved_image_id
        ? `/api/images/${it.resolved_image_id}/thumbnail`
        : null,
      createdAt: it.created_at,
      completedAt: it.completed_at,
    }));

    return {
      id: b.id,
      characterId: b.character_id,
      characterName: b.character_name || null,
      workflowId: b.workflow_id,
      workflowName: b.workflow_name || null,
      themeTitle: b.theme_title || null,
      mode: b.mode,
      totalCount: b.total_count,
      aspectRatio: b.aspect_ratio || '2:3 (Portrait Photo)',
      megapixels: Number(b.megapixels ?? 1.0),
      width: b.width,
      height: b.height,
      createdAt: b.created_at,
      items,
    };
  });
}

/**
 * Tracks a submitted generation item via the unified ComfyUI poller, chaining
 * `upscale_workflow.json` only if a legacy workflow without inline upscale ran >3MP.
 */
function trackGenerationItem(
  itemId: number,
  promptId: string,
  characterId: number | null,
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
              trackGenerationItem(itemId, upData.prompt_id, characterId, undefined, firstImageId);
              return;
            }
          }
        } catch (upErr) {
          console.warn('Automatic upscale pass failed, falling back to 3MP base image:', upErr);
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
        try {
          attachGenerationItemOutputToSeries(itemId, resolvedOutputImageId);
        } catch (seriesErr) {
          logger.warn(
            'ComfyUI',
            `Failed to attach generated image #${resolvedOutputImageId} to series`,
            seriesErr
          );
        }
      }
      logger.info(
        'ComfyUI',
        `Completed generation item #${itemId} (${promptId}) -> image #${resolvedOutputImageId ?? 'none'}`
      );
    },
    onError: (errMsg) => {
      db.prepare(
        `UPDATE generation_items
         SET status = 'failed', error_message = ?, completed_at = datetime('now')
         WHERE id = ?`
      ).run(errMsg, itemId);
      const recovery = preserveFailedGenerationConversation(itemId);
      recordComfyExecutionError({
        promptId,
        message: errMsg,
        recovery,
      });
      notifyImageIndexed();
    },
  });
}

/**
 * Compiles workflow settings, persists generation batch/items in SQLite,
 * dispatches sequential `/prompt` jobs to ComfyUI, and registers live tracking.
 */
export async function dispatchGenerationBatch(
  input: DispatchGenerationBatchInput
): Promise<{ batch: GenerationBatchRecord; batches: GenerationBatchRecord[] }> {
  const workflowId = Number(input.workflowId);
  const promptList = input.prompts.map((p) => String(p).trim()).filter(Boolean);
  if (!workflowId) {
    throw new Error('Please select a ComfyUI workflow.');
  }
  if (promptList.length === 0) {
    throw new Error('At least one positive prompt is required.');
  }

  let wfDefaultMp: number | null = null;
  let wfDefaultAr: string | null = null;
  let wfDefaultCkpt: string | null = null;
  try {
    const wfDefaults = getWorkflowDefaults(workflowId);
    wfDefaultMp = wfDefaults.defaultMegapixels ?? null;
    wfDefaultAr = wfDefaults.defaultAspectRatio ?? null;
    wfDefaultCkpt = wfDefaults.defaultCheckpoint ?? null;
  } catch {
    // Fallback if defaults lookup fails
  }

  const resolvedAr = normalizeResolutionSelectorRatio(input.aspectRatio || wfDefaultAr || undefined);
  const explicitMp =
    input.megapixels !== undefined && input.megapixels !== null && Number(input.megapixels) > 0
      ? Number(input.megapixels)
      : null;
  const resolvedMp = Math.max(0.5, Math.min(10.0, explicitMp ?? wfDefaultMp ?? 3.0));
  const resolvedSteps =
    input.steps !== undefined &&
    input.steps !== null &&
    Number.isFinite(Number(input.steps)) &&
    Number(input.steps) > 0
      ? Math.max(1, Math.min(100, Math.round(Number(input.steps))))
      : undefined;

  const { width: computedWidth, height: computedHeight } = computeDimensionsFromMegapixels(
    resolvedAr,
    resolvedMp
  );
  const loraSelections: GenerationLoraSelection[] = Array.isArray(input.loras) ? input.loras : [];
  const activeLoraNames = loraSelections.map((l) => (l.loraName || '').trim()).filter(Boolean);
  const serializedLoraNames = activeLoraNames.length > 0 ? JSON.stringify(activeLoraNames) : null;
  const resolvedCheckpointName = input.checkpointName?.trim() || wfDefaultCkpt || null;
  const serializedChatSnapshot =
    Array.isArray(input.chatSnapshot) && input.chatSnapshot.length > 0
      ? JSON.stringify(input.chatSnapshot)
      : null;

  let effectiveSeriesId = input.seriesId ? Number(input.seriesId) : null;
  let inspirationImageId: number | null = null;
  if (
    !effectiveSeriesId &&
    !input.branchFromImageId &&
    typeof input.inspirationFilename === 'string' &&
    input.inspirationFilename.trim()
  ) {
    inspirationImageId = await indexUploadedInspirationImage(
      input.inspirationFilename.trim(),
      promptList[0]
    );
  }

  if (!effectiveSeriesId && !input.branchFromImageId && (promptList.length > 1 || inspirationImageId)) {
    const seriesKind = promptList.length > 1 ? 'multi_shot' : 'iterative';
    const createdSeries = db
      .prepare(`INSERT INTO image_series (poster_image_id, series_kind) VALUES (NULL, ?)`)
      .run(seriesKind);
    effectiveSeriesId = Number(createdSeries.lastInsertRowid);

    if (inspirationImageId) {
      const inspSeedSnapshot =
        serializedChatSnapshot ||
        JSON.stringify([
          {
            id: `insp-${inspirationImageId}`,
            role: 'assistant',
            content: 'Uploaded inspiration image:',
            proposedPrompt: promptList[0],
          },
        ]);
      db.prepare(
        `INSERT OR REPLACE INTO image_series_items (series_id, image_id, step_order, chat_snapshot_json)
         VALUES (?, ?, 0, ?)`
      ).run(effectiveSeriesId, inspirationImageId, inspSeedSnapshot);
    }
  }

  const batchInfo = db
    .prepare(
      `INSERT INTO generation_batches
        (character_id, workflow_id, theme_title, mode, total_count, aspect_ratio, megapixels, width, height, checkpoint_name, lora_count, lora_names_json, series_id, branch_from_image_id, inspiration_image_id, chat_snapshot_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.characterId ? Number(input.characterId) : null,
      workflowId,
      input.themeTitle ? String(input.themeTitle).trim() : null,
      input.mode === 'theme_set' ? 'theme_set' : 'single',
      promptList.length,
      resolvedAr,
      resolvedMp,
      computedWidth,
      computedHeight,
      resolvedCheckpointName,
      activeLoraNames.length,
      serializedLoraNames,
      effectiveSeriesId,
      input.branchFromImageId ? Number(input.branchFromImageId) : null,
      inspirationImageId,
      serializedChatSnapshot
    );
  const batchId = Number(batchInfo.lastInsertRowid);

  const insertItem = db.prepare(
    `INSERT INTO generation_items
      (batch_id, item_index, prompt, negative_prompt, seed, status)
     VALUES (?, ?, ?, ?, ?, 'pending')`
  );

  const createdItems: { itemId: number; index: number; prompt: string; seed: string }[] = [];
  const hasFixedBaseSeed = Boolean(input.baseSeed && Number(input.baseSeed) > 0);
  const startingSeed = hasFixedBaseSeed
    ? Math.floor(Number(input.baseSeed))
    : Math.floor(Math.random() * 1e15) + 1;

  for (let i = 0; i < promptList.length; i++) {
    const itemSeed = hasFixedBaseSeed
      ? String(startingSeed + i)
      : String(Math.floor(Math.random() * 1e15) + 1);
    const info = insertItem.run(
      batchId,
      i + 1,
      promptList[i],
      (input.negativePrompt || '').trim(),
      itemSeed
    );
    createdItems.push({
      itemId: Number(info.lastInsertRowid),
      index: i + 1,
      prompt: promptList[i],
      seed: itemSeed,
    });
  }

  for (const item of createdItems) {
    if (isBatchCancelled(batchId)) {
      break;
    }
    try {
      const apiPayload = compileWorkflowForGeneration({
        workflowId,
        positivePrompt: item.prompt,
        triggerWord: input.triggerWord !== undefined ? String(input.triggerWord) : undefined,
        negativePrompt: (input.negativePrompt || '').trim(),
        seed: item.seed,
        aspectRatio: resolvedAr,
        megapixels: resolvedMp,
        steps: resolvedSteps,
        width: computedWidth,
        height: computedHeight,
        loras: loraSelections,
        checkpointName: input.checkpointName || undefined,
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
        throw new Error(`ComfyUI HTTP ${comfyRes.status}: ${errText}`);
      }

      const data = (await comfyRes.json()) as { prompt_id?: string };
      const promptId = data.prompt_id || `prompt-${Date.now()}-${item.itemId}`;

      // If the user cancelled this batch while /prompt was in flight, immediately remove it
      if (isBatchCancelled(batchId)) {
        markPromptsCancelled([promptId], batchId);
        fetch(`${appConfig.comfyuiUrl}/queue`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ delete: [promptId] }),
        }).catch(() => {});
        db.prepare(
          `UPDATE generation_items
           SET comfyui_prompt_id = ?, status = 'cancelled', error_message = 'Cancelled by user', completed_at = datetime('now')
           WHERE id = ?`
        ).run(promptId, item.itemId);
        break;
      }

      db.prepare(
        `UPDATE generation_items
         SET comfyui_prompt_id = ?, status = 'submitted'
         WHERE id = ?`
      ).run(promptId, item.itemId);

      trackGenerationItem(
        item.itemId,
        promptId,
        input.characterId ? Number(input.characterId) : null,
        resolvedMp > 3.0 && !hasInlineUpscale ? resolvedMp : undefined
      );
      logger.info(
        'ComfyUI',
        `Submitted batch #${batchId} item #${item.itemId} (${promptId}) [${computedWidth}x${computedHeight}]`
      );
    } catch (err: any) {
      const errMsg = err?.message || 'Failed to submit to ComfyUI';
      logger.error('ComfyUI', `Failed to submit batch #${batchId} item #${item.itemId}`, errMsg);
      db.prepare(
        `UPDATE generation_items
         SET status = 'failed', error_message = ?, completed_at = datetime('now')
         WHERE id = ?`
      ).run(errMsg, item.itemId);
      preserveFailedGenerationConversation(item.itemId);
    }
  }

  invalidateComfyQueueCache();

  const batches = listGenerationBatches(25);
  const createdBatch = batches.find((b) => b.id === batchId) || batches[0];
  return { batch: createdBatch, batches };
}
