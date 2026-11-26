import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api/client.ts';
import { findAttachedGhostsForImage } from '../../shared/utils.ts';
import { pickDefaultCompareImageId } from './splitCompareUtils.ts';
import {
  DEFAULT_INSPECTOR_VISIBILITY_FILTER,
  getOrderedVisibleSeriesItems,
  resolveInspectorNavigationTargets,
  type InspectorPhotoNavTarget,
  type InspectorVisibilityFilter,
} from './inspectorNavigation.ts';
import type { ImageLoraRecord, ImageRecord, QueuedGhostCardItem } from '../../shared/types.ts';

export interface InspectorDetailData {
  image?: ImageRecord;
  rawMetadata: Record<string, string>;
  visualWorkflowJson: string | null;
  apiWorkflowJson: string | null;
}

export interface InspectorEditableGenParams {
  checkpointName: string;
  vaeName: string;
  seed: string;
  steps: string;
  cfg: string;
  sampler: string;
  scheduler: string;
  denoise: string;
  batchSize: string;
}

export function buildEditableGenParamsFromImage(img: ImageRecord): InspectorEditableGenParams {
  return {
    checkpointName: img.checkpointName || '',
    vaeName: img.vaeName || '',
    seed: img.seed !== null && img.seed !== undefined ? String(img.seed) : '',
    steps: img.steps !== null && img.steps !== undefined ? String(img.steps) : '',
    cfg: img.cfg !== null && img.cfg !== undefined ? String(img.cfg) : '',
    sampler: img.sampler || '',
    scheduler: img.scheduler || '',
    denoise: img.denoise !== null && img.denoise !== undefined ? String(img.denoise) : '1',
    batchSize: img.batchSize !== null && img.batchSize !== undefined ? String(img.batchSize) : '1',
  };
}

interface UseInspectorStateParams {
  image: ImageRecord;
  initialIterationId?: number | null;
  galleryCards?: ImageRecord[];
  galleryFilter?: InspectorVisibilityFilter;
  ghostItems: QueuedGhostCardItem[];
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  onSelectGalleryCard?: (cardId: number, iterationId?: number | null) => void;
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
  initialIterationId = null,
  galleryCards = [],
  galleryFilter,
  ghostItems,
  onClose,
  onPrev,
  onNext,
  onSelectGalleryCard,
  onUpdated,
  onRateImage,
  onToggleFavoriteImage,
  onRejectImage,
  onAdvanceAfterReject,
  onNavigateToImage,
}: UseInspectorStateParams) {
  const sortBy = galleryFilter?.sortBy ?? DEFAULT_INSPECTOR_VISIBILITY_FILTER.sortBy;
  const rejectedMode =
    galleryFilter?.rejectedMode ?? DEFAULT_INSPECTOR_VISIBILITY_FILTER.rejectedMode;
  const archivedMode =
    galleryFilter?.archivedMode ?? DEFAULT_INSPECTOR_VISIBILITY_FILTER.archivedMode;
  const effectiveGalleryFilter = useMemo<InspectorVisibilityFilter>(
    () => ({ sortBy, rejectedMode, archivedMode }),
    [sortBy, rejectedMode, archivedMode]
  );
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [loupeEnabled, setLoupeEnabled] = useState(false);
  const [showShortcutsHelp, setShowShortcutsHelp] = useState(false);
  const [curationFeedback, setCurationFeedback] = useState<InspectorCurationFeedback | null>(null);
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [selectedIterationId, setSelectedIterationId] = useState<number>(
    initialIterationId ?? image.id
  );
  const prevOuterImageIdRef = useRef<number>(image.id);
  const [slotASeriesContextId, setSlotASeriesContextId] = useState<number | null>(
    image.seriesId ?? null
  );
  const [detailData, setDetailData] = useState<InspectorDetailData | null>(null);
  const detailCacheRef = useRef<Map<number, InspectorDetailData>>(new Map());
  const detailFetchSeqRef = useRef<number>(0);

  const [editablePositivePrompt, setEditablePositivePrompt] = useState(image.positivePrompt || '');
  const [editableLoras, setEditableLoras] = useState<ImageLoraRecord[]>(image.loras || []);
  const [editableGenParams, setEditableGenParams] = useState<InspectorEditableGenParams>(() =>
    buildEditableGenParamsFromImage(image)
  );
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

  const knownSeriesItems =
    detailData?.image?.seriesItems && detailData.image.seriesItems.length > 0
      ? detailData.image.seriesItems
      : image.seriesItems || [];

  const cachedSelectedDetail = detailCacheRef.current.get(selectedIterationId);
  const matchingSeriesStep = knownSeriesItems.find((si) => si.imageId === selectedIterationId);

  // Never flash back to the original poster image while switching between steps in a series stack
  const activeImage: ImageRecord =
    detailData?.image && detailData.image.id === selectedIterationId
      ? detailData.image
      : cachedSelectedDetail?.image && cachedSelectedDetail.image.id === selectedIterationId
      ? cachedSelectedDetail.image
      : galleryCards.find((img) => img.id === selectedIterationId) ||
        (matchingSeriesStep
          ? {
              ...(detailData?.image || image),
              id: matchingSeriesStep.imageId,
              filename: matchingSeriesStep.filename,
              thumbnailUrl: matchingSeriesStep.thumbnailUrl,
              originalUrl: matchingSeriesStep.originalUrl,
              width: matchingSeriesStep.width || image.width,
              height: matchingSeriesStep.height || image.height,
              isFavorite: matchingSeriesStep.isFavorite,
              rating: matchingSeriesStep.rating,
              isRejected: Boolean(matchingSeriesStep.isRejected),
              isArchived: Boolean(matchingSeriesStep.isArchived),
              createdAt: matchingSeriesStep.createdAt || image.createdAt,
              chatSnapshot: matchingSeriesStep.chatSnapshot || [],
              isUploadedReference: Boolean(matchingSeriesStep.isUploadedReference),
              seriesItems: knownSeriesItems,
            }
          : image);
  const seriesContextId = slotASeriesContextId ?? activeImage.seriesId ?? null;

  const matchingCompareStep = compareSelection
    ? knownSeriesItems.find((si) => si.imageId === compareSelection.imageId)
    : undefined;
  const compareImage: ImageRecord | null = compareSelection
    ? compareDetailImage && compareDetailImage.id === compareSelection.imageId
      ? compareDetailImage
      : galleryCards.find((img) => img.id === compareSelection.imageId) ||
        (matchingCompareStep
          ? {
              ...image,
              id: matchingCompareStep.imageId,
              filename: matchingCompareStep.filename,
              thumbnailUrl: matchingCompareStep.thumbnailUrl,
              originalUrl: matchingCompareStep.originalUrl,
              width: matchingCompareStep.width || image.width,
              height: matchingCompareStep.height || image.height,
              isFavorite: matchingCompareStep.isFavorite,
              rating: matchingCompareStep.rating,
              isRejected: Boolean(matchingCompareStep.isRejected),
              isArchived: Boolean(matchingCompareStep.isArchived),
              createdAt: matchingCompareStep.createdAt || image.createdAt,
              chatSnapshot: matchingCompareStep.chatSnapshot || [],
              isUploadedReference: Boolean(matchingCompareStep.isUploadedReference),
              seriesItems: knownSeriesItems,
            }
          : null)
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

  // Sync selectedIterationId and reset per-card mode state when outer card or initial step changes
  useEffect(() => {
    const outerChanged = prevOuterImageIdRef.current !== image.id;
    prevOuterImageIdRef.current = image.id;
    const targetId = initialIterationId ?? image.id;

    if (outerChanged) {
      detailCacheRef.current.clear();
      setDetailData(null);
      setSlotASeriesContextId(image.seriesId ?? null);
      setEditablePositivePrompt(image.positivePrompt || '');
      setEditableLoras(image.loras || []);
      setEditableGenParams(buildEditableGenParamsFromImage(image));
      setShowSeriesMiniGallery(false);
      setIsSplitMode(false);
      setCompareSelection(null);
      setCompareDetailImage(null);
      setShowComparePicker(false);
    }
    setSelectedIterationId(targetId);
  }, [image.id, initialIterationId]);

  const navTargets = useMemo(
    () =>
      resolveInspectorNavigationTargets({
        activeImageId: activeImage.id,
        activeSeriesItems: knownSeriesItems,
        cardImageId: image.id,
        galleryCards,
        filter: effectiveGalleryFilter,
      }),
    [activeImage.id, effectiveGalleryFilter, galleryCards, image.id, knownSeriesItems]
  );

  const applyPhotoNavTarget = useCallback(
    (target: InspectorPhotoNavTarget) => {
      if (target.type === 'step') {
        setSelectedIterationId(target.imageId);
      } else if (onSelectGalleryCard) {
        onSelectGalleryCard(target.cardId, target.iterationId);
      }
    },
    [onSelectGalleryCard]
  );

  const handlePrevPhoto = useMemo(() => {
    if (navTargets.prevPhoto) {
      const target = navTargets.prevPhoto;
      return () => applyPhotoNavTarget(target);
    }
    return onPrev;
  }, [applyPhotoNavTarget, navTargets.prevPhoto, onPrev]);

  const handleNextPhoto = useMemo(() => {
    if (navTargets.nextPhoto) {
      const target = navTargets.nextPhoto;
      return () => applyPhotoNavTarget(target);
    }
    return onNext;
  }, [applyPhotoNavTarget, navTargets.nextPhoto, onNext]);

  const handlePrevStack = useMemo(() => {
    if (navTargets.prevStackCardId !== null && onSelectGalleryCard) {
      const cardId = navTargets.prevStackCardId;
      return () => onSelectGalleryCard(cardId, null);
    }
    return onPrev;
  }, [navTargets.prevStackCardId, onPrev, onSelectGalleryCard]);

  const handleNextStack = useMemo(() => {
    if (navTargets.nextStackCardId !== null && onSelectGalleryCard) {
      const cardId = navTargets.nextStackCardId;
      return () => onSelectGalleryCard(cardId, null);
    }
    return onNext;
  }, [navTargets.nextStackCardId, onNext, onSelectGalleryCard]);

  // Background-prefetch adjacent chronological photos (in-stack or cross-stack) for snappy navigation
  useEffect(() => {
    const neighborUrls = [
      navTargets.prevPhoto?.originalUrl,
      navTargets.nextPhoto?.originalUrl,
    ].filter((url): url is string => Boolean(url));
    if (neighborUrls.length === 0) return;

    const preloaders = neighborUrls.map((url) => {
      const preloadImg = new Image();
      preloadImg.referrerPolicy = 'no-referrer';
      preloadImg.src = url;
      return preloadImg;
    });
    return () => {
      preloaders.forEach((preloadImg) => {
        preloadImg.src = '';
      });
    };
  }, [navTargets.prevPhoto?.originalUrl, navTargets.nextPhoto?.originalUrl]);

  const refreshActiveDetail = useCallback(
    (
      targetId = selectedIterationId,
      explicitSeriesId: number | null = seriesContextId
    ) => {
      const seq = ++detailFetchSeqRef.current;
      api
        .getImageDetail(targetId, explicitSeriesId)
        .then((res) => {
          const nextDetail: InspectorDetailData = {
            image: res.image,
            rawMetadata: res.rawMetadata,
            visualWorkflowJson: res.visualWorkflowJson,
            apiWorkflowJson: res.apiWorkflowJson,
          };
          detailCacheRef.current.set(res.image.id, nextDetail);
          // Ignore stale responses if the user already switched to another step
          if (seq !== detailFetchSeqRef.current) return;

          setDetailData(nextDetail);
          if (res.image.seriesId && res.image.seriesId !== explicitSeriesId) {
            setSlotASeriesContextId(res.image.seriesId);
          }
          setEditablePositivePrompt(res.image.positivePrompt || '');
          setEditableLoras(res.image.loras || []);
          setEditableGenParams(buildEditableGenParamsFromImage(res.image));
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
      const nextSeriesPreference =
        activeImage.seriesKind === 'multi_shot' ? null : slotASeriesContextId;
      refreshActiveDetail(selectedIterationId, nextSeriesPreference);
    }
    prevPendingCountRef.current = matchingPendingGhosts.length;
  }, [activeImage.seriesKind, matchingPendingGhosts.length, refreshActiveDetail, selectedIterationId, slotASeriesContextId]);

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
          prev?.image
            ? {
                ...prev,
                image: {
                  ...prev.image,
                  isRejected: false,
                  seriesItems: prev.image.seriesItems?.map((si) =>
                    si.imageId === targetId ? { ...si, isRejected: false } : si
                  ),
                },
              }
            : prev
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
      const orderedVisible = getOrderedVisibleSeriesItems(seriesItems, effectiveGalleryFilter);
      const visibleIdx = orderedVisible.findIndex((it) => it.imageId === targetId);
      const remainingVisible = orderedVisible.filter((it) => it.imageId !== targetId);

      // If rejecting an individual step within a multi-item stack, move to the next visible chronological step
      if (autoAdvance && remainingVisible.length > 0 && visibleIdx >= 0) {
        const nextStep =
          orderedVisible[visibleIdx + 1] || orderedVisible[visibleIdx - 1] || remainingVisible[0];
        const rawStepIdx = seriesItems.findIndex((it) => it.imageId === targetId);
        setDetailData((prev) =>
          prev?.image
            ? {
                ...prev,
                image: {
                  ...prev.image,
                  seriesItems: prev.image.seriesItems?.map((si) =>
                    si.imageId === targetId ? { ...si, isRejected: true } : si
                  ),
                },
              }
            : prev
        );
        showCurationFeedback({
          text: `Rejected Step #${rawStepIdx >= 0 ? rawStepIdx + 1 : visibleIdx + 1}`,
          tone: 'warning',
          undoImageId: targetId,
          undoWasStackStep: true,
        });
        await api.updateImageAnnotations(targetId, { isRejected: true });
        setSelectedIterationId(nextStep.imageId);
        await onUpdated();
        return;
      }

      // Rejecting a standalone image (or final visible step of a stack): auto-advance to next/prev gallery card
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
        prev?.image
          ? {
              ...prev,
              image: {
                ...prev.image,
                isRejected: true,
                seriesItems: prev.image.seriesItems?.map((si) =>
                  si.imageId === targetId ? { ...si, isRejected: true } : si
                ),
              },
            }
          : prev
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
      effectiveGalleryFilter,
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

      if (e.key === 'ArrowLeft' && handlePrevPhoto) {
        e.preventDefault();
        handlePrevPhoto();
        return;
      }
      if (e.key === 'ArrowRight' && handleNextPhoto) {
        e.preventDefault();
        handleNextPhoto();
        return;
      }

      if (e.key === '[' && handlePrevStack) {
        e.preventDefault();
        handlePrevStack();
        return;
      }
      if (e.key === ']' && handleNextStack) {
        e.preventDefault();
        handleNextStack();
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
    activeImage.seriesItems,
    handleNextPhoto,
    handleNextStack,
    handlePrevPhoto,
    handlePrevStack,
    handleRateActiveImage,
    handleRejectActiveImage,
    handleToggleFavoriteActiveImage,
    isFullScreen,
    isSplitMode,
    matchingPendingGhosts.length,
    onClose,
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
      const parsedSteps = Number(editableGenParams.steps);
      const parsedCfg = Number(editableGenParams.cfg);
      const parsedDenoise = Number(editableGenParams.denoise);
      const parsedBatch = Number(editableGenParams.batchSize);

      const res = await api.submitReproduction({
        imageId: activeImage.id,
        workflowId: activeImage.workflowId ?? undefined,
        positivePrompt: editablePositivePrompt,
        loras: editableLoras.map((l) => ({
          loraName: l.loraName,
          modelStrength: Number(l.modelStrength ?? 1.0),
          clipStrength: Number(l.clipStrength ?? l.modelStrength ?? 1.0),
        })),
        generationParams: {
          checkpointName: editableGenParams.checkpointName.trim() || null,
          vaeName: editableGenParams.vaeName.trim() || null,
          seed: editableGenParams.seed.trim() || null,
          steps:
            editableGenParams.steps.trim() !== '' && Number.isFinite(parsedSteps)
              ? parsedSteps
              : null,
          cfg:
            editableGenParams.cfg.trim() !== '' && Number.isFinite(parsedCfg)
              ? parsedCfg
              : null,
          sampler: editableGenParams.sampler.trim() || null,
          scheduler: editableGenParams.scheduler.trim() || null,
          denoise:
            editableGenParams.denoise.trim() !== '' && Number.isFinite(parsedDenoise)
              ? parsedDenoise
              : null,
          batchSize:
            editableGenParams.batchSize.trim() !== '' && Number.isFinite(parsedBatch)
              ? parsedBatch
              : null,
        },
      });
      setReproStatusIsError(false);
      setReproStatusMsg(
        `Submitted to ComfyUI — will stack automatically on completion (Prompt ID: ${res.job.comfyui_prompt_id})`
      );
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
    editableLoras,
    setEditableLoras,
    editableGenParams,
    setEditableGenParams,
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
    handlePrevPhoto,
    handleNextPhoto,
    handlePrevStack,
    handleNextStack,
  };
}
