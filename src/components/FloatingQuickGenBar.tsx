import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  ChevronDown,
  ChevronUp,
  Dices,
  ImagePlus,
  Loader2,
  Plus,
  ScanFace,
  Sliders,
  X,
} from 'lucide-react';
import { DEFAULT_PILL_TYPE_SETTINGS } from '../shared/pillSettings.ts';
import type {
  CharacterProfile,
  ImageRecord,
  LoraExplorerItem,
  LoraPreset,
  ModelInventoryItem,
  PillTypeSettings,
  WorkflowLibraryItem,
} from '../shared/types.ts';
import { ASPECT_RATIO_PRESETS } from '../shared/utils.ts';
import { isCivitaiShareUrl, type QuickGenPrefill } from './quickgen/quickGenUtils.ts';
import { QuickGenAttachmentsBar } from './quickgen/QuickGenAttachmentsBar.tsx';
import { QuickGenConversationView } from './quickgen/QuickGenConversationView.tsx';
import { QuickGenMentionPopover } from './quickgen/QuickGenMentionPopover.tsx';
import { QuickGenSettingsPopover } from './quickgen/QuickGenSettingsPopover.tsx';
import { useQuickGenMentions } from './quickgen/useQuickGenMentions.ts';
import { useQuickGenSubmit } from './quickgen/useQuickGenSubmit.ts';

export type { QuickGenPrefill };

interface FloatingQuickGenBarProps {
  characters: CharacterProfile[];
  loras?: LoraExplorerItem[];
  models?: ModelInventoryItem[];
  presets?: LoraPreset[];
  allImages: ImageRecord[];
  workflows: WorkflowLibraryItem[];
  prefillPayload?: QuickGenPrefill | null;
  onClearPrefill?: () => void;
  onRefreshAll: () => Promise<void>;
  onPushToast: (text: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
  lmStudioOnline?: boolean;
  pillTypeSettings?: PillTypeSettings;
  isInspectorOpen?: boolean;
}

/**
 * Floating Quick Generation Dock with @character / @lora mentions,
 * drag-and-drop image interrogation, resolution settings, and interactive Local LLM Agent mode.
 * On mobile viewports (<768px), collapses by default and expands into a full-screen isolated sheet.
 */
export const FloatingQuickGenBar: React.FC<FloatingQuickGenBarProps> = ({
  characters,
  loras = [],
  models = [],
  presets = [],
  allImages,
  workflows,
  prefillPayload,
  onClearPrefill,
  onRefreshAll,
  onPushToast,
  lmStudioOnline = true,
  pillTypeSettings = DEFAULT_PILL_TYPE_SETTINGS,
  isInspectorOpen = false,
}) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const [isMobile, setIsMobile] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth < 768 : false
  );

  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const sync = () => setIsMobile(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  const submitState = useQuickGenSubmit({
    loras,
    presets,
    workflows,
    prefillPayload,
    lmStudioOnline,
    onRefreshAll,
    onPushToast,
    onClearPrefill,
    inputRef,
    isInspectorOpen,
  });

  const mentions = useQuickGenMentions({
    characters,
    loras,
    models,
    presets,
    allImages,
    prompt: submitState.prompt,
    setPrompt: submitState.setPrompt,
    attachedCharacter: submitState.attachedCharacter,
    setAttachedCharacter: submitState.setAttachedCharacter,
    setCharacterLoraStrength: submitState.setCharacterLoraStrength,
    setAttachedCheckpoint: submitState.setAttachedCheckpoint,
    setAttachedLoras: submitState.setAttachedLoras,
    setRemovedLoraKeys: submitState.setRemovedLoraKeys,
    onApplyPreset: submitState.applyPreset,
    setShowSettingsMenu: submitState.setShowSettingsMenu,
    pillTypeSettings,
    inputRef,
  });

  const isPromptExpanded =
    !submitState.agentEnabled &&
    (submitState.isPromptFocused || submitState.prompt.trim().length > 0);

  const wasMobileRef = useRef(isMobile);
  useEffect(() => {
    if (!wasMobileRef.current && isMobile) {
      const hasDraft =
        submitState.prompt.trim().length > 0 ||
        Boolean(submitState.attachedCharacter) ||
        Boolean(submitState.attachedPreset) ||
        Boolean(submitState.attachedCheckpoint) ||
        submitState.attachedLoras.length > 0 ||
        submitState.chatMessages.length > 0;
      if (!hasDraft) {
        submitState.setIsMinimized(true);
      }
    }
    wasMobileRef.current = isMobile;
  }, [isMobile]);

  const wasInspectorOpenRef = useRef(isInspectorOpen);
  useEffect(() => {
    if (!wasInspectorOpenRef.current && isInspectorOpen && !prefillPayload) {
      submitState.setIsMinimized(true);
      mentions.setMentionOpen(false);
      submitState.setShowSettingsMenu(false);
    }
    wasInspectorOpenRef.current = isInspectorOpen;
  }, [isInspectorOpen, prefillPayload]);

  // Lock background document scroll and track visualViewport on mobile while Quick Gen is open
  useEffect(() => {
    if (!isMobile || submitState.isMinimized) return;

    const scrollY = window.scrollY;
    const htmlStyle = document.documentElement.style;
    const bodyStyle = document.body.style;

    const prevHtmlOverflow = htmlStyle.overflow;
    const prevBodyOverflow = bodyStyle.overflow;
    const prevBodyPosition = bodyStyle.position;
    const prevBodyTop = bodyStyle.top;
    const prevBodyLeft = bodyStyle.left;
    const prevBodyRight = bodyStyle.right;
    const prevBodyWidth = bodyStyle.width;

    htmlStyle.overflow = 'hidden';
    bodyStyle.overflow = 'hidden';
    bodyStyle.position = 'fixed';
    bodyStyle.top = `-${scrollY}px`;
    bodyStyle.left = '0';
    bodyStyle.right = '0';
    bodyStyle.width = '100%';

    const syncVisualViewport = () => {
      const vv = window.visualViewport;
      if (!vv) {
        htmlStyle.setProperty('--quickgen-vv-top', '0px');
        htmlStyle.setProperty('--quickgen-vv-height', `${window.innerHeight}px`);
        return;
      }
      htmlStyle.setProperty('--quickgen-vv-top', `${Math.max(0, Math.round(vv.offsetTop))}px`);
      htmlStyle.setProperty('--quickgen-vv-height', `${Math.round(vv.height)}px`);
    };

    syncVisualViewport();
    const vv = window.visualViewport;
    vv?.addEventListener('resize', syncVisualViewport);
    vv?.addEventListener('scroll', syncVisualViewport);
    window.addEventListener('resize', syncVisualViewport);

    return () => {
      vv?.removeEventListener('resize', syncVisualViewport);
      vv?.removeEventListener('scroll', syncVisualViewport);
      window.removeEventListener('resize', syncVisualViewport);
      htmlStyle.removeProperty('--quickgen-vv-top');
      htmlStyle.removeProperty('--quickgen-vv-height');
      htmlStyle.overflow = prevHtmlOverflow;
      bodyStyle.overflow = prevBodyOverflow;
      bodyStyle.position = prevBodyPosition;
      bodyStyle.top = prevBodyTop;
      bodyStyle.left = prevBodyLeft;
      bodyStyle.right = prevBodyRight;
      bodyStyle.width = prevBodyWidth;
      window.scrollTo(0, scrollY);
    };
  }, [isMobile, submitState.isMinimized]);

  // Close popovers / Quick Gen on Escape without dismissing the underlying Image Inspector
  useEffect(() => {
    if (submitState.isMinimized) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const target = e.target as HTMLElement | null;
      const insideQuickGen = Boolean(target?.closest('[data-quickgen-root="true"]'));
      if (!insideQuickGen && !(isMobile && !submitState.isMinimized)) return;

      if (mentions.mentionOpen) {
        e.preventDefault();
        e.stopPropagation();
        mentions.setMentionOpen(false);
      } else if (submitState.showSettingsMenu) {
        e.preventDefault();
        e.stopPropagation();
        submitState.setShowSettingsMenu(false);
      } else if (isMobile || isInspectorOpen) {
        e.preventDefault();
        e.stopPropagation();
        submitState.setIsMinimized(true);
      }
    };
    window.addEventListener('keydown', handleEsc, true);
    return () => window.removeEventListener('keydown', handleEsc, true);
  }, [
    isInspectorOpen,
    isMobile,
    mentions.mentionOpen,
    submitState.isMinimized,
    submitState.showSettingsMenu,
  ]);

  // Close popovers when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        mentions.setMentionOpen(false);
        submitState.setShowSettingsMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const resolvedShortRatio = useMemo(() => {
    const found = ASPECT_RATIO_PRESETS.find((r) => r.value === submitState.aspectRatio);
    return found ? found.short : '2:3';
  }, [submitState.aspectRatio]);

  const formattedMpLabel = useMemo(
    () =>
      Number.isInteger(submitState.megapixels)
        ? `${submitState.megapixels}MP`
        : `${submitState.megapixels.toFixed(1)}MP`,
    [submitState.megapixels]
  );

  const handleCloseDock = () => {
    submitState.setIsMinimized(true);
    mentions.setMentionOpen(false);
    submitState.setShowSettingsMenu(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentions.handleMentionKeyDown(e)) return;
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submitState.handleSubmit(mentions.resetMentions);
    }
  };

  if (submitState.isMinimized) {
    return (
      <div
        ref={containerRef}
        data-quickgen-root="true"
        className={`fixed left-0 right-0 w-full max-w-[100vw] md:left-1/2 md:-translate-x-1/2 md:w-[94vw] md:max-w-2xl pointer-events-none ${
          isInspectorOpen ? 'bottom-11 md:bottom-11 z-[60]' : 'bottom-0 md:bottom-5 z-40'
        }`}
      >
        <div className="flex justify-center items-end gap-1.5 px-2">
          <button
            type="button"
            onClick={() => {
              submitState.setIsMinimized(false);
              mentions.setMentionOpen(false);
              submitState.setShowSettingsMenu(false);
            }}
            className="pointer-events-auto inline-flex items-center gap-1.5 px-4 py-1.5 rounded-t-xl bg-zinc-900/98 border-t border-x border-zinc-800 text-xs font-medium text-zinc-300 hover:text-white transition-colors shadow-lg cursor-pointer select-none max-w-full"
            title="Expand Generation Dock"
          >
            <ChevronUp className="w-4 h-4 text-indigo-400 shrink-0" />
            <span className="font-semibold text-zinc-200 shrink-0">Quick Gen</span>
            {submitState.prompt.trim() ? (
              <span className="text-[11px] text-zinc-400 truncate max-w-[140px] sm:max-w-[200px]">
                &ldquo;{submitState.prompt.trim()}&rdquo;
              </span>
            ) : (
              <span className="text-[10px] text-zinc-500">Tap to open</span>
            )}
          </button>

          <button
            type="button"
            disabled={
              submitState.isRollingRandom || submitState.isSubmitting || submitState.isChatting
            }
            onClick={submitState.handleRandomRoll}
            aria-label="Random Roll generation"
            title="Random Roll: pick a character (or use your attached character), compatible model, style LoRAs & tags and submit immediately"
            className={`pointer-events-auto inline-flex items-center justify-center px-3 py-1.5 rounded-t-xl bg-zinc-900/98 border-t border-x border-zinc-800 transition-colors shadow-lg select-none shrink-0 ${
              submitState.isRollingRandom
                ? 'text-indigo-300 cursor-wait'
                : submitState.isSubmitting || submitState.isChatting
                ? 'opacity-40 text-zinc-500 cursor-not-allowed'
                : 'text-zinc-300 hover:text-white cursor-pointer'
            }`}
          >
            {submitState.isRollingRandom ? (
              <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
            ) : (
              <Dices className="w-4 h-4 text-indigo-400" />
            )}
          </button>
        </div>
      </div>
    );
  }

  const cardShouldFillMobile = !mentions.mentionOpen && !submitState.showSettingsMenu;

  return (
    <div
      ref={containerRef}
      data-quickgen-root="true"
      data-quickgen-modal={isMobile ? 'true' : undefined}
      role={isMobile ? 'dialog' : undefined}
      aria-modal={isMobile ? true : undefined}
      aria-label={isMobile ? 'Quick Generation' : undefined}
      className={`fixed left-0 right-0 top-[var(--quickgen-vv-top,0px)] h-[var(--quickgen-vv-height,100dvh)] w-full max-w-[100vw] flex flex-col bg-zinc-950 overscroll-none md:inset-auto md:left-1/2 md:-translate-x-1/2 md:w-[94vw] md:max-w-2xl md:h-auto md:block md:bg-transparent md:overscroll-contain ${
        isInspectorOpen ? 'z-[60] md:bottom-14 md:z-[60]' : 'z-50 md:bottom-5 md:z-40'
      }`}
    >
      {/* Desktop Minimize Toggle Tab */}
      <div className="hidden md:flex justify-center -mb-px px-2">
        <button
          type="button"
          onClick={handleCloseDock}
          className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-t-xl bg-zinc-900/98 border-t border-x border-zinc-800 text-xs font-medium text-zinc-300 hover:text-white transition-colors shadow-lg cursor-pointer select-none max-w-full"
          title="Minimize Generation Dock"
        >
          <ChevronDown className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
          <span className="text-[10px] text-zinc-400 uppercase tracking-wider font-semibold">
            Quick Gen
          </span>
        </button>
      </div>

      {/* Mobile Full-Screen Header: Return Arrow (left) & Small X (upper-right) */}
      <div className="flex md:hidden items-center justify-between px-3.5 py-2.5 border-b border-zinc-800/80 bg-zinc-950 shrink-0">
        <button
          type="button"
          onClick={handleCloseDock}
          className="inline-flex items-center gap-2 py-1 pr-2 text-xs font-semibold text-zinc-200 hover:text-white cursor-pointer"
          aria-label="Return to gallery"
          title="Return to gallery"
        >
          <ArrowLeft className="w-4 h-4 text-indigo-400 shrink-0" />
          <span>Quick Gen</span>
        </button>

        <button
          type="button"
          onClick={handleCloseDock}
          className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-900 transition-colors cursor-pointer"
          aria-label="Close Quick Gen"
          title="Close Quick Gen"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {!mentions.mentionOpen && submitState.showSettingsMenu && (
        <div className="flex-1 md:hidden" onClick={() => submitState.setShowSettingsMenu(false)} />
      )}

      {mentions.mentionOpen && (
        <QuickGenMentionPopover
          entries={mentions.mentionEntries}
          counts={mentions.mentionCounts}
          activeTab={mentions.mentionTab}
          activeIndex={mentions.activeIndex}
          query={mentions.mentionQuery}
          highlightedEntry={mentions.highlightedEntry}
          pillTypeSettings={pillTypeSettings}
          onQueryChange={(q) => {
            mentions.setMentionQuery(q);
            mentions.setActiveIndex(0);
          }}
          onTabChange={(tab) => {
            mentions.setMentionTab(tab);
            mentions.setActiveIndex(0);
          }}
          onHoverIndex={mentions.setActiveIndex}
          onSelect={mentions.handleSelectMention}
          onClose={() => mentions.setMentionOpen(false)}
        />
      )}

      {submitState.showSettingsMenu && (
        <QuickGenSettingsPopover
          aspectRatio={submitState.aspectRatio}
          megapixels={submitState.megapixels}
          workflowDefaultMp={submitState.workflowDefaultMp}
          steps={submitState.steps}
          workflowDefaultSteps={submitState.workflowDefaultSteps}
          batchCount={submitState.batchCount}
          agentEnabled={submitState.agentEnabled}
          onChangeAspectRatio={submitState.setAspectRatio}
          onChangeMegapixels={submitState.setMegapixels}
          onChangeSteps={submitState.setSteps}
          onChangeBatchCount={submitState.setBatchCount}
        />
      )}

      {/* Main Floating Quick Generation Box (or bottom-pinned composer in mobile overlay) */}
      <div
        onDragOver={(e) => {
          if (e.dataTransfer?.types?.includes('Files')) {
            e.preventDefault();
            if (lmStudioOnline && !submitState.isInterrogating) {
              setIsDragOver(true);
            }
          }
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) {
            setIsDragOver(false);
          }
        }}
        onDrop={async (e) => {
          e.preventDefault();
          setIsDragOver(false);
          const droppedFile = e.dataTransfer?.files?.[0];
          if (droppedFile) {
            await submitState.handleInterrogateImageFile(droppedFile);
          }
        }}
        className={`w-full max-w-full overflow-hidden bg-zinc-900/98 backdrop-blur-2xl px-3.5 sm:px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] md:pb-3 border-t md:border md:rounded-3xl border-zinc-800/90 shadow-2xl md:transition-all md:duration-300 ${
          cardShouldFillMobile
            ? 'flex-1 min-h-0 flex flex-col justify-between md:block'
            : 'shrink-0'
        } ${
          isDragOver
            ? 'border-t-amber-400 md:border-amber-400 ring-2 ring-amber-400/50 shadow-amber-500/20'
            : submitState.isHighlighted
            ? 'border-t-indigo-500 md:border-indigo-500 ring-2 ring-indigo-500/40 shadow-indigo-500/20'
            : ''
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) {
              await submitState.handleInterrogateImageFile(file);
            }
          }}
        />

        <div
          className={
            cardShouldFillMobile ? 'flex-1 min-h-0 flex flex-col md:block' : ''
          }
        >
          {(submitState.isInterrogating || submitState.isImportingCivitai || isDragOver) && (
            <div className="mb-2 flex items-center gap-2 px-2.5 py-1 rounded-lg bg-indigo-950/70 border border-indigo-500/40 text-xs text-indigo-200 shrink-0">
              {submitState.isImportingCivitai ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 text-indigo-400 animate-spin shrink-0" />
                  <span>Fetching prompt & installed models from Civitai URL...</span>
                </>
              ) : submitState.isInterrogating ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 text-indigo-400 animate-spin shrink-0" />
                  <span>
                    {submitState.isMatchingFace
                      ? 'Scanning face for Model Match & interrogating image...'
                      : 'Downscaling to 1MP & interrogating image via Local LLM...'}
                  </span>
                </>
              ) : (
                <>
                  <ImagePlus className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  <span>Drop image to interrogate into prompt (1MP auto-downscale)</span>
                </>
              )}
            </div>
          )}

          <div className="shrink-0">
            <QuickGenAttachmentsBar
              attachedCharacter={submitState.attachedCharacter}
              characterStrength={submitState.characterLoraStrength}
              attachedPreset={submitState.attachedPreset}
              attachedCheckpoint={submitState.attachedCheckpoint}
              attachedLoras={submitState.attachedLoras}
              removedLoraKeys={submitState.removedLoraKeys}
              loras={loras}
              models={models}
              pillTypeSettings={pillTypeSettings}
              stackSourceLabel={submitState.stackSourceLabel}
              onRemoveCharacter={submitState.handleRemoveCharacter}
              onRemovePreset={submitState.handleRemovePreset}
              onRemoveCheckpoint={submitState.handleRemoveCheckpoint}
              onRemoveStackTarget={submitState.handleRemoveStackTarget}
              onRemoveLora={submitState.handleRemoveLora}
              onUpdateLoraStrength={submitState.handleUpdateLoraStrength}
              onUpdateCharacterStrength={submitState.handleUpdateCharacterStrength}
            />
          </div>

          {/* Inline Expanded Conversation Area (when Agent is active) */}
          {submitState.agentEnabled && !mentions.mentionOpen && (
            <QuickGenConversationView
              messages={submitState.chatMessages}
              isChatting={submitState.isChatting}
              expandingMessageId={submitState.expandingMessageId}
              isSubmitting={submitState.isSubmitting}
              batchCount={submitState.batchCount}
              onUpdateProposedPrompt={submitState.handleUpdateProposedPrompt}
              onSubmitPrompt={(messageId, proposedPrompt) =>
                submitState.handleSubmitProposedPrompt(
                  messageId,
                  proposedPrompt,
                  mentions.resetMentions
                )
              }
              onPreviewExpand={submitState.handlePreviewExpandConcept}
              onUpdateExpandedShot={submitState.handleUpdateExpandedPrompt}
              onCloseExpandedPreview={submitState.handleCloseExpandedPreview}
              onSubmitExpandedShots={(messageId, prompts, conceptTheme) =>
                submitState.handleSubmitExpandedPrompts(
                  messageId,
                  prompts,
                  conceptTheme,
                  mentions.resetMentions
                )
              }
              onClearChat={() => {
                submitState.setChatMessages([]);
                submitState.handleRemoveStackTarget();
              }}
            />
          )}

          {/* Prompt Textarea Row */}
          <div
            className={`flex items-start gap-2 ${
              cardShouldFillMobile && !submitState.agentEnabled
                ? 'flex-1 min-h-0 md:flex-none'
                : 'shrink-0'
            }`}
          >
            <textarea
              ref={inputRef}
              rows={submitState.agentEnabled ? 2 : isPromptExpanded ? 4 : 1}
              value={submitState.prompt}
              onChange={mentions.handlePromptChange}
              onFocus={() => submitState.setIsPromptFocused(true)}
              onBlur={() => submitState.setIsPromptFocused(false)}
              onKeyDown={handleKeyDown}
              onPaste={async (e) => {
                const items = e.clipboardData?.items;
                if (items) {
                  for (const item of Array.from(items)) {
                    if (item.type.startsWith('image/')) {
                      const file = item.getAsFile();
                      if (file) {
                        e.preventDefault();
                        await submitState.handleInterrogateImageFile(file);
                        return;
                      }
                    }
                  }
                }
                const pastedText = e.clipboardData?.getData('text/plain')?.trim() || '';
                if (isCivitaiShareUrl(pastedText)) {
                  e.preventDefault();
                  await submitState.handleImportCivitaiUrl(pastedText);
                }
              }}
              placeholder={
                submitState.agentEnabled
                  ? 'Brainstorm your image or set idea with the Agent (Enter to send, @ for character/LoRA/model)...'
                  : lmStudioOnline
                  ? 'What do you want to create? (Type @ for character/LoRA/model, or drop/paste an image)'
                  : 'What do you want to create? (Type @ to mention a character, LoRA, or model)'
              }
              className={`w-full bg-transparent text-zinc-100 placeholder-zinc-500 text-base md:text-sm resize-none focus:outline-none leading-relaxed md:transition-[height,min-height] md:duration-200 overflow-y-auto overscroll-contain ${
                submitState.agentEnabled
                  ? 'min-h-[2.75rem] max-h-24'
                  : cardShouldFillMobile
                  ? 'h-full min-h-[4rem] md:h-auto md:min-h-[1.5rem] md:max-h-48'
                  : isPromptExpanded
                  ? 'min-h-[3rem] max-h-24 md:min-h-[5.5rem] md:max-h-48'
                  : 'min-h-[1.5rem] max-h-24'
              }`}
            />
            {(submitState.prompt.length > 0 ||
              Boolean(submitState.attachedCharacter) ||
              Boolean(submitState.attachedPreset) ||
              Boolean(submitState.attachedCheckpoint) ||
              Boolean(submitState.stackSourceLabel) ||
              submitState.hasInspirationImage ||
              submitState.attachedLoras.length > 0 ||
              submitState.chatMessages.length > 0) && (
              <button
                type="button"
                onClick={() => submitState.handleClearBox(mentions.resetMentions)}
                className="p-1 text-zinc-500 hover:text-zinc-300 cursor-pointer shrink-0 mt-0.5"
                title="Clear prompt & attachments"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Bottom Control Bar */}
        <div className="mt-2.5 pt-2 border-t border-zinc-800/60 md:border-t-0 md:pt-0 flex items-center justify-between gap-1.5 sm:gap-2 shrink-0">
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => {
                mentions.setMentionOpen((prev) => !prev);
                submitState.setShowSettingsMenu(false);
                mentions.setMentionTriggerRange(null);
              }}
              className="w-8 h-8 rounded-full bg-zinc-800/90 hover:bg-zinc-700 text-zinc-300 flex items-center justify-center transition-colors cursor-pointer shrink-0"
              title="Mention a character or LoRA (@)"
            >
              {mentions.mentionOpen ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
            </button>

            <button
              type="button"
              disabled={!lmStudioOnline || submitState.isInterrogating}
              onClick={() => {
                if (!lmStudioOnline || submitState.isInterrogating) return;
                fileInputRef.current?.click();
              }}
              className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors shrink-0 ${
                !lmStudioOnline
                  ? 'opacity-40 cursor-not-allowed bg-zinc-800/50 text-zinc-500'
                  : submitState.isInterrogating
                  ? 'bg-indigo-600/30 border border-indigo-500/60 text-indigo-200 cursor-wait'
                  : 'bg-zinc-800/90 hover:bg-zinc-700 text-zinc-300 cursor-pointer'
              }`}
              title={
                lmStudioOnline
                  ? 'Upload or drop an image to interrogate into a prompt (auto-downscales to 1MP)'
                  : 'Local LLM is offline — connect a Local LLM to interrogate images'
              }
            >
              {submitState.isInterrogating ? (
                <Loader2 className="w-4 h-4 animate-spin text-indigo-300" />
              ) : (
                <ImagePlus className="w-4 h-4" />
              )}
            </button>

            <button
              type="button"
              disabled={!lmStudioOnline || submitState.isInterrogating}
              onClick={() => {
                if (!lmStudioOnline || submitState.isInterrogating) return;
                submitState.toggleModelMatch();
              }}
              aria-pressed={submitState.modelMatchEnabled}
              aria-label="Toggle automatic face recognition and character attachment"
              className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors shrink-0 ${
                !lmStudioOnline
                  ? 'opacity-40 cursor-not-allowed bg-zinc-800/50 text-zinc-500 border border-transparent'
                  : submitState.modelMatchEnabled
                  ? 'bg-indigo-600/25 border border-indigo-500/60 text-indigo-200 cursor-pointer'
                  : 'bg-zinc-800/90 hover:bg-zinc-700 text-zinc-300 border border-transparent cursor-pointer'
              }`}
              title={
                lmStudioOnline
                  ? 'Automatic character recognition: if no character is selected when you paste or upload an image, scan faces and auto-attach the closest matching character'
                  : 'Local LLM is offline — connect a Local LLM to use automatic face recognition'
              }
            >
              <ScanFace className="w-4 h-4 shrink-0" />
            </button>

            <button
              type="button"
              disabled={
                submitState.isRollingRandom || submitState.isSubmitting || submitState.isChatting
              }
              onClick={submitState.handleRandomRoll}
              aria-label="Random Roll generation"
              className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors shrink-0 ${
                submitState.isRollingRandom
                  ? 'bg-indigo-600/30 border border-indigo-500/60 text-indigo-200 cursor-wait'
                  : submitState.isSubmitting || submitState.isChatting
                  ? 'opacity-40 cursor-not-allowed bg-zinc-800/50 text-zinc-500'
                  : 'bg-zinc-800/90 hover:bg-zinc-700 text-zinc-300 cursor-pointer'
              }`}
              title="Random Roll: pick a character (or use your attached character), compatible model, style LoRAs & tags and submit immediately"
            >
              {submitState.isRollingRandom ? (
                <Loader2 className="w-4 h-4 animate-spin text-indigo-300" />
              ) : (
                <Dices className="w-4 h-4" />
              )}
            </button>

            <button
              type="button"
              disabled={!lmStudioOnline}
              onClick={() => {
                if (!lmStudioOnline) return;
                submitState.setAgentEnabled((prev) => {
                  const next = !prev;
                  if (next) {
                    setTimeout(() => {
                      inputRef.current?.focus({ preventScroll: true });
                    }, 30);
                  }
                  return next;
                });
              }}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors shrink-0 ${
                !lmStudioOnline
                  ? 'opacity-40 cursor-not-allowed bg-zinc-800/50 text-zinc-500 border border-transparent'
                  : submitState.agentEnabled
                  ? 'bg-indigo-600/25 border border-indigo-500/60 text-indigo-200 cursor-pointer'
                  : 'bg-zinc-800/90 hover:bg-zinc-700 text-zinc-300 border border-transparent cursor-pointer'
              }`}
              title={
                lmStudioOnline
                  ? 'Toggle Local LLM Agent to brainstorm prompts (or expand into x2–x8 themed set shots)'
                  : 'Local LLM is offline — start your Local LLM server or check connection in System settings'
              }
            >
              <Bot className="w-3.5 h-3.5" />
              <span>Agent</span>
            </button>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
            <button
              type="button"
              onClick={() => {
                submitState.setShowSettingsMenu((prev) => !prev);
                mentions.setMentionOpen(false);
              }}
              className="inline-flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-1.5 rounded-full bg-zinc-800/90 hover:bg-zinc-700/90 text-zinc-200 text-xs font-medium transition-colors cursor-pointer min-w-0 truncate"
              title="Configure Aspect Ratio, Resolution (MP) & Number of Generations"
            >
              <Sliders className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
              <span className="inline-flex items-center gap-1 font-mono text-zinc-300 shrink-0">
                <span className="inline-block w-2 h-3 border border-zinc-400 rounded-[2px]" />
                <span>{resolvedShortRatio}</span>
              </span>
              <span
                className={`font-mono shrink-0 ${
                  submitState.megapixels > 3.0 ? 'text-amber-300' : 'text-indigo-300'
                }`}
              >
                {formattedMpLabel}
              </span>
              {submitState.steps !== submitState.workflowDefaultSteps && (
                <span className="font-mono text-emerald-300 shrink-0 tabular-nums">
                  {submitState.steps} steps
                </span>
              )}
              <span className="font-mono text-zinc-100 shrink-0">
                x{submitState.batchCount}
              </span>
            </button>

            <button
              type="button"
              onClick={() => submitState.handleSubmit(mentions.resetMentions)}
              disabled={
                !submitState.prompt.trim() ||
                submitState.isSubmitting ||
                submitState.isChatting
              }
              className="w-8 h-8 rounded-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:hover:bg-zinc-800 disabled:bg-zinc-800 text-white flex items-center justify-center transition-colors cursor-pointer shrink-0 shadow-sm"
              title={
                submitState.agentEnabled
                  ? 'Send message to Agent'
                  : 'Submit quick generation'
              }
            >
              {submitState.isSubmitting || submitState.isChatting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <ArrowRight className="w-4 h-4" />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
