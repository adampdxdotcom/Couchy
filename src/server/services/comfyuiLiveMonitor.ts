import { appConfig } from '../config.ts';
import { db } from '../db.ts';
import type { ComfyUiLiveStatus, QueuedGhostCardItem } from '../../shared/types.ts';

export const COUCHY_COMFY_CLIENT_ID = 'couchy-studio-client';

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
          state.step = val;
          state.maxSteps = max;
          const pct =
            max > 0 ? Math.min(100, Math.max(0, Math.round((val / max) * 100))) : null;
          state.progressPercent = pct;
          if (typeof data.prompt_id === 'string' && data.prompt_id) {
            state.activePromptId = data.prompt_id;
            if (pct !== null) {
              const prev = state.promptProgressMap.get(data.prompt_id) ?? 0;
              state.promptProgressMap.set(data.prompt_id, Math.max(prev, pct));
            }
          }
          if (data.node) {
            state.currentNode = String(data.node);
          }
        } else if (type === 'executing' && data) {
          const pid = typeof data.prompt_id === 'string' ? data.prompt_id : null;
          if (data.node === null) {
            // Current prompt finished executing in ComfyUI; hold at 100% while indexing
            if (pid) {
              state.promptProgressMap.set(pid, 100);
              state.finishedPromptIds.set(pid, Date.now());
              state.runningPromptIds.delete(pid);
            } else if (state.activePromptId) {
              state.promptProgressMap.set(state.activePromptId, 100);
              state.finishedPromptIds.set(state.activePromptId, Date.now());
              state.runningPromptIds.delete(state.activePromptId);
            }
            state.progressPercent = null;
            state.step = null;
            state.maxSteps = null;
            state.currentNode = null;
          } else {
            if (pid) {
              state.activePromptId = pid;
              state.runningPromptIds.add(pid);
              state.pendingPromptIds.delete(pid);
            }
            state.currentNode = String(data.node);
          }
        } else if (type === 'execution_cached' || type === 'executed') {
          state.online = true;
          const pid = typeof data?.prompt_id === 'string' ? data.prompt_id : null;
          if (pid && type === 'executed') {
            state.promptProgressMap.set(pid, 100);
          }
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
 * Builds the list of active/queued/indexing ghost preview cards from SQLite and live queue state.
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

    // Find the oldest submitted item as fallback running target if ComfyUI is running a job
    const submittedRows = rows.filter((r) => r.status === 'submitted');
    const oldestSubmittedItemId =
      submittedRows.length > 0 ? submittedRows[submittedRows.length - 1].item_id : null;

    const ghostItems: QueuedGhostCardItem[] = [];

    for (const r of rows) {
      const pid: string | null = r.comfyui_prompt_id || null;
      const ageSeconds = Number(r.age_seconds ?? 0);

      let cardState: 'queued' | 'generating' | 'indexing' = 'queued';
      let progressPercent: number | null = null;

      if (r.status === 'completed' || r.output_image_id) {
        cardState = 'indexing';
        progressPercent = 100;
      } else if (pid && state.finishedPromptIds.has(pid)) {
        cardState = 'indexing';
        progressPercent = 100;
      } else if (
        (pid && (state.runningPromptIds.has(pid) || state.activePromptId === pid)) ||
        (state.runningCount > 0 &&
          state.runningPromptIds.size === 0 &&
          r.item_id === oldestSubmittedItemId)
      ) {
        cardState = 'generating';
        const trackedPct = pid ? state.promptProgressMap.get(pid) : undefined;
        progressPercent = state.progressPercent ?? trackedPct ?? 0;
      } else if (pid && state.pendingPromptIds.has(pid)) {
        cardState = 'queued';
        progressPercent = null;
      } else if (r.status === 'pending' && ageSeconds <= 20) {
        cardState = 'queued';
        progressPercent = null;
      } else if (ageSeconds <= 6) {
        // Recently submitted; if nothing else is running, show 0% generating, else Queued
        if (state.runningCount === 0 && r.item_id === oldestSubmittedItemId) {
          cardState = 'generating';
          progressPercent = 0;
        } else {
          cardState = 'queued';
          progressPercent = null;
        }
      } else if (ageSeconds <= 40) {
        // ComfyUI finished executing this prompt and dropped it from /queue; hold at 100% while scanner indexes
        cardState = 'indexing';
        progressPercent = 100;
      } else {
        // Stale unindexed item older than 40s that is no longer in ComfyUI's queue
        continue;
      }

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
          if (pid) nextRunningIds.add(pid);
        }

        const nextPendingIds = new Set<string>();
        for (const entry of pendingArr) {
          const pid = extractPromptId(entry);
          if (pid) nextPendingIds.add(pid);
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
          }
        } else {
          state.activePromptId = null;
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

  // Prune old entries from finishedPromptIds (> 60s)
  for (const [pid, ts] of state.finishedPromptIds.entries()) {
    if (now - ts > 60_000) {
      state.finishedPromptIds.delete(pid);
      state.promptProgressMap.delete(pid);
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

