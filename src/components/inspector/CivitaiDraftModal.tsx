import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Plus,
  Share2,
  X,
} from 'lucide-react';
import { api } from '../../api/client.ts';
import { CivitaiStackSelector } from './CivitaiStackSelector.tsx';
import type {
  CivitaiDomain,
  CivitaiDraftRecord,
  CivitaiModelVersionCandidate,
  CivitaiShareDraftResponse,
  CivitaiShareEligibilityResponse,
  CivitaiShareUploadMode,
} from '../../shared/apiTypes.ts';
import type { ImageRecord } from '../../shared/types.ts';

interface CivitaiDraftModalProps {
  image: ImageRecord;
  eligibility: CivitaiShareEligibilityResponse;
  onClose: () => void;
  onDraftCreated: (draft: CivitaiDraftRecord) => void;
  onPushToast?: (text: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
}

function formatByteSize(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function dedupeStrings(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of items) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(trimmed);
    }
  }
  return out;
}

/**
 * Confirmation modal for creating a single-image or multi-image stack private Civitai draft (`publish: false`).
 * In stack mode, oversized PNGs seamlessly auto-fallback per image to JPEG + EXIF.
 */
export const CivitaiDraftModal: React.FC<CivitaiDraftModalProps> = ({
  image,
  eligibility,
  onClose,
  onDraftCreated,
  onPushToast,
}) => {
  const stack = eligibility.stack ?? null;
  const initialScope: 'single' | 'stack' =
    !eligibility.eligible && stack?.eligible ? 'stack' : 'single';

  const [shareScope, setShareScope] = useState<'single' | 'stack'>(initialScope);
  const [selectedStackIds, setSelectedStackIds] = useState<number[]>(
    () => stack?.eligibleItems.map((i) => i.imageId) ?? []
  );

  // Derived stack metadata based on currently checked stack steps
  const stackDerived = useMemo(() => {
    if (!stack || shareScope !== 'stack') return null;
    const selectedSet = new Set(selectedStackIds);
    const selectedItems = stack.eligibleItems.filter((item) => selectedSet.has(item.imageId));
    const activeList = selectedItems.length > 0 ? selectedItems : stack.eligibleItems;

    const representative =
      activeList.find((item) => item.isPoster) ||
      [...activeList].sort((a, b) => b.stepOrder - a.stepOrder)[0] ||
      null;

    const orderedForMeta = representative
      ? [representative, ...activeList.filter((item) => item.imageId !== representative.imageId)]
      : activeList;

    const mergedCandidates: CivitaiModelVersionCandidate[] = [];
    const seenVerIds = new Set<number>();
    const resourceNamesSet = new Set<string>();
    let recommendedDomain: CivitaiDomain = 'civitai.com';

    for (const item of orderedForMeta) {
      if (item.recommendedDomain === 'civitai.red') {
        recommendedDomain = 'civitai.red';
      }
      for (const cand of item.candidateModelVersions) {
        if (!seenVerIds.has(cand.modelVersionId)) {
          seenVerIds.add(cand.modelVersionId);
          mergedCandidates.push(cand);
        }
      }
      for (const resName of item.embeddedResourceNames) {
        resourceNamesSet.add(resName);
      }
    }

    return {
      selectedItems,
      prefilledTitle: representative?.prefilledTitle ?? stack.prefilledTitle,
      prefilledDescription: representative?.prefilledDescription ?? stack.prefilledDescription,
      prefilledTags: dedupeStrings(activeList.flatMap((i) => i.tags)),
      recommendedModelVersionId:
        representative?.recommendedModelVersionId ?? mergedCandidates[0]?.modelVersionId ?? null,
      recommendedDomain,
      candidateModelVersions: mergedCandidates,
      embeddedResourceNames: Array.from(resourceNamesSet),
    };
  }, [stack, shareScope, selectedStackIds]);

  const activeCandidates =
    shareScope === 'stack' && stackDerived
      ? stackDerived.candidateModelVersions
      : eligibility.candidateModelVersions;
  const activeEmbeddedResources =
    shareScope === 'stack' && stackDerived
      ? stackDerived.embeddedResourceNames
      : eligibility.embeddedResourceNames;

  const [hasEditedTitle, setHasEditedTitle] = useState(false);
  const [hasEditedDetail, setHasEditedDetail] = useState(false);
  const [hasEditedTags, setHasEditedTags] = useState(false);
  const [hasEditedModel, setHasEditedModel] = useState(false);
  const [hasEditedDomain, setHasEditedDomain] = useState(false);

  const [title, setTitle] = useState(
    initialScope === 'stack' && stack ? stack.prefilledTitle : eligibility.prefilledTitle
  );
  const [detail, setDetail] = useState(
    initialScope === 'stack' && stack
      ? stack.prefilledDescription
      : eligibility.prefilledDescription
  );
  const [tags, setTags] = useState<string[]>(
    initialScope === 'stack' && stack ? stack.prefilledTags : eligibility.prefilledTags
  );
  const [tagInput, setTagInput] = useState('');
  const [modelVersionId, setModelVersionId] = useState<number | ''>(
    (initialScope === 'stack' && stack
      ? stack.recommendedModelVersionId
      : eligibility.recommendedModelVersionId) ?? ''
  );
  const [targetDomain, setTargetDomain] = useState<CivitaiDomain>(
    (initialScope === 'stack' && stack ? stack.recommendedDomain : eligibility.recommendedDomain) ||
      'civitai.com'
  );

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitMode, setSubmitMode] = useState<CivitaiShareUploadMode>('original_png');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [needsJpegFallback, setNeedsJpegFallback] = useState(false);
  const [createdResult, setCreatedResult] = useState<CivitaiShareDraftResponse | null>(null);

  // Keep unedited form fields synced when switching single/stack mode or toggling stack checkboxes
  useEffect(() => {
    const nextPrefills =
      shareScope === 'stack' && stackDerived
        ? stackDerived
        : {
            prefilledTitle: eligibility.prefilledTitle,
            prefilledDescription: eligibility.prefilledDescription,
            prefilledTags: eligibility.prefilledTags,
            recommendedModelVersionId: eligibility.recommendedModelVersionId,
            recommendedDomain: eligibility.recommendedDomain,
          };

    if (!hasEditedTitle) setTitle(nextPrefills.prefilledTitle);
    if (!hasEditedDetail) setDetail(nextPrefills.prefilledDescription);
    if (!hasEditedTags) setTags(nextPrefills.prefilledTags);
    if (!hasEditedModel) setModelVersionId(nextPrefills.recommendedModelVersionId ?? '');
    if (!hasEditedDomain) setTargetDomain(nextPrefills.recommendedDomain || 'civitai.com');
  }, [
    shareScope,
    stackDerived,
    eligibility,
    hasEditedTitle,
    hasEditedDetail,
    hasEditedTags,
    hasEditedModel,
    hasEditedDomain,
  ]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSubmitting) {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isSubmitting, onClose]);

  const handleAddTag = () => {
    const trimmed = tagInput.trim();
    if (!trimmed) return;
    if (!tags.some((t) => t.toLowerCase() === trimmed.toLowerCase())) {
      setHasEditedTags(true);
      setTags((prev) => [...prev, trimmed]);
    }
    setTagInput('');
  };

  const handleToggleStackId = (targetId: number) => {
    setErrorMsg(null);
    setSelectedStackIds((prev) =>
      prev.includes(targetId) ? prev.filter((id) => id !== targetId) : [...prev, targetId]
    );
  };

  const handleSubmitDraft = async (mode: CivitaiShareUploadMode) => {
    if (isSubmitting) return;
    if (shareScope === 'stack' && selectedStackIds.length === 0) {
      setErrorMsg('Select at least 1 eligible stack image to upload.');
      return;
    }

    setIsSubmitting(true);
    setSubmitMode(mode);
    setErrorMsg(null);
    if (mode === 'jpeg_exif') {
      setNeedsJpegFallback(false);
    }

    try {
      const orderedSelectedIds =
        shareScope === 'stack' && stack
          ? stack.eligibleItems
              .filter((item) => selectedStackIds.includes(item.imageId))
              .map((item) => item.imageId)
          : undefined;

      const res = await api.shareImageCivitaiDraft(image.id, {
        title: title.trim(),
        detail: detail.trim(),
        tags,
        modelVersionId: modelVersionId === '' ? null : Number(modelVersionId),
        targetDomain,
        uploadMode: mode,
        shareScope,
        selectedImageIds: orderedSelectedIds,
      });

      setCreatedResult(res);
      onDraftCreated(res.draft);

      if (res.shareScope === 'stack') {
        const count = res.uploadedCount ?? orderedSelectedIds?.length ?? 1;
        const fb = res.jpegFallbackCount ? ` · ${res.jpegFallbackCount} JPEG+EXIF` : '';
        onPushToast?.(`Created Civitai stack draft #${res.postId} (${count} images${fb})`, 'success');
      } else {
        onPushToast?.(
          `Created Civitai draft #${res.postId} (${mode === 'jpeg_exif' ? 'JPEG+EXIF' : 'PNG'})`,
          'success'
        );
      }
    } catch (err: any) {
      const isTooLarge = err?.code === 'PAYLOAD_TOO_LARGE' || err?.status === 413;
      if (shareScope === 'single' && isTooLarge && mode === 'original_png') {
        setNeedsJpegFallback(true);
        setErrorMsg(
          err?.message ||
            'Original PNG exceeded Civitai upload size limits. You can retry with high-quality JPEG + EXIF generation parameters.'
        );
      } else {
        setErrorMsg(err?.message || 'Failed to create Civitai draft.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[70] bg-black/80 backdrop-blur-xs flex items-center justify-center p-4"
      onClick={() => {
        if (!isSubmitting) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="civitai-draft-modal-title"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl max-h-[90vh] bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl flex flex-col overflow-hidden text-xs"
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-zinc-800 flex items-center justify-between gap-4 shrink-0">
          <div className="min-w-0">
            <h2
              id="civitai-draft-modal-title"
              className="text-sm font-display font-semibold text-zinc-100 flex items-center gap-2"
            >
              <Share2 className="w-4 h-4 text-indigo-400 shrink-0" />
              <span>Share to Civitai (Private Draft Only)</span>
            </h2>
            <p className="text-[11px] text-zinc-400 mt-0.5">
              Creates a private draft on your Civitai account. Set mature ratings and publish on Civitai.
            </p>
          </div>
          <button
            type="button"
            disabled={isSubmitting}
            onClick={onClose}
            className="p-1.5 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-400 hover:text-zinc-100 cursor-pointer disabled:opacity-40 shrink-0"
            aria-label="Close modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 overflow-y-auto space-y-4 min-h-0">
          {/* Single vs Stack Segmented Toggle */}
          {stack && !createdResult && (
            <div className="space-y-1.5">
              <div className="inline-flex bg-zinc-950 p-1 rounded-lg border border-zinc-800 gap-1">
                <button
                  type="button"
                  disabled={isSubmitting || !eligibility.eligible}
                  onClick={() => {
                    setShareScope('single');
                    setErrorMsg(null);
                    setNeedsJpegFallback(false);
                  }}
                  title={!eligibility.eligible ? eligibility.reasons.join(' ') : undefined}
                  className={`px-3 py-1.5 rounded-md font-medium whitespace-nowrap transition-colors ${
                    !eligibility.eligible
                      ? 'text-zinc-600 cursor-not-allowed'
                      : shareScope === 'single'
                      ? 'bg-zinc-800 text-zinc-100 cursor-pointer'
                      : 'text-zinc-400 hover:text-zinc-200 cursor-pointer'
                  }`}
                >
                  This Image
                </button>
                <button
                  type="button"
                  disabled={isSubmitting || !stack.eligible}
                  onClick={() => {
                    setShareScope('stack');
                    setErrorMsg(null);
                    setNeedsJpegFallback(false);
                  }}
                  title={stack.disabledReason || undefined}
                  className={`px-3 py-1.5 rounded-md font-medium whitespace-nowrap transition-colors font-mono tabular-nums ${
                    !stack.eligible
                      ? 'text-zinc-600 cursor-not-allowed'
                      : shareScope === 'stack'
                      ? 'bg-indigo-600 text-white cursor-pointer'
                      : 'text-zinc-400 hover:text-zinc-200 cursor-pointer'
                  }`}
                >
                  Entire Stack ({stack.eligibleCount})
                </button>
              </div>
              {!stack.eligible && stack.disabledReason && (
                <p className="text-[11px] text-zinc-400">{stack.disabledReason}</p>
              )}
              {!eligibility.eligible && stack.eligible && (
                <p className="text-[11px] text-zinc-400">
                  Current step excluded ({eligibility.reasons[0]}) — sharing eligible stack frames.
                </p>
              )}
            </div>
          )}

          {/* Active Scope Summary / Stack Selector */}
          {shareScope === 'stack' && stack && !createdResult ? (
            <CivitaiStackSelector
              stack={stack}
              selectedIds={selectedStackIds}
              disabled={isSubmitting}
              onToggleImageId={handleToggleStackId}
              onSelectAll={() => {
                setErrorMsg(null);
                setSelectedStackIds(stack.eligibleItems.map((i) => i.imageId));
              }}
            />
          ) : (
            <div className="flex items-start gap-4 pb-4 border-b border-zinc-800/80">
              <img
                src={image.thumbnailUrl}
                alt={image.filename}
                className="w-20 h-20 rounded-lg object-cover bg-zinc-950 border border-zinc-800 shrink-0"
              />
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="font-mono text-zinc-100 truncate" title={image.filename}>
                  {image.filename}
                </div>
                <div className="text-[11px] text-zinc-400 font-mono tabular-nums flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span>
                    {eligibility.width}×{eligibility.height}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>{formatByteSize(eligibility.fileSizeBytes)}</span>
                  <span aria-hidden="true">·</span>
                  <span>{eligibility.format.toUpperCase()}</span>
                  <span aria-hidden="true">·</span>
                  <span className="text-emerald-400">Native Metadata Verified</span>
                </div>
                <div className="text-[11px] text-zinc-400">
                  {eligibility.linkedCharacters.length > 0 ? (
                    <span>
                      Eligible characters:{' '}
                      <span className="text-zinc-200">
                        {eligibility.linkedCharacters
                          .map((c) => (c.status === 'suggested' ? `${c.name} (suggested)` : c.name))
                          .join(', ')}
                      </span>
                    </span>
                  ) : (
                    <span>0 linked characters (permitted by System Preferences)</span>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Embedded Resource Transparency Note */}
          {activeEmbeddedResources.length > 0 && !createdResult && (
            <div className="bg-zinc-950 border border-zinc-800 rounded-lg px-3.5 py-2.5 text-[11px] text-zinc-400 space-y-1">
              <div className="font-medium text-zinc-300">
                Embedded filenames visible to Civitai metadata parser:
              </div>
              <div className="font-mono text-zinc-400 break-words">
                {activeEmbeddedResources.join(' · ')}
              </div>
            </div>
          )}

          {/* Success State */}
          {createdResult ? (
            <div className="bg-emerald-950/35 border border-emerald-500/40 rounded-xl p-4 space-y-3">
              <div className="flex items-start gap-2.5 text-emerald-200">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <div className="font-semibold text-zinc-100 font-mono tabular-nums">
                    {createdResult.shareScope === 'stack'
                      ? `Draft #${createdResult.postId} created (${createdResult.uploadedCount ?? 1} images${
                          createdResult.jpegFallbackCount
                            ? ` · ${createdResult.jpegFallbackCount} converted to JPEG+EXIF`
                            : ''
                        })`
                      : `Draft #${createdResult.postId} created (${
                          createdResult.uploadMode === 'jpeg_exif' ? 'JPEG + EXIF' : 'Original PNG'
                        })`}
                  </div>
                  <p className="text-[11px] text-zinc-300">
                    Civitai scans new uploads briefly before previewing them in your draft. Review mature rating and tags on Civitai before publishing.
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3 pt-1">
                <a
                  href={createdResult.draftUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium whitespace-nowrap"
                >
                  <span>Open Draft Editor ({createdResult.domain})</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
                <a
                  href={`https://${
                    createdResult.domain === 'civitai.red' ? 'civitai.com' : 'civitai.red'
                  }/posts/${createdResult.postId}/edit`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-zinc-950 border border-zinc-800 hover:border-zinc-700 text-zinc-300 whitespace-nowrap"
                  title="Open the draft editor on the alternate Civitai domain"
                >
                  <span>
                    Try {createdResult.domain === 'civitai.red' ? 'civitai.com' : 'civitai.red'}
                  </span>
                  <ExternalLink className="w-3 h-3" />
                </a>
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 rounded-lg bg-zinc-950 border border-zinc-800 hover:border-zinc-700 text-zinc-200 cursor-pointer whitespace-nowrap"
                >
                  Done
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Editable Draft Fields */}
              <div className="space-y-3">
                <div className="space-y-1">
                  <label htmlFor="civitai-draft-title" className="block text-[11px] font-medium text-zinc-300">
                    Draft Title
                  </label>
                  <input
                    id="civitai-draft-title"
                    type="text"
                    value={title}
                    disabled={isSubmitting}
                    onChange={(e) => {
                      setHasEditedTitle(true);
                      setTitle(e.target.value);
                    }}
                    placeholder="Optional post title"
                    className="w-full px-3 py-2 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-100 focus:outline-none focus:border-indigo-500 disabled:opacity-60"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="space-y-1 sm:col-span-2">
                    <label htmlFor="civitai-draft-model" className="block text-[11px] font-medium text-zinc-300">
                      Primary Model Version
                    </label>
                    <select
                      id="civitai-draft-model"
                      value={modelVersionId}
                      disabled={isSubmitting}
                      onChange={(e) => {
                        setHasEditedModel(true);
                        const nextVal = e.target.value === '' ? '' : Number(e.target.value);
                        setModelVersionId(nextVal);
                        if (nextVal !== '') {
                          const picked = activeCandidates.find((c) => c.modelVersionId === nextVal);
                          if (picked?.domain === 'civitai.red') {
                            setTargetDomain('civitai.red');
                          }
                        }
                      }}
                      className="w-full px-3 py-2 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-100 focus:outline-none focus:border-indigo-500 disabled:opacity-60"
                    >
                      <option value="">None (do not link a primary model version)</option>
                      {activeCandidates.map((cand) => (
                        <option key={cand.modelVersionId} value={cand.modelVersionId}>
                          {cand.label} (#{cand.modelVersionId} · {cand.domain})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label htmlFor="civitai-draft-domain" className="block text-[11px] font-medium text-zinc-300">
                      Civitai Domain
                    </label>
                    <select
                      id="civitai-draft-domain"
                      value={targetDomain}
                      disabled={isSubmitting}
                      onChange={(e) => {
                        setHasEditedDomain(true);
                        setTargetDomain(e.target.value === 'civitai.red' ? 'civitai.red' : 'civitai.com');
                      }}
                      className="w-full px-3 py-2 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-100 focus:outline-none focus:border-indigo-500 disabled:opacity-60"
                    >
                      <option value="civitai.com">civitai.com</option>
                      <option value="civitai.red">civitai.red (Mature)</option>
                    </select>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="civitai-draft-tag-input" className="block text-[11px] font-medium text-zinc-300">
                    Post Tags ({tags.length})
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {tags.map((t) => (
                      <span
                        key={t}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-zinc-950 border border-zinc-800 text-zinc-200 text-[11px]"
                      >
                        <span>{t}</span>
                        <button
                          type="button"
                          disabled={isSubmitting}
                          onClick={() => {
                            setHasEditedTags(true);
                            setTags((prev) => prev.filter((item) => item !== t));
                          }}
                          className="text-zinc-500 hover:text-rose-400 cursor-pointer"
                          aria-label={`Remove tag ${t}`}
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      id="civitai-draft-tag-input"
                      type="text"
                      value={tagInput}
                      disabled={isSubmitting}
                      onChange={(e) => setTagInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleAddTag();
                        }
                      }}
                      placeholder="Add tag and press Enter..."
                      className="flex-1 px-3 py-1.5 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-100 focus:outline-none focus:border-indigo-500 disabled:opacity-60"
                    />
                    <button
                      type="button"
                      disabled={isSubmitting || !tagInput.trim()}
                      onClick={handleAddTag}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-zinc-950 border border-zinc-800 hover:border-zinc-700 text-zinc-200 cursor-pointer disabled:opacity-40 whitespace-nowrap"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Add</span>
                    </button>
                  </div>
                </div>

                <div className="space-y-1">
                  <label htmlFor="civitai-draft-detail" className="block text-[11px] font-medium text-zinc-300">
                    Description (Prompt)
                  </label>
                  <textarea
                    id="civitai-draft-detail"
                    rows={4}
                    value={detail}
                    disabled={isSubmitting}
                    onChange={(e) => {
                      setHasEditedDetail(true);
                      setDetail(e.target.value);
                    }}
                    placeholder="Optional post description"
                    className="w-full px-3 py-2 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-100 focus:outline-none focus:border-indigo-500 leading-relaxed disabled:opacity-60"
                  />
                </div>
              </div>

              {/* Prior Draft & Published History */}
              {eligibility.existingDrafts.length > 0 && (
                <div className="pt-2 border-t border-zinc-800/80 space-y-1.5">
                  <div className="text-[11px] font-medium text-zinc-400">
                    Previously Shared Posts for This Image
                  </div>
                  <div className="space-y-1">
                    {eligibility.existingDrafts.slice(0, 3).map((d) => {
                      const targetUrl = d.publishedUrl || d.draftUrl;
                      const domainLabel = targetUrl.includes('civitai.red') ? 'civitai.red' : 'civitai.com';
                      const isPub = d.status === 'published';
                      return (
                        <div
                          key={d.id}
                          className="flex items-center justify-between gap-2 text-[11px] text-zinc-300 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-1.5"
                        >
                          <span className="truncate font-mono tabular-nums">
                            <span className={isPub ? 'text-emerald-400' : 'text-sky-400'}>
                              {isPub ? 'Published' : 'Draft'}
                            </span>{' '}
                            · Post #{d.civitaiPostId} · {domainLabel}
                            {isPub && (d.reactionCount > 0 || d.commentCount > 0)
                              ? ` · ${d.reactionCount} likes · ${d.commentCount} comments`
                              : ''}
                          </span>
                          <a
                            href={targetUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-indigo-400 hover:text-indigo-300 whitespace-nowrap shrink-0"
                          >
                            <span>{isPub ? 'View' : 'Open'}</span>
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Error & Oversized PNG Fallback Callout */}
              {errorMsg && (
                <div className="bg-amber-950/35 border border-amber-500/40 rounded-lg p-3 space-y-2 text-[11px] text-amber-200">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                    <span>{errorMsg}</span>
                  </div>
                  {needsJpegFallback && shareScope === 'single' && (
                    <div className="pt-1">
                      <button
                        type="button"
                        disabled={isSubmitting}
                        onClick={() => void handleSubmitDraft('jpeg_exif')}
                        className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-medium cursor-pointer disabled:opacity-50 whitespace-nowrap"
                      >
                        <span>Retry as High-Quality JPEG + EXIF Metadata</span>
                      </button>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        {!createdResult && (
          <div className="px-5 py-3.5 border-t border-zinc-800 bg-zinc-950/60 flex items-center justify-end gap-2.5 shrink-0">
            <button
              type="button"
              disabled={isSubmitting}
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-zinc-300 cursor-pointer disabled:opacity-40 whitespace-nowrap"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={
                isSubmitting || (shareScope === 'stack' && selectedStackIds.length === 0)
              }
              onClick={() => void handleSubmitDraft('original_png')}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium cursor-pointer disabled:opacity-50 whitespace-nowrap"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>
                    {shareScope === 'stack'
                      ? `Uploading ${selectedStackIds.length} images & creating draft...`
                      : submitMode === 'jpeg_exif'
                      ? 'Converting & Uploading JPEG...'
                      : 'Uploading PNG & Creating Draft...'}
                  </span>
                </>
              ) : (
                <>
                  <Share2 className="w-3.5 h-3.5" />
                  <span>
                    {shareScope === 'stack'
                      ? `Create Stack Draft (${selectedStackIds.length})`
                      : 'Create Draft on Civitai'}
                  </span>
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
