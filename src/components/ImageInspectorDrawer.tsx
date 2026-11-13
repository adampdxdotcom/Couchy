import React, { useEffect, useState } from 'react';
import {
  X,
  Star,
  Heart,
  Download,
  Copy,
  Check,
  Play,
  Loader2,
  Sparkles,
  CheckCircle2,
  XCircle,
  ChevronLeft,
  ChevronRight,
  Minimize2,
  RefreshCw,
  Trash2,
  ArrowUpRight,
  User,
} from 'lucide-react';
import { api } from '../api/client.ts';
import { formatBytes } from '../shared/utils.ts';
import { renderDependencyLabel } from './GalleryGridView.tsx';
import { SeriesIterationsStrip } from './inspector/SeriesIterationsStrip.tsx';
import type {
  CharacterProfile,
  ImageRecord,
} from '../shared/types.ts';

interface ImageInspectorDrawerProps {
  image: ImageRecord;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  onUpdated: () => void;
  onOpenConversation?: (image: ImageRecord) => void;
  characters: CharacterProfile[];
  collections: { id: number; name: string }[];
  onFilterByLora: (loraFilename: string) => void;
  onFilterByCharacter: (characterId: number) => void;
  visualTaggerEnabled?: boolean;
  onFilterByVisualKeyword?: (keyword: string) => void;
}

/**
 * Full-Screen Lightbox & Comprehensive Image Detail Inspector with Workflow Execution.
 */
export const ImageInspectorDrawer: React.FC<ImageInspectorDrawerProps> = ({
  image,
  onClose,
  onPrev,
  onNext,
  onUpdated,
  onOpenConversation,
  characters,
  collections,
  onFilterByLora,
  onFilterByCharacter,
  visualTaggerEnabled = false,
  onFilterByVisualKeyword,
}) => {
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [selectedIterationId, setSelectedIterationId] = useState<number>(image.id);
  const [detailData, setDetailData] = useState<{
    image?: ImageRecord;
    rawMetadata: Record<string, string>;
    visualWorkflowJson: string | null;
    apiWorkflowJson: string | null;
  } | null>(null);
  const [editablePositivePrompt, setEditablePositivePrompt] = useState(image.positivePrompt || '');
  const [notes, setNotes] = useState(image.notes);
  const [newTag, setNewTag] = useState('');
  const [selectedCharId, setSelectedCharId] = useState('');
  const [charAppearance, setCharAppearance] = useState('');
  const [selectedColId, setSelectedColId] = useState('');
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [isRescanningVisualTags, setIsRescanningVisualTags] = useState(false);

  // Workflow Run & Upscale state
  const [isRunningWorkflow, setIsRunningWorkflow] = useState(false);
  const [isUpscalingImage, setIsUpscalingImage] = useState(false);
  const [reproStatusMsg, setReproStatusMsg] = useState<string | null>(null);
  const [reproStatusIsError, setReproStatusIsError] = useState(false);
  const [showRawWorkflow, setShowRawWorkflow] = useState(false);

  const activeImage = detailData?.image || image;
  const seriesContextId = image.seriesId ?? detailData?.image?.seriesId ?? null;
  const currentMegapixels =
    activeImage.width > 0 && activeImage.height > 0
      ? (activeImage.width * activeImage.height) / 1_000_000
      : 1.0;

  const getSuggestedUpscaleMp = (mp: number): number => {
    const doubled = Math.round(mp * 4) / 2;
    return Math.max(4.0, Math.min(10.0, doubled));
  };

  const [upscaleTargetMp, setUpscaleTargetMp] = useState<number>(() =>
    getSuggestedUpscaleMp(currentMegapixels)
  );

  // Sync selectedIterationId when outer image prop changes
  useEffect(() => {
    setSelectedIterationId(image.id);
  }, [image.id]);

  const refreshActiveDetail = (targetId = selectedIterationId) => {
    api
      .getImageDetail(targetId, seriesContextId)
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
  };

  useEffect(() => {
    setReproStatusMsg(null);
    setReproStatusIsError(false);
    refreshActiveDetail(selectedIterationId);
  }, [selectedIterationId, image.id, image.seriesId]);

  // Keyboard navigation (Escape, Left, Right)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName)) return;
      if (e.key === 'Escape') {
        if (isFullScreen) {
          setIsFullScreen(false);
        } else {
          onClose();
        }
      }
      if (e.key === 'ArrowLeft' && onPrev) onPrev();
      if (e.key === 'ArrowRight' && onNext) onNext();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose, onPrev, onNext, isFullScreen]);

  const copyText = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(label);
    setTimeout(() => setCopiedField(null), 1500);
  };

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

  return (
    <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-sm flex flex-col lg:flex-row overflow-hidden">
      {/* Left Pane: Full-Resolution Image Viewer / Lightbox */}
      <div
        onClick={() => {
          if (isFullScreen) setIsFullScreen(false);
        }}
        className={`relative bg-zinc-950 flex items-center justify-center select-none overflow-hidden transition-all duration-200 ${
          isFullScreen
            ? 'fixed inset-0 z-50 p-2 sm:p-6 pb-14 sm:pb-14 bg-black/95 cursor-zoom-out'
            : 'flex-1 p-4 pb-14 lg:pb-4'
        }`}
      >
        {/* Top-Right Exit Full-Screen Pill (shown only when expanded via image click) */}
        {isFullScreen && (
          <div className="absolute top-4 right-4 z-20 flex items-center gap-2">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setIsFullScreen(false);
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-zinc-900/90 hover:bg-zinc-800 text-zinc-100 border border-zinc-700/80 shadow-2xl backdrop-blur-md text-xs font-medium cursor-pointer"
              title="Exit Full Screen (Esc)"
            >
              <Minimize2 className="w-4 h-4 text-indigo-400" />
              <span>Exit Full Screen</span>
              <span className="text-zinc-500 text-[10px] hidden sm:inline ml-0.5 font-mono">ESC</span>
            </button>
          </div>
        )}

        {/* Previous Image Arrow */}
        {onPrev && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onPrev();
            }}
            className={`absolute left-3 sm:left-4 top-1/2 -translate-y-1/2 rounded-full bg-zinc-900/85 hover:bg-zinc-800 text-zinc-200 border border-zinc-700/60 cursor-pointer z-10 transition-colors shadow-lg ${
              isFullScreen ? 'p-3 sm:p-3.5' : 'p-2.5'
            }`}
            title="Previous Image (Left Arrow)"
          >
            <ChevronLeft className={isFullScreen ? 'w-6 h-6' : 'w-5 h-5'} />
          </button>
        )}

        {/* Centered Image */}
        <img
          src={activeImage.originalUrl}
          alt={activeImage.filename}
          referrerPolicy="no-referrer"
          onClick={(e) => {
            e.stopPropagation();
            setIsFullScreen((prev) => !prev);
          }}
          className={`max-w-full max-h-full object-contain rounded transition-all duration-200 ${
            isFullScreen ? 'cursor-zoom-out' : 'cursor-zoom-in active:scale-[0.99]'
          }`}
          title={isFullScreen ? 'Tap or click to exit full screen' : 'Tap or click to expand full screen'}
        />

        {/* Next Image Arrow */}
        {onNext && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onNext();
            }}
            className={`absolute right-3 sm:right-4 top-1/2 -translate-y-1/2 rounded-full bg-zinc-900/85 hover:bg-zinc-800 text-zinc-200 border border-zinc-700/60 cursor-pointer z-10 transition-colors shadow-lg ${
              isFullScreen ? 'p-3 sm:p-3.5' : 'p-2.5'
            }`}
            title="Next Image (Right Arrow)"
          >
            <ChevronRight className={isFullScreen ? 'w-6 h-6' : 'w-5 h-5'} />
          </button>
        )}

        {/* Bottom Metadata & Download Bar (Docked to bottom edge to never overlap image) */}
        <div
          onClick={(e) => e.stopPropagation()}
          className="fixed bottom-0 inset-x-0 h-11 bg-zinc-950/95 border-t border-zinc-800/80 px-3 sm:px-4 flex items-center justify-between gap-2 text-xs text-zinc-400 backdrop-blur-md z-30 shadow-lg select-none"
        >
          <div className="flex items-center gap-1.5 sm:gap-2 font-mono tabular-nums truncate text-xs">
            <span className="text-zinc-200 font-sans font-medium truncate max-w-[130px] xs:max-w-[180px] sm:max-w-xs">
              {activeImage.filename}
            </span>
            <span aria-hidden="true" className="text-zinc-600">·</span>
            <span className="shrink-0">{activeImage.width}×{activeImage.height}</span>
            <span aria-hidden="true" className="text-zinc-600 hidden sm:inline">·</span>
            <span className="hidden sm:inline shrink-0">{formatBytes(activeImage.fileSize)}</span>
            <span aria-hidden="true" className="text-zinc-600 hidden md:inline">·</span>
            <span className="hidden md:inline text-zinc-500 font-mono shrink-0">
              SHA256: {activeImage.contentHash.slice(0, 10)}…
            </span>
          </div>
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            {isFullScreen && (
              <span className="text-[11px] text-zinc-500 hidden md:inline">
                Tap image or press ESC to exit full screen
              </span>
            )}
            <a
              href={`/api/images/${activeImage.id}/file?download=1`}
              className="inline-flex items-center gap-1.5 text-indigo-400 hover:text-indigo-300 font-medium px-2 py-1 rounded hover:bg-zinc-800/80 transition-colors shrink-0"
              title="Download original unchanged file"
            >
              <Download className="w-3.5 h-3.5" />
              <span className="hidden xs:inline sm:inline">Download</span>
            </a>
          </div>
        </div>
      </div>

      {/* Right Pane: Comprehensive Metadata, Character & Workflow Reproduction Inspector */}
      <aside
        className={`w-full max-w-full lg:w-[500px] xl:w-[540px] bg-zinc-900 border-l border-zinc-800 flex flex-col h-[55vh] lg:h-full overflow-y-auto overflow-x-hidden ${
          isFullScreen ? 'hidden' : ''
        }`}
      >
        {/* Inspector Header */}
        <div className="sticky top-0 z-10 bg-zinc-900/95 backdrop-blur-xs border-b border-zinc-800 px-4 sm:px-5 py-3.5 flex items-center justify-between gap-2 sm:gap-3">
          <div className="flex flex-wrap items-center gap-2 sm:gap-3 min-w-0">
            {/* Rating Stars */}
            <div className="flex items-center gap-1 shrink-0">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  onClick={async () => {
                    await api.updateImageAnnotations(activeImage.id, {
                      rating: activeImage.rating === star ? 0 : star,
                    });
                    refreshActiveDetail(activeImage.id);
                    onUpdated();
                  }}
                  className="p-0.5 cursor-pointer"
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
              onClick={async () => {
                await api.updateImageAnnotations(activeImage.id, {
                  isFavorite: !activeImage.isFavorite,
                });
                refreshActiveDetail(activeImage.id);
                onUpdated();
              }}
              className={`p-1.5 rounded-lg border cursor-pointer shrink-0 ${
                activeImage.isFavorite
                  ? 'bg-rose-500/15 border-rose-500/40 text-rose-400'
                  : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:text-rose-300'
              }`}
              title={
                (activeImage.seriesItems?.length || 0) > 1
                  ? 'Set as Series Poster (only one image in a series can be favorited)'
                  : 'Favorite'
              }
            >
              <Heart className={`w-4 h-4 ${activeImage.isFavorite ? 'fill-rose-400' : ''}`} />
            </button>

            <button
              type="button"
              onClick={async () => {
                await api.updateImageAnnotations(activeImage.id, {
                  isRejected: !activeImage.isRejected,
                });
                refreshActiveDetail(activeImage.id);
                onUpdated();
              }}
              className={`p-1.5 rounded-lg border cursor-pointer shrink-0 ${
                activeImage.isRejected
                  ? 'bg-rose-500/20 border-rose-500/50 text-rose-400'
                  : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:text-rose-300'
              }`}
              title={activeImage.isRejected ? 'Restore from Rejected' : 'Reject Image (Hide from Library)'}
            >
              <Trash2 className="w-4 h-4" />
            </button>

            {renderDependencyLabel(activeImage.dependencyStatus)}
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-400 hover:text-zinc-100 cursor-pointer shrink-0"
            title="Close Inspector (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Inspector Body */}
        <div className="p-4 sm:p-5 space-y-5 text-xs min-w-0">
          {/* 1. Assigned Character (Portrait + Larger Name) */}
          <div className="space-y-2.5 min-w-0">
            <h4 className="text-[11px] font-display font-semibold text-zinc-400 uppercase tracking-wider">
              Assigned Character
            </h4>

            {activeImage.characters.length === 0 ? (
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 pt-0.5">
                <select
                  value={selectedCharId}
                  onChange={(e) => setSelectedCharId(e.target.value)}
                  className="w-full sm:flex-1 min-w-0 px-2.5 py-2 sm:py-1.5 bg-zinc-950 border border-zinc-800 rounded text-zinc-200"
                >
                  <option value="">Assign Character...</option>
                  {characters.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <div className="flex items-center gap-2 w-full sm:w-auto min-w-0">
                  <input
                    type="text"
                    value={charAppearance}
                    onChange={(e) => setCharAppearance(e.target.value)}
                    placeholder="Outfit/Variant (optional)"
                    className="flex-1 sm:w-36 min-w-0 px-2.5 py-2 sm:py-1.5 bg-zinc-950 border border-zinc-800 rounded text-zinc-200"
                  />
                  <button
                    type="button"
                    onClick={async () => {
                      if (!selectedCharId) return;
                      await api.updateCharacterAssociationStatus({
                        imageId: activeImage.id,
                        characterId: Number(selectedCharId),
                        status: 'confirmed',
                        appearanceLabel: charAppearance.trim() || undefined,
                      });
                      setSelectedCharId('');
                      setCharAppearance('');
                      refreshActiveDetail(activeImage.id);
                      onUpdated();
                    }}
                    className="px-3.5 py-2 sm:py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded cursor-pointer shrink-0"
                  >
                    Add
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                {activeImage.characters.map((ch) => {
                  const charProfile = characters.find((c) => c.id === ch.characterId);
                  return (
                    <div
                      key={ch.id}
                      className="flex items-center justify-between gap-3 bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2.5 min-w-0"
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <button
                          type="button"
                          onClick={() => {
                            onFilterByCharacter(ch.characterId);
                            onClose();
                          }}
                          className="w-12 h-12 rounded-lg overflow-hidden bg-zinc-900 border border-zinc-800 shrink-0 flex items-center justify-center cursor-pointer hover:border-indigo-500/60 transition-colors"
                          title={`Filter gallery by ${ch.characterName}`}
                        >
                          {charProfile?.portraitThumbnailUrl ? (
                            <img
                              src={charProfile.portraitThumbnailUrl}
                              alt={ch.characterName}
                              referrerPolicy="no-referrer"
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <User className="w-5 h-5 text-zinc-600" />
                          )}
                        </button>

                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-baseline gap-1.5">
                            <button
                              type="button"
                              onClick={() => {
                                onFilterByCharacter(ch.characterId);
                                onClose();
                              }}
                              className="text-base font-display font-semibold text-zinc-100 hover:text-indigo-400 cursor-pointer truncate leading-tight"
                            >
                              {ch.characterName}
                            </button>
                            {ch.appearanceLabel && (
                              <span className="text-xs text-zinc-400">· {ch.appearanceLabel}</span>
                            )}
                            {ch.status === 'suggested' && (
                              <span className="inline-flex items-center gap-1 text-[11px] text-amber-400">
                                <Sparkles className="w-3 h-3 shrink-0" />
                                <span>Suggested ({Math.round(ch.confidence * 100)}%)</span>
                              </span>
                            )}
                          </div>
                          {ch.matchReason && (
                            <p className="text-[11px] text-zinc-500 truncate mt-0.5">
                              {ch.matchReason}
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        {ch.status === 'suggested' ? (
                          <>
                            <button
                              type="button"
                              onClick={async () => {
                                await api.updateCharacterAssociationStatus({
                                  imageId: activeImage.id,
                                  characterId: ch.characterId,
                                  status: 'confirmed',
                                });
                                refreshActiveDetail(activeImage.id);
                                onUpdated();
                              }}
                              className="inline-flex items-center gap-1 px-2 py-1 bg-emerald-600/20 border border-emerald-500/40 text-emerald-300 rounded hover:bg-emerald-600/30 cursor-pointer"
                              title="Confirm Character Suggestion"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span>Confirm</span>
                            </button>
                            <button
                              type="button"
                              onClick={async () => {
                                await api.updateCharacterAssociationStatus({
                                  imageId: activeImage.id,
                                  characterId: ch.characterId,
                                  status: 'rejected',
                                });
                                refreshActiveDetail(activeImage.id);
                                onUpdated();
                              }}
                              className="inline-flex items-center gap-1 px-2 py-1 bg-rose-600/20 border border-rose-500/40 text-rose-300 rounded hover:bg-rose-600/30 cursor-pointer"
                              title="Reject Suggestion Permanently"
                            >
                              <XCircle className="w-3.5 h-3.5" />
                              <span>Reject</span>
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            onClick={async () => {
                              await api.updateCharacterAssociationStatus({
                                imageId: activeImage.id,
                                characterId: ch.characterId,
                                status: 'remove',
                              });
                              refreshActiveDetail(activeImage.id);
                              onUpdated();
                            }}
                            className="text-zinc-500 hover:text-rose-400 px-1.5 py-0.5 cursor-pointer"
                          >
                            Unlink
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* 2. Workflow & Reproducibility */}
          <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-4 space-y-3 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <h4 className="text-sm font-display font-semibold text-zinc-100">
                  Workflow &amp; Reproducibility
                </h4>
                <p className="text-zinc-400 mt-0.5 text-[11px]">
                  Visual Graph: {activeImage.hasVisualWorkflow ? 'Embedded' : 'None'} · API Graph:{' '}
                  {activeImage.hasApiWorkflow ? 'Embedded' : 'None'} · Current:{' '}
                  <span className="font-mono text-zinc-300 tabular-nums">
                    {currentMegapixels.toFixed(1)} MP
                  </span>
                </p>
              </div>
              {(activeImage.hasVisualWorkflow || activeImage.hasApiWorkflow) && (
                <button
                  type="button"
                  onClick={handleRunWorkflow}
                  disabled={isRunningWorkflow || isUpscalingImage}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-medium rounded-lg cursor-pointer shrink-0 transition-colors"
                >
                  {isRunningWorkflow ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Play className="w-3.5 h-3.5" />
                  )}
                  <span>{isRunningWorkflow ? 'Running...' : 'Run Workflow'}</span>
                </button>
              )}
            </div>

            {/* Upscale Existing Image Control */}
            <div className="pt-3 border-t border-zinc-800/80 space-y-2">
              <div className="flex items-center justify-between gap-2 text-[11px]">
                <span className="font-display font-semibold text-zinc-200 uppercase tracking-wider">
                  Upscale Image
                </span>
                <span className="font-mono text-zinc-300 tabular-nums">
                  {currentMegapixels.toFixed(1)} MP &rarr;{' '}
                  <span className="text-indigo-300 font-semibold">
                    {upscaleTargetMp.toFixed(1)} MP
                  </span>{' '}
                  <span className="text-zinc-500">
                    (~{estimatedUpscaleDims.estW}×{estimatedUpscaleDims.estH})
                  </span>
                </span>
              </div>

              <div className="flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <input
                    type="range"
                    min={1.0}
                    max={10.0}
                    step={0.5}
                    value={upscaleTargetMp}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value);
                      if (Number.isFinite(val)) {
                        setUpscaleTargetMp(Math.max(1.0, Math.min(10.0, Math.round(val * 2) / 2)));
                      }
                    }}
                    className="w-full accent-indigo-500 cursor-pointer"
                  />
                  <div className="flex items-center justify-between text-[10px] font-mono text-zinc-500 mt-0.5">
                    <span>1.0 MP</span>
                    {currentMegapixels > 3.0 && (
                      <span className="text-amber-300/90">
                        Source &gt;3MP auto-clamped to 3MP before 4&times; ESRGAN
                      </span>
                    )}
                    <span>10.0 MP</span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleUpscaleImage}
                  disabled={isUpscalingImage || isRunningWorkflow}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 disabled:opacity-50 text-zinc-100 font-medium rounded-lg cursor-pointer shrink-0 transition-colors"
                  title="Send this image through the internal 4x-ESRGAN upscale workflow"
                >
                  {isUpscalingImage ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <ArrowUpRight className="w-3.5 h-3.5 text-indigo-400" />
                  )}
                  <span>{isUpscalingImage ? 'Upscaling...' : 'Upscale'}</span>
                </button>
              </div>
            </div>

            {reproStatusMsg && (
              <p
                className={`font-mono break-words text-[11px] ${
                  reproStatusIsError ? 'text-rose-400' : 'text-emerald-400'
                }`}
              >
                {reproStatusMsg}
              </p>
            )}
          </div>

          {/* 3. Series Preview (when stacked iterations exist) */}
          <SeriesIterationsStrip
            items={activeImage.seriesItems || []}
            activeImageId={activeImage.id}
            onSelectIteration={(nextId) => setSelectedIterationId(nextId)}
            onContinueConversation={
              onOpenConversation ? () => onOpenConversation(activeImage) : undefined
            }
          />

          {/* 4. Positive & Negative Prompts with Provenance */}
          <div className="space-y-3 pt-1 border-t border-zinc-800/80">
            <div className="space-y-1.5 pt-2">
              <div className="flex items-center justify-between gap-2">
                <label
                  htmlFor="inspector-positive-prompt"
                  className="font-display font-semibold text-zinc-200 uppercase tracking-wider"
                >
                  Positive Prompt
                </label>
                <div className="flex items-center gap-2">
                  {activeImage.provenance.positivePrompt && (
                    <span className="text-[11px] text-zinc-400">
                      Source: {activeImage.provenance.positivePrompt}
                    </span>
                  )}
                  {editablePositivePrompt.trim().length > 0 && (
                    <button
                      type="button"
                      onClick={() => copyText(editablePositivePrompt, 'pos')}
                      className="inline-flex items-center gap-1 text-indigo-400 hover:text-indigo-300 cursor-pointer"
                    >
                      {copiedField === 'pos' ? (
                        <Check className="w-3.5 h-3.5" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                      <span>{copiedField === 'pos' ? 'Copied' : 'Copy'}</span>
                    </button>
                  )}
                </div>
              </div>
              <textarea
                id="inspector-positive-prompt"
                rows={4}
                value={editablePositivePrompt}
                onChange={(e) => setEditablePositivePrompt(e.target.value)}
                placeholder="Edit positive prompt to send with Run Workflow..."
                className="w-full bg-zinc-950 border border-zinc-800 focus:border-indigo-500 focus:outline-none rounded-lg p-3 text-zinc-200 leading-relaxed resize-y"
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="font-display font-semibold text-zinc-200 uppercase tracking-wider">
                  Negative Prompt
                </span>
                {activeImage.negativePrompt && (
                  <button
                    type="button"
                    onClick={() => copyText(activeImage.negativePrompt!, 'neg')}
                    className="inline-flex items-center gap-1 text-indigo-400 hover:text-indigo-300 cursor-pointer"
                  >
                    {copiedField === 'neg' ? (
                      <Check className="w-3.5 h-3.5" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                    <span>{copiedField === 'neg' ? 'Copied' : 'Copy'}</span>
                  </button>
                )}
              </div>
              <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-3 text-zinc-300 leading-relaxed whitespace-pre-wrap max-h-28 overflow-y-auto">
                {activeImage.negativePrompt || (
                  <span className="text-zinc-500 italic">None</span>
                )}
              </div>
            </div>
          </div>

          {/* 5. Generation Parameters & Checkpoint */}
          <div className="space-y-2">
            <h4 className="font-display font-semibold text-zinc-200 uppercase tracking-wider">
              Generation Parameters
            </h4>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 font-mono tabular-nums">
              <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-2.5">
                <span className="block text-[10px] font-sans text-zinc-400">Checkpoint</span>
                <span className="text-zinc-100 truncate block" title={activeImage.checkpointName || ''}>
                  {activeImage.checkpointName || '—'}
                </span>
              </div>
              <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-2.5">
                <span className="block text-[10px] font-sans text-zinc-400">VAE</span>
                <span className="text-zinc-100 truncate block">{activeImage.vaeName || 'Baked / Default'}</span>
              </div>
              <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-2.5">
                <span className="block text-[10px] font-sans text-zinc-400">Seed</span>
                <span className="text-zinc-100 truncate block">{activeImage.seed ?? '—'}</span>
              </div>
              <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-2.5">
                <span className="block text-[10px] font-sans text-zinc-400">Steps / CFG</span>
                <span className="text-zinc-100">
                  {activeImage.steps ?? '—'} / {activeImage.cfg ?? '—'}
                </span>
              </div>
              <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-2.5">
                <span className="block text-[10px] font-sans text-zinc-400">Sampler / Scheduler</span>
                <span className="text-zinc-100 truncate block">
                  {activeImage.sampler || '—'} · {activeImage.scheduler || '—'}
                </span>
              </div>
              <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-2.5">
                <span className="block text-[10px] font-sans text-zinc-400">Denoise / Batch</span>
                <span className="text-zinc-100">
                  {activeImage.denoise ?? '1.0'} · Batch {activeImage.batchSize ?? 1}
                </span>
              </div>
            </div>

            {activeImage.missingFields.length > 0 && (
              <p className="text-[11px] text-zinc-500">
                Unextracted fields: {activeImage.missingFields.join(' · ')}
              </p>
            )}
          </div>

          {/* 6. Extracted LoRA Chain (Model & CLIP Strengths) */}
          <div className="space-y-2">
            <h4 className="font-display font-semibold text-zinc-200 uppercase tracking-wider">
              Extracted LoRAs ({activeImage.loras.length})
            </h4>
            {activeImage.loras.length === 0 ? (
              <p className="text-zinc-500">No LoRAs detected in workflow or metadata.</p>
            ) : (
              <div className="space-y-1.5">
                {activeImage.loras.map((l) => (
                  <div
                    key={l.id}
                    className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <button
                        type="button"
                        onClick={() => {
                          onFilterByLora(l.loraName);
                          onClose();
                        }}
                        className="font-medium text-indigo-300 hover:text-indigo-200 truncate block cursor-pointer"
                      >
                        {l.loraName}
                      </button>
                      <span className="text-[11px] text-zinc-500">
                        {l.nodeType || 'LoraLoader'} · Source: {l.provenance} ·{' '}
                        {l.isInstalled ? 'Installed' : 'Missing on disk'}
                      </span>
                    </div>
                    <div className="text-right font-mono tabular-nums shrink-0">
                      <div className="text-zinc-200">Model: {l.modelStrength}</div>
                      <div className="text-zinc-400 text-[11px]">CLIP: {l.clipStrength}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Section 5: System Visual Keywords, User Tags, Collections & Notes */}
          <div className="space-y-3 pt-2 border-t border-zinc-800">
            {visualTaggerEnabled && (
              <div className="space-y-1.5 pb-2 border-b border-zinc-800/70">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-display font-semibold text-zinc-200 uppercase tracking-wider">
                    Visual Keywords ({(activeImage.visualTags || []).length})
                  </span>
                  <button
                    type="button"
                    disabled={isRescanningVisualTags}
                    onClick={async () => {
                      setIsRescanningVisualTags(true);
                      try {
                        const res = await api.rescanImageVisualTags(activeImage.id);
                        setDetailData((prev) =>
                          prev
                            ? {
                                ...prev,
                                image: prev.image
                                  ? { ...prev.image, visualTags: res.visualTags }
                                  : prev.image,
                              }
                            : prev
                        );
                        onUpdated();
                      } finally {
                        setIsRescanningVisualTags(false);
                      }
                    }}
                    className="inline-flex items-center gap-1 text-[11px] text-indigo-400 hover:text-indigo-300 disabled:opacity-50 cursor-pointer"
                    title="Re-run WD14 ONNX visual keyword extractor on this image"
                  >
                    <RefreshCw
                      className={`w-3 h-3 ${isRescanningVisualTags ? 'animate-spin' : ''}`}
                    />
                    <span>{isRescanningVisualTags ? 'Tagging...' : 'Re-tag Image'}</span>
                  </button>
                </div>

                {!activeImage.visualTags || activeImage.visualTags.length === 0 ? (
                  <p className="text-[11px] text-zinc-500">
                    No visual keywords extracted yet. Click &ldquo;Re-tag Image&rdquo; or let the background queue scan it.
                  </p>
                ) : (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {activeImage.visualTags.map((vt) => (
                      <div
                        key={vt.tag}
                        className="inline-flex items-center bg-zinc-950 border border-zinc-800 hover:border-indigo-500/50 rounded overflow-hidden"
                      >
                        <button
                          type="button"
                          onClick={() => {
                            if (onFilterByVisualKeyword) {
                              onFilterByVisualKeyword(vt.tag);
                              onClose();
                            }
                          }}
                          className="px-2 py-0.5 text-zinc-200 hover:text-indigo-300 cursor-pointer font-mono text-[11px]"
                          title={`Filter gallery by "${vt.tag}" (Confidence: ${Math.round(vt.confidence * 100)}%)`}
                        >
                          {vt.tag}
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            const res = await api.removeImageVisualTag(activeImage.id, vt.tag);
                            setDetailData((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    image: prev.image
                                      ? { ...prev.image, visualTags: res.visualTags }
                                      : prev.image,
                                  }
                                : prev
                            );
                            onUpdated();
                          }}
                          className="px-1.5 py-0.5 text-zinc-500 hover:text-rose-400 hover:bg-rose-500/10 border-l border-zinc-800/80 cursor-pointer"
                          title={`Remove "${vt.tag}" from this image`}
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="space-y-1.5">
              <span className="font-display font-semibold text-zinc-200 uppercase tracking-wider block">
                Tags
              </span>
              <div className="flex flex-wrap items-center gap-1.5">
                {activeImage.tags.map((t) => (
                  <span
                    key={t.id}
                    className="inline-flex items-center gap-1 text-zinc-300 bg-zinc-950 border border-zinc-800 px-2 py-0.5 rounded"
                  >
                    <span>#{t.name}</span>
                    <button
                      type="button"
                      onClick={async () => {
                        await api.bulkUpdateImages({
                          imageIds: [activeImage.id],
                          removeTagId: t.id,
                        });
                        refreshActiveDetail(activeImage.id);
                        onUpdated();
                      }}
                      className="text-zinc-500 hover:text-rose-400 cursor-pointer"
                    >
                      ×
                    </button>
                  </span>
                ))}
                <input
                  type="text"
                  value={newTag}
                  onChange={(e) => setNewTag(e.target.value)}
                  onKeyDown={async (e) => {
                    if (e.key === 'Enter' && newTag.trim()) {
                      await api.bulkUpdateImages({
                        imageIds: [activeImage.id],
                        addTagName: newTag.trim(),
                      });
                      setNewTag('');
                      refreshActiveDetail(activeImage.id);
                      onUpdated();
                    }
                  }}
                  placeholder="+ Add tag & Enter"
                  className="px-2 py-0.5 bg-zinc-950 border border-zinc-800 rounded text-zinc-200 w-32"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <span className="font-display font-semibold text-zinc-200 uppercase tracking-wider block">
                Collections
              </span>
              <div className="flex flex-wrap items-center gap-2">
                {activeImage.collections.map((c) => (
                  <span
                    key={c.id}
                    className="inline-flex items-center gap-1 text-zinc-300 bg-zinc-950 border border-zinc-800 px-2 py-0.5 rounded"
                  >
                    <span>{c.name}</span>
                    <button
                      type="button"
                      onClick={async () => {
                        await api.bulkUpdateImages({
                          imageIds: [activeImage.id],
                          removeCollectionId: c.id,
                        });
                        refreshActiveDetail(activeImage.id);
                        onUpdated();
                      }}
                      className="text-zinc-500 hover:text-rose-400 cursor-pointer"
                    >
                      ×
                    </button>
                  </span>
                ))}
                {collections.length > 0 && (
                  <select
                    value={selectedColId}
                    onChange={async (e) => {
                      const cid = e.target.value;
                      if (!cid) return;
                      await api.bulkUpdateImages({
                        imageIds: [activeImage.id],
                        addCollectionId: Number(cid),
                      });
                      setSelectedColId('');
                      refreshActiveDetail(activeImage.id);
                      onUpdated();
                    }}
                    className="px-2 py-1 bg-zinc-950 border border-zinc-800 rounded text-zinc-200"
                  >
                    <option value="">+ Add to collection...</option>
                    {collections.map((col) => (
                      <option key={col.id} value={col.id}>
                        {col.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="font-display font-semibold text-zinc-200 uppercase tracking-wider">
                  User Notes
                </span>
                <button
                  type="button"
                  onClick={handleSaveNotes}
                  className="text-indigo-400 hover:text-indigo-300 cursor-pointer"
                >
                  Save Notes
                </button>
              </div>
              <textarea
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                onBlur={handleSaveNotes}
                placeholder="Add private notes about lighting, prompt adjustments, or defects..."
                className="w-full p-2.5 bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-200"
              />
            </div>

            {/* Raw Workflow JSON Inspector Toggle */}
            <div className="pt-2">
              <button
                type="button"
                onClick={() => setShowRawWorkflow((v) => !v)}
                className="text-zinc-400 hover:text-zinc-200 underline cursor-pointer"
              >
                {showRawWorkflow ? 'Hide Raw Embedded Workflow JSON' : 'Inspect Raw Embedded Workflow JSON'}
              </button>
              {showRawWorkflow && detailData && (
                <pre className="mt-2 p-3 bg-zinc-950 border border-zinc-800 rounded-lg text-[11px] font-mono text-zinc-300 max-h-60 overflow-auto">
                  {detailData.apiWorkflowJson ||
                    detailData.visualWorkflowJson ||
                    JSON.stringify(detailData.rawMetadata, null, 2)}
                </pre>
              )}
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
};
