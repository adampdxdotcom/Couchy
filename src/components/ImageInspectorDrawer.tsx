import React from 'react';
import { Columns2, Heart, Keyboard, RotateCcw, Star, Trash2, X } from 'lucide-react';
import { api } from '../api/client.ts';
import { renderDependencyLabel } from './GalleryGridView.tsx';
import { SeriesIterationsStrip } from './inspector/SeriesIterationsStrip.tsx';
import { SeriesMiniGalleryModal } from './inspector/SeriesMiniGalleryModal.tsx';
import { SplitCompareView } from './inspector/SplitCompareView.tsx';
import { ComparePickerModal } from './inspector/ComparePickerModal.tsx';
import { InspectorSingleViewer } from './inspector/InspectorSingleViewer.tsx';
import { InspectorCharacterSection } from './inspector/InspectorCharacterSection.tsx';
import { InspectorWorkflowSection } from './inspector/InspectorWorkflowSection.tsx';
import { InspectorPromptAndParamsSection } from './inspector/InspectorPromptAndParamsSection.tsx';
import { InspectorTagsAndNotesSection } from './inspector/InspectorTagsAndNotesSection.tsx';
import { useInspectorState } from './inspector/useInspectorState.ts';
import type {
  CharacterProfile,
  ImageRecord,
  LoraExplorerItem,
  QueuedGhostCardItem,
} from '../shared/types.ts';

interface ImageInspectorDrawerProps {
  image: ImageRecord;
  allImages?: ImageRecord[];
  loras?: LoraExplorerItem[];
  ghostItems?: QueuedGhostCardItem[];
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  onUpdated: () => void | Promise<void>;
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
}

/**
 * Full-Screen Lightbox & Comprehensive Image Detail Inspector Coordinator.
 */
export const ImageInspectorDrawer: React.FC<ImageInspectorDrawerProps> = ({
  image,
  allImages = [],
  loras = [],
  ghostItems = [],
  onClose,
  onPrev,
  onNext,
  onUpdated,
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
            className={`w-full max-w-full lg:w-[500px] xl:w-[540px] bg-zinc-900 border-l border-zinc-800 flex flex-col h-[55vh] lg:h-full overflow-y-auto overflow-x-hidden ${
              isFullScreen ? 'hidden' : ''
            }`}
          >
            {/* Inspector Header */}
            <div className="sticky top-0 z-10 bg-zinc-900/95 backdrop-blur-xs border-b border-zinc-800 px-4 sm:px-5 py-3.5 flex items-center justify-between gap-2 sm:gap-3">
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

                {renderDependencyLabel(activeImage.dependencyStatus)}
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

            {/* Inspector Body */}
            <div className="p-4 sm:p-5 pb-20 space-y-5 text-xs min-w-0">
              <InspectorCharacterSection
                activeImage={activeImage}
                characters={characters}
                onFilterByCharacter={onFilterByCharacter}
                onClose={onClose}
                onRefreshDetail={(id) => refreshActiveDetail(id)}
                onUpdated={onUpdated}
              />

              <InspectorWorkflowSection
                activeImage={activeImage}
                currentMegapixels={currentMegapixels}
                upscaleTargetMp={upscaleTargetMp}
                onChangeUpscaleTargetMp={setUpscaleTargetMp}
                estimatedUpscaleDims={estimatedUpscaleDims}
                isRunningWorkflow={isRunningWorkflow}
                isUpscalingImage={isUpscalingImage}
                reproStatusMsg={reproStatusMsg}
                reproStatusIsError={reproStatusIsError}
                onRunWorkflow={handleRunWorkflow}
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
              />

              <InspectorPromptAndParamsSection
                activeImage={activeImage}
                editablePositivePrompt={editablePositivePrompt}
                onChangeEditablePositivePrompt={setEditablePositivePrompt}
                onFilterByLora={onFilterByLora}
                onReusePrompt={onReusePrompt}
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
