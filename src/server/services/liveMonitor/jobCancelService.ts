import { appConfig } from '../../config.ts';
import { db } from '../../db.ts';
import { logger } from '../../logger.ts';
import {
  invalidateComfyQueueCache,
  liveMonitorState,
  markPromptsCancelled,
  notifyWorkspaceDataChanged,
} from './liveMonitorState.ts';

export interface CancelComfyJobInput {
  itemId?: number | null;
  batchId?: number | null;
  comfyuiPromptId?: string | null;
}

export interface CancelComfyJobResult {
  ok: boolean;
  kind: 'batch' | 'reproduction' | 'queue_item';
  cancelledItems: number;
  cancelledPrompts: string[];
  interrupted: boolean;
}

function collectComfyQueuePromptStates(queueData: any): {
  running: Set<string>;
  pending: Set<string>;
} {
  const running = new Set<string>();
  const pending = new Set<string>();
  const extract = (list: unknown, target: Set<string>) => {
    if (!Array.isArray(list)) return;
    for (const entry of list) {
      if (Array.isArray(entry) && typeof entry[1] === 'string' && entry[1].trim()) {
        target.add(entry[1].trim());
      }
    }
  };
  extract(queueData?.queue_running, running);
  extract(queueData?.queue_pending, pending);
  return { running, pending };
}

async function fetchComfyJsonWithTimeout(
  url: string,
  init?: RequestInit,
  timeoutMs = 2500
): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Cancels an active generation batch/series, reproduction job, or direct ComfyUI queue item.
 * Removes queued prompts from ComfyUI `/queue`, calls `/interrupt` only if a target prompt
 * is currently executing, and marks matching DB rows as `'cancelled'`.
 */
export async function cancelComfyUiJob(
  input: CancelComfyJobInput
): Promise<CancelComfyJobResult> {
  const itemId = typeof input.itemId === 'number' && Number.isFinite(input.itemId) ? input.itemId : null;
  const batchId =
    typeof input.batchId === 'number' && Number.isFinite(input.batchId) ? input.batchId : null;
  const incomingPromptId =
    typeof input.comfyuiPromptId === 'string' && input.comfyuiPromptId.trim()
      ? input.comfyuiPromptId.trim()
      : null;

  const targetPromptIds = new Set<string>();
  if (incomingPromptId) targetPromptIds.add(incomingPromptId);

  let kind: CancelComfyJobResult['kind'] = 'queue_item';
  let cancelledItems = 0;
  let resolvedBatchId: number | null =
    batchId !== null && batchId > 0 && batchId < 1_000_000 ? batchId : null;

  // 1. Resolve generation_batches / generation_items scope (cancels whole remaining batch/series)
  if (resolvedBatchId === null && itemId !== null && itemId > 0 && itemId < 1_000_000) {
    const itemRow = db
      .prepare('SELECT batch_id FROM generation_items WHERE id = ?')
      .get(itemId) as { batch_id?: number } | undefined;
    if (itemRow?.batch_id) resolvedBatchId = Number(itemRow.batch_id);
  }
  if (resolvedBatchId === null && incomingPromptId) {
    const byPid = db
      .prepare('SELECT batch_id FROM generation_items WHERE comfyui_prompt_id = ? LIMIT 1')
      .get(incomingPromptId) as { batch_id?: number } | undefined;
    if (byPid?.batch_id) resolvedBatchId = Number(byPid.batch_id);
  }

  if (resolvedBatchId !== null) {
    const activeBatchRows = db
      .prepare(
        `SELECT id, comfyui_prompt_id FROM generation_items
         WHERE batch_id = ? AND status IN ('pending', 'submitted')`
      )
      .all(resolvedBatchId) as Array<{ id: number; comfyui_prompt_id: string | null }>;

    for (const row of activeBatchRows) {
      if (row.comfyui_prompt_id?.trim()) {
        targetPromptIds.add(row.comfyui_prompt_id.trim());
      }
    }

    const upd = db
      .prepare(
        `UPDATE generation_items
         SET status = 'cancelled', error_message = 'Cancelled by user', completed_at = datetime('now')
         WHERE batch_id = ? AND status IN ('pending', 'submitted')`
      )
      .run(resolvedBatchId);
    if (upd.changes > 0) {
      kind = 'batch';
      cancelledItems += upd.changes;
    }
  }

  // 2. Resolve reproduction_jobs scope (offset by 1_000_000 in ghost cards)
  let reproJobId: number | null =
    itemId !== null && itemId >= 1_000_000 && itemId < 2_000_000 ? itemId - 1_000_000 : null;
  if (reproJobId === null && incomingPromptId) {
    const byPid = db
      .prepare(
        `SELECT id FROM reproduction_jobs
         WHERE comfyui_prompt_id = ? AND status IN ('queued', 'running') LIMIT 1`
      )
      .get(incomingPromptId) as { id?: number } | undefined;
    if (byPid?.id) reproJobId = Number(byPid.id);
  }

  if (reproJobId !== null && reproJobId > 0) {
    const reproRow = db
      .prepare('SELECT comfyui_prompt_id FROM reproduction_jobs WHERE id = ?')
      .get(reproJobId) as { comfyui_prompt_id?: string | null } | undefined;
    if (reproRow?.comfyui_prompt_id?.trim()) {
      targetPromptIds.add(reproRow.comfyui_prompt_id.trim());
    }
    const upd = db
      .prepare(
        `UPDATE reproduction_jobs
         SET status = 'cancelled', execution_error = 'Cancelled by user', completed_at = datetime('now')
         WHERE id = ? AND status IN ('queued', 'running')`
      )
      .run(reproJobId);
    if (upd.changes > 0) {
      kind = 'reproduction';
      cancelledItems += upd.changes;
    }
  }

  const promptList = Array.from(targetPromptIds);
  if (promptList.length === 0 && cancelledItems === 0) {
    throw new Error('No active generation job found to cancel.');
  }

  // Track cancellation before hitting ComfyUI so WS execution_interrupted/error frames are ignored
  markPromptsCancelled(promptList, resolvedBatchId);

  // 3. Check live ComfyUI queue to separate pending removals from active execution interrupt
  const baseUrl = appConfig.comfyuiUrl.replace(/\/+$/, '');
  const runningTargets = new Set<string>();
  for (const pid of promptList) {
    if (liveMonitorState.runningPromptIds.has(pid) || liveMonitorState.activePromptId === pid) {
      runningTargets.add(pid);
    }
  }

  if (promptList.length > 0) {
    const queueRes = await fetchComfyJsonWithTimeout(`${baseUrl}/queue`);
    if (queueRes?.ok) {
      try {
        const queueData = await queueRes.json();
        const liveQueue = collectComfyQueuePromptStates(queueData);
        for (const pid of promptList) {
          if (liveQueue.running.has(pid)) runningTargets.add(pid);
        }
      } catch {
        // Ignore malformed queue payload
      }
    }

    await fetchComfyJsonWithTimeout(`${baseUrl}/queue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ delete: promptList }),
    });

    if (runningTargets.size > 0) {
      const activeTarget = Array.from(runningTargets)[0];
      await fetchComfyJsonWithTimeout(`${baseUrl}/interrupt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt_id: activeTarget }),
      });
    }
  }

  invalidateComfyQueueCache();
  notifyWorkspaceDataChanged();

  logger.info(
    'ComfyUI',
    `Cancelled ${kind} (batch=${resolvedBatchId ?? 'none'}, items=${cancelledItems}, prompts=${promptList.length}, interrupted=${runningTargets.size > 0})`
  );

  return {
    ok: true,
    kind,
    cancelledItems,
    cancelledPrompts: promptList,
    interrupted: runningTargets.size > 0,
  };
}
