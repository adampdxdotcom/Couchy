import { logger } from '../../logger.ts';
import type { ComfyUiExecutionErrorNotice } from '../../../shared/types.ts';
import type { QueuePromptMeta } from './promptGraphUtils.ts';

export const COUCHY_COMFY_CLIENT_ID = 'couchy-studio-client';

export interface QueueSeriesRegistration {
  sourceImageId: number;
  targetSeriesId?: number | null;
  characterId?: number | null;
  characterName?: string | null;
  prompt?: string;
  width?: number;
  height?: number;
  isUpscale?: boolean;
  registeredAtMs: number;
}

export interface LiveMonitorState {
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
  queuePromptSeriesMap: Map<string, QueueSeriesRegistration>;
  runTotalJobs: number;
  prevTotalRemaining: number;
  lastQueueFetchMs: number;
  lastIndexedAt: number;
  workspaceVersion: number;
  lastError: ComfyUiExecutionErrorNotice | null;
  cancelledPromptIds: Map<string, number>;
  cancelledBatchIds: Map<number, number>;
  recentlySubmittedPromptIds: Map<string, number>;
}

export const liveMonitorState: LiveMonitorState = {
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
  queuePromptSeriesMap: new Map<string, QueueSeriesRegistration>(),
  runTotalJobs: 0,
  prevTotalRemaining: 0,
  lastQueueFetchMs: 0,
  lastIndexedAt: Date.now(),
  workspaceVersion: Date.now(),
  lastError: null,
  cancelledPromptIds: new Map<string, number>(),
  cancelledBatchIds: new Map<number, number>(),
  recentlySubmittedPromptIds: new Map<string, number>(),
};

/**
 * Records a ComfyUI execution failure so connected clients can display an error toast
 * and automatically restore any failed Conversation Mode state.
 */
export function recordComfyExecutionError(params: {
  promptId: string | null;
  message: string;
  recovery?: ComfyUiExecutionErrorNotice['recovery'];
}): void {
  const { promptId, message, recovery = null } = params;
  if (promptId && liveMonitorState.cancelledPromptIds.has(promptId)) {
    return;
  }
  if (promptId) {
    liveMonitorState.runningPromptIds.delete(promptId);
    liveMonitorState.pendingPromptIds.delete(promptId);
    liveMonitorState.promptProgressMap.delete(promptId);
    liveMonitorState.finishedPromptIds.delete(promptId);
  }
  // Avoid overwriting an identical promptId error that already has recovery attached
  if (
    promptId &&
    liveMonitorState.lastError?.promptId === promptId &&
    Date.now() - liveMonitorState.lastError.timestamp < 15_000
  ) {
    if (recovery && !liveMonitorState.lastError.recovery) {
      liveMonitorState.lastError = { ...liveMonitorState.lastError, recovery };
    }
    return;
  }
  liveMonitorState.lastError = {
    id: `${promptId || 'err'}-${Date.now()}`,
    promptId,
    message: message.trim() || 'ComfyUI execution error',
    timestamp: Date.now(),
    recovery,
  };
  logger.error(
    'ComfyUI',
    `Execution failed (${promptId || 'unknown'}): ${liveMonitorState.lastError.message}`
  );
}

/**
 * Registers series/source image metadata for a queued ComfyUI prompt (such as an upscale job)
 * so its pending ghost card attaches onto the target series stack until completion.
 */
export function registerQueuedPromptSeriesTarget(
  promptId: string,
  meta: Omit<QueueSeriesRegistration, 'registeredAtMs'>
): void {
  if (!promptId) return;
  liveMonitorState.queuePromptSeriesMap.set(promptId, {
    ...meta,
    registeredAtMs: Date.now(),
  });
}

/**
 * Forces the next getComfyUiLiveStatus call to fetch fresh /queue data immediately.
 */
export function invalidateComfyQueueCache(): void {
  liveMonitorState.lastQueueFetchMs = 0;
}

const RECENT_SUBMIT_GRACE_MS = 25_000;

/**
 * Records a freshly submitted ComfyUI prompt_id so ghost-card staleness checks give
 * ComfyUI's /queue a brief grace window (including for Pass-2 upscales on older DB rows).
 */
export function markPromptSubmitted(promptId: string | null | undefined): void {
  const pid = (promptId || '').trim();
  if (!pid) return;
  liveMonitorState.recentlySubmittedPromptIds.set(pid, Date.now());
  invalidateComfyQueueCache();
}

export function isPromptRecentlySubmitted(
  promptId: string | null | undefined,
  now = Date.now()
): boolean {
  if (!promptId) return false;
  const submittedAt = liveMonitorState.recentlySubmittedPromptIds.get(promptId);
  return submittedAt !== undefined && now - submittedAt <= RECENT_SUBMIT_GRACE_MS;
}

export function isPromptActiveOrFinishedInComfy(promptId: string | null | undefined): boolean {
  return Boolean(
    promptId &&
      (liveMonitorState.runningPromptIds.has(promptId) ||
        liveMonitorState.pendingPromptIds.has(promptId) ||
        liveMonitorState.finishedPromptIds.has(promptId))
  );
}

/**
 * Marks prompts (and an optional batch ID) as explicitly cancelled by the user so
 * pollers stop quietly and ComfyUI interrupt events do not trigger error toasts.
 */
export function markPromptsCancelled(promptIds: string[], batchId?: number | null): void {
  const now = Date.now();
  if (typeof batchId === 'number' && batchId > 0) {
    liveMonitorState.cancelledBatchIds.set(batchId, now);
  }
  for (const rawPid of promptIds) {
    const pid = rawPid.trim();
    if (!pid) continue;
    liveMonitorState.cancelledPromptIds.set(pid, now);
    liveMonitorState.runningPromptIds.delete(pid);
    liveMonitorState.pendingPromptIds.delete(pid);
    liveMonitorState.promptProgressMap.delete(pid);
    liveMonitorState.finishedPromptIds.delete(pid);
    liveMonitorState.queuePromptMetaMap.delete(pid);
    liveMonitorState.queuePromptSeriesMap.delete(pid);
    liveMonitorState.recentlySubmittedPromptIds.delete(pid);
    if (liveMonitorState.activePromptId === pid) {
      liveMonitorState.activePromptId = null;
      liveMonitorState.progressPercent = null;
      liveMonitorState.step = null;
      liveMonitorState.maxSteps = null;
      liveMonitorState.currentNode = null;
    }
  }
}

export function isPromptCancelled(promptId: string | null | undefined): boolean {
  return Boolean(promptId && liveMonitorState.cancelledPromptIds.has(promptId));
}

export function isBatchCancelled(batchId: number | null | undefined): boolean {
  return Boolean(typeof batchId === 'number' && liveMonitorState.cancelledBatchIds.has(batchId));
}

/**
 * Updates active run job total and remaining counts so current image index (1 of X) stays accurate.
 */
export function syncRunJobCounts(totalRemaining: number): void {
  if (totalRemaining <= 0) {
    liveMonitorState.runTotalJobs = 0;
    liveMonitorState.prevTotalRemaining = 0;
    return;
  }
  if (liveMonitorState.runTotalJobs === 0) {
    liveMonitorState.runTotalJobs = totalRemaining;
  } else if (totalRemaining > liveMonitorState.prevTotalRemaining) {
    liveMonitorState.runTotalJobs += totalRemaining - liveMonitorState.prevTotalRemaining;
  }
  liveMonitorState.runTotalJobs = Math.max(liveMonitorState.runTotalJobs, totalRemaining);
  liveMonitorState.prevTotalRemaining = totalRemaining;
}

/**
 * Bumps the monotonic workspace mutation version so other open browser tabs/devices
 * pick up curation edits (favorites, ratings, tags, characters, presets, etc.) on next poll.
 */
export function notifyWorkspaceDataChanged(): void {
  liveMonitorState.workspaceVersion = Math.max(liveMonitorState.workspaceVersion + 1, Date.now());
}

/**
 * Signals that one or more newly generated images were indexed and committed to SQLite,
 * allowing connected frontends to refresh their gallery views silently.
 */
export function notifyImageIndexed(): void {
  liveMonitorState.lastIndexedAt = Date.now();
  notifyWorkspaceDataChanged();
}

/**
 * Resolves cardState ('queued' | 'generating' | 'indexing') and progressPercent (number | null)
 * for a tracked or untracked prompt.
 * Never returns 100% unless the job has actually finished; returns null ('Pending') until step progress begins.
 */
export function resolvePromptProgressState(
  pid: string | null,
  dbStatus: string,
  hasOutputImage: boolean,
  isFallbackActiveJob: boolean
): { cardState: 'queued' | 'generating' | 'indexing'; progressPercent: number | null } {
  // 1. Explicitly completed in DB or finished execution in ComfyUI -> hold at 100% while indexing
  if (dbStatus === 'completed' || hasOutputImage || (pid && liveMonitorState.finishedPromptIds.has(pid))) {
    return { cardState: 'indexing', progressPercent: 100 };
  }

  // 2. Has emitted real multi-step sampling progress for this prompt_id
  if (pid && liveMonitorState.promptProgressMap.has(pid)) {
    const pct = liveMonitorState.promptProgressMap.get(pid)!;
    return { cardState: 'generating', progressPercent: pct };
  }

  // 3. Fallback when WebSocket frames didn't include prompt_id but a job is actively stepping
  if (
    isFallbackActiveJob &&
    liveMonitorState.runningCount > 0 &&
    liveMonitorState.progressPercent !== null
  ) {
    return { cardState: 'generating', progressPercent: liveMonitorState.progressPercent };
  }

  // 4. Waiting in queue or loading models before step 1 begins -> show 'Pending' (progressPercent = null)
  return { cardState: 'queued', progressPercent: null };
}

/**
 * Evicts expired finished prompts and stale series registration records from memory.
 */
export function pruneStaleMonitorEntries(now: number): void {
  for (const [pid, ts] of liveMonitorState.finishedPromptIds.entries()) {
    if (now - ts > 60_000) {
      liveMonitorState.finishedPromptIds.delete(pid);
      liveMonitorState.promptProgressMap.delete(pid);
      liveMonitorState.queuePromptMetaMap.delete(pid);
      liveMonitorState.queuePromptSeriesMap.delete(pid);
    }
  }
  for (const [pid, reg] of liveMonitorState.queuePromptSeriesMap.entries()) {
    if (now - reg.registeredAtMs > 30 * 60_000) {
      liveMonitorState.queuePromptSeriesMap.delete(pid);
    }
  }
  for (const [pid, ts] of liveMonitorState.cancelledPromptIds.entries()) {
    if (now - ts > 5 * 60_000) {
      liveMonitorState.cancelledPromptIds.delete(pid);
    }
  }
  for (const [bid, ts] of liveMonitorState.cancelledBatchIds.entries()) {
    if (now - ts > 5 * 60_000) {
      liveMonitorState.cancelledBatchIds.delete(bid);
    }
  }
  for (const [pid, ts] of liveMonitorState.recentlySubmittedPromptIds.entries()) {
    if (now - ts > RECENT_SUBMIT_GRACE_MS) {
      liveMonitorState.recentlySubmittedPromptIds.delete(pid);
    }
  }
}
