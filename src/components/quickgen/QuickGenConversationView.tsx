import React, { useEffect, useRef } from 'react';
import {
  ArrowRight,
  Bot,
  Eye,
  Loader2,
  Pencil,
  RefreshCw,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import type { QuickGenChatMessage } from '../../shared/types.ts';

interface QuickGenConversationViewProps {
  messages: QuickGenChatMessage[];
  isChatting: boolean;
  expandingMessageId: string | null;
  isSubmitting: boolean;
  batchCount: number;
  onUpdateProposedPrompt: (messageId: string, value: string) => void;
  onSubmitPrompt: (promptText: string) => void;
  onPreviewExpand: (messageId: string, conceptText: string) => void;
  onUpdateExpandedShot: (messageId: string, shotIndex: number, value: string) => void;
  onCloseExpandedPreview: (messageId: string) => void;
  onSubmitExpandedShots: (prompts: string[], conceptTheme: string) => void;
  onClearChat: () => void;
}

/**
 * Inline conversation thread inside FloatingQuickGenBar when Agent mode is active.
 * Supports editing single-shot <proposed_prompt> text before submit and batch Set Concept -> Preview/Edit or Expand & Submit.
 */
export const QuickGenConversationView: React.FC<QuickGenConversationViewProps> = ({
  messages,
  isChatting,
  expandingMessageId,
  isSubmitting,
  batchCount,
  onUpdateProposedPrompt,
  onSubmitPrompt,
  onPreviewExpand,
  onUpdateExpandedShot,
  onCloseExpandedPreview,
  onSubmitExpandedShots,
  onClearChat,
}) => {
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll to latest message or thinking indicator
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length, isChatting]);

  return (
    <div className="mb-2.5 rounded-2xl bg-zinc-950/90 border border-zinc-800/90 overflow-hidden flex flex-col flex-1 min-h-0 md:flex-none">
      {/* Header Bar */}
      <div className="px-3 py-1.5 border-b border-zinc-800/80 bg-zinc-900/50 flex items-center justify-between text-[11px] shrink-0">
        <div className="flex items-center gap-1.5 text-indigo-300 font-medium">
          <Bot className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
          <span>
            {batchCount > 1 ? `Agent · Set Concept Mode (x${batchCount})` : 'Agent Conversation'}
          </span>
        </div>
        {messages.length > 0 && (
          <button
            type="button"
            onClick={onClearChat}
            disabled={isChatting || isSubmitting || Boolean(expandingMessageId)}
            className="inline-flex items-center gap-1 text-zinc-400 hover:text-zinc-200 disabled:opacity-40 cursor-pointer transition-colors"
            title="Clear conversation history"
          >
            <Trash2 className="w-3 h-3" />
            <span>Clear</span>
          </button>
        )}
      </div>

      {/* Scrollable Conversation Body */}
      <div
        ref={scrollContainerRef}
        className="flex-1 min-h-0 md:flex-none md:h-72 overflow-y-auto overscroll-contain touch-pan-y p-3 space-y-2.5 text-xs leading-relaxed"
      >
        {messages.length === 0 && !isChatting ? (
          <div className="h-full flex flex-col items-center justify-center text-center px-4 text-zinc-400 space-y-1.5">
            <Bot className="w-6 h-6 text-indigo-400/70 stroke-1.5" />
            <p className="text-zinc-300 font-medium">
              {batchCount > 1
                ? `Develop a ${batchCount}-shot set concept with the Local LLM Agent`
                : 'Brainstorm your image idea with the Local LLM Agent'}
            </p>
            <p className="text-[11px] text-zinc-500 max-w-md">
              {batchCount > 1 ? (
                <>
                  Lock in wardrobe, setting, lighting, and arc with the Agent. Then click{' '}
                  <span className="text-indigo-300 font-medium">Preview Shots (x{batchCount})</span>{' '}
                  to manually edit individual prompts before submitting, or{' '}
                  <span className="text-indigo-300 font-medium">Expand &amp; Submit</span> directly.
                </>
              ) : (
                <>
                  Describe a rough concept below and press Enter. When the Agent offers a prompt,
                  click <span className="text-indigo-300 font-medium">Submit</span>—or set batch to{' '}
                  <span className="text-indigo-300 font-mono">x2–x8</span> to expand into a multi-shot set.
                </>
              )}
            </p>
          </div>
        ) : (
          messages.map((msg) => {
            const isExpandingThis = expandingMessageId === msg.id;
            const hasPreview = Array.isArray(msg.expandedPrompts) && msg.expandedPrompts.length > 0;
            const isConceptCard = msg.proposalKind === 'concept' || batchCount > 1;

            return (
              <div
                key={msg.id}
                className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
              >
                <div
                  className={`max-w-[92%] rounded-2xl px-3 py-2 ${
                    msg.role === 'user'
                      ? 'bg-indigo-600/25 border border-indigo-500/40 text-indigo-100'
                      : 'bg-zinc-900/95 border border-zinc-800 text-zinc-200'
                  } ${
                    msg.role === 'assistant' &&
                    msg.proposedPrompt !== null &&
                    msg.proposedPrompt !== undefined
                      ? 'w-[92%]'
                      : ''
                  }`}
                >
                  <p className="whitespace-pre-wrap break-words">{msg.content}</p>

                  {msg.role === 'assistant' &&
                    msg.proposedPrompt !== null &&
                    msg.proposedPrompt !== undefined && (
                    <div className="mt-2.5 p-2.5 rounded-xl bg-zinc-950 border border-indigo-500/40 space-y-2">
                      <div className="flex items-center justify-between gap-2 text-[10px] font-semibold uppercase tracking-wider text-indigo-300">
                        <span className="inline-flex items-center gap-1">
                          <Sparkles className="w-3 h-3 text-amber-400" />
                          {isConceptCard ? 'Set Concept' : 'Proposed Prompt'}
                        </span>
                        <div className="flex items-center gap-2">
                          <span className="inline-flex items-center gap-1 font-normal normal-case tracking-normal text-zinc-400">
                            <Pencil className="w-2.5 h-2.5 text-zinc-400" />
                            <span>Editable</span>
                          </span>
                          {batchCount > 1 && (
                            <span className="font-mono text-indigo-300/90">
                              x{batchCount} shots
                            </span>
                          )}
                        </div>
                      </div>
                      <textarea
                        rows={Math.min(
                          9,
                          Math.max(
                            3,
                            Math.max(
                              msg.proposedPrompt.split('\n').length,
                              Math.ceil((msg.proposedPrompt.length || 1) / 62)
                            )
                          )
                        )}
                        value={msg.proposedPrompt}
                        onChange={(e) => onUpdateProposedPrompt(msg.id, e.target.value)}
                        disabled={isSubmitting || isExpandingThis}
                        aria-label={isConceptCard ? 'Edit Set Concept' : 'Edit Proposed Prompt'}
                        placeholder="Edit prompt before submitting..."
                        className="w-full text-base md:text-xs text-zinc-100 bg-zinc-900/80 border border-zinc-800/80 focus:border-indigo-500 rounded-lg p-2 font-sans leading-relaxed resize-y focus:outline-none disabled:opacity-60"
                      />
                      {msg.selectedLoras && msg.selectedLoras.length > 0 && (
                        <div className="text-[11px] text-amber-300/90 font-mono truncate">
                          Agent attached:{' '}
                          {msg.selectedLoras
                            .map((l) =>
                              l
                                .replace(/\\/g, '/')
                                .split('/')
                                .pop()!
                                .replace(/\.(safetensors|pt|ckpt|bin)$/i, '')
                            )
                            .join(', ')}
                        </div>
                      )}

                      {/* Inline Editable Expanded Shots Preview */}
                      {hasPreview && (
                        <div className="pt-2 border-t border-zinc-800/90 space-y-2">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[11px] font-semibold text-zinc-200">
                              Expanded Shots Preview ({msg.expandedPrompts!.length}) — Edit individually before submit
                            </span>
                            <button
                              type="button"
                              onClick={() => onCloseExpandedPreview(msg.id)}
                              disabled={isSubmitting || isExpandingThis}
                              className="inline-flex items-center gap-1 text-[11px] text-zinc-400 hover:text-zinc-200 cursor-pointer disabled:opacity-40"
                              title="Collapse shot preview"
                            >
                              <X className="w-3 h-3" />
                              <span>Hide</span>
                            </button>
                          </div>

                          <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                            {msg.expandedPrompts!.map((shotText, idx) => (
                              <div
                                key={`${msg.id}-shot-${idx}`}
                                className="rounded-lg bg-zinc-900/90 border border-zinc-800 p-2 space-y-1"
                              >
                                <label className="block text-[10px] font-mono uppercase tracking-wider text-indigo-300">
                                  Shot {idx + 1}
                                </label>
                                <textarea
                                  rows={3}
                                  value={shotText}
                                  onChange={(e) =>
                                    onUpdateExpandedShot(msg.id, idx, e.target.value)
                                  }
                                  disabled={isSubmitting}
                                  className="w-full px-2 py-1.5 text-base md:text-xs bg-zinc-950 border border-zinc-800 rounded text-zinc-100 focus:outline-none focus:border-indigo-500 resize-y"
                                />
                              </div>
                            ))}
                          </div>

                          <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
                            <button
                              type="button"
                              disabled={isSubmitting || isChatting || Boolean(expandingMessageId)}
                              onClick={() => onPreviewExpand(msg.id, msg.proposedPrompt!)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-zinc-200 font-medium text-xs transition-colors cursor-pointer"
                              title="Re-expand concept into fresh variations"
                            >
                              {isExpandingThis ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <RefreshCw className="w-3.5 h-3.5" />
                              )}
                              <span>{isExpandingThis ? 'Expanding...' : 'Re-expand'}</span>
                            </button>
                            <button
                              type="button"
                              disabled={isSubmitting || isChatting || Boolean(expandingMessageId)}
                              onClick={() =>
                                onSubmitExpandedShots(msg.expandedPrompts!, msg.proposedPrompt!)
                              }
                              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white font-semibold text-xs transition-colors cursor-pointer shadow-sm"
                              title={`Queue all ${msg.expandedPrompts!.length} reviewed prompts to ComfyUI`}
                            >
                              {isSubmitting ? (
                                <>
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                  <span>Submitting...</span>
                                </>
                              ) : (
                                <>
                                  <span>Submit {msg.expandedPrompts!.length} Shots</span>
                                  <ArrowRight className="w-3.5 h-3.5" />
                                </>
                              )}
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Standard Action Row (when preview is not open) */}
                      {!hasPreview && (
                        <div className="flex flex-wrap items-center justify-end gap-2 pt-0.5">
                          {batchCount > 1 && (
                            <button
                              type="button"
                              disabled={
                                isSubmitting ||
                                isChatting ||
                                Boolean(expandingMessageId) ||
                                !msg.proposedPrompt.trim()
                              }
                              onClick={() => onPreviewExpand(msg.id, msg.proposedPrompt!)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 disabled:opacity-40 text-zinc-100 font-medium text-xs transition-colors cursor-pointer"
                              title={`Expand this concept into ${batchCount} editable shot prompts to review before submitting`}
                            >
                              {isExpandingThis ? (
                                <>
                                  <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-300" />
                                  <span>Expanding...</span>
                                </>
                              ) : (
                                <>
                                  <Eye className="w-3.5 h-3.5 text-indigo-300" />
                                  <span>Preview Shots (x{batchCount})</span>
                                </>
                              )}
                            </button>
                          )}

                          <button
                            type="button"
                            disabled={
                              isSubmitting ||
                              isChatting ||
                              Boolean(expandingMessageId) ||
                              !msg.proposedPrompt.trim()
                            }
                            onClick={() => onSubmitPrompt(msg.proposedPrompt!)}
                            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white font-semibold text-xs transition-colors cursor-pointer shadow-sm"
                            title={
                              batchCount > 1
                                ? `Expand this concept into ${batchCount} shot prompts and queue directly to ComfyUI`
                                : 'Submit this prompt to ComfyUI and reset Quick Gen'
                            }
                          >
                            {isSubmitting ? (
                              <>
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                <span>
                                  {batchCount > 1 ? 'Expanding & Submitting...' : 'Submitting...'}
                                </span>
                              </>
                            ) : (
                              <>
                                <span>
                                  {batchCount > 1
                                    ? `Expand & Submit (x${batchCount})`
                                    : 'Submit'}
                                </span>
                                <ArrowRight className="w-3.5 h-3.5" />
                              </>
                            )}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}

        {isChatting && (
          <div className="flex items-start">
            <div className="inline-flex items-center gap-2 px-3 py-2 rounded-2xl bg-zinc-900/95 border border-zinc-800 text-zinc-300">
              <Loader2 className="w-3.5 h-3.5 text-indigo-400 animate-spin shrink-0" />
              <span>Agent is thinking...</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
