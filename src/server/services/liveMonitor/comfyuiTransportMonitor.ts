import { appConfig } from '../../config.ts';
import { db } from '../../db.ts';
import { preserveFailedGenerationConversation } from '../seriesService.ts';
import type { ComfyUiExecutionErrorNotice, ComfyUiLiveStatus } from '../../../shared/types.ts';
import { getActiveGhostItems } from './ghostCardAggregator.ts';
import {
  COUCHY_COMFY_CLIENT_ID,
  liveMonitorState,
  notifyImageIndexed,
  pruneStaleMonitorEntries,
  recordComfyExecutionError,
  syncRunJobCounts,
} from './liveMonitorState.ts';
import { extractMetadataFromPromptGraph, extractPromptId } from './promptGraphUtils.ts';
import { scheduleDebouncedModelSync } from '../modelWatcherService.ts';

let wsInstance: WebSocket | null = null;
let connectedWsUrl = '';
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let monitorStopped = false;

/**
 * Transitions ComfyUI status to online and triggers an automatic model inventory sync
 * whenever ComfyUI recovers from an offline state (e.g., after a reboot or restart).
 */
function markComfyUiOnline(source: string): void {
  const wasOffline = !liveMonitorState.online;
  liveMonitorState.online = true;
  if (wasOffline) {
    scheduleDebouncedModelSync(`comfyui-online:${source}`, 1500);
  }
}

export function stopComfyUiWsMonitor(): void {
  monitorStopped = true;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (wsInstance) {
    const active = wsInstance;
    wsInstance = null;
    try {
      active.close();
    } catch {
      // ignore
    }
  }
}

function buildWsUrl(httpBaseUrl: string): string {
  const clean = httpBaseUrl.trim().replace(/\/+$/, '');
  const wsBase = clean.replace(/^http:/i, 'ws:').replace(/^https:/i, 'wss:');
  return `${wsBase}/ws?clientId=${encodeURIComponent(COUCHY_COMFY_CLIENT_ID)}`;
}

/**
 * Marks a matching generation_item failed in SQLite and prepares any Conversation Mode recovery payload.
 */
function handleWsExecutionError(promptId: string | null, data: any): void {
  const excMsg = String(data?.exception_message || '').trim();
  const nodeType = String(data?.node_type || '').trim();
  const readableErr =
    excMsg && nodeType ? `${nodeType}: ${excMsg}` : excMsg || 'ComfyUI execution error';

  let recovery: ComfyUiExecutionErrorNotice['recovery'] = null;
  if (promptId) {
    try {
      const genRow = db
        .prepare('SELECT id FROM generation_items WHERE comfyui_prompt_id = ? LIMIT 1')
        .get(promptId) as { id: number } | undefined;
      if (genRow) {
        db.prepare(
          `UPDATE generation_items
           SET status = 'failed', error_message = ?, completed_at = datetime('now')
           WHERE id = ?`
        ).run(readableErr, genRow.id);
        recovery = preserveFailedGenerationConversation(genRow.id);
        notifyImageIndexed();
      }
    } catch {
      // ignore DB lookup error
    }
  }

  recordComfyExecutionError({
    promptId,
    message: readableErr,
    recovery,
  });
}

/**
 * Collects prompt_ids from `/queue` running/pending arrays and caches graph metadata once per prompt_id.
 */
function collectQueuePromptIds(entries: any[], now: number): Set<string> {
  const ids = new Set<string>();
  for (const entry of entries) {
    const pid = extractPromptId(entry);
    if (!pid) continue;
    ids.add(pid);
    if (!liveMonitorState.queuePromptMetaMap.has(pid) && Array.isArray(entry) && entry[2]) {
      liveMonitorState.queuePromptMetaMap.set(pid, {
        ...extractMetadataFromPromptGraph(entry[2]),
        firstSeenMs: now,
      });
    }
  }
  return ids;
}

/**
 * Ensures a background WebSocket listener is connected to ComfyUI `/ws`
 * to capture real-time step progress (`value / max` -> percentage) and `prompt_id` transitions.
 */
export function ensureComfyUiWsMonitor(): void {
  if (typeof WebSocket === 'undefined') return;
  monitorStopped = false;

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
      if (wsInstance !== ws) return;
      markComfyUiOnline('ws');
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
              : liveMonitorState.activePromptId;

          // Ignore single-step (1/1) setup/preprocessor notifications so a starting job never flashes 100%
          if (max > 1) {
            liveMonitorState.step = val;
            liveMonitorState.maxSteps = max;
            const pct = Math.min(100, Math.max(0, Math.round((val / max) * 100)));
            liveMonitorState.progressPercent = pct;
            if (pid) {
              liveMonitorState.activePromptId = pid;
              liveMonitorState.runningPromptIds.add(pid);
              liveMonitorState.pendingPromptIds.delete(pid);
              const prev = liveMonitorState.promptProgressMap.get(pid) ?? 0;
              liveMonitorState.promptProgressMap.set(pid, Math.max(prev, pct));
            }
          }
          if (data.node) {
            liveMonitorState.currentNode = String(data.node);
          }
        } else if (type === 'executing' && data) {
          const pid = typeof data.prompt_id === 'string' ? data.prompt_id : null;
          if (data.node === null) {
            const completedPid = pid || liveMonitorState.activePromptId;
            if (completedPid) {
              liveMonitorState.promptProgressMap.set(completedPid, 100);
              liveMonitorState.finishedPromptIds.set(completedPid, Date.now());
              liveMonitorState.runningPromptIds.delete(completedPid);
              liveMonitorState.pendingPromptIds.delete(completedPid);
            }
            liveMonitorState.progressPercent = null;
            liveMonitorState.step = null;
            liveMonitorState.maxSteps = null;
            liveMonitorState.currentNode = null;
            liveMonitorState.activePromptId = null;
          } else {
            if (pid) {
              if (liveMonitorState.activePromptId !== pid) {
                liveMonitorState.progressPercent =
                  liveMonitorState.promptProgressMap.get(pid) ?? null;
                liveMonitorState.step = null;
                liveMonitorState.maxSteps = null;
              }
              liveMonitorState.activePromptId = pid;
              liveMonitorState.runningPromptIds.add(pid);
              liveMonitorState.pendingPromptIds.delete(pid);
            }
            liveMonitorState.currentNode = String(data.node);
          }
        } else if (type === 'execution_cached' || type === 'executed') {
          markComfyUiOnline('ws-event');
        } else if (type === 'execution_error' || type === 'execution_interrupted') {
          const pid =
            typeof data?.prompt_id === 'string'
              ? data.prompt_id
              : liveMonitorState.activePromptId;
          if (pid) {
            liveMonitorState.runningPromptIds.delete(pid);
            liveMonitorState.pendingPromptIds.delete(pid);
            liveMonitorState.promptProgressMap.delete(pid);
            liveMonitorState.finishedPromptIds.delete(pid);
          }
          liveMonitorState.progressPercent = null;

          if (type === 'execution_error') {
            handleWsExecutionError(pid, data);
          }
        } else if (type === 'status' && data?.status?.exec_info) {
          const totalRemaining = Number(data.status.exec_info.queue_remaining ?? 0);
          syncRunJobCounts(totalRemaining);
          if (totalRemaining === 0) {
            if (liveMonitorState.activePromptId) {
              liveMonitorState.promptProgressMap.set(liveMonitorState.activePromptId, 100);
              liveMonitorState.finishedPromptIds.set(liveMonitorState.activePromptId, Date.now());
            }
            liveMonitorState.runningCount = 0;
            liveMonitorState.queuedCount = 0;
            liveMonitorState.progressPercent = null;
            liveMonitorState.step = null;
            liveMonitorState.maxSteps = null;
            liveMonitorState.currentNode = null;
            liveMonitorState.activePromptId = null;
            liveMonitorState.runningPromptIds.clear();
            liveMonitorState.pendingPromptIds.clear();
          }
        }
      } catch {
        // ignore non-JSON frames
      }
    });

    ws.addEventListener('close', () => {
      if (wsInstance !== ws) return;
      wsInstance = null;
      liveMonitorState.online = false;
      if (!monitorStopped && !reconnectTimer) {
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          ensureComfyUiWsMonitor();
        }, 5000);
        reconnectTimer.unref?.();
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
 * Queries ComfyUI GET /queue (cached for 800ms) and merges with live WebSocket step progress.
 */
export async function getComfyUiLiveStatus(): Promise<ComfyUiLiveStatus> {
  ensureComfyUiWsMonitor();

  const now = Date.now();
  if (now - liveMonitorState.lastQueueFetchMs >= 800) {
    liveMonitorState.lastQueueFetchMs = now;
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

        const nextRunningIds = collectQueuePromptIds(runningArr, now);
        const nextPendingIds = collectQueuePromptIds(pendingArr, now);

        // Any prompt that was running previously and is now neither running nor pending has finished in ComfyUI
        for (const prevRunningId of liveMonitorState.runningPromptIds) {
          if (!nextRunningIds.has(prevRunningId) && !nextPendingIds.has(prevRunningId)) {
            liveMonitorState.promptProgressMap.set(prevRunningId, 100);
            liveMonitorState.finishedPromptIds.set(prevRunningId, now);
          }
        }

        liveMonitorState.runningPromptIds = nextRunningIds;
        liveMonitorState.pendingPromptIds = nextPendingIds;
        if (nextRunningIds.size > 0) {
          const firstRunning = Array.from(nextRunningIds)[0];
          if (!liveMonitorState.activePromptId || !nextRunningIds.has(liveMonitorState.activePromptId)) {
            liveMonitorState.activePromptId = firstRunning;
            liveMonitorState.progressPercent =
              liveMonitorState.promptProgressMap.get(firstRunning) ?? null;
          }
        } else {
          liveMonitorState.activePromptId = null;
          liveMonitorState.progressPercent = null;
        }

        markComfyUiOnline('queue');
        liveMonitorState.runningCount = running;
        liveMonitorState.queuedCount = pending;
        syncRunJobCounts(running + pending);

        if (running === 0) {
          liveMonitorState.progressPercent = null;
          liveMonitorState.step = null;
          liveMonitorState.maxSteps = null;
          liveMonitorState.currentNode = null;
        }
      } else {
        liveMonitorState.online = false;
        liveMonitorState.runningCount = 0;
        liveMonitorState.queuedCount = 0;
        syncRunJobCounts(0);
      }
    } catch {
      liveMonitorState.online = false;
      liveMonitorState.runningCount = 0;
      liveMonitorState.queuedCount = 0;
      liveMonitorState.progressPercent = null;
      liveMonitorState.step = null;
      liveMonitorState.maxSteps = null;
      liveMonitorState.currentNode = null;
      syncRunJobCounts(0);
    }
  }

  pruneStaleMonitorEntries(now);

  const totalRemaining = liveMonitorState.runningCount + liveMonitorState.queuedCount;
  const totalRunJobs = totalRemaining > 0 ? Math.max(liveMonitorState.runTotalJobs, totalRemaining) : null;
  const currentJobIndex =
    totalRemaining > 0 && totalRunJobs !== null
      ? Math.min(totalRunJobs, Math.max(1, totalRunJobs - totalRemaining + 1))
      : null;

  const ghostItems = getActiveGhostItems();

  return {
    online: liveMonitorState.online,
    runningCount: liveMonitorState.runningCount,
    queuedCount: liveMonitorState.queuedCount,
    progressPercent: liveMonitorState.runningCount > 0 ? liveMonitorState.progressPercent : null,
    step: liveMonitorState.runningCount > 0 ? liveMonitorState.step : null,
    maxSteps: liveMonitorState.runningCount > 0 ? liveMonitorState.maxSteps : null,
    currentNode: liveMonitorState.runningCount > 0 ? liveMonitorState.currentNode : null,
    currentJobIndex,
    totalRunJobs,
    lastIndexedAt: liveMonitorState.lastIndexedAt,
    workspaceVersion: liveMonitorState.workspaceVersion,
    ghostItems,
    lastError:
      liveMonitorState.lastError && now - liveMonitorState.lastError.timestamp < 30_000
        ? liveMonitorState.lastError
        : null,
  };
}
