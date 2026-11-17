import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../api/client.ts';
import { findAttachedGhostsForImage } from '../../shared/utils.ts';
import { pickDefaultCompareImageId } from './splitCompareUtils.ts';
import type { ImageRecord, QueuedGhostCardItem } from '../../shared/types.ts';

export interface InspectorDetailData {
  image?: ImageRecord;
  rawMetadata: Record<string, string>;
  visualWorkflowJson: string | null;
  apiWorkflowJson: string | null;
}

interface UseInspectorStateParams {
  image: ImageRecord;
  allImages: ImageRecord[];
  ghostItems: QueuedGhostCardItem[];
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  onUpdated: () => void | Promise<void>;
  onRateImage?: (imageId: number, rating: number) => Promise<void> | void;
  onToggleFavoriteImage?: (imageId: number, nextFavorite: boolean) => Promise<void> | void;
  onRejectImage?: (imageId: number, nextRejected: boolean) => Promise<void> | void;
  onAdvanceAfterReject?: (rejectedCardId: number) => void;
  onNavigateToImage?: (imageId: number) => void;
}

export interface InspectorCurationFeedback {
  text: string;
  tone?: 'info' | 'warning' | 'success';
  undoImageId?: number;
  undoWasStackStep?: boolean;
}

const getSuggestedUpscaleMp = (mp: number): number => {
  const doubled = Math.round(mp * 4) / 2;
  return Math.max(4.0, Math.min(10.0, doubled));
};

/**
 * Coordinates inspector detail fetching, live queue sync, upscale/workflow
 * reproduction actions, A/B split-compare transitions, Loupe state, and fast curation hotkeys.
 */
export function useInspectorState({
  image,
  allImages,
  ghostItems,
  onClose,
  onPrev,
  onNext,
  onUpdated,
  onRateImage,
  onToggleFavoriteImage,
  onRejectImage,
  onAdvanceAfterReject,
  onNavigateToImage,
}: UseInspectorStateParams) {
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [loupeEnabled, setLoupeEnabled] = useState(false);
  const [showShortcutsHelp, setShowShortcutsHelp] = useState(false);
  const [curationFeedback, setCurationFeedback] = useState<InspectorCurationFeedback | null>(null);
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [selectedIterationId, setSelectedIterationId] = useState<number>(image.id);
  const [slotASeriesContextId, setSlotASeriesContextId] = useState<number | null>(
    image.seriesId ?? null
  );
  const [detailData, setDetailData] = useState<InspectorDetailData | null>(null);
  const [editablePositivePrompt, setEditablePositivePrompt] = useState(image.positivePrompt || '');
  const [notes, setNotes] = useState(image.notes);

  const [isRunningWorkflow, setIsRunningWorkflow] = useState(false);
  const [isUpscalingImage, setIsUpscalingImage] = useState(false);
  const [reproStatusMsg, setReproStatusMsg] = useState<string | null>(null);
  const [reproStatusIsError, setReproStatusIsError] = useState(false);
  const [showSeriesMiniGallery, setShowSeriesMiniGallery] = useState(false);

  const [isSplitMode, setIsSplitMode] = useState(false);
  const [compareSelection, setCompareSelection] = useState<{
    imageId: number;
    seriesId: number | null;
  } | null>(null);
  const [compareDetailImage, setCompareDetailImage] = useState<ImageRecord | null>(null);
  const [showComparePicker, setShowComparePicker] = useState(false);

  const activeImage =
    detailData?.image && detailData.image.id === selectedIterationId
      ? detailData.image
      : allImages.find((img) => img.id === selectedIterationId) || image;
  const seriesContextId = slotASeriesContextId ?? activeImage.seriesId ?? null;

  const compareImage: ImageRecord | null = compareSelection
    ? compareDetailImage && compareDetailImage.id === compareSelection.imageId
      ? compareDetailImage
      : allImages.find((img) => img.id === compareSelection.imageId) || null
    : null;

  const currentMegapixels =
    activeImage.width > 0 && activeImage.height > 0
      ? (activeImage.width * activeImage.height) / 1_000_000
      : 1.0;

  const [upscaleTargetMp, setUpscaleTargetMp] = useState<number>(() =>
    getSuggestedUpscaleMp(currentMegapixels)
  );

  const showCurationFeedback = useCallback((next: InspectorCurationFeedback) => {
    setCurationFeedback(next);
    if (feedbackTimerRef.current) {
      clearTimeout(feedbackTimerRef.current);
    }
    feedbackTimerRef.current = setTimeout(() => {
      setCurationFeedback(null);
      feedbackTimerRef.current = null;
    }, next.undoImageId ? 4500 : 2200);
  }, []);

  useEffect(() => {
    return () => {
      if (feedbackTimerRef.current) {
        clearTimeout(feedbackTimerRef.current);
      }
    };
  }, []);

  // Sync selectedIterationId and reset per-image mode state when outer image prop changes
  useEffect(() => {
    setDetailData(null);
    setSelectedIterationId(image.id);
    setSlotASeriesContextId(image.seriesId ?? null);
    setShowSeriesMiniGallery(false);
    setIsSplitMode(false);
    setCompareSelection(null);
    setCompareDetailImage(null);
    setShowComparePicker(false);
  }, [image.id]);

  const refreshActiveDetail = useCallback(
    (
      targetId = selectedIterationId,
      explicitSeriesId: number | null = seriesContextId
    ) => {
      api
        .getImageDetail(targetId, explicitSeriesId)
        .then((res) => {
          setDetailData({
            image: res.image,
            rawMetadata: res.rawMetadata,
            visualWorkflowJson: res.visualWorkflowJson,
            apiWorkflowJson: res.apiWorkflowJson,
          });
          setEditablePositivePrompt(res.image.positivePrompt || '');
          setNotes(res.image.notes || '');
          const imgMp =
            res.image.width > 0 && res.image.height > 0
              ? (res.image.width * res.image.height) / 1_000_000
              : 1.0;
          setUpscaleTargetMp(getSuggestedUpscaleMp(imgMp));
        })
        .catch(() => {});
    },
    [selectedIterationId, seriesContextId]
  );

  const refreshCompareDetail = useCallback(
    (sel = compareSelection) => {
      if (!sel) {
        setCompareDetailImage(null);
        return;
      }
      api
        .getImageDetail(sel.imageId, sel.seriesId)
        .then((res) => {
          setCompareDetailImage(res.image);
        })
        .catch(() => {});
    },
    [compareSelection]
  );

  const matchingPendingGhosts = findAttachedGhostsForImage(activeImage, ghostItems);
  const prevPendingCountRef = useRef<number>(matchingPendingGhosts.length);

  useEffect(() => {
    setReproStatusMsg(null);
    setReproStatusIsError(false);
    refreshActiveDetail(selectedIterationId, slotASeriesContextId);
  }, [selectedIterationId, slotASeriesContextId, image.id, image.seriesId, image.seriesCount]);

  useEffect(() => {
    if (!isSplitMode || !compareSelection) return;
    refreshCompareDetail(compareSelection);
  }, [isSplitMode, compareSelection?.imageId, compareSelection?.seriesId]);

  // Refresh active detail immediately when a pending series iteration completes and leaves the queue
  useEffect(() => {
    if (prevPendingCountRef.current > 0 && matchingPendingGhosts.length < prevPendingCountRef.current) {
      refreshActiveDetail(selectedIterationId, slotASeriesContextId);
    }
    prevPendingCountRef.current = matchingPendingGhosts.length;
  }, [matchingPendingGhosts.length, selectedIterationId, slotASeriesContextId]);

  const handleRateActiveImage = useCallback(
    async (targetRating: number) => {
      const nextRating =
        targetRating === 0 ? 0 : activeImage.rating === targetRating ? 0 : targetRating;

      setDetailData((prev) =>
        prev?.image
          ? {
              ...prev,
              image: {
                ...prev.image,
                rating: nextRating,
                seriesItems: prev.image.seriesItems?.map((si) =>
                  si.imageId === activeImage.id ? { ...si, rating: nextRating } : si
                ),
              },
            }
          : prev
      );
      showCurationFeedback({
        text: nextRating > 0 ? `Rated ★ ${nextRating}` : 'Rating cleared',
        tone: 'info',
      });

      if (onRateImage) {
        await onRateImage(activeImage.id, nextRating);
      } else {
        await api.updateImageAnnotations(activeImage.id, { rating: nextRating });
        await onUpdated();
      }
    },
    [activeImage.id, activeImage.rating, onRateImage, onUpdated, showCurationFeedback]
  );

  const handleToggleFavoriteActiveImage = useCallback(async () => {
    const nextFavorite = !activeImage.isFavorite;
    setDetailData((prev) =>
      prev?.image
        ? {
            ...prev,
            image: {
              ...prev.image,
              isFavorite: nextFavorite,
              seriesItems: prev.image.seriesItems?.map((si) => ({
                ...si,
                isFavorite:
                  si.imageId === activeImage.id
                    ? nextFavorite
                    : nextFavorite
                    ? false
                    : si.isFavorite,
              })),
            },
          }
        : prev
    );
    showCurationFeedback({
      text: nextFavorite ? 'Added to Favorites' : 'Removed from Favorites',
      tone: 'success',
    });

    if (onToggleFavoriteImage) {
      await onToggleFavoriteImage(activeImage.id, nextFavorite);
    } else {
      await api.updateImageAnnotations(activeImage.id, { isFavorite: nextFavorite });
      await onUpdated();
    }
  }, [activeImage.id, activeImage.isFavorite, onToggleFavoriteImage, onUpdated, showCurationFeedback]);

  const handleRejectActiveImage = useCallback(
    async (autoAdvance: boolean) => {
      const targetId = activeImage.id;
      const nextRejected = !activeImage.isRejected;

      if (!nextRejected) {
        setDetailData((prev) =>
          prev?.image ? { ...prev, image: { ...prev.image, isRejected: false } } : prev
        );
        showCurationFeedback({ text: 'Restored from Rejected', tone: 'success' });
        if (onRejectImage) {
          await onRejectImage(targetId, false);
        } else {
          await api.updateImageAnnotations(targetId, { isRejected: false });
          await onUpdated();
        }
        return;
      }

      const seriesItems = activeImage.seriesItems || [];
      const currentStepIdx = seriesItems.findIndex((it) => it.imageId === targetId);
      const remainingSteps = seriesItems.filter((it) => it.imageId !== targetId);

      // If rejecting an individual step within a multi-item stack, move to an adjacent step in the stack
      if (autoAdvance && remainingSteps.length > 0 && currentStepIdx >= 0) {
        const nextStep =
          seriesItems[currentStepIdx + 1] || seriesItems[currentStepIdx - 1] || remainingSteps[0];
        showCurationFeedback({
          text: `Rejected Step #${currentStepIdx + 1}`,
          tone: 'warning',
          undoImageId: targetId,
          undoWasStackStep: true,
        });
        await api.updateImageAnnotations(targetId, { isRejected: true });
        setSelectedIterationId(nextStep.imageId);
        await onUpdated();
        return;
      }

      // Rejecting a standalone image (or final step of a stack): auto-advance to next/prev gallery item
      if (autoAdvance && onAdvanceAfterReject) {
        showCurationFeedback({
          text: 'Image rejected',
          tone: 'warning',
          undoImageId: targetId,
          undoWasStackStep: false,
        });
        onAdvanceAfterReject(image.id);
        if (onRejectImage) {
          await onRejectImage(targetId, true);
        } else {
          await api.updateImageAnnotations(targetId, { isRejected: true });
          await onUpdated();
        }
        return;
      }

      setDetailData((prev) =>
        prev?.image ? { ...prev, image: { ...prev.image, isRejected: true } } : prev
      );
      showCurationFeedback({
        text: 'Image rejected',
        tone: 'warning',
        undoImageId: targetId,
        undoWasStackStep: false,
      });
      if (onRejectImage) {
        await onRejectImage(targetId, true);
      } else {
        await api.updateImageAnnotations(targetId, { isRejected: true });
        await onUpdated();
      }
    },
    [
      activeImage.id,
      activeImage.isRejected,
      activeImage.seriesItems,
      image.id,
      onAdvanceAfterReject,
      onRejectImage,
      onUpdated,
      showCurationFeedback,
    ]
  );

  const handleUndoReject = useCallback(
    async (undoImageId: number, wasStackStep?: boolean) => {
      setCurationFeedback(null);
      if (onRejectImage) {
        await onRejectImage(undoImageId, false);
      } else {
        await api.updateImageAnnotations(undoImageId, { isRejected: false });
        await onUpdated();
      }
      if (wasStackStep) {
        setSelectedIterationId(undoImageId);
        refreshActiveDetail(undoImageId, slotASeriesContextId);
      } else if (onNavigateToImage) {
        onNavigateToImage(undoImageId);
      }
    },
    [onNavigateToImage, onRejectImage, onUpdated, refreshActiveDetail, slotASeriesContextId]
  );

  // Keyboard navigation & fast curation hotkeys
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        (target &&
          (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) ||
            target.isContentEditable ||
            Boolean(target.closest('[data-quickgen-root="true"]')))) ||
        Boolean(document.querySelector('[data-quickgen-modal="true"]'))
      ) {
        return;
      }

      if (e.key === 'Escape') {
        if (showShortcutsHelp) {
          setShowShortcutsHelp(false);
        } else if (showComparePicker) {
          setShowComparePicker(false);
        } else if (showSeriesMiniGallery) {
          setShowSeriesMiniGallery(false);
        } else if (isSplitMode) {
          setIsSplitMode(false);
        } else if (isFullScreen) {
          setIsFullScreen(false);
        } else {
          onClose();
        }
        return;
      }

      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (showComparePicker || isSplitMode) return;

      if (e.key === 's' || e.key === 'S') {
        const hasStack =
          (activeImage.seriesItems?.length || 0) > 1 || matchingPendingGhosts.length > 0;
        if (hasStack || showSeriesMiniGallery) {
          e.preventDefault();
          setShowSeriesMiniGallery((prev) => !prev);
        }
        return;
      }

      if (showSeriesMiniGallery) return;

      if (e.key === '?') {
        e.preventDefault();
        setShowShortcutsHelp((prev) => !prev);
        return;
      }

      if (e.key === 'ArrowLeft' && onPrev) {
        e.preventDefault();
        onPrev();
        return;
      }
      if (e.key === 'ArrowRight' && onNext) {
        e.preventDefault();
        onNext();
        return;
      }

      if (e.key === '[' || e.key === ']') {
        const items = activeImage.seriesItems || [];
        if (items.length > 1) {
          const idx = items.findIndex((it) => it.imageId === activeImage.id);
          if (idx >= 0) {
            const nextIdx = e.key === '[' ? idx - 1 : idx + 1;
            if (nextIdx >= 0 && nextIdx < items.length) {
              e.preventDefault();
              setSelectedIterationId(items[nextIdx].imageId);
            }
          }
        }
        return;
      }

      if (e.key >= '0' && e.key <= '5') {
        e.preventDefault();
        void handleRateActiveImage(Number(e.key));
        return;
      }

      if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        void handleToggleFavoriteActiveImage();
        return;
      }

      if (e.key === 'x' || e.key === 'X' || e.key === 'Delete') {
        e.preventDefault();
        void handleRejectActiveImage(true);
        return;
      }

      if (e.key === 'l' || e.key === 'L') {
        e.preventDefault();
        setLoupeEnabled((prev) => !prev);
        return;
      }

      if (e.key === ' ') {
        e.preventDefault();
        setIsFullScreen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [
    activeImage.id,
    activeImage.seriesItems,
    handleRateActiveImage,
    handleRejectActiveImage,
    handleToggleFavoriteActiveImage,
    isFullScreen,
    isSplitMode,
    matchingPendingGhosts.length,
    onClose,
    onNext,
    onPrev,
    showComparePicker,
    showSeriesMiniGallery,
    showShortcutsHelp,
  ]);

  const handleSaveNotes = async () => {
    await api.updateImageAnnotations(activeImage.id, { notes });
    refreshActiveDetail(activeImage.id);
    onUpdated();
  };

  const handleRunWorkflow = async () => {
    setIsRunningWorkflow(true);
    setReproStatusMsg(null);
    setReproStatusIsError(false);
    try {
      const res = await api.submitReproduction({
        imageId: activeImage.id,
        workflowId: activeImage.workflowId ?? undefined,
        positivePrompt: editablePositivePrompt,
      });
      setReproStatusIsError(false);
      setReproStatusMsg(`Submitted to ComfyUI (Prompt ID: ${res.job.comfyui_prompt_id})`);
      onUpdated();
    } catch (err: any) {
      setReproStatusIsError(true);
      setReproStatusMsg(err.message || 'Failed to run workflow');
    } finally {
      setIsRunningWorkflow(false);
    }
  };

  const handleUpscaleImage = async () => {
    setIsUpscalingImage(true);
    setReproStatusMsg(null);
    setReproStatusIsError(false);
    try {
      const res = await api.upscaleImage(activeImage.id, upscaleTargetMp);
      setReproStatusIsError(false);
      setReproStatusMsg(
        `Upscale queued at ${res.targetMegapixels.toFixed(1)} MP — will stack automatically on completion`
      );
      onUpdated();
    } catch (err: any) {
      setReproStatusIsError(true);
      setReproStatusMsg(err.message || 'Failed to queue image upscale');
    } finally {
      setIsUpscalingImage(false);
    }
  };

  const estimatedUpscaleDims = (() => {
    const w = activeImage.width || 1024;
    const h = activeImage.height || 1024;
    const ratio = w / h;
    const targetPixels = upscaleTargetMp * 1_000_000;
    const estW = Math.round(Math.sqrt(targetPixels * ratio));
    const estH = Math.round(Math.sqrt(targetPixels / ratio));
    return { estW, estH };
  })();

  const handleEnterSplitMode = () => {
    if (!compareSelection) {
      const smartBId = pickDefaultCompareImageId(activeImage);
      if (smartBId) {
        setCompareSelection({
          imageId: smartBId,
          seriesId: seriesContextId,
        });
      }
    }
    setIsFullScreen(false);
    setShowSeriesMiniGallery(false);
    setIsSplitMode(true);
  };

  const handleSwapSplitSlots = () => {
    if (!compareImage) return;
    const prevA = activeImage;
    const prevASeries = seriesContextId;
    const prevB = compareImage;
    const prevBSeries = compareSelection?.seriesId ?? prevB.seriesId ?? null;

    setSelectedIterationId(prevB.id);
    setSlotASeriesContextId(prevBSeries);
    setDetailData({
      image: prevB,
      rawMetadata: {},
      visualWorkflowJson: null,
      apiWorkflowJson: null,
    });

    setCompareSelection({ imageId: prevA.id, seriesId: prevASeries });
    setCompareDetailImage(prevA);
  };

  const handleSplitAnnotationRefresh = () => {
    refreshActiveDetail(selectedIterationId, slotASeriesContextId);
    refreshCompareDetail(compareSelection);
    onUpdated();
  };

  return {
    isFullScreen,
    setIsFullScreen,
    loupeEnabled,
    setLoupeEnabled,
    showShortcutsHelp,
    setShowShortcutsHelp,
    curationFeedback,
    setCurationFeedback,
    handleRateActiveImage,
    handleToggleFavoriteActiveImage,
    handleRejectActiveImage,
    handleUndoReject,
    selectedIterationId,
    setSelectedIterationId,
    detailData,
    setDetailData,
    editablePositivePrompt,
    setEditablePositivePrompt,
    notes,
    setNotes,
    isRunningWorkflow,
    isUpscalingImage,
    reproStatusMsg,
    reproStatusIsError,
    showSeriesMiniGallery,
    setShowSeriesMiniGallery,
    isSplitMode,
    setIsSplitMode,
    compareSelection,
    setCompareSelection,
    compareDetailImage,
    setCompareDetailImage,
    showComparePicker,
    setShowComparePicker,
    activeImage,
    seriesContextId,
    compareImage,
    currentMegapixels,
    upscaleTargetMp,
    setUpscaleTargetMp,
    estimatedUpscaleDims,
    matchingPendingGhosts,
    refreshActiveDetail,
    handleSaveNotes,
    handleRunWorkflow,
    handleUpscaleImage,
    handleEnterSplitMode,
    handleSwapSplitSlots,
    handleSplitAnnotationRefresh,
  };
}
