import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BookmarkPlus, Columns2, Dices, Heart, Keyboard, Loader2, Play, RotateCcw, Share2, Star, Trash2, X } from 'lucide-react';
import { api } from '../api/client.ts';
import { renderDependencyLabel } from './GalleryGridView.tsx';
import { SeriesIterationsStrip } from './inspector/SeriesIterationsStrip.tsx';
import { SeriesMiniGalleryModal } from './inspector/SeriesMiniGalleryModal.tsx';
import { SplitCompareView } from './inspector/SplitCompareView.tsx';
import { ComparePickerModal } from './inspector/ComparePickerModal.tsx';
import { CivitaiDraftModal } from './inspector/CivitaiDraftModal.tsx';
import { InspectorSingleViewer } from './inspector/InspectorSingleViewer.tsx';
import { InspectorCharacterSection } from './inspector/InspectorCharacterSection.tsx';
import { InspectorWorkflowSection } from './inspector/InspectorWorkflowSection.tsx';
import {
  InspectorPositivePromptSection,
  InspectorPromptAndParamsSection,
} from './inspector/InspectorPromptAndParamsSection.tsx';
import { InspectorTagsAndNotesSection } from './inspector/InspectorTagsAndNotesSection.tsx';
import { useInspectorState } from './inspector/useInspectorState.ts';
import { MAX_SYSTEM_LORAS, normalizeLoraKey } from './quickgen/quickGenUtils.ts';
import type { CivitaiShareEligibilityResponse } from '../shared/apiTypes.ts';
import type {
  CharacterProfile,
  ImageRecord,
  LoraExplorerItem,
  LoraPreset,
  ModelInventoryItem,
  PillTypeSettings,
  QueuedGhostCardItem,
} from '../shared/types.ts';

interface ImageInspectorDrawerProps {
  image: ImageRecord;
  allImages?: ImageRecord[];
  loras?: LoraExplorerItem[];
  models?: ModelInventoryItem[];
  presets?: LoraPreset[];
  pillTypeSettings?: PillTypeSettings;
  ghostItems?: QueuedGhostCardItem[];
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  onUpdated: () => void | Promise<void>;
  onPushToast?: (text: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
  onRateImage?: (imageId: number, rating: number) => Promise<void> | void;
  onToggleFavoriteImage?: (imageId: number, nextFavorite: boolean) => Promise<void> | void;
  onRejectImage?: (imageId: number, nextRejected: boolean) => Promise<void> | void;
  onAdvanceAfterReject?: (rejectedCardId: number) => void;
  onNavigateToImage?: (imageId: number) => void;
  onOpenConversation?: (image: ImageRecord) => void;
  onReusePrompt?: (image: ImageRecord) => void;
  characters: CharacterProfile[];
  collections: { id: number; name: string }[];
  onFilterByLora: (loraFilename: string) => void;
  onFilterByCharacter: (characterId: number) => void;
  visualTaggerEnabled?: boolean;
  onFilterByVisualKeyword?: (keyword: string) => void;
  onCancelGhost?: (ghost: QueuedGhostCardItem) => Promise<void> | void;
}

/** Finds the lowest unused `userX` preset name (starting at user0, reusing gaps). */
function resolveNextUserPresetName(existingPresets: LoraPreset[]): string {
  const usedNumbers = new Set<number>();
  for (const preset of existingPresets) {
    for (const candidate of [preset.name, preset.nickname]) {
      const match = candidate?.trim().match(/^user(\d+)$/i);
      if (match) {
        usedNumbers.add(Number(match[1]));
      }
    }
  }
  let idx = 0;
  while (usedNumbers.has(idx)) {
    idx += 1;
  }
  return `user${idx}`;
}

/**
 * Full-Screen Lightbox & Comprehensive Image Detail Inspector Coordinator.
 */
export const ImageInspectorDrawer: React.FC<ImageInspectorDrawerProps> = ({
  image,
  allImages = [],
  loras = [],
  models = [],
  presets = [],
  pillTypeSettings,
  ghostItems = [],
  onClose,
  onPrev,
  onNext,
  onUpdated,
  onPushToast,
  onRateImage,
  onToggleFavoriteImage,
  onRejectImage,
  onAdvanceAfterReject,
  onNavigateToImage,
  onOpenConversation,
  onReusePrompt,
  characters,
  collections,
  onFilterByLora,
  onFilterByCharacter,
  visualTaggerEnabled = false,
  onFilterByVisualKeyword,
  onCancelGhost,
}) => {
  const {
    isFullScreen,
    setIsFullScreen,
    loupeEnabled,
    setLoupeEnabled,
    showShortcutsHelp,
    setShowShortcutsHelp,
    curationFeedback,
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
    setCompareSelection,
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
  } = useInspectorState({
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
  });

  const [isCreatingPreset, setIsCreatingPreset] = useState(false);
  const [civitaiShareStatus, setCivitaiShareStatus] =
    useState<CivitaiShareEligibilityResponse | null>(null);
  const [isLoadingShareStatus, setIsLoadingShareStatus] = useState(false);
  const [showCivitaiDraftModal, setShowCivitaiDraftModal] = useState(false);

  const characterTagSig = useMemo(
    () =>
      [
        (activeImage.characters || []).map((c) => `${c.characterId}:${c.status}`).join(','),
        (activeImage.tags || []).map((t) => t.name).join(','),
        characters.map((c) => `${c.id}:${c.allowCivitaiShare ? 1 : 0}`).join(','),
      ].join('|'),
    [activeImage.characters, activeImage.tags, characters]
  );

  const refreshCivitaiShareStatus = useCallback(async () => {
    setIsLoadingShareStatus(true);
    try {
      const res = await api.getImageCivitaiShareStatus(activeImage.id);
      setCivitaiShareStatus(res);
    } catch {
      setCivitaiShareStatus(null);
    } finally {
      setIsLoadingShareStatus(false);
    }
  }, [activeImage.id]);

  useEffect(() => {
    let cancelled = false;
    setIsLoadingShareStatus(true);
    setShowCivitaiDraftModal(false);
    api
      .getImageCivitaiShareStatus(activeImage.id)
      .then((res) => {
        if (!cancelled) setCivitaiShareStatus(res);
      })
      .catch(() => {
        if (!cancelled) setCivitaiShareStatus(null);
      })
      .finally(() => {
        if (!cancelled) setIsLoadingShareStatus(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeImage.id, characterTagSig]);

  const nextUserPresetName = useMemo(() => resolveNextUserPresetName(presets), [presets]);
  const hasPresetModels = Boolean(
    activeImage.checkpointName?.trim() || (activeImage.loras && activeImage.loras.length > 0)
  );

  const handleCreatePresetFromImage = async () => {
    if (isCreatingPreset || !hasPresetModels) return;
    setIsCreatingPreset(true);
    try {
      // Resolve canonical installed checkpoint filename if present in inventory, else preserve raw metadata name
      const rawCkpt = activeImage.checkpointName?.trim() || '';
      let resolvedCheckpoint: string | null = rawCkpt || null;
      if (rawCkpt && models.length > 0) {
        const ckptKey = normalizeLoraKey(rawCkpt);
        const matchedModel = models.find(
          (m) =>
            m.modelType !== 'lora' &&
            (normalizeLoraKey(m.filename) === ckptKey || normalizeLoraKey(m.name) === ckptKey)
        );
        if (matchedModel) {
          resolvedCheckpoint = matchedModel.filename;
        }
      }

      // Collect all LoRAs (including character LoRAs), deduplicated and capped at MAX_SYSTEM_LORAS
      const seenLoraKeys = new Set<string>();
      const collectedItems: Array<{
        loraName: string;
        modelStrength: number;
        clipStrength: number;
      }> = [];
      let skippedOverLimit = 0;

      for (const imgLora of activeImage.loras || []) {
        const key = normalizeLoraKey(imgLora.loraName);
        if (!key || seenLoraKeys.has(key)) continue;
        seenLoraKeys.add(key);

        if (collectedItems.length >= MAX_SYSTEM_LORAS) {
          skippedOverLimit += 1;
          continue;
        }

        const matchedLora = loras.find(
          (l) => normalizeLoraKey(l.filename) === key || normalizeLoraKey(l.name) === key
        );
        collectedItems.push({
          loraName: matchedLora?.filename || imgLora.loraName,
          modelStrength: Number(imgLora.modelStrength ?? 1.0),
          clipStrength: Number(imgLora.clipStrength ?? imgLora.modelStrength ?? 1.0),
        });
      }

      const presetName = resolveNextUserPresetName(presets);
      await api.createPreset({
        name: presetName,
        nickname: presetName,
        pillColor: 'fuchsia',
        checkpointName: resolvedCheckpoint,
        items: collectedItems,
      });
      await onUpdated();

      const parts = [
        resolvedCheckpoint ? 'Base Model' : null,
        collectedItems.length > 0 ? `${collectedItems.length} LoRA(s)` : null,
      ].filter(Boolean);
      const limitNote =
        skippedOverLimit > 0 ? ` · skipped ${skippedOverLimit} over ${MAX_SYSTEM_LORAS}-LoRA cap` : '';
      onPushToast?.(
        `Created preset "${presetName}" (${parts.join(' + ')}${limitNote})`,
        skippedOverLimit > 0 ? 'warning' : 'success'
      );
    } catch (err: any) {
      onPushToast?.(err?.message || 'Failed to create preset from image.', 'error');
    } finally {
      setIsCreatingPreset(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-sm flex flex-col lg:flex-row overflow-hidden">
      {isSplitMode ? (
        <SplitCompareView
          imageA={activeImage}
          imageB={compareImage}
          onSwap={handleSwapSplitSlots}
          onOpenPickerForB={() => setShowComparePicker(true)}
          onExitSplit={() => setIsSplitMode(false)}
          onRateImage={async (targetId, nextRating) => {
            await api.updateImageAnnotations(targetId, { rating: nextRating });
            handleSplitAnnotationRefresh();
          }}
          onToggleFavorite={async (targetId, nextFavorite) => {
            await api.updateImageAnnotations(targetId, { isFavorite: nextFavorite });
            handleSplitAnnotationRefresh();
          }}
          onToggleReject={async (targetId, nextRejected) => {
            await api.updateImageAnnotations(targetId, { isRejected: nextRejected });
            handleSplitAnnotationRefresh();
          }}
          onReusePrompt={
            onReusePrompt
              ? (targetImg) => {
                  onReusePrompt(targetImg);
                }
              : undefined
          }
          onSelectStepA={(nextId) => setSelectedIterationId(nextId)}
          onSelectStepB={(nextId) => {
            setCompareSelection((prev) => ({
              imageId: nextId,
              seriesId: prev?.seriesId ?? compareImage?.seriesId ?? null,
            }));
          }}
        />
      ) : (
        <>
          <InspectorSingleViewer
            activeImage={activeImage}
            outerImageId={image.id}
            isFullScreen={isFullScreen}
            onSetFullScreen={setIsFullScreen}
            loupeEnabled={loupeEnabled}
            onSetLoupeEnabled={setLoupeEnabled}
            onClose={onClose}
            onPrev={onPrev}
            onNext={onNext}
          />

          {/* Right Pane: Comprehensive Metadata, Character & Workflow Reproduction Inspector */}
          <aside
            className={`w-full max-w-full lg:w-[500px] xl:w-[540px] bg-zinc-900 border-l border-zinc-800 flex flex-col h-[55vh] lg:h-full overflow-hidden ${
              isFullScreen ? 'hidden' : ''
            }`}
          >
            {/* Inspector Header */}
            <div className="shrink-0 z-10 bg-zinc-900/95 backdrop-blur-xs border-b border-zinc-800 px-4 sm:px-5 py-3.5 flex items-center justify-between gap-2 sm:gap-3">
              <div className="flex flex-wrap items-center gap-2 sm:gap-3 min-w-0">
                <div className="flex items-center gap-1 shrink-0" title="Rate 1–5 (Keys 1–5, 0 to clear)">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <button
                      key={star}
                      type="button"
                      onClick={() => void handleRateActiveImage(star)}
                      className="p-0.5 cursor-pointer"
                      title={`Rate ${star} star${star === 1 ? '' : 's'} (Key ${star})`}
                    >
                      <Star
                        className={`w-4 h-4 ${
                          star <= activeImage.rating
                            ? 'fill-amber-400 text-amber-400'
                            : 'text-zinc-500 hover:text-amber-300'
                        }`}
                      />
                    </button>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={() => void handleToggleFavoriteActiveImage()}
                  className={`p-1.5 rounded-lg border cursor-pointer shrink-0 ${
                    activeImage.isFavorite
                      ? 'bg-rose-500/15 border-rose-500/40 text-rose-400'
                      : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:text-rose-300'
                  }`}
                  title={
                    (activeImage.seriesItems?.length || 0) > 1
                      ? 'Set as Series Poster (F)'
                      : 'Toggle Favorite (F)'
                  }
                >
                  <Heart className={`w-4 h-4 ${activeImage.isFavorite ? 'fill-rose-400' : ''}`} />
                </button>

                <button
                  type="button"
                  disabled={!hasPresetModels || isCreatingPreset}
                  onClick={() => void handleCreatePresetFromImage()}
                  className={`p-1.5 rounded-lg border shrink-0 transition-colors ${
                    !hasPresetModels
                      ? 'bg-zinc-950 border-zinc-800/70 text-zinc-600 cursor-not-allowed opacity-50'
                      : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:text-fuchsia-300 hover:border-fuchsia-500/50 cursor-pointer'
                  }`}
                  title={
                    !hasPresetModels
                      ? 'No Base Model or LoRAs found on this image'
                      : `Create Preset (${nextUserPresetName}) from this image's Base Model & LoRA(s)`
                  }
                >
                  {isCreatingPreset ? (
                    <Loader2 className="w-4 h-4 animate-spin text-fuchsia-400" />
                  ) : (
                    <BookmarkPlus className="w-4 h-4" />
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => void handleRejectActiveImage(true)}
                  className={`p-1.5 rounded-lg border cursor-pointer shrink-0 ${
                    activeImage.isRejected
                      ? 'bg-rose-500/20 border-rose-500/50 text-rose-400'
                      : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:text-rose-300'
                  }`}
                  title={
                    activeImage.isRejected
                      ? 'Restore from Rejected (X / Delete)'
                      : 'Reject Image & Advance (X / Delete)'
                  }
                >
                  <Trash2 className="w-4 h-4" />
                </button>

                <button
                  type="button"
                  disabled={isLoadingShareStatus || !civitaiShareStatus?.eligible}
                  onClick={() => {
                    if (civitaiShareStatus?.eligible) {
                      setShowCivitaiDraftModal(true);
                    }
                  }}
                  className={`p-1.5 rounded-lg border shrink-0 transition-colors ${
                    isLoadingShareStatus || !civitaiShareStatus?.eligible
                      ? 'bg-zinc-950 border-zinc-800/70 text-zinc-600 cursor-not-allowed opacity-45'
                      : (civitaiShareStatus.existingDrafts?.length || 0) > 0
                      ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/20 cursor-pointer'
                      : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:text-indigo-300 hover:border-indigo-500/50 cursor-pointer'
                  }`}
                  title={
                    isLoadingShareStatus
                      ? 'Checking Civitai draft sharing eligibility...'
                      : !civitaiShareStatus
                      ? 'Unable to verify Civitai sharing status'
                      : !civitaiShareStatus.eligible
                      ? civitaiShareStatus.reasons.join(' ')
                      : (civitaiShareStatus.existingDrafts?.length || 0) > 0
                      ? `Share on Civitai as Private Draft (${civitaiShareStatus.existingDrafts.length} draft(s) already created)`
                      : 'Share on Civitai as Private Draft'
                  }
                  aria-label="Share on Civitai as Private Draft"
                >
                  {isLoadingShareStatus ? (
                    <Loader2 className="w-4 h-4 animate-spin text-zinc-500" />
                  ) : (
                    <Share2 className="w-4 h-4" />
                  )}
                </button>

                {renderDependencyLabel(activeImage.dependencyStatus)}

                {activeImage.isRandomRoll && (
                  <span
                    title="Generated via Random Roll"
                    aria-label="Generated via Random Roll"
                    className="inline-flex items-center justify-center p-1.5 rounded-lg bg-indigo-500/15 border border-indigo-500/35 text-indigo-300 shrink-0"
                  >
                    <Dices className="w-3.5 h-3.5" />
                  </span>
                )}
              </div>

              <div className="relative flex items-center gap-1.5 sm:gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setShowShortcutsHelp((prev) => !prev)}
                  className={`p-1.5 rounded-lg border cursor-pointer shrink-0 transition-colors ${
                    showShortcutsHelp
                      ? 'bg-indigo-600/20 border-indigo-500/70 text-indigo-300'
                      : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:text-zinc-200'
                  }`}
                  title="Keyboard Shortcuts (?)"
                >
                  <Keyboard className="w-4 h-4" />
                </button>

                <button
                  type="button"
                  onClick={handleEnterSplitMode}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-zinc-950 border border-zinc-800 hover:border-indigo-500/60 text-zinc-200 hover:text-white text-xs font-medium cursor-pointer shrink-0 transition-colors"
                  title="Enter A/B Split-Screen Comparison"
                >
                  <Columns2 className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Compare</span>
                </button>

                <button
                  type="button"
                  onClick={onClose}
                  className="p-1.5 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-400 hover:text-zinc-100 cursor-pointer shrink-0"
                  title="Close Inspector (Esc)"
                >
                  <X className="w-4 h-4" />
                </button>

                {showShortcutsHelp && (
                  <div
                    onClick={(e) => e.stopPropagation()}
                    className="absolute right-0 top-11 w-64 rounded-xl bg-zinc-950 border border-zinc-700/80 shadow-2xl p-3 text-[11px] text-zinc-300 space-y-1.5 z-30"
                  >
                    <div className="flex items-center justify-between pb-1 border-b border-zinc-800">
                      <span className="font-display font-semibold text-zinc-100">Curation Shortcuts</span>
                      <span className="text-zinc-500 font-mono">?</span>
                    </div>
                    <div className="flex justify-between"><span>Rate 1–5 / Clear</span><span className="font-mono text-zinc-400">1–5 / 0</span></div>
                    <div className="flex justify-between"><span>Favorite / Poster</span><span className="font-mono text-zinc-400">F</span></div>
                    <div className="flex justify-between"><span>Reject & Next</span><span className="font-mono text-zinc-400">X / Del</span></div>
                    <div className="flex justify-between"><span>Toggle Loupe</span><span className="font-mono text-zinc-400">L</span></div>
                    <div className="flex justify-between"><span>Stack Mini Gallery</span><span className="font-mono text-zinc-400">S</span></div>
                    <div className="flex justify-between"><span>Fullscreen</span><span className="font-mono text-zinc-400">Space</span></div>
                    <div className="flex justify-between"><span>Next / Prev Card</span><span className="font-mono text-zinc-400">← / →</span></div>
                    <div className="flex justify-between"><span>Next / Prev Stack Step</span><span className="font-mono text-zinc-400">[ / ]</span></div>
                    <div className="flex justify-between"><span>Close / Exit</span><span className="font-mono text-zinc-400">Esc</span></div>
                  </div>
                )}
              </div>
            </div>

            {/* Inspector Body (independent scroll container) */}
            <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-4 sm:p-5 pb-8 space-y-5 text-xs min-w-0">
              <InspectorCharacterSection
                activeImage={activeImage}
                characters={characters}
                onFilterByCharacter={onFilterByCharacter}
                onClose={onClose}
                onRefreshDetail={(id) => refreshActiveDetail(id)}
                onUpdated={onUpdated}
              />

              <InspectorPositivePromptSection
                activeImage={activeImage}
                editablePositivePrompt={editablePositivePrompt}
                editableLoras={editableLoras}
                onChangeEditablePositivePrompt={setEditablePositivePrompt}
                onReusePrompt={onReusePrompt}
              />

              <InspectorWorkflowSection
                currentMegapixels={currentMegapixels}
                upscaleTargetMp={upscaleTargetMp}
                onChangeUpscaleTargetMp={setUpscaleTargetMp}
                estimatedUpscaleDims={estimatedUpscaleDims}
                isRunningWorkflow={isRunningWorkflow}
                isUpscalingImage={isUpscalingImage}
                reproStatusMsg={reproStatusMsg}
                reproStatusIsError={reproStatusIsError}
                onUpscaleImage={handleUpscaleImage}
              />

              <SeriesIterationsStrip
                items={activeImage.seriesItems || []}
                activeImageId={activeImage.id}
                activeImage={activeImage}
                seriesKind={activeImage.seriesKind}
                pendingGhosts={matchingPendingGhosts}
                onSelectIteration={(nextId) => setSelectedIterationId(nextId)}
                onContinueConversation={
                  onOpenConversation && !activeImage.isUploadedReference
                    ? () => onOpenConversation(activeImage)
                    : undefined
                }
                onOpenMiniGallery={() => setShowSeriesMiniGallery(true)}
                onCancelGhost={onCancelGhost}
              />

              <InspectorPromptAndParamsSection
                activeImage={activeImage}
                editableLoras={editableLoras}
                onChangeEditableLoras={setEditableLoras}
                editableGenParams={editableGenParams}
                onChangeEditableGenParams={setEditableGenParams}
                loras={loras}
                models={models}
                pillTypeSettings={pillTypeSettings}
                onFilterByLora={onFilterByLora}
                onClose={onClose}
              />

              <InspectorTagsAndNotesSection
                activeImage={activeImage}
                detailData={detailData}
                onUpdateVisualTags={(visualTags) =>
                  setDetailData((prev) =>
                    prev
                      ? {
                          ...prev,
                          image: prev.image ? { ...prev.image, visualTags } : prev.image,
                        }
                      : prev
                  )
                }
                visualTaggerEnabled={visualTaggerEnabled}
                collections={collections}
                notes={notes}
                onChangeNotes={setNotes}
                onSaveNotes={handleSaveNotes}
                onFilterByVisualKeyword={onFilterByVisualKeyword}
                onClose={onClose}
                onRefreshDetail={(id) => refreshActiveDetail(id)}
                onUpdated={onUpdated}
              />
            </div>

            {/* Pinned Bottom Full-Width Run Workflow Footer */}
            {(activeImage.hasVisualWorkflow || activeImage.hasApiWorkflow) && (
              <div className="shrink-0 z-10 bg-zinc-900/95 backdrop-blur-xs border-t border-zinc-800 px-4 sm:px-5 py-3">
                <button
                  type="button"
                  onClick={handleRunWorkflow}
                  disabled={isRunningWorkflow || isUpscalingImage}
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-semibold rounded-lg cursor-pointer transition-colors shadow-lg shadow-indigo-950/50"
                >
                  {isRunningWorkflow ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Play className="w-4 h-4" />
                  )}
                  <span>{isRunningWorkflow ? 'Running...' : 'Run Workflow'}</span>
                </button>
              </div>
            )}
          </aside>
        </>
      )}

      {showSeriesMiniGallery && !isSplitMode && (
        <SeriesMiniGalleryModal
          items={
            activeImage.seriesItems && activeImage.seriesItems.length > 0
              ? activeImage.seriesItems
              : [
                  {
                    seriesId: activeImage.seriesId || 0,
                    imageId: activeImage.id,
                    stepOrder: 0,
                    filename: activeImage.filename,
                    thumbnailUrl: activeImage.thumbnailUrl,
                    originalUrl: activeImage.originalUrl,
                    width: activeImage.width,
                    height: activeImage.height,
                    isFavorite: activeImage.isFavorite,
                    rating: activeImage.rating,
                    createdAt: activeImage.createdAt,
                    chatSnapshot: activeImage.chatSnapshot || [],
                  },
                ]
          }
          activeImageId={activeImage.id}
          seriesKind={activeImage.seriesKind}
          pendingGhosts={matchingPendingGhosts}
          onCancelGhost={onCancelGhost}
          onClose={() => setShowSeriesMiniGallery(false)}
          onSelectIteration={(nextId) => setSelectedIterationId(nextId)}
          onToggleFavorite={async (targetId, nextFavorite) => {
            await api.updateImageAnnotations(targetId, { isFavorite: nextFavorite });
            refreshActiveDetail(selectedIterationId);
            onUpdated();
          }}
          onRejectIteration={async (targetId) => {
            const currentItems = activeImage.seriesItems || [];
            const remaining = currentItems.filter((it) => it.imageId !== targetId);
            await api.updateImageAnnotations(targetId, { isRejected: true });
            const nextId =
              targetId === selectedIterationId && remaining.length > 0
                ? remaining[remaining.length - 1].imageId
                : selectedIterationId;
            if (nextId !== selectedIterationId) {
              setSelectedIterationId(nextId);
            } else {
              refreshActiveDetail(nextId);
            }
            onUpdated();
          }}
          onOpenConversationForStep={
            onOpenConversation
              ? async (stepImageId) => {
                  let targetRecord = activeImage;
                  if (stepImageId !== activeImage.id) {
                    const res = await api.getImageDetail(stepImageId, seriesContextId);
                    targetRecord = res.image;
                  }
                  setShowSeriesMiniGallery(false);
                  onOpenConversation(targetRecord);
                }
              : undefined
          }
        />
      )}

      {showComparePicker && (
        <ComparePickerModal
          targetSlot="B"
          currentSlotAId={activeImage.id}
          currentSlotBId={compareImage?.id ?? null}
          initialImages={allImages}
          characters={characters}
          loras={loras}
          onSelectImage={(pickedImg) => {
            setCompareDetailImage(pickedImg);
            setCompareSelection({
              imageId: pickedImg.id,
              seriesId: pickedImg.seriesId ?? null,
            });
            setShowComparePicker(false);
          }}
          onClose={() => setShowComparePicker(false)}
        />
      )}

      {showCivitaiDraftModal && civitaiShareStatus?.eligible && (
        <CivitaiDraftModal
          image={activeImage}
          eligibility={civitaiShareStatus}
          onClose={() => setShowCivitaiDraftModal(false)}
          onDraftCreated={() => {
            void refreshCivitaiShareStatus();
          }}
          onPushToast={onPushToast}
        />
      )}

      {/* Floating Curation Feedback Pill (visible in Inspector and Fullscreen Lightbox) */}
      {curationFeedback && (
        <div
          onClick={(e) => e.stopPropagation()}
          className={`fixed bottom-14 left-1/2 -translate-x-1/2 z-[65] inline-flex items-center gap-2.5 px-3.5 py-1.5 rounded-full border shadow-2xl backdrop-blur-md text-xs font-medium ${
            curationFeedback.tone === 'warning'
              ? 'bg-rose-950/90 border-rose-500/60 text-rose-100'
              : curationFeedback.tone === 'success'
              ? 'bg-emerald-950/90 border-emerald-500/60 text-emerald-100'
              : 'bg-zinc-900/95 border-zinc-700/80 text-zinc-100'
          }`}
        >
          <span>{curationFeedback.text}</span>
          {curationFeedback.undoImageId !== undefined && (
            <button
              type="button"
              onClick={() =>
                void handleUndoReject(
                  curationFeedback.undoImageId!,
                  curationFeedback.undoWasStackStep
                )
              }
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/15 hover:bg-white/25 text-white font-semibold cursor-pointer transition-colors"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Undo</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
};
