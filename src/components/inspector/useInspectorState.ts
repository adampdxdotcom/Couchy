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
  onUpdated: () => void;
}

const getSuggestedUpscaleMp = (mp: number): number => {
  const doubled = Math.round(mp * 4) / 2;
  return Math.max(4.0, Math.min(10.0, doubled));
};

/**
 * Coordinates inspector detail fetching, live queue sync, upscale/workflow
 * reproduction actions, A/B split-compare transitions, and keyboard shortcuts.
 */
export function useInspectorState({
  image,
  allImages,
  ghostItems,
  onClose,
  onPrev,
  onNext,
  onUpdated,
}: UseInspectorStateParams) {
  const [isFullScreen, setIsFullScreen] = useState(false);
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

  // Sync selectedIterationId and reset mode state when outer image prop changes
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

  // Keyboard navigation (two-stage Escape in Split Mode; suppress arrow keys in Split Mode & modals)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName)) return;
      if (e.key === 'Escape') {
        if (showComparePicker) {
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
      }
      if (showComparePicker || showSeriesMiniGallery || isSplitMode) return;
      if (e.key === 'ArrowLeft' && onPrev) onPrev();
      if (e.key === 'ArrowRight' && onNext) onNext();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose, onPrev, onNext, isFullScreen, isSplitMode, showSeriesMiniGallery, showComparePicker]);

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
