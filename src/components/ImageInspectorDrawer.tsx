import React, { useEffect, useState } from 'react';
import {
  X,
  Star,
  Heart,
  Download,
  Copy,
  Check,
  Play,
  Bookmark,
  Sparkles,
  CheckCircle2,
  XCircle,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  Maximize2,
  Minimize2,
} from 'lucide-react';
import { api } from '../api/client.ts';
import { renderDependencyLabel } from './GalleryGridView.tsx';
import type {
  CharacterProfile,
  ImageRecord,
  ReproductionValidationResult,
} from '../shared/types.ts';

interface ImageInspectorDrawerProps {
  image: ImageRecord;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  onUpdated: () => void;
  characters: CharacterProfile[];
  collections: { id: number; name: string }[];
  onFilterByLora: (loraFilename: string) => void;
  onFilterByCharacter: (characterId: number) => void;
}

/**
 * Full-Screen Lightbox & Comprehensive Image Detail Inspector with Workflow Reproduction Wizard.
 */
export const ImageInspectorDrawer: React.FC<ImageInspectorDrawerProps> = ({
  image,
  onClose,
  onPrev,
  onNext,
  onUpdated,
  characters,
  collections,
  onFilterByLora,
  onFilterByCharacter,
}) => {
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [detailData, setDetailData] = useState<{
    image?: ImageRecord;
    rawMetadata: Record<string, string>;
    visualWorkflowJson: string | null;
    apiWorkflowJson: string | null;
  } | null>(null);
  const [notes, setNotes] = useState(image.notes);
  const [newTag, setNewTag] = useState('');
  const [selectedCharId, setSelectedCharId] = useState('');
  const [charAppearance, setCharAppearance] = useState('');
  const [selectedColId, setSelectedColId] = useState('');
  const [copiedField, setCopiedField] = useState<string | null>(null);

  // Workflow Save & Reproduction state
  const [workflowName, setWorkflowName] = useState('');
  const [workflowSavedMsg, setWorkflowSavedMsg] = useState<string | null>(null);
  const [reproValidation, setReproValidation] = useState<ReproductionValidationResult | null>(null);
  const [isValidatingRepro, setIsValidatingRepro] = useState(false);
  const [reproStatusMsg, setReproStatusMsg] = useState<string | null>(null);
  const [showRawWorkflow, setShowRawWorkflow] = useState(false);

  const activeImage = detailData?.image || image;

  useEffect(() => {
    setNotes(image.notes);
    setReproValidation(null);
    setReproStatusMsg(null);
    api
      .getImageDetail(image.id)
      .then((res) => {
        setDetailData({
          image: res.image,
          rawMetadata: res.rawMetadata,
          visualWorkflowJson: res.visualWorkflowJson,
          apiWorkflowJson: res.apiWorkflowJson,
        });
      })
      .catch(() => {});
  }, [image.id, image.notes]);

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
    await api.updateImageAnnotations(image.id, { notes });
    onUpdated();
  };

  const handleOpenReproductionCheck = async () => {
    setIsValidatingRepro(true);
    setReproStatusMsg(null);
    try {
      const res = await api.validateReproduction({
        imageId: image.id,
        workflowId: image.workflowId ?? undefined,
      });
      setReproValidation(res);
    } catch (err: any) {
      setReproStatusMsg(err.message || 'Validation failed');
    } finally {
      setIsValidatingRepro(false);
    }
  };

  const handleSubmitReproduction = async () => {
    if (!reproValidation?.workflowId) return;
    try {
      const res = await api.submitReproduction({
        imageId: image.id,
        workflowId: reproValidation.workflowId,
      });
      setReproStatusMsg(`Submitted to ComfyUI (Prompt ID: ${res.job.comfyui_prompt_id})`);
    } catch (err: any) {
      setReproStatusMsg(`Error: ${err.message}`);
    }
  };

  const handleSaveToWorkflowLibrary = async () => {
    if (!image.workflowId) return;
    await api.saveWorkflow({
      id: image.workflowId,
      name: workflowName.trim() || `Workflow from ${image.filename}`,
      description: `Saved from image ${image.filename}`,
    });
    setWorkflowSavedMsg('Saved to independent Workflow Library');
    setTimeout(() => setWorkflowSavedMsg(null), 2500);
  };

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-sm flex flex-col lg:flex-row overflow-hidden">
      {/* Left Pane: Full-Resolution Image Viewer / Lightbox */}
      <div
        onClick={() => {
          if (isFullScreen) setIsFullScreen(false);
        }}
        className={`relative bg-zinc-950 flex items-center justify-center select-none overflow-hidden transition-all duration-200 ${
          isFullScreen
            ? 'fixed inset-0 z-50 p-2 sm:p-6 bg-black/95 cursor-zoom-out'
            : 'flex-1 p-4'
        }`}
      >
        {/* Full-Screen Toggle Button (Top Right) */}
        {isFullScreen ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setIsFullScreen(false);
            }}
            className="absolute top-4 right-4 z-20 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-zinc-900/90 hover:bg-zinc-800 text-zinc-100 border border-zinc-700/80 shadow-2xl backdrop-blur-md text-xs font-medium cursor-pointer"
            title="Exit Full Screen (Esc)"
          >
            <Minimize2 className="w-4 h-4 text-indigo-400" />
            <span>Exit Full Screen</span>
            <span className="text-zinc-500 text-[10px] hidden sm:inline ml-0.5 font-mono">ESC</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setIsFullScreen(true);
            }}
            className="absolute top-4 right-4 z-10 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-zinc-900/80 hover:bg-zinc-800 text-zinc-300 hover:text-white border border-zinc-700/60 text-xs font-medium cursor-pointer backdrop-blur-xs shadow-md"
            title="Expand Full Screen"
          >
            <Maximize2 className="w-3.5 h-3.5 text-indigo-400" />
            <span className="hidden sm:inline">Full Screen</span>
          </button>
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
          src={image.originalUrl}
          alt={image.filename}
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

        {/* Bottom Metadata & Download Bar */}
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute bottom-4 left-4 right-4 flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-400 bg-zinc-900/90 border border-zinc-800 px-4 py-2 rounded-lg backdrop-blur-md z-10 shadow-lg"
        >
          <div className="flex items-center gap-2 font-mono tabular-nums truncate">
            <span className="text-zinc-200 font-sans font-medium truncate max-w-[180px] sm:max-w-xs">
              {image.filename}
            </span>
            <span aria-hidden="true">·</span>
            <span>
              {image.width}×{image.height}
            </span>
            <span aria-hidden="true">·</span>
            <span>{formatBytes(image.fileSize)}</span>
            <span aria-hidden="true" className="hidden sm:inline">
              ·
            </span>
            <span className="hidden sm:inline">SHA256: {image.contentHash.slice(0, 12)}…</span>
          </div>
          <div className="flex items-center gap-3">
            {isFullScreen && (
              <span className="text-[11px] text-zinc-500 hidden md:inline">
                Tap image or press ESC to exit full screen
              </span>
            )}
            <a
              href={`/api/images/${image.id}/file?download=1`}
              className="inline-flex items-center gap-1.5 text-indigo-400 hover:text-indigo-300 font-medium shrink-0"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download Original</span>
            </a>
          </div>
        </div>
      </div>

      {/* Right Pane: Comprehensive Metadata, Character & Workflow Reproduction Inspector */}
      <aside
        className={`w-full lg:w-[500px] xl:w-[540px] bg-zinc-900 border-l border-zinc-800 flex flex-col h-[55vh] lg:h-full overflow-y-auto ${
          isFullScreen ? 'hidden' : ''
        }`}
      >
        {/* Inspector Header */}
        <div className="sticky top-0 z-10 bg-zinc-900/95 backdrop-blur-xs border-b border-zinc-800 px-5 py-3.5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            {/* Rating Stars */}
            <div className="flex items-center gap-1">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  onClick={async () => {
                    await api.updateImageAnnotations(image.id, {
                      rating: image.rating === star ? 0 : star,
                    });
                    onUpdated();
                  }}
                  className="p-0.5 cursor-pointer"
                >
                  <Star
                    className={`w-4 h-4 ${
                      star <= image.rating
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
                await api.updateImageAnnotations(image.id, { isFavorite: !image.isFavorite });
                onUpdated();
              }}
              className={`p-1.5 rounded-lg border cursor-pointer ${
                image.isFavorite
                  ? 'bg-rose-500/15 border-rose-500/40 text-rose-400'
                  : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:text-rose-300'
              }`}
              title="Favorite"
            >
              <Heart className={`w-4 h-4 ${image.isFavorite ? 'fill-rose-400' : ''}`} />
            </button>

            {renderDependencyLabel(image.dependencyStatus)}
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-400 hover:text-zinc-100 cursor-pointer"
            title="Close Inspector (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Inspector Body */}
        <div className="p-5 space-y-6 text-xs">
          {/* Workflow Reproduction & Library Bar */}
          <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h4 className="text-sm font-display font-semibold text-zinc-100">
                  Workflow & Reproducibility
                </h4>
                <p className="text-zinc-400 mt-0.5">
                  Visual Graph: {image.hasVisualWorkflow ? 'Embedded' : 'None'} · API Graph:{' '}
                  {image.hasApiWorkflow ? 'Embedded' : 'None'}
                </p>
              </div>
              {(image.hasVisualWorkflow || image.hasApiWorkflow) && (
                <button
                  type="button"
                  onClick={handleOpenReproductionCheck}
                  disabled={isValidatingRepro}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-medium rounded-lg cursor-pointer shrink-0"
                >
                  <Play className="w-3.5 h-3.5" />
                  <span>{isValidatingRepro ? 'Checking...' : 'Reproduce'}</span>
                </button>
              )}
            </div>

            {image.workflowId && (
              <div className="flex items-center gap-2 pt-1">
                <input
                  type="text"
                  value={workflowName}
                  onChange={(e) => setWorkflowName(e.target.value)}
                  placeholder="Save workflow to library as..."
                  className="flex-1 px-2.5 py-1.5 bg-zinc-900 border border-zinc-800 rounded text-zinc-200"
                />
                <button
                  type="button"
                  onClick={handleSaveToWorkflowLibrary}
                  className="inline-flex items-center gap-1 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded cursor-pointer shrink-0"
                >
                  <Bookmark className="w-3.5 h-3.5" />
                  <span>Save Workflow</span>
                </button>
              </div>
            )}
            {workflowSavedMsg && <p className="text-emerald-400">{workflowSavedMsg}</p>}

            {/* Reproduction Pre-Flight Summary Box */}
            {reproValidation && (
              <div className="mt-3 pt-3 border-t border-zinc-800 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-zinc-200">
                    Reproduction Readiness Summary
                  </span>
                  {renderDependencyLabel(reproValidation.readinessStatus)}
                </div>

                {reproValidation.warnings.map((w, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-2 text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded p-2"
                  >
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span>{w}</span>
                  </div>
                ))}

                {reproValidation.requiredModels.length > 0 && (
                  <div className="space-y-1">
                    <span className="text-zinc-400 font-medium">Required Model Dependencies:</span>
                    {reproValidation.requiredModels.map((rm, idx) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between bg-zinc-900 px-2.5 py-1.5 rounded border border-zinc-800"
                      >
                        <span className="font-mono text-zinc-200 truncate">{rm.name}</span>
                        <span
                          className={
                            rm.status === 'exact_match'
                              ? 'text-emerald-400'
                              : rm.status === 'available'
                              ? 'text-sky-400'
                              : 'text-rose-400'
                          }
                        >
                          {rm.status}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex items-center justify-end gap-2 pt-1">
                  <button
                    type="button"
                    disabled={!reproValidation.canSubmit}
                    onClick={handleSubmitReproduction}
                    className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-medium rounded cursor-pointer"
                  >
                    Submit Workflow to ComfyUI
                  </button>
                </div>
                {reproStatusMsg && (
                  <p className="text-indigo-300 font-mono">{reproStatusMsg}</p>
                )}
              </div>
            )}
          </div>

          {/* Section 1: Character Associations & Assisted Suggestions */}
          <div className="space-y-2.5">
            <h4 className="text-xs font-display font-semibold text-zinc-200 uppercase tracking-wider">
              Characters & Assisted Identification
            </h4>

            {image.characters.length === 0 ? (
              <p className="text-zinc-500">No characters linked or suggested for this image.</p>
            ) : (
              <div className="space-y-1.5">
                {image.characters.map((ch) => (
                  <div
                    key={ch.id}
                    className="flex items-center justify-between gap-2 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            onFilterByCharacter(ch.characterId);
                            onClose();
                          }}
                          className="font-medium text-zinc-100 hover:text-indigo-400 cursor-pointer"
                        >
                          {ch.characterName}
                        </button>
                        {ch.appearanceLabel && (
                          <span className="text-zinc-400">· {ch.appearanceLabel}</span>
                        )}
                        {ch.status === 'suggested' && (
                          <span className="inline-flex items-center gap-1 text-amber-400">
                            <Sparkles className="w-3 h-3" />
                            <span>Suggested ({Math.round(ch.confidence * 100)}%)</span>
                          </span>
                        )}
                      </div>
                      {ch.matchReason && (
                        <p className="text-[11px] text-zinc-500 truncate">{ch.matchReason}</p>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {ch.status === 'suggested' ? (
                        <>
                          <button
                            type="button"
                            onClick={async () => {
                              await api.updateCharacterAssociationStatus({
                                imageId: image.id,
                                characterId: ch.characterId,
                                status: 'confirmed',
                              });
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
                                imageId: image.id,
                                characterId: ch.characterId,
                                status: 'rejected',
                              });
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
                              imageId: image.id,
                              characterId: ch.characterId,
                              status: 'remove',
                            });
                            onUpdated();
                          }}
                          className="text-zinc-500 hover:text-rose-400 px-1.5 py-0.5 cursor-pointer"
                        >
                          Unlink
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Manual Character Assignment */}
            <div className="flex items-center gap-2 pt-1">
              <select
                value={selectedCharId}
                onChange={(e) => setSelectedCharId(e.target.value)}
                className="flex-1 px-2.5 py-1.5 bg-zinc-950 border border-zinc-800 rounded text-zinc-200"
              >
                <option value="">Assign Character...</option>
                {characters.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={charAppearance}
                onChange={(e) => setCharAppearance(e.target.value)}
                placeholder="Outfit/Variant (optional)"
                className="w-36 px-2.5 py-1.5 bg-zinc-950 border border-zinc-800 rounded text-zinc-200"
              />
              <button
                type="button"
                onClick={async () => {
                  if (!selectedCharId) return;
                  await api.updateCharacterAssociationStatus({
                    imageId: image.id,
                    characterId: Number(selectedCharId),
                    status: 'confirmed',
                    appearanceLabel: charAppearance.trim() || undefined,
                  });
                  setSelectedCharId('');
                  setCharAppearance('');
                  onUpdated();
                }}
                className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded cursor-pointer"
              >
                Add
              </button>
            </div>
          </div>

          {/* Section 2: Positive & Negative Prompts with Provenance */}
          <div className="space-y-3">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="font-display font-semibold text-zinc-200 uppercase tracking-wider">
                  Positive Prompt
                </span>
                <div className="flex items-center gap-2">
                  {activeImage.provenance.positivePrompt && (
                    <span className="text-[11px] text-zinc-400">
                      Source: {activeImage.provenance.positivePrompt}
                    </span>
                  )}
                  {image.positivePrompt && (
                    <button
                      type="button"
                      onClick={() => copyText(image.positivePrompt!, 'pos')}
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
              <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-3 text-zinc-200 leading-relaxed whitespace-pre-wrap max-h-40 overflow-y-auto">
                {image.positivePrompt || (
                  <span className="text-zinc-500 italic">Not embedded in file metadata</span>
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="font-display font-semibold text-zinc-200 uppercase tracking-wider">
                  Negative Prompt
                </span>
                {image.negativePrompt && (
                  <button
                    type="button"
                    onClick={() => copyText(image.negativePrompt!, 'neg')}
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
                {image.negativePrompt || (
                  <span className="text-zinc-500 italic">None</span>
                )}
              </div>
            </div>
          </div>

          {/* Section 3: Generation Parameters & Checkpoint */}
          <div className="space-y-2">
            <h4 className="font-display font-semibold text-zinc-200 uppercase tracking-wider">
              Generation Parameters
            </h4>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 font-mono tabular-nums">
              <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-2.5">
                <span className="block text-[10px] font-sans text-zinc-400">Checkpoint</span>
                <span className="text-zinc-100 truncate block" title={image.checkpointName || ''}>
                  {image.checkpointName || '—'}
                </span>
              </div>
              <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-2.5">
                <span className="block text-[10px] font-sans text-zinc-400">VAE</span>
                <span className="text-zinc-100 truncate block">{image.vaeName || 'Baked / Default'}</span>
              </div>
              <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-2.5">
                <span className="block text-[10px] font-sans text-zinc-400">Seed</span>
                <span className="text-zinc-100 truncate block">{image.seed ?? '—'}</span>
              </div>
              <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-2.5">
                <span className="block text-[10px] font-sans text-zinc-400">Steps / CFG</span>
                <span className="text-zinc-100">
                  {image.steps ?? '—'} / {image.cfg ?? '—'}
                </span>
              </div>
              <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-2.5">
                <span className="block text-[10px] font-sans text-zinc-400">Sampler / Scheduler</span>
                <span className="text-zinc-100 truncate block">
                  {image.sampler || '—'} · {image.scheduler || '—'}
                </span>
              </div>
              <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-2.5">
                <span className="block text-[10px] font-sans text-zinc-400">Denoise / Batch</span>
                <span className="text-zinc-100">
                  {image.denoise ?? '1.0'} · Batch {image.batchSize ?? 1}
                </span>
              </div>
            </div>

            {activeImage.missingFields.length > 0 && (
              <p className="text-[11px] text-zinc-500">
                Unextracted fields: {activeImage.missingFields.join(' · ')}
              </p>
            )}
          </div>

          {/* Section 4: Extracted LoRA Chain (Model & CLIP Strengths) */}
          <div className="space-y-2">
            <h4 className="font-display font-semibold text-zinc-200 uppercase tracking-wider">
              Extracted LoRAs ({image.loras.length})
            </h4>
            {image.loras.length === 0 ? (
              <p className="text-zinc-500">No LoRAs detected in workflow or metadata.</p>
            ) : (
              <div className="space-y-1.5">
                {image.loras.map((l) => (
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

          {/* Section 5: Tags, Collections & Notes */}
          <div className="space-y-3 pt-2 border-t border-zinc-800">
            <div className="space-y-1.5">
              <span className="font-display font-semibold text-zinc-200 uppercase tracking-wider block">
                Tags
              </span>
              <div className="flex flex-wrap items-center gap-1.5">
                {image.tags.map((t) => (
                  <span
                    key={t.id}
                    className="inline-flex items-center gap-1 text-zinc-300 bg-zinc-950 border border-zinc-800 px-2 py-0.5 rounded"
                  >
                    <span>#{t.name}</span>
                    <button
                      type="button"
                      onClick={async () => {
                        await api.bulkUpdateImages({
                          imageIds: [image.id],
                          removeTagId: t.id,
                        });
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
                        imageIds: [image.id],
                        addTagName: newTag.trim(),
                      });
                      setNewTag('');
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
                {image.collections.map((c) => (
                  <span
                    key={c.id}
                    className="inline-flex items-center gap-1 text-zinc-300 bg-zinc-950 border border-zinc-800 px-2 py-0.5 rounded"
                  >
                    <span>{c.name}</span>
                    <button
                      type="button"
                      onClick={async () => {
                        await api.bulkUpdateImages({
                          imageIds: [image.id],
                          removeCollectionId: c.id,
                        });
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
                        imageIds: [image.id],
                        addCollectionId: Number(cid),
                      });
                      setSelectedColId('');
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
