import { db } from '../../db.ts';
import type { QueuedGhostCardItem } from '../../../shared/types.ts';
import { liveMonitorState, resolvePromptProgressState } from './liveMonitorState.ts';
import { parseLoraNamesJson, toIsoUtc } from './promptGraphUtils.ts';
import { resolveSeriesTargetForJob } from './seriesTargetResolver.ts';

function isPromptKnownInComfy(pid: string | null): boolean {
  return Boolean(
    pid &&
      (liveMonitorState.runningPromptIds.has(pid) ||
        liveMonitorState.pendingPromptIds.has(pid) ||
        liveMonitorState.finishedPromptIds.has(pid))
  );
}

/**
 * Skips uncompleted DB jobs that have been idle > 45s while ComfyUI reports an empty queue.
 */
function isStaleOrphanedGhostRow(
  status: string,
  hasOutput: boolean,
  pid: string | null,
  ageSeconds: number
): boolean {
  return (
    status !== 'completed' &&
    !hasOutput &&
    !isPromptKnownInComfy(pid) &&
    ageSeconds > 45 &&
    liveMonitorState.runningCount === 0 &&
    liveMonitorState.queuedCount === 0
  );
}

/**
 * 1. Collects one representative ghost card per active Quick Gen / Generation Studio batch.
 */
function collectGenerationBatchGhosts(seenPromptIds: Set<string>): QueuedGhostCardItem[] {
  const rows = db
    .prepare(
      `
      SELECT
        gi.id AS item_id,
        gi.batch_id,
        gi.item_index,
        gi.prompt,
        gi.comfyui_prompt_id,
        gi.status,
        gi.output_image_id,
        gi.created_at,
        gi.completed_at,
        (strftime('%s', 'now') - strftime('%s', gi.created_at)) AS age_seconds,
        gb.total_count,
        gb.width,
        gb.height,
        gb.checkpoint_name,
        gb.lora_count,
        gb.lora_names_json,
        gb.character_id,
        gb.series_id,
        gb.branch_from_image_id,
        c.name AS character_name,
        w.name AS workflow_name
      FROM generation_items gi
      JOIN generation_batches gb ON gb.id = gi.batch_id
      LEFT JOIN characters c ON c.id = gb.character_id
      LEFT JOIN workflows w ON w.id = gb.workflow_id
      WHERE
        (
          gi.status IN ('pending', 'submitted')
          AND gi.created_at >= datetime('now', '-30 minutes')
        )
        OR (
          gi.status = 'completed'
          AND gi.completed_at >= datetime('now', '-25 seconds')
        )
      ORDER BY gi.batch_id DESC, gi.item_index ASC
    `
    )
    .all() as any[];

  const submittedRows = rows.filter((r) => r.status === 'submitted');
  const oldestSubmittedItemId =
    submittedRows.length > 0
      ? [...submittedRows].sort((a, b) =>
          a.batch_id !== b.batch_id ? a.batch_id - b.batch_id : a.item_index - b.item_index
        )[0].item_id
      : null;

  const validRowsByBatch = new Map<number, any[]>();
  for (const r of rows) {
    const pid: string | null = r.comfyui_prompt_id || null;
    if (isStaleOrphanedGhostRow(r.status, Boolean(r.output_image_id), pid, Number(r.age_seconds ?? 0))) {
      continue;
    }
    if (pid) seenPromptIds.add(pid);

    const bid = Number(r.batch_id);
    const list = validRowsByBatch.get(bid);
    if (list) list.push(r);
    else validRowsByBatch.set(bid, [r]);
  }

  // Look up finished (completed/failed) counts per active batch for "X of N" progress
  const finishedCountByBatch = new Map<number, number>();
  if (validRowsByBatch.size > 0) {
    const batchIds = Array.from(validRowsByBatch.keys());
    const placeholders = batchIds.map(() => '?').join(',');
    const countRows = db
      .prepare(
        `SELECT batch_id, COUNT(*) AS cnt
         FROM generation_items
         WHERE batch_id IN (${placeholders}) AND status IN ('completed', 'failed')
         GROUP BY batch_id`
      )
      .all(...batchIds) as { batch_id: number; cnt: number }[];
    for (const cr of countRows) {
      finishedCountByBatch.set(Number(cr.batch_id), Number(cr.cnt));
    }
  }

  const items: QueuedGhostCardItem[] = [];
  for (const [bid, batchRows] of validRowsByBatch.entries()) {
    const activeRows = batchRows.filter((r) => r.status !== 'completed' && !r.output_image_id);
    const chosen =
      activeRows.length > 0
        ? activeRows.find((r) => {
            const p: string | null = r.comfyui_prompt_id || null;
            return Boolean(
              p &&
                (liveMonitorState.runningPromptIds.has(p) ||
                  liveMonitorState.promptProgressMap.has(p) ||
                  liveMonitorState.finishedPromptIds.has(p))
            );
          }) || activeRows[0]
        : batchRows[batchRows.length - 1];

    const pid: string | null = chosen.comfyui_prompt_id || null;
    const { cardState, progressPercent } = resolvePromptProgressState(
      pid,
      chosen.status,
      Boolean(chosen.output_image_id),
      chosen.item_id === oldestSubmittedItemId
    );
    const queueMeta = pid ? liveMonitorState.queuePromptMetaMap.get(pid) : undefined;
    const outputImgId = chosen.output_image_id ? Number(chosen.output_image_id) : null;
    const seriesTarget = resolveSeriesTargetForJob(
      chosen.series_id ? Number(chosen.series_id) : null,
      chosen.branch_from_image_id ? Number(chosen.branch_from_image_id) : null,
      outputImgId
    );

    const batchTotalCount = Math.max(1, Number(chosen.total_count || 1));
    const finishedInBatch = finishedCountByBatch.get(bid) ?? 0;
    const batchCurrentNumber =
      batchTotalCount > 1
        ? Math.min(batchTotalCount, activeRows.length > 0 ? finishedInBatch + 1 : batchTotalCount)
        : 1;

    const batchLoraNames = parseLoraNamesJson(chosen.lora_names_json);

    items.push({
      itemId: Number(chosen.item_id),
      batchId: bid,
      itemIndex: Number(chosen.item_index),
      comfyuiPromptId: pid,
      prompt: chosen.prompt || '',
      state: cardState,
      progressPercent,
      width: Number(chosen.width || 1024),
      height: Number(chosen.height || 1536),
      checkpointName: chosen.checkpoint_name || queueMeta?.checkpointName || null,
      workflowName: chosen.workflow_name || null,
      loraCount: Number(chosen.lora_count || batchLoraNames?.length || queueMeta?.loraCount || 0),
      loraNames: batchLoraNames || queueMeta?.loraNames || undefined,
      characterId: chosen.character_id ? Number(chosen.character_id) : null,
      characterName: chosen.character_name || null,
      outputImageId: outputImgId,
      targetSeriesId: seriesTarget.targetSeriesId,
      targetImageId: seriesTarget.targetImageId,
      isBranchSplit: seriesTarget.isBranchSplit,
      batchTotalCount,
      batchCurrentNumber,
      createdAt: toIsoUtc(chosen.created_at),
    });
  }

  return items;
}

/**
 * 2. Collects active or recently completed reproduction_jobs (Inspector / Workflow Library runs).
 */
function collectReproductionJobGhosts(
  seenPromptIds: Set<string>,
  existingCount: number
): QueuedGhostCardItem[] {
  const reproRows = db
    .prepare(
      `
      SELECT
        rj.id AS job_id,
        rj.source_image_id,
        rj.workflow_id,
        rj.comfyui_prompt_id,
        rj.status,
        rj.output_image_ids_json,
        rj.submitted_at,
        rj.completed_at,
        (strftime('%s', 'now') - strftime('%s', rj.submitted_at)) AS age_seconds,
        i.width AS img_width,
        i.height AS img_height,
        im.positive_prompt AS img_prompt,
        im.checkpoint_name AS img_checkpoint,
        w.name AS workflow_name,
        (
          SELECT COUNT(*) FROM image_models imod
          WHERE imod.image_id = rj.source_image_id AND imod.model_type = 'lora'
        ) AS img_lora_count,
        (
          SELECT json_group_array(imod.model_name) FROM image_models imod
          WHERE imod.image_id = rj.source_image_id AND imod.model_type = 'lora'
        ) AS img_lora_names_json,
        (
          SELECT ic.character_id FROM image_characters ic
          WHERE ic.image_id = rj.source_image_id AND ic.status = 'confirmed'
          LIMIT 1
        ) AS char_id,
        (
          SELECT c.name FROM image_characters ic
          JOIN characters c ON c.id = ic.character_id
          WHERE ic.image_id = rj.source_image_id AND ic.status = 'confirmed'
          LIMIT 1
        ) AS char_name
      FROM reproduction_jobs rj
      LEFT JOIN images i ON i.id = rj.source_image_id
      LEFT JOIN image_metadata im ON im.image_id = rj.source_image_id
      LEFT JOIN workflows w ON w.id = rj.workflow_id
      WHERE
        (
          rj.status IN ('queued', 'running')
          AND rj.submitted_at >= datetime('now', '-30 minutes')
        )
        OR (
          rj.status = 'completed'
          AND rj.completed_at >= datetime('now', '-25 seconds')
        )
      ORDER BY rj.id DESC
    `
    )
    .all() as any[];

  const items: QueuedGhostCardItem[] = [];
  for (const rj of reproRows) {
    const pid: string | null = rj.comfyui_prompt_id || null;
    if (pid && seenPromptIds.has(pid)) continue;
    if (isStaleOrphanedGhostRow(rj.status, false, pid, Number(rj.age_seconds ?? 0))) {
      continue;
    }
    if (pid) seenPromptIds.add(pid);

    let outputImageId: number | null = null;
    try {
      const parsedIds = JSON.parse(rj.output_image_ids_json || '[]');
      if (Array.isArray(parsedIds) && parsedIds.length > 0) {
        outputImageId = Number(parsedIds[0]);
      }
    } catch {
      outputImageId = null;
    }

    const queueMeta = pid ? liveMonitorState.queuePromptMetaMap.get(pid) : undefined;
    const { cardState, progressPercent } = resolvePromptProgressState(
      pid,
      rj.status,
      Boolean(outputImageId),
      existingCount + items.length === 0
    );
    const reproLoraNames = queueMeta?.loraNames || parseLoraNamesJson(rj.img_lora_names_json);

    items.push({
      itemId: 1_000_000 + Number(rj.job_id),
      batchId: 1_000_000 + Number(rj.job_id),
      itemIndex: 1,
      comfyuiPromptId: pid,
      prompt: queueMeta?.prompt || rj.img_prompt || rj.workflow_name || `Workflow Run #${rj.job_id}`,
      state: cardState,
      progressPercent,
      width: Number(queueMeta?.width || rj.img_width || 1024),
      height: Number(queueMeta?.height || rj.img_height || 1536),
      checkpointName: queueMeta?.checkpointName || rj.img_checkpoint || null,
      workflowName: rj.workflow_name || null,
      loraCount: Number(queueMeta?.loraCount ?? rj.img_lora_count ?? 0),
      loraNames: reproLoraNames,
      characterId: rj.char_id ? Number(rj.char_id) : null,
      characterName: rj.char_name || null,
      outputImageId,
      createdAt: toIsoUtc(rj.submitted_at),
    });
  }

  return items;
}

/**
 * 3. Collects any untracked/external ComfyUI jobs (including upscales) present in /queue.
 */
function collectExternalQueueGhosts(
  seenPromptIds: Set<string>,
  existingCount: number
): QueuedGhostCardItem[] {
  const liveQueuePromptIds = [
    ...Array.from(liveMonitorState.runningPromptIds),
    ...Array.from(liveMonitorState.pendingPromptIds),
  ];
  const items: QueuedGhostCardItem[] = [];
  let externalIdx = 1;

  for (const pid of liveQueuePromptIds) {
    if (seenPromptIds.has(pid)) continue;
    seenPromptIds.add(pid);

    const queueMeta = liveMonitorState.queuePromptMetaMap.get(pid);
    const regMeta = liveMonitorState.queuePromptSeriesMap.get(pid);
    const seriesTarget = regMeta
      ? resolveSeriesTargetForJob(
          regMeta.targetSeriesId ?? null,
          regMeta.sourceImageId,
          null,
          Boolean(regMeta.isUpscale)
        )
      : { targetSeriesId: null, targetImageId: null, isBranchSplit: false };

    const { cardState, progressPercent } = resolvePromptProgressState(
      pid,
      'submitted',
      false,
      existingCount + items.length === 0 && liveMonitorState.runningPromptIds.has(pid)
    );

    // Hash prompt_id into a stable numeric itemId
    let numericHash = 2_000_000 + externalIdx++;
    for (let i = 0; i < pid.length; i++) {
      numericHash = (numericHash * 31 + pid.charCodeAt(i)) % 900_000_000;
    }

    items.push({
      itemId: numericHash,
      batchId: numericHash,
      itemIndex: externalIdx - 1,
      comfyuiPromptId: pid,
      prompt: regMeta?.prompt || queueMeta?.prompt || 'ComfyUI Workflow Job',
      state: cardState,
      progressPercent,
      width: regMeta?.width || queueMeta?.width || 1024,
      height: regMeta?.height || queueMeta?.height || 1536,
      checkpointName: queueMeta?.checkpointName || (regMeta ? '4x-ESRGAN Upscale' : 'ComfyUI Workflow'),
      workflowName: regMeta ? '4x-ESRGAN Upscale' : 'ComfyUI Workflow',
      loraCount: queueMeta?.loraCount || 0,
      loraNames: queueMeta?.loraNames || undefined,
      characterId: regMeta?.characterId ?? null,
      characterName: regMeta?.characterName ?? null,
      outputImageId: null,
      targetSeriesId: seriesTarget.targetSeriesId,
      targetImageId: seriesTarget.targetImageId,
      isBranchSplit: seriesTarget.isBranchSplit,
      createdAt: new Date(queueMeta?.firstSeenMs || regMeta?.registeredAtMs || Date.now()).toISOString(),
    });
  }

  return items;
}

/**
 * Builds the sorted list of active/queued/indexing ghost preview cards from
 * `generation_items`, `reproduction_jobs`, and direct ComfyUI `/queue` jobs.
 */
export function getActiveGhostItems(): QueuedGhostCardItem[] {
  try {
    const seenPromptIds = new Set<string>();
    const ghostItems = collectGenerationBatchGhosts(seenPromptIds);
    ghostItems.push(...collectReproductionJobGhosts(seenPromptIds, ghostItems.length));
    ghostItems.push(...collectExternalQueueGhosts(seenPromptIds, ghostItems.length));

    ghostItems.sort((a, b) => {
      const ta = Date.parse(a.createdAt) || 0;
      const tb = Date.parse(b.createdAt) || 0;
      if (tb !== ta) return tb - ta;
      if (b.batchId !== a.batchId) return b.batchId - a.batchId;
      return b.itemIndex - a.itemIndex;
    });

    return ghostItems;
  } catch {
    return [];
  }
}
