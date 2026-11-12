import { appConfig } from '../config.ts';
import { db } from '../db.ts';
import type { ComfyUiLiveStatus, QueuedGhostCardItem } from '../../shared/types.ts';

export const COUCHY_COMFY_CLIENT_ID = 'couchy-studio-client';

interface QueuePromptMeta {
  prompt: string;
  width: number;
  height: number;
  checkpointName: string | null;
  loraCount: number;
  firstSeenMs: number;
}

interface LiveMonitorState {
  online: boolean;
  runningCount: number;
  queuedCount: number;
  progressPercent: number | null;
  step: number | null;
  maxSteps: number | null;
  currentNode: string | null;
  activePromptId: string | null;
  runningPromptIds: Set<string>;
  pendingPromptIds: Set<string>;
  promptProgressMap: Map<string, number>;
  finishedPromptIds: Map<string, number>;
  queuePromptMetaMap: Map<string, QueuePromptMeta>;
  runTotalJobs: number;
  prevTotalRemaining: number;
  lastQueueFetchMs: number;
  lastIndexedAt: number;
}

const state: LiveMonitorState = {
  online: false,
  runningCount: 0,
  queuedCount: 0,
  progressPercent: null,
  step: null,
  maxSteps: null,
  currentNode: null,
  activePromptId: null,
  runningPromptIds: new Set<string>(),
  pendingPromptIds: new Set<string>(),
  promptProgressMap: new Map<string, number>(),
  finishedPromptIds: new Map<string, number>(),
  queuePromptMetaMap: new Map<string, QueuePromptMeta>(),
  runTotalJobs: 0,
  prevTotalRemaining: 0,
  lastQueueFetchMs: 0,
  lastIndexedAt: Date.now(),
};

/**
 * Forces the next getComfyUiLiveStatus call to fetch fresh /queue data immediately.
 */
export function invalidateComfyQueueCache(): void {
  state.lastQueueFetchMs = 0;
}

/**
 * Updates active run job total and remaining counts so current image index (1 of X) stays accurate.
 */
function syncRunJobCounts(totalRemaining: number): void {
  if (totalRemaining <= 0) {
    state.runTotalJobs = 0;
    state.prevTotalRemaining = 0;
    return;
  }
  if (state.runTotalJobs === 0) {
    state.runTotalJobs = totalRemaining;
  } else if (totalRemaining > state.prevTotalRemaining) {
    state.runTotalJobs += totalRemaining - state.prevTotalRemaining;
  }
  state.runTotalJobs = Math.max(state.runTotalJobs, totalRemaining);
  state.prevTotalRemaining = totalRemaining;
}

/**
 * Signals that one or more newly generated images were indexed and committed to SQLite,
 * allowing connected frontends to refresh their gallery views silently.
 */
export function notifyImageIndexed(): void {
  state.lastIndexedAt = Date.now();
}

function extractPromptId(entry: any): string | null {
  if (Array.isArray(entry) && typeof entry[1] === 'string') {
    return entry[1];
  }
  if (entry && typeof entry === 'object' && typeof entry.prompt_id === 'string') {
    return entry.prompt_id;
  }
  return null;
}

/**
 * Extracts prompt text, dimensions, checkpoint/model name, and LoRA count from a ComfyUI API prompt graph.
 */
export function extractMetadataFromPromptGraph(graph: any): Omit<QueuePromptMeta, 'firstSeenMs'> {
  let prompt = '';
  let width = 1024;
  let height = 1536;
  let checkpointName: string | null = null;
  let loraCount = 0;

  if (graph && typeof graph === 'object' && !Array.isArray(graph)) {
    for (const node of Object.values(graph) as any[]) {
      if (!node || typeof node !== 'object') continue;
      const ct = String(node.class_type || '');
      const ctLower = ct.toLowerCase();
      const inputs = node.inputs || {};

      // Extract dimensions
      if (typeof inputs.width === 'number' && inputs.width >= 64) {
        width = Math.round(inputs.width);
      }
      if (typeof inputs.height === 'number' && inputs.height >= 64) {
        height = Math.round(inputs.height);
      }

      // Extract checkpoint / diffusion model
      for (const ckptKey of ['ckpt_name', 'unet_name', 'model_name', 'diffusion_model']) {
        if (!checkpointName && typeof inputs[ckptKey] === 'string' && inputs[ckptKey].trim()) {
          checkpointName = inputs[ckptKey].trim().replace(/\\/g, '/').split('/').pop() || inputs[ckptKey].trim();
        }
      }

      // Count active LoRAs
      if (ctLower.includes('lora')) {
        if (typeof inputs.lora_name === 'string' && inputs.lora_name !== 'None' && inputs.lora_name.trim()) {
          loraCount++;
        }
        for (const [k, v] of Object.entries(inputs)) {
          if (k.startsWith('lora_') && v && typeof v === 'object' && (v as any).on && (v as any).lora) {
            loraCount++;
          }
        }
      }

      // Extract positive prompt candidate (prefer longest non-negative string)
      const titleLower = String(node._meta?.title || '').toLowerCase();
      if (!titleLower.includes('negative')) {
        for (const textKey of ['text', 'value', 'prompt', 'positive', 'string', 'text_g']) {
          const val = inputs[textKey];
          if (typeof val === 'string' && val.trim().length > prompt.length) {
            prompt = val.trim();
          }
        }
      }
    }
  }

  return { prompt, width, height, checkpointName, loraCount };
}

let wsInstance: WebSocket | null = null;
let connectedWsUrl = '';
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

function buildWsUrl(httpBaseUrl: string): string {
  const clean = httpBaseUrl.trim().replace(/\/+$/, '');
  const wsBase = clean.replace(/^http:/i, 'ws:').replace(/^https:/i, 'wss:');
  return `${wsBase}/ws?clientId=${encodeURIComponent(COUCHY_COMFY_CLIENT_ID)}`;
}

/**
 * Ensures a background WebSocket listener is connected to ComfyUI /ws
 * to capture real-time step progress (value / max -> percentage) and prompt_id transitions.
 */
export function ensureComfyUiWsMonitor(): void {
  if (typeof WebSocket === 'undefined') return;

  const targetWsUrl = buildWsUrl(appConfig.comfyuiUrl);
  if (wsInstance && connectedWsUrl === targetWsUrl && wsInstance.readyState <= 1) {
    return;
  }

  if (wsInstance) {
    try {
      wsInstance.close();
    } catch {
      // ignore
    }
    wsInstance = null;
  }

  connectedWsUrl = targetWsUrl;
  try {
    const ws = new WebSocket(targetWsUrl);
    wsInstance = ws;

    ws.addEventListener('open', () => {
      state.online = true;
    });

    ws.addEventListener('message', (event) => {
      if (typeof event.data !== 'string') return;
      try {
        const msg = JSON.parse(event.data);
        const type = msg?.type;
        const data = msg?.data;

        if (type === 'progress' && data) {
          const val = Number(data.value ?? 0);
          const max = Number(data.max ?? 0);
          const pid =
            typeof data.prompt_id === 'string' && data.prompt_id
              ? data.prompt_id
              : state.activePromptId;

          // Ignore single-step (1/1) setup/preprocessor notifications so a starting job never flashes 100% before sampling
          if (max > 1) {
            state.step = val;
            state.maxSteps = max;
            const pct = Math.min(100, Math.max(0, Math.round((val / max) * 100)));
            state.progressPercent = pct;
            if (pid) {
              state.activePromptId = pid;
              state.runningPromptIds.add(pid);
              state.pendingPromptIds.delete(pid);
              const prev = state.promptProgressMap.get(pid) ?? 0;
              state.promptProgressMap.set(pid, Math.max(prev, pct));
            }
          }
          if (data.node) {
            state.currentNode = String(data.node);
          }
        } else if (type === 'executing' && data) {
          const pid = typeof data.prompt_id === 'string' ? data.prompt_id : null;
          if (data.node === null) {
            // Current prompt finished executing in ComfyUI; hold at 100% while indexing
            const completedPid = pid || state.activePromptId;
            if (completedPid) {
              state.promptProgressMap.set(completedPid, 100);
              state.finishedPromptIds.set(completedPid, Date.now());
              state.runningPromptIds.delete(completedPid);
              state.pendingPromptIds.delete(completedPid);
            }
            state.progressPercent = null;
            state.step = null;
            state.maxSteps = null;
            state.currentNode = null;
            state.activePromptId = null;
          } else {
            if (pid) {
              if (state.activePromptId !== pid) {
                state.progressPercent = state.promptProgressMap.get(pid) ?? null;
                state.step = null;
                state.maxSteps = null;
              }
              state.activePromptId = pid;
              state.runningPromptIds.add(pid);
              state.pendingPromptIds.delete(pid);
            }
            state.currentNode = String(data.node);
          }
        } else if (type === 'execution_cached' || type === 'executed') {
          state.online = true;
        } else if (type === 'execution_error' || type === 'execution_interrupted') {
          const pid = typeof data?.prompt_id === 'string' ? data.prompt_id : state.activePromptId;
          if (pid) {
            state.runningPromptIds.delete(pid);
            state.pendingPromptIds.delete(pid);
            state.promptProgressMap.delete(pid);
            state.finishedPromptIds.delete(pid);
          }
          state.progressPercent = null;
        } else if (type === 'status' && data?.status?.exec_info) {
          const totalRemaining = Number(data.status.exec_info.queue_remaining ?? 0);
          syncRunJobCounts(totalRemaining);
          if (totalRemaining === 0) {
            if (state.activePromptId) {
              state.promptProgressMap.set(state.activePromptId, 100);
              state.finishedPromptIds.set(state.activePromptId, Date.now());
            }
            state.runningCount = 0;
            state.queuedCount = 0;
            state.progressPercent = null;
            state.step = null;
            state.maxSteps = null;
            state.currentNode = null;
            state.activePromptId = null;
            state.runningPromptIds.clear();
            state.pendingPromptIds.clear();
          }
        }
      } catch {
        // ignore non-JSON frames
      }
    });

    ws.addEventListener('close', () => {
      wsInstance = null;
      if (!reconnectTimer) {
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          ensureComfyUiWsMonitor();
        }, 5000);
      }
    });

    ws.addEventListener('error', () => {
      // Handled by close listener
    });
  } catch {
    // WebSocket connection failed; HTTP /queue fallback will still update status
  }
}

/**
 * Resolves cardState ('queued' | 'generating' | 'indexing') and progressPercent (number | null)
 * for a tracked or untracked prompt.
 * Never returns 100% unless the job has actually finished; returns null ('Pending') until step progress begins.
 */
function resolvePromptProgressState(
  pid: string | null,
  dbStatus: string,
  hasOutputImage: boolean,
  isFallbackActiveJob: boolean
): { cardState: 'queued' | 'generating' | 'indexing'; progressPercent: number | null } {
  // 1. Explicitly completed in DB or finished execution in ComfyUI -> hold at 100% while indexing
  if (dbStatus === 'completed' || hasOutputImage || (pid && state.finishedPromptIds.has(pid))) {
    return { cardState: 'indexing', progressPercent: 100 };
  }

  // 2. Has emitted real multi-step sampling progress for this prompt_id
  if (pid && state.promptProgressMap.has(pid)) {
    const pct = state.promptProgressMap.get(pid)!;
    return { cardState: 'generating', progressPercent: pct };
  }

  // 3. Fallback when WebSocket frames didn't include prompt_id but a job is actively stepping
  if (isFallbackActiveJob && state.runningCount > 0 && state.progressPercent !== null) {
    return { cardState: 'generating', progressPercent: state.progressPercent };
  }

  // 4. Waiting in queue or loading models before step 1 begins -> show 'Pending' (progressPercent = null)
  return { cardState: 'queued', progressPercent: null };
}

/**
 * Builds the list of active/queued/indexing ghost preview cards from:
 * 1. generation_items (Quick Gen & Generation Studio)
 * 2. reproduction_jobs (Image/Metadata Inspector & Workflow Library)
 * 3. Any external/direct ComfyUI jobs present in /queue
 */
export function getActiveGhostItems(): QueuedGhostCardItem[] {
  try {
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
          gb.width,
          gb.height,
          gb.checkpoint_name,
          gb.lora_count,
          gb.character_id,
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
      submittedRows.length > 0 ? submittedRows[submittedRows.length - 1].item_id : null;

    const ghostItems: QueuedGhostCardItem[] = [];
    const seenPromptIds = new Set<string>();

    for (const r of rows) {
      const pid: string | null = r.comfyui_prompt_id || null;
      const ageSeconds = Number(r.age_seconds ?? 0);

      // Skip stale uncompleted items that are no longer in ComfyUI's queue or finished map
      const isKnownInComfy =
        pid &&
        (state.runningPromptIds.has(pid) ||
          state.pendingPromptIds.has(pid) ||
          state.finishedPromptIds.has(pid));

      if (
        r.status !== 'completed' &&
        !r.output_image_id &&
        !isKnownInComfy &&
        ageSeconds > 45 &&
        state.runningCount === 0 &&
        state.queuedCount === 0
      ) {
        continue;
      }

      if (pid) seenPromptIds.add(pid);

      const { cardState, progressPercent } = resolvePromptProgressState(
        pid,
        r.status,
        Boolean(r.output_image_id),
        r.item_id === oldestSubmittedItemId
      );

      ghostItems.push({
        itemId: Number(r.item_id),
        batchId: Number(r.batch_id),
        itemIndex: Number(r.item_index),
        comfyuiPromptId: pid,
        prompt: r.prompt || '',
        state: cardState,
        progressPercent,
        width: Number(r.width || 1024),
        height: Number(r.height || 1536),
        checkpointName: r.checkpoint_name || r.workflow_name || null,
        workflowName: r.workflow_name || null,
        loraCount: Number(r.lora_count || 0),
        characterId: r.character_id ? Number(r.character_id) : null,
        characterName: r.character_name || null,
        outputImageId: r.output_image_id ? Number(r.output_image_id) : null,
        createdAt: r.created_at,
      });
    }

    // 2. Include active or recently completed reproduction_jobs (Inspector / Workflow Library runs)
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

    for (const rj of reproRows) {
      const pid: string | null = rj.comfyui_prompt_id || null;
      if (pid && seenPromptIds.has(pid)) continue;

      const ageSeconds = Number(rj.age_seconds ?? 0);
      const isKnownInComfy =
        pid &&
        (state.runningPromptIds.has(pid) ||
          state.pendingPromptIds.has(pid) ||
          state.finishedPromptIds.has(pid));

      if (
        rj.status !== 'completed' &&
        !isKnownInComfy &&
        ageSeconds > 45 &&
        state.runningCount === 0 &&
        state.queuedCount === 0
      ) {
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

      const queueMeta = pid ? state.queuePromptMetaMap.get(pid) : undefined;
      const { cardState, progressPercent } = resolvePromptProgressState(
        pid,
        rj.status,
        Boolean(outputImageId),
        ghostItems.length === 0
      );

      ghostItems.push({
        itemId: 1_000_000 + Number(rj.job_id),
        batchId: 1_000_000 + Number(rj.job_id),
        itemIndex: 1,
        comfyuiPromptId: pid,
        prompt: queueMeta?.prompt || rj.img_prompt || rj.workflow_name || `Workflow Run #${rj.job_id}`,
        state: cardState,
        progressPercent,
        width: Number(queueMeta?.width || rj.img_width || 1024),
        height: Number(queueMeta?.height || rj.img_height || 1536),
        checkpointName:
          queueMeta?.checkpointName || rj.img_checkpoint || rj.workflow_name || null,
        workflowName: rj.workflow_name || null,
        loraCount: Number(queueMeta?.loraCount ?? rj.img_lora_count ?? 0),
        characterId: rj.char_id ? Number(rj.char_id) : null,
        characterName: rj.char_name || null,
        outputImageId,
        createdAt: rj.submitted_at,
      });
    }

    // 3. Include any remaining jobs directly in ComfyUI's live queue_running / queue_pending
    const liveQueuePromptIds = [
      ...Array.from(state.runningPromptIds),
      ...Array.from(state.pendingPromptIds),
    ];
    let externalIdx = 1;
    for (const pid of liveQueuePromptIds) {
      if (seenPromptIds.has(pid)) continue;
      seenPromptIds.add(pid);

      const queueMeta = state.queuePromptMetaMap.get(pid);
      const { cardState, progressPercent } = resolvePromptProgressState(
        pid,
        'submitted',
        false,
        ghostItems.length === 0 && state.runningPromptIds.has(pid)
      );

      // Hash prompt_id into a stable numeric itemId
      let numericHash = 2_000_000 + externalIdx++;
      for (let i = 0; i < pid.length; i++) {
        numericHash = (numericHash * 31 + pid.charCodeAt(i)) % 900_000_000;
      }

      ghostItems.push({
        itemId: numericHash,
        batchId: numericHash,
        itemIndex: externalIdx - 1,
        comfyuiPromptId: pid,
        prompt: queueMeta?.prompt || 'ComfyUI Workflow Job',
        state: cardState,
        progressPercent,
        width: queueMeta?.width || 1024,
        height: queueMeta?.height || 1536,
        checkpointName: queueMeta?.checkpointName || 'ComfyUI Workflow',
        workflowName: 'ComfyUI Workflow',
        loraCount: queueMeta?.loraCount || 0,
        characterId: null,
        characterName: null,
        outputImageId: null,
        createdAt: new Date(queueMeta?.firstSeenMs || Date.now()).toISOString(),
      });
    }

    return ghostItems;
  } catch {
    return [];
  }
}

/**
 * Queries ComfyUI GET /queue (cached for 800ms) and merges with live WebSocket step progress.
 */
export async function getComfyUiLiveStatus(): Promise<ComfyUiLiveStatus> {
  ensureComfyUiWsMonitor();

  const now = Date.now();
  if (now - state.lastQueueFetchMs >= 800) {
    state.lastQueueFetchMs = now;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 1500);
      const res = await fetch(`${appConfig.comfyuiUrl}/queue`, {
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (res.ok) {
        const data = (await res.json()) as {
          queue_running?: any[];
          queue_pending?: any[];
        };
        const runningArr = Array.isArray(data.queue_running) ? data.queue_running : [];
        const pendingArr = Array.isArray(data.queue_pending) ? data.queue_pending : [];
        const running = runningArr.length;
        const pending = pendingArr.length;

        const nextRunningIds = new Set<string>();
        for (const entry of runningArr) {
          const pid = extractPromptId(entry);
          if (pid) {
            nextRunningIds.add(pid);
            if (!state.queuePromptMetaMap.has(pid) && Array.isArray(entry) && entry[2]) {
              state.queuePromptMetaMap.set(pid, {
                ...extractMetadataFromPromptGraph(entry[2]),
                firstSeenMs: now,
              });
            }
          }
        }

        const nextPendingIds = new Set<string>();
        for (const entry of pendingArr) {
          const pid = extractPromptId(entry);
          if (pid) {
            nextPendingIds.add(pid);
            if (!state.queuePromptMetaMap.has(pid) && Array.isArray(entry) && entry[2]) {
              state.queuePromptMetaMap.set(pid, {
                ...extractMetadataFromPromptGraph(entry[2]),
                firstSeenMs: now,
              });
            }
          }
        }

        // Any prompt that was running previously and is now neither running nor pending has finished in ComfyUI
        for (const prevRunningId of state.runningPromptIds) {
          if (!nextRunningIds.has(prevRunningId) && !nextPendingIds.has(prevRunningId)) {
            state.promptProgressMap.set(prevRunningId, 100);
            state.finishedPromptIds.set(prevRunningId, now);
          }
        }

        state.runningPromptIds = nextRunningIds;
        state.pendingPromptIds = nextPendingIds;
        if (nextRunningIds.size > 0) {
          const firstRunning = Array.from(nextRunningIds)[0];
          if (!state.activePromptId || !nextRunningIds.has(state.activePromptId)) {
            state.activePromptId = firstRunning;
            state.progressPercent = state.promptProgressMap.get(firstRunning) ?? null;
          }
        } else {
          state.activePromptId = null;
          state.progressPercent = null;
        }

        state.online = true;
        state.runningCount = running;
        state.queuedCount = pending;
        syncRunJobCounts(running + pending);

        if (running === 0) {
          state.progressPercent = null;
          state.step = null;
          state.maxSteps = null;
          state.currentNode = null;
        }
      } else {
        state.online = false;
        state.runningCount = 0;
        state.queuedCount = 0;
        syncRunJobCounts(0);
      }
    } catch {
      state.online = false;
      state.runningCount = 0;
      state.queuedCount = 0;
      state.progressPercent = null;
      state.step = null;
      state.maxSteps = null;
      state.currentNode = null;
      syncRunJobCounts(0);
    }
  }

  // Prune old entries from finishedPromptIds and queuePromptMetaMap (> 60s)
  for (const [pid, ts] of state.finishedPromptIds.entries()) {
    if (now - ts > 60_000) {
      state.finishedPromptIds.delete(pid);
      state.promptProgressMap.delete(pid);
      state.queuePromptMetaMap.delete(pid);
    }
  }

  const totalRemaining = state.runningCount + state.queuedCount;
  const totalRunJobs = totalRemaining > 0 ? Math.max(state.runTotalJobs, totalRemaining) : null;
  const currentJobIndex =
    totalRemaining > 0 && totalRunJobs !== null
      ? Math.min(totalRunJobs, Math.max(1, totalRunJobs - totalRemaining + 1))
      : null;

  const ghostItems = getActiveGhostItems();

  return {
    online: state.online,
    runningCount: state.runningCount,
    queuedCount: state.queuedCount,
    progressPercent: state.runningCount > 0 ? state.progressPercent : null,
    step: state.runningCount > 0 ? state.step : null,
    maxSteps: state.runningCount > 0 ? state.maxSteps : null,
    currentNode: state.runningCount > 0 ? state.currentNode : null,
    currentJobIndex,
    totalRunJobs,
    lastIndexedAt: state.lastIndexedAt,
    ghostItems,
  };
}


