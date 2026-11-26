import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client.ts';
import type { QuickGenPrefill } from '../components/FloatingQuickGenBar.tsx';
import type { WorkspaceTab } from '../components/TopNavHeader.tsx';
import {
  resolveBaseModelDisplayLabel,
  resolveReusableCheckpoint,
} from '../components/quickgen/quickGenUtils.ts';
import { resolveClosestAspectRatio } from '../shared/utils.ts';
import type {
  AppToastMessage,
  CharacterProfile,
  GalleryFilterState,
  ImageRecord,
  ModelInventoryItem,
  QuickGenChatMessage,
} from '../shared/types.ts';

interface UseGalleryImageActionsParams {
  activeTab: WorkspaceTab;
  setActiveTab: React.Dispatch<React.SetStateAction<WorkspaceTab>>;
  inspectedImageId: number | null;
  setInspectedImageId: React.Dispatch<React.SetStateAction<number | null>>;
  images: ImageRecord[];
  setImages: React.Dispatch<React.SetStateAction<ImageRecord[]>>;
  setAllImages?: React.Dispatch<React.SetStateAction<ImageRecord[]>>;
  characters: CharacterProfile[];
  models: ModelInventoryItem[];
  filters: GalleryFilterState;
  lmStudioOnline: boolean;
  pushToast: (text: string, type?: AppToastMessage['type']) => void;
  onRefreshAll: () => Promise<void>;
  beginRejectMutation?: (imageId: number, nextRejected: boolean) => number;
  settleRejectMutation?: (imageId: number, token: number, committed: boolean) => void;
  setQuickGenPrefill: React.Dispatch<React.SetStateAction<QuickGenPrefill | null>>;
}

/**
 * Encapsulates Quick Gen reuse/conversation handoffs, optimistic image annotations
 * (favorite, rate, reject), multi-selection, and directory scan triggering.
 */
export function useGalleryImageActions({
  activeTab,
  setActiveTab,
  inspectedImageId,
  setInspectedImageId,
  images,
  setImages,
  setAllImages,
  characters,
  models,
  filters,
  lmStudioOnline,
  pushToast,
  onRefreshAll,
  beginRejectMutation,
  settleRejectMutation,
  setQuickGenPrefill,
}: UseGalleryImageActionsParams) {
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const lastSelectedAnchorIdRef = useRef<number | null>(null);

  const handleClearSelection = useCallback(() => {
    setSelectedIds(new Set());
    lastSelectedAnchorIdRef.current = null;
  }, []);

  const handleTriggerScan = useCallback(async () => {
    pushToast('Scanning mounted output directory...', 'info');
    try {
      await api.triggerScan('incremental');
      setTimeout(async () => {
        await onRefreshAll();
        pushToast('Directory scan complete', 'success');
      }, 900);
    } catch {
      pushToast('Directory scan failed', 'error');
    }
  }, [pushToast, onRefreshAll]);

  const handleReusePrompt = useCallback(
    (img: ImageRecord, options?: { stackFromSource?: boolean }) => {
      const confirmedCharLink = img.characters.find((c) => c.status === 'confirmed');
      const firstCharLink = confirmedCharLink || img.characters[0];
      const matchedChar = firstCharLink
        ? characters.find((c) => c.id === firstCharLink.characterId) || null
        : null;

      let promptText = (img.positivePrompt || '').trim();
      if (!promptText && matchedChar?.name) {
        promptText = `portrait of ${matchedChar.name}`;
      }

      const targetRatio = resolveClosestAspectRatio(img.width, img.height);
      const { checkpointName: reusableCheckpoint, unavailableLabel } = resolveReusableCheckpoint(
        img.checkpointName,
        models
      );

      const stackFromSource = Boolean(options?.stackFromSource);
      const isFromMultiShot = img.seriesKind === 'multi_shot';
      const hasExistingIterativeStack =
        stackFromSource && !isFromMultiShot && Boolean(img.seriesId) && (img.seriesCount || 1) > 1;

      setQuickGenPrefill({
        prompt: promptText,
        character: matchedChar,
        checkpointName: reusableCheckpoint,
        loras: img.loras || [],
        aspectRatio: targetRatio,
        batchCount: 1,
        seriesId: stackFromSource && !isFromMultiShot ? (img.seriesId ?? null) : null,
        branchFromImageId: stackFromSource ? img.id : null,
        stackSourceLabel: stackFromSource
          ? hasExistingIterativeStack
            ? `Add to stack · ${img.filename}`
            : `New stack · ${img.filename}`
          : null,
        timestamp: Date.now(),
      });

      const charLabel = matchedChar ? ` with ${matchedChar.name}` : '';
      const ckptLabel = reusableCheckpoint
        ? ` + ${resolveBaseModelDisplayLabel(reusableCheckpoint, models)}`
        : '';
      const loraCount = img.loras?.length || 0;
      const loraLabel = loraCount > 0 ? ` + ${loraCount} LoRA(s)` : '';
      const stackNotice = stackFromSource
        ? hasExistingIterativeStack
          ? ' · adding to stack'
          : ' · new stack'
        : '';
      const skippedNotice = unavailableLabel
        ? ` (skipped unavailable base model: ${unavailableLabel})`
        : '';
      pushToast(
        `Reused prompt${charLabel}${ckptLabel}${loraLabel} (${targetRatio}, 1 image${stackNotice}) in Quick Gen${skippedNotice}`,
        unavailableLabel ? 'warning' : 'success'
      );
    },
    [characters, models, pushToast, setQuickGenPrefill]
  );

  const handleOpenConversationForImage = useCallback(
    async (img: ImageRecord) => {
      if (!lmStudioOnline) {
        pushToast(
          'Local LLM is offline — start your Local LLM server to use Conversation mode.',
          'warning'
        );
        return;
      }

      const confirmedCharLink = img.characters.find((c) => c.status === 'confirmed');
      const firstCharLink = confirmedCharLink || img.characters[0];
      const matchedChar = firstCharLink
        ? characters.find((c) => c.id === firstCharLink.characterId) || null
        : null;

      const targetRatio = resolveClosestAspectRatio(img.width, img.height);
      const targetMp =
        img.width > 0 && img.height > 0
          ? Math.max(0.5, Math.min(10.0, Math.round(((img.width * img.height) / 1_000_000) * 2) / 2))
          : undefined;

      const isFromMultiShot = img.seriesKind === 'multi_shot';
      let resolvedChatSnapshot = img.chatSnapshot || [];
      if (!isFromMultiShot && resolvedChatSnapshot.length === 0 && (img.hasChat || img.seriesId)) {
        try {
          const detail = await api.getImageDetail(img.id, img.seriesId ?? undefined);
          resolvedChatSnapshot = detail.image?.chatSnapshot || [];
        } catch {
          // Fall back to seeding conversation from positivePrompt if detail lookup fails
        }
      }

      let initialChatMessages: QuickGenChatMessage[] = [];
      if (!isFromMultiShot && resolvedChatSnapshot.length > 0) {
        const hasSubmittedFlag = resolvedChatSnapshot.some((m) => m.submitted);
        if (hasSubmittedFlag) {
          initialChatMessages = resolvedChatSnapshot;
        } else {
          // Legacy snapshots without `submitted`: mark the latest assistant proposal as submitted
          const lastProposalRevIdx = [...resolvedChatSnapshot]
            .reverse()
            .findIndex((m) => m.role === 'assistant' && Boolean(m.proposedPrompt?.trim()));
          const targetIdx =
            lastProposalRevIdx >= 0 ? resolvedChatSnapshot.length - 1 - lastProposalRevIdx : -1;
          initialChatMessages = resolvedChatSnapshot.map((m, idx) =>
            idx === targetIdx ? { ...m, submitted: true } : m
          );
        }
      } else {
        const promptText = (img.positivePrompt || '').trim();
        if (promptText) {
          initialChatMessages = [
            {
              id: `seed-${img.id}`,
              role: 'assistant',
              content: isFromMultiShot
                ? 'Loaded this shot from the photo set. How would you like to iterate on it?'
                : 'Loaded prompt from this image. How would you like to iterate on it?',
              proposedPrompt: promptText,
              submitted: true,
            },
          ];
        }
      }

      const latestExcludedMsg = [...initialChatMessages]
        .reverse()
        .find((m) => Array.isArray(m.excludedLoras) && m.excludedLoras.length > 0);

      const { checkpointName: reusableCheckpoint } = resolveReusableCheckpoint(
        img.checkpointName,
        models
      );

      setQuickGenPrefill({
        prompt: '',
        character: matchedChar,
        checkpointName: reusableCheckpoint,
        loras: img.loras || [],
        excludedLoras: latestExcludedMsg?.excludedLoras || [],
        aspectRatio: targetRatio,
        megapixels: targetMp,
        batchCount: 1,
        conversationMode: true,
        chatMessages: initialChatMessages,
        seriesId: isFromMultiShot ? null : (img.seriesId ?? null),
        branchFromImageId: img.id,
        timestamp: Date.now(),
      });

      if (activeTab === 'generation') {
        setInspectedImageId(null);
        setActiveTab('gallery');
      }
      pushToast(
        isFromMultiShot
          ? 'Started new Conversation stack from set shot in Quick Gen'
          : img.seriesId
          ? 'Reopened image series conversation in Quick Gen'
          : 'Started Conversation stack from image in Quick Gen',
        'info'
      );
    },
    [activeTab, characters, lmStudioOnline, models, pushToast, setActiveTab, setInspectedImageId, setQuickGenPrefill]
  );

  const handleQuickFavorite = useCallback(
    async (id: number, isFavorite: boolean) => {
      const favoritedAt = isFavorite ? new Date().toISOString() : null;
      const targetImg = images.find((img) => img.id === id);
      setImages((prev) =>
        prev.map((img) => (img.id === id ? { ...img, isFavorite, favoritedAt } : img))
      );
      setAllImages?.((prev) =>
        prev.map((img) => (img.id === id ? { ...img, isFavorite, favoritedAt } : img))
      );
      await api.updateImageAnnotations(id, { isFavorite });
      // Refresh if favoriting a series poster or an image opened from a scoped detail view
      if (!targetImg || (targetImg.seriesCount || 1) > 1) {
        await onRefreshAll();
      }
      pushToast(isFavorite ? 'Added to Favorites' : 'Removed from Favorites', 'info');
    },
    [images, onRefreshAll, pushToast, setAllImages, setImages]
  );

  const handleQuickRate = useCallback(
    async (id: number, rating: number) => {
      setImages((prev) => prev.map((img) => (img.id === id ? { ...img, rating } : img)));
      setAllImages?.((prev) => prev.map((img) => (img.id === id ? { ...img, rating } : img)));
      await api.updateImageAnnotations(id, { rating });
      pushToast(rating > 0 ? `Rated image ★ ${rating}` : 'Cleared image rating', 'info');
    },
    [pushToast, setAllImages, setImages]
  );

  const handleQuickReject = useCallback(
    async (id: number, nextRejected: boolean) => {
      const mutationToken = beginRejectMutation ? beginRejectMutation(id, nextRejected) : 0;
      setAllImages?.((prev) =>
        prev.map((img) => (img.id === id ? { ...img, isRejected: nextRejected } : img))
      );
      setImages((prev) => {
        if (filters.rejectedMode === 'exclude' && nextRejected) {
          return prev.filter((img) => img.id !== id);
        }
        if (filters.rejectedMode === 'only' && !nextRejected) {
          return prev.filter((img) => img.id !== id);
        }
        return prev.map((img) => (img.id === id ? { ...img, isRejected: nextRejected } : img));
      });
      try {
        await api.updateImageAnnotations(id, { isRejected: nextRejected });
        if (settleRejectMutation && mutationToken) {
          settleRejectMutation(id, mutationToken, true);
        }
        if (!nextRejected && filters.rejectedMode === 'exclude') {
          await onRefreshAll();
        }
        pushToast(
          nextRejected
            ? 'Image rejected (hidden from standard library)'
            : 'Image restored from rejected',
          'info'
        );
      } catch (err: any) {
        if (settleRejectMutation && mutationToken) {
          settleRejectMutation(id, mutationToken, false);
        }
        console.error('Failed to update rejection status:', err);
        pushToast('Failed to update rejection status', 'error');
        onRefreshAll();
      }
    },
    [
      beginRejectMutation,
      filters.rejectedMode,
      onRefreshAll,
      pushToast,
      setAllImages,
      setImages,
      settleRejectMutation,
    ]
  );

  const handleToggleSelect = useCallback(
    (id: number, shiftKey = false) => {
      const anchorId = lastSelectedAnchorIdRef.current;
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (shiftKey && anchorId !== null) {
          const anchorIdx = images.findIndex((img) => img.id === anchorId);
          const targetIdx = images.findIndex((img) => img.id === id);
          if (anchorIdx >= 0 && targetIdx >= 0) {
            const start = Math.min(anchorIdx, targetIdx);
            const end = Math.max(anchorIdx, targetIdx);
            const shouldSelect = !prev.has(id);
            for (let i = start; i <= end; i++) {
              if (shouldSelect) next.add(images[i].id);
              else next.delete(images[i].id);
            }
            return next;
          }
        }
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      lastSelectedAnchorIdRef.current = id;
    },
    [images]
  );

  // Press Escape in the Gallery grid to clear active multi-selection
  useEffect(() => {
    if (activeTab !== 'gallery' || inspectedImageId !== null || selectedIds.size === 0) {
      return;
    }
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable)
      ) {
        return;
      }
      handleClearSelection();
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [activeTab, handleClearSelection, inspectedImageId, selectedIds.size]);

  const handleAdvanceAfterReject = useCallback(
    (rejectedCardId: number) => {
      const idx = images.findIndex((img) => img.id === rejectedCardId);
      if (idx < 0) {
        setInspectedImageId(null);
        return;
      }
      const nextCard = images[idx + 1] || images[idx - 1] || null;
      setInspectedImageId(nextCard ? nextCard.id : null);
    },
    [images, setInspectedImageId]
  );

  return {
    selectedIds,
    setSelectedIds,
    handleClearSelection,
    handleToggleSelect,
    handleTriggerScan,
    handleReusePrompt,
    handleOpenConversationForImage,
    handleQuickFavorite,
    handleQuickRate,
    handleQuickReject,
    handleAdvanceAfterReject,
  };
}
