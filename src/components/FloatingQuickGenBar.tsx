import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  Bot,
  Loader2,
  Plus,
  Search,
  Sparkles,
  User,
  X,
} from 'lucide-react';
import { api } from '../api/client.ts';
import type {
  CharacterProfile,
  GenerationLoraSelection,
  ImageRecord,
  WorkflowLibraryItem,
} from '../shared/types.ts';

interface FloatingQuickGenBarProps {
  characters: CharacterProfile[];
  allImages: ImageRecord[];
  workflows: WorkflowLibraryItem[];
  onRefreshAll: () => Promise<void>;
  onOpenGenerationTab: () => void;
  onPushToast: (text: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
}

const ASPECT_RATIO_OPTIONS = [
  { short: '2:3', value: '2:3 (Portrait Photo)' },
  { short: '1:1', value: '1:1 (Square)' },
  { short: '3:4', value: '3:4 (Portrait)' },
  { short: '9:16', value: '9:16 (Vertical)' },
  { short: '3:2', value: '3:2 (Landscape Photo)' },
  { short: '4:3', value: '4:3 (Landscape)' },
  { short: '16:9', value: '16:9 (Widescreen)' },
];

const BATCH_COUNT_OPTIONS = [1, 2, 4, 6, 8];

interface MentionEntry {
  key: string;
  type: 'character' | 'image';
  character: CharacterProfile;
  title: string;
  subtitle: string;
  thumbnailUrl: string | null;
  promptSnippet?: string | null;
}

/**
 * Floating Quick Generation Bar with @character mention popover,
 * aspect ratio & batch count selectors, and LM Studio Agent toggle.
 */
export const FloatingQuickGenBar: React.FC<FloatingQuickGenBarProps> = ({
  characters,
  allImages,
  workflows,
  onRefreshAll,
  onPushToast,
}) => {
  const [prompt, setPrompt] = useState('');
  const [agentEnabled, setAgentEnabled] = useState(false);
  const [aspectRatio, setAspectRatio] = useState('2:3 (Portrait Photo)');
  const [batchCount, setBatchCount] = useState<number>(1);
  const [attachedCharacter, setAttachedCharacter] = useState<CharacterProfile | null>(null);

  // Popover visibility states
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionTriggerRange, setMentionTriggerRange] = useState<{
    start: number;
    end: number;
  } | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [showSettingsMenu, setShowSettingsMenu] = useState(false);

  // Submission state
  const [isSubmitting, setIsSubmitting] = useState(false);

  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Close popovers when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setMentionOpen(false);
        setShowSettingsMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Build unified mention candidates (Character entries first, followed by confirmed character images)
  const mentionEntries = useMemo<MentionEntry[]>(() => {
    const q = mentionQuery.trim().toLowerCase();
    const entries: MentionEntry[] = [];

    for (const char of characters) {
      const charImages = allImages.filter((img) =>
        img.characters.some((c) => c.characterId === char.id && c.status === 'confirmed')
      );
      const fallbackThumb =
        char.portraitThumbnailUrl || (charImages.length > 0 ? charImages[0].thumbnailUrl : null);

      const matchesChar =
        !q ||
        char.name.toLowerCase().includes(q) ||
        char.aliases.some((a) => a.alias.toLowerCase().includes(q)) ||
        char.loras.some(
          (l) =>
            l.triggerWord?.toLowerCase().includes(q) || l.loraName.toLowerCase().includes(q)
        );

      if (matchesChar) {
        entries.push({
          key: `char-${char.id}`,
          type: 'character',
          character: char,
          title: char.name,
          subtitle: 'Character',
          thumbnailUrl: fallbackThumb,
        });
      }

      // Include recent confirmed images of matching characters (up to 6 per character)
      if (matchesChar || q.length >= 2) {
        for (const img of charImages.slice(0, 6)) {
          const promptLine = (img.positivePrompt || '').trim();
          const shortTitle = promptLine
            ? promptLine.slice(0, 42) + (promptLine.length > 42 ? '...' : '')
            : `${char.name} (${img.filename})`;
          if (!q || matchesChar || shortTitle.toLowerCase().includes(q)) {
            entries.push({
              key: `img-${char.id}-${img.id}`,
              type: 'image',
              character: char,
              title: shortTitle,
              subtitle: 'Image',
              thumbnailUrl: img.thumbnailUrl,
              promptSnippet: promptLine || null,
            });
          }
        }
      }
    }

    return entries;
  }, [characters, allImages, mentionQuery]);

  // Keep activeIndex in bounds
  useEffect(() => {
    if (activeIndex >= mentionEntries.length) {
      setActiveIndex(0);
    }
  }, [mentionEntries.length, activeIndex]);

  const highlightedEntry = mentionEntries[activeIndex] || mentionEntries[0] || null;

  // Detect @mention token near cursor in textarea
  const handlePromptChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setPrompt(val);

    const cursor = e.target.selectionStart ?? val.length;
    const beforeCursor = val.slice(0, cursor);
    const match = beforeCursor.match(/(?:^|\s)@([^\s@]*)$/);

    if (match) {
      const queryText = match[1] || '';
      const atStart = cursor - queryText.length - 1;
      setMentionQuery(queryText);
      setMentionTriggerRange({ start: atStart, end: cursor });
      setMentionOpen(true);
      setShowSettingsMenu(false);
      setActiveIndex(0);
    } else if (mentionTriggerRange) {
      setMentionOpen(false);
      setMentionTriggerRange(null);
    }
  };

  // Select a character/image from the @mention popover
  const handleSelectMention = (entry: MentionEntry) => {
    const char = entry.character;
    setAttachedCharacter(char);

    let nextPrompt = prompt;
    if (mentionTriggerRange) {
      const before = prompt.slice(0, mentionTriggerRange.start);
      const after = prompt.slice(mentionTriggerRange.end);
      const needsTrailingSpace = after.length === 0 || !after.startsWith(' ');
      nextPrompt = `${before}${char.name}${needsTrailingSpace ? ' ' : ''}${after}`;
    } else {
      // Triggered via "+" button
      const trimmed = prompt.trim();
      if (!trimmed.toLowerCase().includes(char.name.toLowerCase())) {
        nextPrompt = trimmed ? `${char.name} ${trimmed}` : `${char.name} `;
      }
    }

    setPrompt(nextPrompt);
    setMentionOpen(false);
    setMentionTriggerRange(null);
    setMentionQuery('');

    setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.focus();
      }
    }, 10);
  };

  // Resolve active workflow & character defaults
  const resolvedWorkflow = useMemo(() => {
    if (attachedCharacter && attachedCharacter.workflows.length > 0) {
      const charWfId = attachedCharacter.workflows[0].workflowId;
      const found = workflows.find((w) => w.id === charWfId && w.hasApiWorkflow);
      if (found) return found;
    }
    return workflows.find((w) => w.hasApiWorkflow) || workflows[0] || null;
  }, [attachedCharacter, workflows]);

  const resolvedShortRatio = useMemo(() => {
    const found = ASPECT_RATIO_OPTIONS.find((r) => r.value === aspectRatio);
    return found ? found.short : '2:3';
  }, [aspectRatio]);

  // Dispatch generation batch using defaults + character LoRAs & trigger word
  const handleSubmit = async () => {
    const cleanPrompt = prompt.trim();
    if (!cleanPrompt || isSubmitting) return;

    if (!resolvedWorkflow) {
      onPushToast('No ComfyUI API workflow available in Workflows library.', 'error');
      return;
    }

    setIsSubmitting(true);

    try {
      const selectedLoras: GenerationLoraSelection[] = attachedCharacter
        ? attachedCharacter.loras.map((l) => ({
            loraName: l.loraName,
            modelStrength: 1.0,
            clipStrength: 1.0,
            triggerWord: l.triggerWord || '',
            appearanceLabel: l.appearanceLabel || '',
          }))
        : [];

      const triggerWord =
        attachedCharacter?.loras.find((l) => l.triggerWord?.trim())?.triggerWord?.trim() || '';

      let promptsToRun: string[] = [];

      if (agentEnabled) {
        const agentRes = await api.generateSetPromptsWithAgent({
          characterName: attachedCharacter?.name || '',
          characterDescription: attachedCharacter?.description || '',
          loraNames: selectedLoras.map((l) => l.loraName),
          theme: cleanPrompt,
          count: batchCount,
          basePromptTemplate: '{character}, {theme}',
        });
        promptsToRun =
          agentRes.prompts && agentRes.prompts.length > 0
            ? agentRes.prompts
            : Array.from({ length: batchCount }, () => cleanPrompt);
      } else {
        promptsToRun = Array.from({ length: batchCount }, () => cleanPrompt);
      }

      const res = await api.submitGenerationBatch({
        characterId: attachedCharacter?.id || null,
        workflowId: resolvedWorkflow.id,
        mode: agentEnabled ? 'theme_set' : 'single',
        themeTitle: cleanPrompt.slice(0, 80),
        aspectRatio,
        megapixels: 3.0,
        prompts: promptsToRun,
        triggerWord,
        negativePrompt: '',
        loras: selectedLoras,
      });

      const submittedCount = res.batch.items.filter((i) => i.status === 'submitted').length;
      const failedCount = res.batch.items.filter((i) => i.status === 'failed').length;

      if (failedCount > 0 && submittedCount === 0) {
        onPushToast(
          `Batch #${res.batch.id} failed (${res.batch.items[0]?.errorMessage || 'ComfyUI offline'})`,
          'warning'
        );
      } else {
        onPushToast(
          `Queued Batch #${res.batch.id} (${submittedCount}/${res.batch.totalCount} sent${
            attachedCharacter ? ` · ${attachedCharacter.name}` : ''
          })`,
          'success'
        );
      }

      setPrompt('');
      await onRefreshAll();
    } catch (err: any) {
      onPushToast(err?.message || 'Failed to submit quick generation.', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionOpen && mentionEntries.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((prev) => (prev + 1) % mentionEntries.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((prev) => (prev - 1 + mentionEntries.length) % mentionEntries.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        if (highlightedEntry) {
          handleSelectMention(highlightedEntry);
        }
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setMentionOpen(false);
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div
      ref={containerRef}
      className="fixed bottom-5 left-1/2 -translate-x-1/2 z-40 w-[94vw] max-w-2xl"
    >

      {/* Two-Column @Character Mention Popover */}
      {mentionOpen && (
        <div className="mb-3 bg-zinc-950/98 backdrop-blur-2xl border border-zinc-800 rounded-3xl shadow-2xl overflow-hidden text-xs">
          {/* Top Search Header */}
          <div className="px-4 py-3 border-b border-zinc-800/80 flex items-center gap-3">
            <div className="relative flex-1">
              <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={mentionQuery}
                onChange={(e) => {
                  setMentionQuery(e.target.value);
                  setActiveIndex(0);
                }}
                placeholder="Search characters or trigger words..."
                className="w-full pl-8 pr-3 py-1.5 bg-zinc-900 border border-indigo-500/60 rounded-full text-zinc-100 placeholder-zinc-500 focus:outline-none"
              />
            </div>
            <button
              type="button"
              onClick={() => setMentionOpen(false)}
              className="p-1.5 text-zinc-400 hover:text-zinc-200 rounded-full hover:bg-zinc-900 cursor-pointer"
              title="Close character picker"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {mentionEntries.length === 0 ? (
            <div className="p-6 text-center text-zinc-400">
              No matching characters found. Create a character in the Characters tab to @mention them.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-12 max-h-[380px]">
              {/* Left Column: Character & Image Matches */}
              <div className="sm:col-span-6 p-2.5 overflow-y-auto max-h-[360px] space-y-1 border-r border-zinc-800/70">
                {mentionEntries.map((entry, idx) => {
                  const isSelected = idx === activeIndex;
                  return (
                    <button
                      key={entry.key}
                      type="button"
                      onMouseEnter={() => setActiveIndex(idx)}
                      onClick={() => handleSelectMention(entry)}
                      className={`w-full flex items-center gap-3 px-2.5 py-2 rounded-2xl text-left transition-colors cursor-pointer ${
                        isSelected
                          ? 'bg-zinc-800/95 text-zinc-100'
                          : 'hover:bg-zinc-900/80 text-zinc-300'
                      }`}
                    >
                      <div className="w-9 h-9 rounded-xl bg-zinc-900 border border-zinc-700/60 overflow-hidden shrink-0 flex items-center justify-center">
                        {entry.thumbnailUrl ? (
                          <img
                            src={entry.thumbnailUrl}
                            alt={entry.title}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <User className="w-4 h-4 text-zinc-500" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-zinc-100 truncate">{entry.title}</div>
                        <div className="text-[11px] text-zinc-400 flex items-center gap-1.5">
                          <span>{entry.subtitle}</span>
                          {entry.type === 'character' && entry.character.loras.length > 0 && (
                            <span className="text-indigo-400 font-mono truncate">
                              · {entry.character.loras[0].triggerWord || entry.character.loras[0].loraName}
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Right Column: Large Preview & "Add to prompt" Action */}
              {highlightedEntry && (
                <div className="sm:col-span-6 p-3.5 flex flex-col justify-between bg-zinc-950/60">
                  <div className="relative rounded-2xl bg-zinc-900 border border-zinc-800/80 overflow-hidden h-56 flex items-center justify-center">
                    {highlightedEntry.thumbnailUrl ? (
                      <img
                        src={highlightedEntry.thumbnailUrl}
                        alt={highlightedEntry.title}
                        className="w-full h-full object-contain"
                      />
                    ) : (
                      <div className="flex flex-col items-center gap-2 text-zinc-500">
                        <User className="w-10 h-10 stroke-1" />
                        <span>{highlightedEntry.character.name}</span>
                      </div>
                    )}
                    <div className="absolute bottom-2 left-2 right-2 px-2.5 py-1.5 rounded-xl bg-zinc-950/85 backdrop-blur-md border border-zinc-800/80 flex items-center justify-between text-[11px]">
                      <span className="font-medium text-zinc-200 truncate">
                        {highlightedEntry.character.name}
                      </span>
                      <span className="text-indigo-300 font-mono shrink-0 ml-2">
                        {highlightedEntry.character.loras.length} LoRA(s)
                      </span>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleSelectMention(highlightedEntry)}
                    className="mt-3 w-full py-2 px-4 rounded-full bg-zinc-100 hover:bg-white text-zinc-950 font-semibold text-xs transition-colors cursor-pointer"
                  >
                    Add to prompt
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Aspect Ratio & Batch Count Popover */}
      {showSettingsMenu && (
        <div className="mb-3 ml-auto w-72 bg-zinc-950/98 backdrop-blur-2xl border border-zinc-800 rounded-2xl p-3.5 shadow-2xl space-y-3 text-xs">
          <div>
            <span className="block text-[11px] font-medium text-zinc-400 mb-1.5">
              Aspect Ratio (Node #49)
            </span>
            <div className="grid grid-cols-4 gap-1.5">
              {ASPECT_RATIO_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setAspectRatio(opt.value)}
                  className={`px-2 py-1.5 rounded-lg font-mono text-[11px] border transition-colors cursor-pointer ${
                    aspectRatio === opt.value
                      ? 'bg-indigo-600/30 border-indigo-500 text-indigo-200 font-semibold'
                      : 'bg-zinc-900 border-zinc-800 text-zinc-300 hover:bg-zinc-800'
                  }`}
                >
                  {opt.short}
                </button>
              ))}
            </div>
          </div>

          <div>
            <span className="block text-[11px] font-medium text-zinc-400 mb-1.5">
              Number of Generations
            </span>
            <div className="grid grid-cols-5 gap-1.5">
              {BATCH_COUNT_OPTIONS.map((cnt) => (
                <button
                  key={cnt}
                  type="button"
                  onClick={() => setBatchCount(cnt)}
                  className={`px-2 py-1.5 rounded-lg font-mono text-[11px] border transition-colors cursor-pointer ${
                    batchCount === cnt
                      ? 'bg-indigo-600/30 border-indigo-500 text-indigo-200 font-semibold'
                      : 'bg-zinc-900 border-zinc-800 text-zinc-300 hover:bg-zinc-800'
                  }`}
                >
                  x{cnt}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Main Floating Quick Generation Box */}
      <div className="bg-zinc-900/95 backdrop-blur-2xl border border-zinc-800/90 rounded-3xl px-4 py-3 shadow-2xl">
        {/* Attached Character Pill Badge */}
        {attachedCharacter && (
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center gap-2 pl-1.5 pr-2.5 py-1 rounded-full bg-indigo-950/70 border border-indigo-500/40 text-xs text-indigo-200">
              <div className="w-5 h-5 rounded-full bg-zinc-800 overflow-hidden flex items-center justify-center">
                {attachedCharacter.portraitThumbnailUrl ? (
                  <img
                    src={attachedCharacter.portraitThumbnailUrl}
                    alt={attachedCharacter.name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <User className="w-3 h-3 text-indigo-300" />
                )}
              </div>
              <span className="font-medium">{attachedCharacter.name}</span>
              {attachedCharacter.loras[0]?.triggerWord && (
                <span className="text-[11px] font-mono text-indigo-300/90">
                  ({attachedCharacter.loras[0].triggerWord})
                </span>
              )}
              <button
                type="button"
                onClick={() => setAttachedCharacter(null)}
                className="text-indigo-300/70 hover:text-white cursor-pointer"
                title="Remove character LoRA & trigger word"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* Prompt Textarea Row */}
        <div className="flex items-start gap-2">
          <textarea
            ref={inputRef}
            rows={1}
            value={prompt}
            onChange={handlePromptChange}
            onKeyDown={handleKeyDown}
            placeholder="What do you want to create? (Type @ to mention a character)"
            className="w-full bg-transparent text-zinc-100 placeholder-zinc-500 text-sm resize-none focus:outline-none leading-relaxed max-h-24 overflow-y-auto"
          />
          {prompt.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setPrompt('');
                setMentionOpen(false);
              }}
              className="p-1 text-zinc-500 hover:text-zinc-300 cursor-pointer shrink-0"
              title="Clear prompt"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Bottom Control Bar */}
        <div className="mt-2.5 flex items-center justify-between gap-2">
          {/* Left Controls: + (@character picker) & Agent Toggle */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setMentionOpen((prev) => !prev);
                setShowSettingsMenu(false);
                setMentionTriggerRange(null);
              }}
              className="w-8 h-8 rounded-full bg-zinc-800/90 hover:bg-zinc-700 text-zinc-300 flex items-center justify-center transition-colors cursor-pointer"
              title="Mention a character (@)"
            >
              {mentionOpen ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
            </button>

            <button
              type="button"
              onClick={() => setAgentEnabled((prev) => !prev)}
              className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-medium transition-colors cursor-pointer ${
                agentEnabled
                  ? 'bg-indigo-600/25 border border-indigo-500/60 text-indigo-200'
                  : 'bg-zinc-800/90 hover:bg-zinc-700 text-zinc-300 border border-transparent'
              }`}
              title="Toggle LM Studio Agent to expand your prompt into a themed photo set"
            >
              <Bot className="w-3.5 h-3.5" />
              <span>Agent</span>
            </button>
          </div>

          {/* Right Controls: Workflow / Aspect Ratio / Count Pill + Submit Button */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setShowSettingsMenu((prev) => !prev);
                setMentionOpen(false);
              }}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-zinc-800/90 hover:bg-zinc-700/90 text-zinc-200 text-xs font-medium transition-colors cursor-pointer"
              title="Configure Aspect Ratio & Number of Generations"
            >
              <Sparkles className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span className="truncate max-w-[110px]">
                {resolvedWorkflow?.name || 'Krea2_turbo'}
              </span>
              <span className="inline-flex items-center gap-1 font-mono text-zinc-300">
                <span className="inline-block w-2.5 h-3.5 border border-zinc-400 rounded-[2px]" />
                <span>{resolvedShortRatio}</span>
              </span>
              <span className="font-mono text-zinc-100">x{batchCount}</span>
            </button>

            <button
              type="button"
              onClick={handleSubmit}
              disabled={!prompt.trim() || isSubmitting}
              className="w-8 h-8 rounded-full bg-zinc-800 hover:bg-indigo-600 disabled:opacity-40 disabled:hover:bg-zinc-800 text-zinc-100 flex items-center justify-center transition-colors cursor-pointer"
              title="Submit quick generation"
            >
              {isSubmitting ? (
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
