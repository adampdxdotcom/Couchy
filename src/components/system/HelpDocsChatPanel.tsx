import React, { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ArrowRight, Bot, Loader2, Sparkles, Trash2 } from 'lucide-react';
import { api } from '../../api/client.ts';
import type { HelpChatMessage, LmStudioStatus } from '../../shared/types.ts';

interface HelpDocsChatPanelProps {
  lmStatus: LmStudioStatus;
  onJumpToSection: (sectionId: string) => void;
}

const STARTER_QUESTIONS = [
  'What are the Inspector curation and stack navigation hotkeys?',
  'How does Civitai Activity Notifications and LoRA linking work?',
  'How does Agent Set Concept mode (x2–x8) work?',
  'How do I configure extra_model_paths.yaml?',
];

/**
 * Sticky Local LLM Help Assistant panel (only shown when a Local LLM is online).
 * Grounds answers across all User Manual chapters and links back to cited headings.
 */
export const HelpDocsChatPanel: React.FC<HelpDocsChatPanelProps> = ({
  lmStatus,
  onJumpToSection,
}) => {
  const [messages, setMessages] = useState<HelpChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isAsking, setIsAsking] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, isAsking]);

  const sendQuestion = async (questionText: string) => {
    const trimmed = questionText.trim();
    if (!trimmed || isAsking) return;

    const userMsg: HelpChatMessage = {
      id: `help-u-${Date.now()}`,
      role: 'user',
      content: trimmed,
    };
    const nextHistory = [...messages, userMsg];
    setMessages(nextHistory);
    setInput('');
    setErrorMsg(null);
    setIsAsking(true);

    try {
      const res = await api.askHelpAssistant(
        nextHistory.map((m) => ({ role: m.role, content: m.content }))
      );
      const assistantMsg: HelpChatMessage = {
        id: `help-a-${Date.now()}`,
        role: 'assistant',
        content: res.reply,
        matchedSections: res.matchedSections,
        modelUsed: res.modelUsed,
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to get an answer from the Local LLM.');
    } finally {
      setIsAsking(false);
    }
  };

  return (
    <aside className="bg-zinc-900 border border-zinc-800 rounded-xl flex flex-col lg:sticky lg:top-20 h-[560px] lg:h-[calc(100vh-12rem)] min-h-[420px] max-h-[760px] overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-zinc-800 bg-zinc-900/95 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Bot className="w-4 h-4 text-indigo-400 shrink-0" />
            <h3 className="font-display font-semibold text-zinc-100 truncate">
              Ask the Docs
            </h3>
          </div>
          <p className="text-[11px] text-zinc-400 font-mono truncate mt-0.5">
            Searching User Manual via {lmStatus.selectedModel || 'Local LLM'}
          </p>
        </div>
        {messages.length > 0 && (
          <button
            type="button"
            disabled={isAsking}
            onClick={() => {
              setMessages([]);
              setErrorMsg(null);
            }}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-zinc-300 text-[11px] cursor-pointer shrink-0"
            title="Clear Help chat history"
          >
            <Trash2 className="w-3 h-3" />
            <span>Clear</span>
          </button>
        )}
      </div>

      {/* Chat Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3.5 space-y-3 text-xs">
        {messages.length === 0 && !isAsking ? (
          <div className="h-full flex flex-col justify-center items-center text-center px-2 space-y-3">
            <Sparkles className="w-6 h-6 text-indigo-400/80" />
            <div className="space-y-1">
              <p className="font-medium text-zinc-200">
                Search Couchy&apos;s User Manual with your Local LLM
              </p>
              <p className="text-[11px] text-zinc-400 leading-relaxed">
                Ask across all chapters about hotkeys, Civitai metrics, Agent prompts, LoRA downloads, or Docker setup.
              </p>
            </div>
            <div className="w-full space-y-1.5 pt-1">
              {STARTER_QUESTIONS.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => void sendQuestion(q)}
                  className="w-full text-left px-3 py-2 rounded-lg bg-zinc-950 hover:bg-zinc-800/80 border border-zinc-800 text-zinc-300 text-[11px] transition-colors cursor-pointer"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
            >
              <div
                className={`max-w-[94%] rounded-xl px-3 py-2.5 leading-relaxed ${
                  msg.role === 'user'
                    ? 'bg-indigo-600/25 border border-indigo-500/40 text-indigo-100 whitespace-pre-wrap'
                    : 'bg-zinc-950 border border-zinc-800 text-zinc-200 space-y-2'
                }`}
              >
                {msg.role === 'user' ? (
                  msg.content
                ) : (
                  <>
                    <div className="space-y-2 break-words [&_p]:leading-relaxed [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:list-decimal [&_ol]:pl-4 [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:bg-zinc-900 [&_code]:text-indigo-300 [&_code]:font-mono [&_code]:text-[11px] [&_pre]:p-2.5 [&_pre]:rounded-lg [&_pre]:bg-zinc-900 [&_pre]:overflow-x-auto [&_strong]:text-zinc-100">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                    </div>
                    {msg.matchedSections && msg.matchedSections.length > 0 && (
                      <div className="pt-2 border-t border-zinc-800/90 flex flex-wrap items-center gap-1.5">
                        <span className="text-[10px] uppercase tracking-wider text-zinc-500">
                          Sources:
                        </span>
                        {msg.matchedSections.slice(0, 3).map((sec) => (
                          <button
                            key={sec.id}
                            type="button"
                            onClick={() => onJumpToSection(sec.id)}
                            className="px-2 py-0.5 rounded bg-zinc-900 hover:bg-indigo-600/20 border border-zinc-800 hover:border-indigo-500/40 text-[10px] text-indigo-300 transition-colors cursor-pointer truncate max-w-[200px]"
                            title={
                              sec.chapterTitle && sec.chapterTitle !== sec.title
                                ? `Jump to ${sec.chapterTitle} › ${sec.title}`
                                : `Jump to ${sec.title}`
                            }
                          >
                            {sec.title}
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          ))
        )}

        {isAsking && (
          <div className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-zinc-300">
            <Loader2 className="w-3.5 h-3.5 text-indigo-400 animate-spin" />
            <span>Searching manual chapters...</span>
          </div>
        )}

        {errorMsg && (
          <div className="p-2.5 rounded-lg bg-rose-950/50 border border-rose-800/60 text-rose-200 text-[11px]">
            {errorMsg}
          </div>
        )}
      </div>

      {/* Input Bar */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void sendQuestion(input);
        }}
        className="p-3 border-t border-zinc-800 bg-zinc-950/70 flex items-end gap-2"
      >
        <textarea
          rows={2}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void sendQuestion(input);
            }
          }}
          placeholder="Ask a question about Couchy... (Enter to send)"
          className="flex-1 px-3 py-2 bg-zinc-900 border border-zinc-800 focus:border-indigo-500 rounded-lg text-xs text-zinc-100 placeholder-zinc-500 resize-none focus:outline-none"
        />
        <button
          type="submit"
          disabled={!input.trim() || isAsking}
          className="w-9 h-9 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white flex items-center justify-center shrink-0 cursor-pointer transition-colors"
          title="Ask User Manual Assistant"
        >
          {isAsking ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <ArrowRight className="w-4 h-4" />
          )}
        </button>
      </form>
    </aside>
  );
};
