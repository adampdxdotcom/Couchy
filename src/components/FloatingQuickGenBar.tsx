import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  Bot,
  ChevronDown,
  ChevronUp,
  ImagePlus,
  Loader2,
  MessageSquare,
  Plus,
  Sliders,
  X,
} from 'lucide-react';
import type {
  CharacterProfile,
  ImageRecord,
  LoraExplorerItem,
  WorkflowLibraryItem,
} from '../shared/types.ts';
import { ASPECT_RATIO_PRESETS } from '../shared/utils.ts';
import type { QuickGenPrefill } from './quickgen/quickGenUtils.ts';
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
  allImages: ImageRecord[];
  workflows: WorkflowLibraryItem[];
  prefillPayload?: QuickGenPrefill | null;
  onRefreshAll: () => Promise<void>;
  onPushToast: (text: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
  lmStudioOnline?: boolean;
}

/**
 * Floating Quick Generation Dock with @character / @lora mentions,
 * drag-and-drop image interrogation, resolution settings, and LM Studio Agent & Conversation modes.
 */
export const FloatingQuickGenBar: React.FC<FloatingQuickGenBarProps> = ({
  characters,
  loras = [],
  allImages,
  workflows,
  prefillPayload,
  onRefreshAll,
  onPushToast,
  lmStudioOnline = true,
}) => {
  const [isDragOver, setIsDragOver] = useState(false);

  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const submitState = useQuickGenSubmit({
    loras,
    workflows,
    prefillPayload,
    lmStudioOnline,
    onRefreshAll,
    onPushToast,
    inputRef,
  });

  const mentions = useQuickGenMentions({
    characters,
    loras,
    allImages,
    prompt: submitState.prompt,
    setPrompt: submitState.setPrompt,
    setAttachedCharacter: submitState.setAttachedCharacter,
    setAttachedLoras: submitState.setAttachedLoras,
    setRemovedLoraKeys: submitState.setRemovedLoraKeys,
    setShowSettingsMenu: submitState.setShowSettingsMenu,
    inputRef,
  });

  const isPromptExpanded =
    !submitState.conversationEnabled &&
    (submitState.isPromptFocused || submitState.prompt.trim().length > 0);

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

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentions.handleMentionKeyDown(e)) return;
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submitState.handleSubmit(mentions.resetMentions);
    }
  };

  return (
    <div
      ref={containerRef}
      className="fixed bottom-0 left-0 right-0 z-40 w-full max-w-[100vw] md:bottom-5 md:left-1/2 md:-translate-x-1/2 md:w-[94vw] md:max-w-2xl"
    >
      {/* Minimize / Expand Toggle Tab */}
      <div className="flex justify-center -mb-px px-2">
        <button
          type="button"
          onClick={() => {
            submitState.setIsMinimized((prev) => !prev);
            mentions.setMentionOpen(false);
            submitState.setShowSettingsMenu(false);
          }}
          className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-t-xl bg-zinc-900/98 border-t border-x border-zinc-800 text-xs font-medium text-zinc-300 hover:text-white transition-colors shadow-lg cursor-pointer select-none max-w-full"
          title={submitState.isMinimized ? 'Expand Generation Dock' : 'Minimize Generation Dock'}
        >
          {submitState.isMinimized ? (
            <>
              <ChevronUp className="w-4 h-4 text-indigo-400 shrink-0" />
              <span className="font-semibold text-zinc-200 shrink-0">Quick Gen</span>
              {submitState.prompt.trim() ? (
                <span className="text-[11px] text-zinc-400 truncate max-w-[140px] sm:max-w-[200px]">
                  &ldquo;{submitState.prompt.trim()}&rdquo;
                </span>
              ) : (
                <span className="text-[10px] text-zinc-500 hidden sm:inline">Tap to expand</span>
              )}
            </>
          ) : (
            <>
              <ChevronDown className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
              <span className="text-[10px] text-zinc-400 uppercase tracking-wider font-semibold">
                Quick Gen
              </span>
            </>
          )}
        </button>
      </div>

      {!submitState.isMinimized && (
        <>
          {mentions.mentionOpen && (
            <QuickGenMentionPopover
              entries={mentions.mentionEntries}
              counts={mentions.mentionCounts}
              activeTab={mentions.mentionTab}
              activeIndex={mentions.activeIndex}
              query={mentions.mentionQuery}
              highlightedEntry={mentions.highlightedEntry}
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
              batchCount={submitState.batchCount}
              conversationEnabled={submitState.conversationEnabled}
              onChangeAspectRatio={submitState.setAspectRatio}
              onChangeMegapixels={submitState.setMegapixels}
              onChangeBatchCount={submitState.setBatchCount}
            />
          )}

          {/* Main Floating Quick Generation Box */}
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
            className={`w-full max-w-full overflow-hidden bg-zinc-900/98 backdrop-blur-2xl rounded-t-2xl md:rounded-3xl px-3.5 sm:px-4 py-3 border-t border-x md:border border-zinc-800/90 shadow-2xl transition-all duration-300 ${
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

            {(submitState.isInterrogating || isDragOver) && (
              <div className="mb-2 flex items-center gap-2 px-2.5 py-1 rounded-lg bg-indigo-950/70 border border-indigo-500/40 text-xs text-indigo-200">
                {submitState.isInterrogating ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 text-indigo-400 animate-spin shrink-0" />
                    <span>Downscaling to 1MP &amp; interrogating image via LM Studio...</span>
                  </>
                ) : (
                  <>
                    <ImagePlus className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    <span>Drop image to interrogate into prompt (1MP auto-downscale)</span>
                  </>
                )}
              </div>
            )}

            <QuickGenAttachmentsBar
              attachedCharacter={submitState.attachedCharacter}
              attachedLoras={submitState.attachedLoras}
              onRemoveCharacter={submitState.handleRemoveCharacter}
              onRemoveLora={submitState.handleRemoveLora}
            />

            {/* Inline Expanded Conversation Area (when Agent -> Conversation is active) */}
            {submitState.conversationEnabled && (
              <QuickGenConversationView
                messages={submitState.chatMessages}
                isChatting={submitState.isChatting}
                isSubmitting={submitState.isSubmitting}
                batchCount={submitState.batchCount}
                onSubmitPrompt={(proposedPrompt) =>
                  submitState.handleSubmitProposedPrompt(proposedPrompt, mentions.resetMentions)
                }
                onClearChat={() => {
                  submitState.setChatMessages([]);
                  submitState.setActiveSeriesId(null);
                  submitState.setBranchFromImageId(null);
                }}
              />
            )}

            {/* Prompt Textarea Row */}
            <div className="flex items-start gap-2">
              <textarea
                ref={inputRef}
                rows={submitState.conversationEnabled ? 2 : isPromptExpanded ? 4 : 1}
                value={submitState.prompt}
                onChange={mentions.handlePromptChange}
                onFocus={() => submitState.setIsPromptFocused(true)}
                onBlur={() => submitState.setIsPromptFocused(false)}
                onKeyDown={handleKeyDown}
                onPaste={async (e) => {
                  const items = e.clipboardData?.items;
                  if (!items) return;
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
                }}
                placeholder={
                  submitState.conversationEnabled
                    ? 'Message the Agent about your image idea (Enter to send, @ for character/LoRA)...'
                    : lmStudioOnline
                    ? 'What do you want to create? (Type @ for character/LoRA, or drop/paste an image)'
                    : 'What do you want to create? (Type @ to mention a character or LoRA)'
                }
                className={`w-full bg-transparent text-zinc-100 placeholder-zinc-500 text-sm resize-none focus:outline-none leading-relaxed transition-[height,min-height] duration-200 overflow-y-auto ${
                  submitState.conversationEnabled
                    ? 'min-h-[2.75rem] max-h-24'
                    : isPromptExpanded
                    ? 'min-h-[5.5rem] max-h-36 sm:max-h-48'
                    : 'min-h-[1.5rem] max-h-24'
                }`}
              />
              {submitState.prompt.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    submitState.setPrompt('');
                    submitState.setAttachedLoras((prev) =>
                      prev.filter((l) => l.showPill !== false)
                    );
                    mentions.setMentionOpen(false);
                    submitState.setIsPromptFocused(false);
                    inputRef.current?.blur();
                  }}
                  className="p-1 text-zinc-500 hover:text-zinc-300 cursor-pointer shrink-0 mt-0.5"
                  title="Clear prompt"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Bottom Control Bar */}
            <div className="mt-2.5 flex items-center justify-between gap-1.5 sm:gap-2">
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
                      : 'LM Studio is offline — connect LM Studio to interrogate images'
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
                  disabled={!lmStudioOnline}
                  onClick={() => {
                    if (!lmStudioOnline) return;
                    submitState.setAgentEnabled((prev) => !prev);
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
                      ? 'Toggle LM Studio Agent to expand your prompt into a themed photo set'
                      : 'LM Studio is offline — start LM Studio or check connection in System settings'
                  }
                >
                  <Bot className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Agent</span>
                </button>

                {submitState.agentEnabled && lmStudioOnline && (
                  <button
                    type="button"
                    onClick={() => {
                      submitState.setConversationEnabled((prev) => !prev);
                      setTimeout(() => {
                        inputRef.current?.focus({ preventScroll: true });
                      }, 30);
                    }}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors shrink-0 cursor-pointer ${
                      submitState.conversationEnabled
                        ? 'bg-amber-500/20 border border-amber-400/60 text-amber-200'
                        : 'bg-zinc-800/90 hover:bg-zinc-700 text-zinc-300 border border-transparent'
                    }`}
                    title="Toggle interactive Conversation mode to brainstorm and refine your prompt with the Agent"
                  >
                    <MessageSquare className="w-3.5 h-3.5" />
                    <span>Conversation</span>
                  </button>
                )}
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
                    submitState.conversationEnabled
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
        </>
      )}
    </div>
  );
};
