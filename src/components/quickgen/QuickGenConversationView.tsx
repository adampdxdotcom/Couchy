import React, { useEffect, useRef } from 'react';
import { ArrowRight, Bot, Loader2, Sparkles, Trash2 } from 'lucide-react';
import type { QuickGenChatMessage } from '../../shared/types.ts';

interface QuickGenConversationViewProps {
  messages: QuickGenChatMessage[];
  isChatting: boolean;
  isSubmitting: boolean;
  batchCount: number;
  onSubmitPrompt: (promptText: string) => void;
  onClearChat: () => void;
}

/**
 * Inline 10-15 line conversation thread inside FloatingQuickGenBar when Agent Conversation mode is active.
 * Displays user/assistant turns and renders a Submit button whenever the LLM proposes a ready prompt.
 */
export const QuickGenConversationView: React.FC<QuickGenConversationViewProps> = ({
  messages,
  isChatting,
  isSubmitting,
  batchCount,
  onSubmitPrompt,
  onClearChat,
}) => {
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll to latest message or thinking indicator
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, isChatting]);

  return (
    <div className="mb-2.5 rounded-2xl bg-zinc-950/90 border border-zinc-800/90 overflow-hidden flex flex-col">
      {/* Header Bar */}
      <div className="px-3 py-1.5 border-b border-zinc-800/80 bg-zinc-900/50 flex items-center justify-between text-[11px]">
        <div className="flex items-center gap-1.5 text-indigo-300 font-medium">
          <Bot className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
          <span>Agent Conversation</span>
        </div>
        {messages.length > 0 && (
          <button
            type="button"
            onClick={onClearChat}
            disabled={isChatting || isSubmitting}
            className="inline-flex items-center gap-1 text-zinc-400 hover:text-zinc-200 disabled:opacity-40 cursor-pointer transition-colors"
            title="Clear conversation history"
          >
            <Trash2 className="w-3 h-3" />
            <span>Clear</span>
          </button>
        )}
      </div>

      {/* ~12-15 Line Scrollable Conversation Body */}
      <div
        ref={scrollContainerRef}
        className="h-64 sm:h-72 overflow-y-auto p-3 space-y-2.5 text-xs leading-relaxed"
      >
        {messages.length === 0 && !isChatting ? (
          <div className="h-full flex flex-col items-center justify-center text-center px-4 text-zinc-400 space-y-1.5">
            <Bot className="w-6 h-6 text-indigo-400/70 stroke-1.5" />
            <p className="text-zinc-300 font-medium">
              Brainstorm your image idea with the LM Studio Agent
            </p>
            <p className="text-[11px] text-zinc-500 max-w-md">
              Describe a rough concept below and press Enter. When the Agent offers a prompt, click{' '}
              <span className="text-indigo-300 font-medium">Submit</span> to generate it or keep
              chatting to refine details.
            </p>
          </div>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
            >
              <div
                className={`max-w-[90%] rounded-2xl px-3 py-2 ${
                  msg.role === 'user'
                    ? 'bg-indigo-600/25 border border-indigo-500/40 text-indigo-100'
                    : 'bg-zinc-900/95 border border-zinc-800 text-zinc-200'
                }`}
              >
                <p className="whitespace-pre-wrap break-words">{msg.content}</p>

                {msg.role === 'assistant' && msg.proposedPrompt && (
                  <div className="mt-2.5 p-2.5 rounded-xl bg-zinc-950 border border-indigo-500/40 space-y-2">
                    <div className="flex items-center justify-between gap-2 text-[10px] font-semibold uppercase tracking-wider text-indigo-300">
                      <span className="inline-flex items-center gap-1">
                        <Sparkles className="w-3 h-3 text-amber-400" />
                        Proposed Prompt
                      </span>
                      {batchCount > 1 && (
                        <span className="font-mono text-zinc-400">x{batchCount} shots</span>
                      )}
                    </div>
                    <p className="text-xs text-zinc-100 bg-zinc-900/80 border border-zinc-800/80 rounded-lg p-2 font-sans whitespace-pre-wrap break-words select-all">
                      {msg.proposedPrompt}
                    </p>
                    <div className="flex items-center justify-end gap-2 pt-0.5">
                      <button
                        type="button"
                        disabled={isSubmitting || isChatting}
                        onClick={() => onSubmitPrompt(msg.proposedPrompt!)}
                        className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white font-semibold text-xs transition-colors cursor-pointer shadow-sm"
                        title="Submit this prompt to ComfyUI and reset Quick Gen"
                      >
                        {isSubmitting ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            <span>Submitting...</span>
                          </>
                        ) : (
                          <>
                            <span>Submit{batchCount > 1 ? ` (x${batchCount})` : ''}</span>
                            <ArrowRight className="w-3.5 h-3.5" />
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))
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
