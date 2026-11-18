import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client.ts';
import type { QuickGenPrefill } from '../components/FloatingQuickGenBar.tsx';
import type {
  AppToastMessage,
  CharacterProfile,
  ComfyUiLiveStatus,
  ImageRecord,
  QueuedGhostCardItem,
} from '../shared/types.ts';

interface UseLiveStatusPollingParams {
  allImages: ImageRecord[];
  characters: CharacterProfile[];
  pushToast: (text: string, type?: AppToastMessage['type']) => void;
  onRefreshWorkspace: () => Promise<void>;
  setQuickGenPrefill: React.Dispatch<React.SetStateAction<QuickGenPrefill | null>>;
}

/**
 * Polls ComfyUI live queue progress and Local LLM health, filters indexed ghost cards,
 * restores failed Conversation turns into Quick Gen, and syncs the browser tab title.
 */
export function useLiveStatusPolling({
  allImages,
  characters,
  pushToast,
  onRefreshWorkspace,
  setQuickGenPrefill,
}: UseLiveStatusPollingParams) {
  const [comfyStatus, setComfyStatus] = useState<ComfyUiLiveStatus>({
    online: false,
    runningCount: 0,
    queuedCount: 0,
    progressPercent: null,
    step: null,
    maxSteps: null,
    currentNode: null,
  });
  const [lmStudioStatus, setLmStudioStatus] = useState<{
    online: boolean;
    selectedModel: string;
    baseUrl: string;
  }>({
    online: false,
    selectedModel: '',
    baseUrl: '',
  });
  const [hasUnseenCompletion, setHasUnseenCompletion] = useState<boolean>(false);

  const prevLmStudioOnlineRef = useRef<boolean | null>(null);
  const prevBusyRef = useRef<boolean>(false);
  const lastIndexedAtRef = useRef<number | null>(null);
  const lastWorkspaceVersionRef = useRef<number | null>(null);
  const lastWakeRefreshAtRef = useRef<number>(Date.now());
  const allImageIdsRef = useRef<Set<number>>(new Set());
  const allImagesRef = useRef<ImageRecord[]>([]);
  const charactersRef = useRef<CharacterProfile[]>([]);
  const lastSeenErrorIdRef = useRef<string | null>(null);

  useEffect(() => {
    allImagesRef.current = allImages;
    const ids = new Set<number>();
    for (const img of allImages) {
      ids.add(img.id);
      if (img.seriesItems) {
        for (const si of img.seriesItems) {
          ids.add(si.imageId);
        }
      }
    }
    allImageIdsRef.current = ids;
  }, [allImages]);

  useEffect(() => {
    charactersRef.current = characters;
  }, [characters]);

  const refreshComfyStatus = useCallback(() => {
    api.getComfyUiLiveStatus().then(setComfyStatus).catch(() => {});
  }, []);

  /** Immediately cancels an active ghost job or multi-shot batch and removes it optimistically. */
  const cancelGhostJob = useCallback(
    async (
      ghost: Pick<
        QueuedGhostCardItem,
        'itemId' | 'batchId' | 'comfyuiPromptId' | 'batchTotalCount'
      >
    ) => {
      try {
        await api.cancelComfyUiJob({
          itemId: ghost.itemId,
          batchId: ghost.batchId,
          comfyuiPromptId: ghost.comfyuiPromptId,
        });
        setComfyStatus((prev) => ({
          ...prev,
          ghostItems: (prev.ghostItems || []).filter((g) => {
            if (g.itemId === ghost.itemId) return false;
            if (ghost.batchId > 0 && ghost.batchId < 1_000_000 && g.batchId === ghost.batchId) {
              return false;
            }
            if (ghost.comfyuiPromptId && g.comfyuiPromptId === ghost.comfyuiPromptId) {
              return false;
            }
            return true;
          }),
        }));
        const isSeries = Number(ghost.batchTotalCount || 1) > 1;
        pushToast(isSeries ? 'Cancelled active series batch' : 'Cancelled generation', 'info');
        refreshComfyStatus();
        await onRefreshWorkspace();
      } catch (err: any) {
        pushToast(err?.message || 'Failed to cancel generation.', 'error');
      }
    },
    [pushToast, refreshComfyStatus, onRefreshWorkspace]
  );

  // Poll ComfyUI live queue & job progress
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      try {
        const status = await api.getComfyUiLiveStatus();
        if (cancelled) return;
        setComfyStatus(status);

        // Surface ComfyUI execution failures and auto-restore failed Conversation turns
        if (status.lastError && status.lastError.id !== lastSeenErrorIdRef.current) {
          lastSeenErrorIdRef.current = status.lastError.id;
          const rec = status.lastError.recovery;
          if (rec && rec.chatMessages && rec.chatMessages.length > 0) {
            const matchedChar = rec.characterId
              ? charactersRef.current.find((c) => c.id === rec.characterId) || null
              : null;
            const sourceImg = rec.branchFromImageId
              ? allImagesRef.current.find((img) => img.id === rec.branchFromImageId) || null
              : null;
            const latestExcludedMsg = [...rec.chatMessages]
              .reverse()
              .find((m) => Array.isArray(m.excludedLoras) && m.excludedLoras.length > 0);

            setQuickGenPrefill({
              prompt: '',
              character: matchedChar,
              checkpointName: sourceImg?.checkpointName || null,
              loras: sourceImg?.loras || [],
              excludedLoras: latestExcludedMsg?.excludedLoras || [],
              aspectRatio: rec.aspectRatio,
              megapixels: rec.megapixels,
              batchCount: 1,
              conversationMode: true,
              chatMessages: rec.chatMessages,
              seriesId: rec.seriesId,
              branchFromImageId: rec.branchFromImageId,
              timestamp: Date.now(),
            });
            pushToast(
              `ComfyUI error (${status.lastError.message}) — Conversation restored in Quick Gen`,
              'error'
            );
          } else {
            pushToast(`ComfyUI generation failed: ${status.lastError.message}`, 'error');
          }
          lastWakeRefreshAtRef.current = Date.now();
          onRefreshWorkspace();
        }

        const hasUnindexedGhost = (status.ghostItems || []).some(
          (g) =>
            g.state === 'indexing' &&
            (!g.outputImageId || !allImageIdsRef.current.has(g.outputImageId))
        );

        const isInitialPoll = lastWorkspaceVersionRef.current === null && lastIndexedAtRef.current === null;
        const versionChanged =
          typeof status.workspaceVersion === 'number' &&
          lastWorkspaceVersionRef.current !== null &&
          status.workspaceVersion !== lastWorkspaceVersionRef.current;
        const indexedChanged =
          Boolean(status.lastIndexedAt) &&
          lastIndexedAtRef.current !== null &&
          status.lastIndexedAt! > lastIndexedAtRef.current;

        if (typeof status.workspaceVersion === 'number') {
          lastWorkspaceVersionRef.current = status.workspaceVersion;
        }
        if (status.lastIndexedAt) {
          lastIndexedAtRef.current = status.lastIndexedAt;
        }

        // Silently refresh gallery when another device/tab mutates data or newly generated images are indexed
        if ((!isInitialPoll && (versionChanged || indexedChanged)) || hasUnindexedGhost) {
          lastWakeRefreshAtRef.current = Date.now();
          onRefreshWorkspace();
        }

        const isBusy =
          status.runningCount > 0 ||
          status.queuedCount > 0 ||
          (status.ghostItems && status.ghostItems.length > 0);
        if (status.runningCount > 0 || status.queuedCount > 0) {
          setHasUnseenCompletion(false);
        } else if (prevBusyRef.current && status.runningCount === 0 && status.queuedCount === 0) {
          if (document.hidden || !document.hasFocus()) {
            setHasUnseenCompletion(true);
          }
          lastWakeRefreshAtRef.current = Date.now();
          onRefreshWorkspace();
        }
        prevBusyRef.current = status.runningCount > 0 || status.queuedCount > 0;

        timer = setTimeout(poll, isBusy ? 1000 : 3500);
      } catch {
        if (!cancelled) {
          timer = setTimeout(poll, 5000);
        }
      }
    };

    poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [pushToast, onRefreshWorkspace, setQuickGenPrefill]);

  // Clear "Couchy (Done)" and refresh stale workspace data when returning to a backgrounded tab or device
  useEffect(() => {
    const WAKE_REFRESH_COOLDOWN_MS = 5000;
    const handleWakeOrFocus = () => {
      if (document.hidden) return;
      setHasUnseenCompletion(false);
      const now = Date.now();
      if (now - lastWakeRefreshAtRef.current < WAKE_REFRESH_COOLDOWN_MS) {
        return;
      }
      lastWakeRefreshAtRef.current = now;
      refreshComfyStatus();
      onRefreshWorkspace();
    };

    window.addEventListener('focus', handleWakeOrFocus);
    window.addEventListener('pageshow', handleWakeOrFocus);
    document.addEventListener('visibilitychange', handleWakeOrFocus);
    return () => {
      window.removeEventListener('focus', handleWakeOrFocus);
      window.removeEventListener('pageshow', handleWakeOrFocus);
      document.removeEventListener('visibilitychange', handleWakeOrFocus);
    };
  }, [onRefreshWorkspace, refreshComfyStatus]);

  // Synchronize browser tab title with live generation progress and unseen completion state
  useEffect(() => {
    const isBusy = comfyStatus.runningCount > 0 || comfyStatus.queuedCount > 0;
    if (isBusy) {
      const total =
        comfyStatus.totalRunJobs ?? comfyStatus.runningCount + comfyStatus.queuedCount;
      const current = comfyStatus.currentJobIndex ?? 1;
      const pct = comfyStatus.progressPercent ?? 0;
      document.title = `Couchy (${current} of ${total} - ${pct}%)`;
    } else if (hasUnseenCompletion) {
      document.title = 'Couchy (Done)';
    } else {
      document.title = 'Couchy';
    }
  }, [comfyStatus, hasUnseenCompletion]);

  // Poll LM Studio connection every 15s; alert on state transitions after initial check
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const pollLmStudio = async () => {
      try {
        const res = await api.getLmStudioStatus();
        if (cancelled) return;

        setLmStudioStatus({
          online: Boolean(res.online),
          selectedModel: res.selectedModel || '',
          baseUrl: res.baseUrl || '',
        });

        const prev = prevLmStudioOnlineRef.current;
        if (prev !== null) {
          if (prev === true && !res.online) {
            pushToast('Local LLM Offline', 'warning');
          } else if (prev === false && res.online) {
            pushToast('Local LLM Reconnected', 'success');
          }
        }
        prevLmStudioOnlineRef.current = Boolean(res.online);
      } catch {
        if (cancelled) return;
        const prev = prevLmStudioOnlineRef.current;
        if (prev !== null && prev === true) {
          pushToast('Local LLM Offline', 'warning');
        }
        prevLmStudioOnlineRef.current = false;
        setLmStudioStatus((prevStatus) => ({ ...prevStatus, online: false }));
      } finally {
        if (!cancelled) {
          timer = setTimeout(pollLmStudio, 15000);
        }
      }
    };

    pollLmStudio();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [pushToast]);

  // Filter out ghost cards once their indexed image (or stacked iteration) exists in allImages
  const activeGhostItems = useMemo(() => {
    const raw = comfyStatus.ghostItems || [];
    if (raw.length === 0) return [];
    const knownIds = new Set<number>();
    for (const img of allImages) {
      knownIds.add(img.id);
      if (img.seriesItems) {
        for (const si of img.seriesItems) {
          knownIds.add(si.imageId);
        }
      }
    }
    return raw.filter((g) => !g.outputImageId || !knownIds.has(g.outputImageId));
  }, [comfyStatus.ghostItems, allImages]);

  return {
    comfyStatus,
    lmStudioStatus,
    activeGhostItems,
    refreshComfyStatus,
    cancelGhostJob,
  };
}
