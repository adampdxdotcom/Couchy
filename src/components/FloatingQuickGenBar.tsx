import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  Bot,
  ChevronDown,
  ChevronUp,
  ImagePlus,
  Layers,
  Loader2,
  Plus,
  Search,
  Sliders,
  Sparkles,
  User,
  X,
} from 'lucide-react';
import { api } from '../api/client.ts';
import type {
  CharacterProfile,
  GenerationLoraSelection,
  ImageLoraRecord,
  ImageRecord,
  LoraExplorerItem,
  WorkflowLibraryItem,
} from '../shared/types.ts';
import {
  ASPECT_RATIO_PRESETS as ASPECT_RATIO_OPTIONS,
  resolveClosestAspectRatio,
  resolveDefaultWorkflow,
} from '../shared/utils.ts';

/**
 * Returns the clean display label for a LoRA in Quick Gen:
 * prefers the user-configured nickname (without @ prefix), falling back to clean name.
 */
function getCleanLoraLabel(
  lora?: {
    nickname?: string | null;
    name?: string;
    loraName?: string;
    filename?: string;
  } | null
): string {
  if (!lora) return 'LoRA';
  const nick = (lora.nickname || '').trim().replace(/^@+/, '');
  if (nick) return nick;
  const cleanName = (lora.name || '').trim();
  if (cleanName) return cleanName;
  return (lora.loraName || lora.filename || 'LoRA').replace(/\.(safetensors|pt|ckpt)$/i, '');
}

/**
 * Downscales an uploaded/dropped image file in the browser so its pixel area is at most ~1MP (1,048,576 px),
 * preserving original aspect ratio and returning a compact JPEG data URL + original dimensions.
 */
async function downscaleImageFileTo1Mp(file: File): Promise<{
  dataUrl: string;
  width: number;
  height: number;
}> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const origW = img.naturalWidth || img.width || 1024;
        const origH = img.naturalHeight || img.height || 1024;
        const maxArea = 1024 * 1024; // 1 Megapixel
        const currentArea = origW * origH;

        let targetW = origW;
        let targetH = origH;
        if (currentArea > maxArea) {
          const scale = Math.sqrt(maxArea / currentArea);
          targetW = Math.max(64, Math.round(origW * scale));
          targetH = Math.max(64, Math.round(origH * scale));
        }

        const canvas = document.createElement('canvas');
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          throw new Error('Could not initialize 2D canvas for image downscaling.');
        }
        // Fill white background for transparent PNGs before JPEG encoding
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, targetW, targetH);
        ctx.drawImage(img, 0, 0, targetW, targetH);

        const dataUrl = canvas.toDataURL('image/jpeg', 0.88);
        URL.revokeObjectURL(objectUrl);
        resolve({ dataUrl, width: origW, height: origH });
      } catch (err) {
        URL.revokeObjectURL(objectUrl);
        reject(err);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Failed to load image file for interrogation.'));
    };
    img.src = objectUrl;
  });
}

export interface QuickGenPrefill {
  prompt: string;
  character?: CharacterProfile | null;
  loras?: ImageLoraRecord[];
  aspectRatio?: string;
  batchCount?: number;
  timestamp: number;
}

/** Normalizes a LoRA filename/path to a lowercase base key without extension. */
function normalizeLoraKey(name: string): string {
  return name
    .trim()
    .replace(/\\/g, '/')
    .split('/')
    .pop()!
    .replace(/\.(safetensors|pt|ckpt)$/i, '')
    .toLowerCase();
}

/** Checks whether a LoRA filename belongs to the given CharacterProfile. */
function isCharacterLora(
  loraName: string,
  character: CharacterProfile | null,
  allLoras: LoraExplorerItem[]
): boolean {
  if (!character) return false;
  const key = normalizeLoraKey(loraName);
  if (character.loras.some((cl) => normalizeLoraKey(cl.loraName) === key)) {
    return true;
  }
  const explorerMatch = allLoras.find(
    (l) => normalizeLoraKey(l.filename) === key || normalizeLoraKey(l.name) === key
  );
  return Boolean(explorerMatch?.characters?.some((c) => c.id === character.id));
}

interface FloatingQuickGenBarProps {
  characters: CharacterProfile[];
  loras?: LoraExplorerItem[];
  allImages: ImageRecord[];
  workflows: WorkflowLibraryItem[];
  prefillPayload?: QuickGenPrefill | null;
  onRefreshAll: () => Promise<void>;
  onOpenGenerationTab: () => void;
  onPushToast: (text: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
  lmStudioOnline?: boolean;
}

const BATCH_COUNT_OPTIONS = [1, 2, 4, 6, 8];

interface MentionEntry {
  key: string;
  type: 'character' | 'image' | 'lora';
  character?: CharacterProfile;
  loraItem?: LoraExplorerItem;
  title: string;
  subtitle: string;
  thumbnailUrl: string | null;
  promptSnippet?: string | null;
}

/**
 * Floating Quick Generation Bar with @character and @lora mention popover,
 * aspect ratio & batch count selectors, and LM Studio Agent toggle.
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
  const [prompt, setPrompt] = useState('');
  const [agentEnabled, setAgentEnabled] = useState(false);

  // Auto-disable agent mode if LM Studio goes offline
  useEffect(() => {
    if (!lmStudioOnline && agentEnabled) {
      setAgentEnabled(false);
    }
  }, [lmStudioOnline, agentEnabled]);
  const [aspectRatio, setAspectRatio] = useState('2:3 (Portrait Photo)');
  const [batchCount, setBatchCount] = useState<number>(1);
  const [attachedCharacter, setAttachedCharacter] = useState<CharacterProfile | null>(null);
  const [attachedLoras, setAttachedLoras] = useState<GenerationLoraSelection[]>([]);
  const [removedLoraKeys, setRemovedLoraKeys] = useState<Set<string>>(new Set());
  const [isHighlighted, setIsHighlighted] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);

  // Popover visibility & filter tab states
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionTab, setMentionTab] = useState<'all' | 'characters' | 'loras'>('all');
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionTriggerRange, setMentionTriggerRange] = useState<{
    start: number;
    end: number;
  } | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [showSettingsMenu, setShowSettingsMenu] = useState(false);

  // Focus & expansion state for prompt textarea
  const [isPromptFocused, setIsPromptFocused] = useState(false);
  const isPromptExpanded = isPromptFocused || prompt.trim().length > 0;

  // Submission & Image Interrogation states
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isInterrogating, setIsInterrogating] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);

  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const lastAppliedTimestampRef = useRef<number | null>(null);

  const handleInterrogateImageFile = async (file: File) => {
    if (!lmStudioOnline) {
      onPushToast('LM Studio is offline — start LM Studio to interrogate images.', 'warning');
      return;
    }
    if (!file.type.startsWith('image/')) {
      onPushToast('Please select or drop a valid image file.', 'warning');
      return;
    }
    if (isInterrogating) return;

    setIsInterrogating(true);
    setIsMinimized(false);
    try {
      const { dataUrl, width, height } = await downscaleImageFileTo1Mp(file);
      const matchedRatio = resolveClosestAspectRatio(width, height);
      setAspectRatio(matchedRatio);

      const res = await api.interrogateImage({
        imageBase64DataUrl: dataUrl,
        characterName: attachedCharacter?.name,
      });

      if (res.prompt) {
        setPrompt(res.prompt);
        setIsHighlighted(true);
        setTimeout(() => setIsHighlighted(false), 1200);
        const modeLabel = res.pipelineUsed === 'vision' ? 'Vision Model' : 'WD14 + LLM';
        onPushToast(`Interrogated image via ${modeLabel} (${matchedRatio})`, 'success');
        setTimeout(() => {
          inputRef.current?.focus({ preventScroll: true });
        }, 50);
      }
    } catch (err: any) {
      onPushToast(err?.message || 'Failed to interrogate uploaded image.', 'error');
    } finally {
      setIsInterrogating(false);
    }
  };

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

  // Handle incoming reuse / prefill requests once per unique timestamp
  useEffect(() => {
    if (!prefillPayload || lastAppliedTimestampRef.current === prefillPayload.timestamp) return;
    lastAppliedTimestampRef.current = prefillPayload.timestamp;

    // Ensure the dock is expanded when reusing a prompt
    setIsMinimized(false);
    setRemovedLoraKeys(new Set());

    if (prefillPayload.prompt !== undefined) {
      setPrompt(prefillPayload.prompt);
    }
    if (prefillPayload.character !== undefined) {
      setAttachedCharacter(prefillPayload.character);
    }
    if (prefillPayload.loras !== undefined) {
      const reusedSelections: GenerationLoraSelection[] = [];
      const seenLoraNames = new Set<string>();

      for (const imgLora of prefillPayload.loras) {
        const rawKey = imgLora.loraName.toLowerCase();
        if (seenLoraNames.has(rawKey)) continue;
        seenLoraNames.add(rawKey);

        const cleanBase = imgLora.loraName.replace(/\.(safetensors|pt|ckpt)$/i, '').toLowerCase();
        const matchedExplorerLora = loras.find(
          (l) =>
            l.filename.toLowerCase() === rawKey ||
            l.name.toLowerCase() === cleanBase
        );

        reusedSelections.push({
          loraName: matchedExplorerLora?.filename || imgLora.loraName,
          modelStrength: Number(
            imgLora.modelStrength ?? matchedExplorerLora?.defaultModelStrength ?? 1.0
          ),
          clipStrength: Number(
            imgLora.clipStrength ?? matchedExplorerLora?.defaultClipStrength ?? 1.0
          ),
          nickname: getCleanLoraLabel(matchedExplorerLora || { loraName: imgLora.loraName }),
          showPill: Boolean(matchedExplorerLora?.mentionEnabled),
        });
      }
      setAttachedLoras(reusedSelections);
    } else {
      setAttachedLoras([]);
    }

    if (prefillPayload.aspectRatio) {
      setAspectRatio(prefillPayload.aspectRatio);
    }
    if (prefillPayload.batchCount !== undefined) {
      setBatchCount(prefillPayload.batchCount);
    }

    // Focus prompt textarea and position cursor at end without forced page scrolling
    setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.focus({ preventScroll: true });
        inputRef.current.setSelectionRange(
          inputRef.current.value.length,
          inputRef.current.value.length
        );
      }
    }, 60);

    // Pulse highlight animation
    setIsHighlighted(true);
    const timer = setTimeout(() => setIsHighlighted(false), 1400);
    return () => clearTimeout(timer);
  }, [prefillPayload, loras]);

  // Build categorized mention candidates for All / Characters / LoRAs tabs
  const { mentionEntries, mentionCounts } = useMemo(() => {
    const q = mentionQuery.trim().toLowerCase();
    const charEntries: MentionEntry[] = [];
    const loraEntries: MentionEntry[] = [];

    // 1. Characters & confirmed character reference images
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
        charEntries.push({
          key: `char-${char.id}`,
          type: 'character',
          character: char,
          title: char.name,
          subtitle: 'Character',
          thumbnailUrl: fallbackThumb,
        });
      }

      // Include recent confirmed images of matching characters (up to 4 per character)
      if (matchesChar || q.length >= 2) {
        for (const img of charImages.slice(0, 4)) {
          const promptLine = (img.positivePrompt || '').trim();
          const shortTitle = promptLine
            ? promptLine.slice(0, 42) + (promptLine.length > 42 ? '...' : '')
            : `${char.name} (${img.filename})`;
          if (!q || matchesChar || shortTitle.toLowerCase().includes(q)) {
            charEntries.push({
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

    // 2. Mention-enabled LoRAs (showing nickname without @ prefix, fallback to clean name)
    const mentionableLoras = loras.filter((l) => l.mentionEnabled);
    for (const lora of mentionableLoras) {
      const nick = (lora.nickname || '').toLowerCase();
      const loraName = lora.name.toLowerCase();
      const loraFile = lora.filename.toLowerCase();

      const matchesLora =
        !q ||
        (nick && nick.includes(q)) ||
        loraName.includes(q) ||
        loraFile.includes(q);

      if (matchesLora) {
        const displayLabel = getCleanLoraLabel(lora);
        loraEntries.push({
          key: `lora-${lora.filename}`,
          type: 'lora',
          loraItem: lora,
          title: displayLabel,
          subtitle: `LoRA · ${lora.loraCategory} · ${(lora.defaultModelStrength ?? 1.0).toFixed(1)}x`,
          thumbnailUrl: null,
          promptSnippet: displayLabel,
        });
      }
    }

    const allCombined = [...charEntries, ...loraEntries];
    const counts = {
      all: allCombined.length,
      characters: charEntries.length,
      loras: loraEntries.length,
    };

    const filteredByTab =
      mentionTab === 'characters'
        ? charEntries
        : mentionTab === 'loras'
        ? loraEntries
        : allCombined;

    return { mentionEntries: filteredByTab, mentionCounts: counts };
  }, [characters, loras, allImages, mentionQuery, mentionTab]);

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

  // Select a character, LoRA, or image from the @mention popover
  const handleSelectMention = (entry: MentionEntry) => {
    let nextPrompt = prompt;

    if (entry.type === 'lora' && entry.loraItem) {
      const lora = entry.loraItem;
      const cleanLabel = getCleanLoraLabel(lora);
      const loraKey = normalizeLoraKey(lora.filename);
      setRemovedLoraKeys((prev) => {
        if (!prev.has(loraKey)) return prev;
        const next = new Set(prev);
        next.delete(loraKey);
        return next;
      });
      // Add to attachedLoras list (or make visible if it was a hidden reused LoRA)
      setAttachedLoras((prev) => {
        const existingIdx = prev.findIndex(
          (al) => normalizeLoraKey(al.loraName) === loraKey
        );
        if (existingIdx >= 0) {
          const updated = [...prev];
          updated[existingIdx] = {
            ...updated[existingIdx],
            nickname: cleanLabel,
            showPill: true,
          };
          return updated;
        }
        return [
          ...prev,
          {
            loraName: lora.filename,
            modelStrength: lora.defaultModelStrength ?? 1.0,
            clipStrength: lora.defaultClipStrength ?? 1.0,
            nickname: cleanLabel,
            showPill: true,
          },
        ];
      });

      // Remove the @mention token from prompt text without leaving stranded '@'
      if (mentionTriggerRange) {
        const before = prompt.slice(0, mentionTriggerRange.start);
        const after = prompt.slice(mentionTriggerRange.end);
        const cleanBefore = before.endsWith(' ') ? before : before ? `${before} ` : '';
        const cleanAfter = after.startsWith(' ') ? after.slice(1) : after;
        nextPrompt = `${cleanBefore}${cleanAfter}`.trim();
      }
    } else if (entry.character) {
      const char = entry.character;
      setAttachedCharacter(char);
      setRemovedLoraKeys((prev) => {
        const next = new Set(prev);
        for (const cl of char.loras) {
          next.delete(normalizeLoraKey(cl.loraName));
        }
        return next;
      });

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
    }

    setPrompt(nextPrompt);
    setMentionOpen(false);
    setMentionTriggerRange(null);
    setMentionQuery('');

    setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.focus({ preventScroll: true });
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
    return resolveDefaultWorkflow(workflows);
  }, [attachedCharacter, workflows]);

  const resolvedShortRatio = useMemo(() => {
    const found = ASPECT_RATIO_OPTIONS.find((r) => r.value === aspectRatio);
    return found ? found.short : '2:3';
  }, [aspectRatio]);

  // Dispatch generation batch using defaults + character LoRAs & all attached LoRAs
  const handleSubmit = async () => {
    const cleanPrompt = prompt.trim();
    if (!cleanPrompt || isSubmitting) return;

    if (!resolvedWorkflow) {
      onPushToast('No ComfyUI API workflow available in Workflows library.', 'error');
      return;
    }

    setIsSubmitting(true);

    try {
      // Merge active character LoRAs with attached/reused LoRAs (excluding any explicitly removed pills)
      const activeCharLoraRecords = attachedCharacter
        ? attachedCharacter.loras.filter(
            (l) => !removedLoraKeys.has(normalizeLoraKey(l.loraName))
          )
        : [];

      const charLoras: GenerationLoraSelection[] = activeCharLoraRecords.map((l) => {
        const matchingAttached = attachedLoras.find(
          (al) => normalizeLoraKey(al.loraName) === normalizeLoraKey(l.loraName)
        );
        return {
          loraName: l.loraName,
          modelStrength: matchingAttached ? matchingAttached.modelStrength : 1.0,
          clipStrength: matchingAttached ? matchingAttached.clipStrength : 1.0,
          triggerWord: l.triggerWord || '',
          appearanceLabel: l.appearanceLabel || '',
        };
      });

      // Combine ensuring unique loraNames across active character LoRAs and attached LoRAs
      const selectedLoras: GenerationLoraSelection[] = [...charLoras];
      for (const al of attachedLoras) {
        const alKey = normalizeLoraKey(al.loraName);
        if (removedLoraKeys.has(alKey)) continue;
        if (!selectedLoras.some((sl) => normalizeLoraKey(sl.loraName) === alKey)) {
          selectedLoras.push(al);
        }
      }

      const triggerWord =
        activeCharLoraRecords.find((l) => l.triggerWord?.trim())?.triggerWord?.trim() || '';

      let promptsToRun: string[] = [];

      if (agentEnabled) {
        const agentRes = await api.generateSetPromptsWithAgent({
          characterName: attachedCharacter?.name || '',
          characterDescription: attachedCharacter?.description || '',
          loraNames: selectedLoras.map((l) => l.loraName),
          theme: cleanPrompt,
          count: batchCount,
          basePromptTemplate: '{theme}',
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
        const loraCountNotice =
          attachedLoras.length > 0 ? ` + ${attachedLoras.length} LoRA(s)` : '';
        onPushToast(
          `Queued Batch #${res.batch.id} (${submittedCount}/${res.batch.totalCount} sent${
            attachedCharacter ? ` · ${attachedCharacter.name}` : ''
          }${loraCountNotice})`,
          'success'
        );
      }

      // Reset prompt, character, attached LoRAs, and controls
      setPrompt('');
      setAttachedCharacter(null);
      setAttachedLoras([]);
      setRemovedLoraKeys(new Set());
      setAgentEnabled(false);
      setAspectRatio('2:3 (Portrait Photo)');
      setBatchCount(1);
      setMentionOpen(false);
      setShowSettingsMenu(false);
      setMentionTriggerRange(null);
      setMentionQuery('');
      setIsPromptFocused(false);
      inputRef.current?.blur();
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
      className="fixed bottom-0 left-0 right-0 z-40 w-full max-w-[100vw] md:bottom-5 md:left-1/2 md:-translate-x-1/2 md:w-[94vw] md:max-w-2xl"
    >
      {/* Minimize / Expand Toggle Tab */}
      <div className="flex justify-center -mb-px px-2">
        <button
          type="button"
          onClick={() => {
            setIsMinimized((prev) => !prev);
            setMentionOpen(false);
            setShowSettingsMenu(false);
          }}
          className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-t-xl bg-zinc-900/98 border-t border-x border-zinc-800 text-xs font-medium text-zinc-300 hover:text-white transition-colors shadow-lg cursor-pointer select-none max-w-full"
          title={isMinimized ? 'Expand Generation Dock' : 'Minimize Generation Dock'}
        >
          {isMinimized ? (
            <>
              <ChevronUp className="w-4 h-4 text-indigo-400 shrink-0" />
              <span className="font-semibold text-zinc-200 shrink-0">Quick Gen</span>
              {prompt.trim() ? (
                <span className="text-[11px] text-zinc-400 truncate max-w-[140px] sm:max-w-[200px]">
                  "{prompt.trim()}"
                </span>
              ) : (
                <span className="text-[10px] text-zinc-500 hidden sm:inline">Tap to expand</span>
              )}
            </>
          ) : (
            <>
              <ChevronDown className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
              <span className="text-[10px] text-zinc-400 uppercase tracking-wider font-semibold">Quick Gen</span>
            </>
          )}
        </button>
      </div>

      {!isMinimized && (
        <>
          {/* Two-Column @Character & @LoRA Mention Popover */}
          {mentionOpen && (
        <div className="mb-2 mx-2 md:mx-0 bg-zinc-950/98 backdrop-blur-2xl border border-zinc-800 rounded-3xl shadow-2xl overflow-hidden text-xs max-w-[calc(100vw-1rem)]">
          {/* Top Search Header */}
          <div className="px-4 py-3 border-b border-zinc-800/80 flex items-center gap-3">
            <div className="relative flex-1 min-w-0">
              <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={mentionQuery}
                onChange={(e) => {
                  setMentionQuery(e.target.value);
                  setActiveIndex(0);
                }}
                placeholder="Search characters, nicknames, or trigger words..."
                className="w-full pl-8 pr-3 py-1.5 bg-zinc-900 border border-indigo-500/60 rounded-full text-zinc-100 placeholder-zinc-500 focus:outline-none"
              />
            </div>
            <button
              type="button"
              onClick={() => setMentionOpen(false)}
              className="p-1.5 text-zinc-400 hover:text-zinc-200 rounded-full hover:bg-zinc-900 cursor-pointer shrink-0"
              title="Close mention picker"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Filter Tabs: All | Characters | LoRAs */}
          <div className="px-4 py-2 border-b border-zinc-800/80 bg-zinc-900/40 flex items-center gap-1.5">
            {(
              [
                { id: 'all', label: 'All', count: mentionCounts.all },
                { id: 'characters', label: 'Characters', count: mentionCounts.characters },
                { id: 'loras', label: 'LoRAs', count: mentionCounts.loras },
              ] as const
            ).map((tab) => {
              const isTabActive = mentionTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    setMentionTab(tab.id);
                    setActiveIndex(0);
                  }}
                  className={`px-3 py-1 rounded-full text-[11px] font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 flex items-center gap-1.5 ${
                    isTabActive
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'bg-zinc-900 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'
                  }`}
                >
                  <span>{tab.label}</span>
                  <span
                    className={`font-mono text-[10px] tabular-nums ${
                      isTabActive ? 'text-indigo-200' : 'text-zinc-500'
                    }`}
                  >
                    {tab.count}
                  </span>
                </button>
              );
            })}
          </div>

          {mentionEntries.length === 0 ? (
            <div className="p-6 text-center text-zinc-400">
              {mentionTab === 'loras'
                ? 'No matching @mention LoRAs found. Enable LoRAs and set nicknames in the LoRA Explorer!'
                : mentionTab === 'characters'
                ? 'No matching characters found. Create a character in the Characters tab to @mention them.'
                : 'No matching characters or @mentioned LoRAs found. Enable LoRAs for @mention in the LoRA Explorer!'}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-12 max-h-[380px]">
              {/* Left Column: Character, LoRA & Image Matches */}
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
                        {entry.type === 'lora' ? (
                          <div className="w-full h-full bg-amber-500/10 flex items-center justify-center text-amber-400">
                            <Layers className="w-4 h-4" />
                          </div>
                        ) : entry.thumbnailUrl ? (
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
                        <div className="flex items-center gap-1.5">
                          <span className="font-medium text-zinc-100 truncate">{entry.title}</span>
                          {entry.type === 'lora' && (
                            <span className="text-[10px] uppercase font-mono px-1.5 py-0.2 rounded bg-amber-400/10 text-amber-300 border border-amber-400/20 shrink-0">
                              LoRA
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-zinc-400 flex items-center gap-1.5">
                          <span>{entry.subtitle}</span>
                          {entry.type === 'character' && entry.character && entry.character.loras.length > 0 && (
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
                    {highlightedEntry.type === 'lora' ? (
                      <div className="flex flex-col items-center gap-2.5 p-4 text-center">
                        <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 shadow-inner">
                          <Layers className="w-6 h-6" />
                        </div>
                        <div>
                          <div className="text-sm font-semibold text-zinc-100">
                            {getCleanLoraLabel(highlightedEntry.loraItem || { name: highlightedEntry.title })}
                          </div>
                        </div>
                        <div className="text-[11px] text-zinc-400 flex items-center gap-2">
                          <span className="capitalize">{highlightedEntry.loraItem?.loraCategory}</span>
                          <span>·</span>
                          <span className="font-mono text-amber-300">
                            Strength: {(highlightedEntry.loraItem?.defaultModelStrength ?? 1.0).toFixed(1)}x
                          </span>
                        </div>
                      </div>
                    ) : highlightedEntry.thumbnailUrl ? (
                      <img
                        src={highlightedEntry.thumbnailUrl}
                        alt={highlightedEntry.title}
                        className="w-full h-full object-contain"
                      />
                    ) : (
                      <div className="flex flex-col items-center gap-2 text-zinc-500">
                        <User className="w-10 h-10 stroke-1" />
                        <span>{highlightedEntry.character?.name}</span>
                      </div>
                    )}
                    <div className="absolute bottom-2 left-2 right-2 px-2.5 py-1.5 rounded-xl bg-zinc-950/85 backdrop-blur-md border border-zinc-800/80 flex items-center justify-between text-[11px]">
                      <span className="font-medium text-zinc-200 truncate">
                        {highlightedEntry.type === 'lora'
                          ? getCleanLoraLabel(highlightedEntry.loraItem || { name: highlightedEntry.title })
                          : highlightedEntry.character?.name}
                      </span>
                      <span className="text-indigo-300 font-mono shrink-0 ml-2">
                        {highlightedEntry.type === 'lora'
                          ? (highlightedEntry.loraItem?.isInstalled ? 'Installed' : 'Missing')
                          : `${highlightedEntry.character?.loras.length || 0} LoRA(s)`}
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
        <div className="mb-2 mr-2 md:mr-0 ml-auto w-72 max-w-[calc(100vw-1rem)] bg-zinc-950/98 backdrop-blur-2xl border border-zinc-800 rounded-2xl p-3.5 shadow-2xl space-y-3 text-xs">
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
                  title={opt.label}
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
      <div
        onDragOver={(e) => {
          if (e.dataTransfer?.types?.includes('Files')) {
            e.preventDefault();
            if (lmStudioOnline && !isInterrogating) {
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
            await handleInterrogateImageFile(droppedFile);
          }
        }}
        className={`w-full max-w-full overflow-hidden bg-zinc-900/98 backdrop-blur-2xl rounded-t-2xl md:rounded-3xl px-3.5 sm:px-4 py-3 border-t border-x md:border border-zinc-800/90 shadow-2xl transition-all duration-300 ${
          isDragOver
            ? 'border-t-amber-400 md:border-amber-400 ring-2 ring-amber-400/50 shadow-amber-500/20'
            : isHighlighted
            ? 'border-t-indigo-500 md:border-indigo-500 ring-2 ring-indigo-500/40 shadow-indigo-500/20'
            : ''
        }`}
      >
        {/* Hidden File Input for Image Interrogation */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) {
              await handleInterrogateImageFile(file);
            }
          }}
        />

        {/* Interrogation / Drag-Over Status Banner */}
        {(isInterrogating || isDragOver) && (
          <div className="mb-2 flex items-center gap-2 px-2.5 py-1 rounded-lg bg-indigo-950/70 border border-indigo-500/40 text-xs text-indigo-200">
            {isInterrogating ? (
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

        {/* Attached Character and LoRA Pill Badges */}
        {(attachedCharacter || attachedLoras.some((l) => l.showPill !== false)) && (
          <div className="mb-2 flex flex-wrap items-center gap-2">
            {/* Character Badge */}
            {attachedCharacter && (
              <div className="inline-flex items-center gap-2 pl-1.5 pr-2.5 py-1 rounded-full bg-indigo-950/70 border border-indigo-500/40 text-xs text-indigo-200 shadow-sm">
                <div className="w-5 h-5 rounded-full bg-zinc-800 overflow-hidden flex items-center justify-center shrink-0">
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
                  onClick={() => {
                    const charToRemove = attachedCharacter;
                    setAttachedCharacter(null);
                    if (charToRemove) {
                      const removedKeys = new Set(
                        charToRemove.loras.map((cl) => normalizeLoraKey(cl.loraName))
                      );
                      setRemovedLoraKeys((prev) => {
                        const next = new Set(prev);
                        removedKeys.forEach((k) => next.add(k));
                        return next;
                      });
                      setAttachedLoras((prev) =>
                        prev.filter(
                          (al) =>
                            !removedKeys.has(normalizeLoraKey(al.loraName)) &&
                            !isCharacterLora(al.loraName, charToRemove, loras) &&
                            al.showPill !== false
                        )
                      );
                    }
                  }}
                  className="text-indigo-300/70 hover:text-white cursor-pointer ml-0.5"
                  title="Remove character"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {/* Mentioned LoRA Badges */}
            {attachedLoras
              .filter((lora) => lora.showPill !== false)
              .map((lora) => {
                const label = getCleanLoraLabel(lora);
                return (
                  <div
                    key={lora.loraName}
                    className="inline-flex items-center gap-1.5 pl-2 pr-2.5 py-1 rounded-full bg-amber-950/60 border border-amber-500/40 text-xs text-amber-200 shadow-sm"
                  >
                    <Layers className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    <span className="font-medium text-amber-100">{label}</span>
                    <span className="text-[11px] font-mono text-amber-300/90 tabular-nums">
                      {lora.modelStrength.toFixed(1)}x
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        const keyToRemove = normalizeLoraKey(lora.loraName);
                        setRemovedLoraKeys((prev) => new Set(prev).add(keyToRemove));
                        setAttachedLoras((prev) => {
                          const remaining = prev.filter(
                            (l) => normalizeLoraKey(l.loraName) !== keyToRemove
                          );
                          // If no visible pills and no character remain, clear any hidden reused LoRAs
                          if (
                            !attachedCharacter &&
                            !remaining.some((l) => l.showPill !== false)
                          ) {
                            return [];
                          }
                          return remaining;
                        });
                      }}
                      className="text-amber-300/70 hover:text-white cursor-pointer ml-0.5"
                      title={`Remove ${label}`}
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })}
          </div>
        )}

        {/* Prompt Textarea Row */}
        <div className="flex items-start gap-2">
          <textarea
            ref={inputRef}
            rows={isPromptExpanded ? 4 : 1}
            value={prompt}
            onChange={handlePromptChange}
            onFocus={() => setIsPromptFocused(true)}
            onBlur={() => setIsPromptFocused(false)}
            onKeyDown={handleKeyDown}
            onPaste={async (e) => {
              const items = e.clipboardData?.items;
              if (!items) return;
              for (const item of Array.from(items)) {
                if (item.type.startsWith('image/')) {
                  const file = item.getAsFile();
                  if (file) {
                    e.preventDefault();
                    await handleInterrogateImageFile(file);
                    return;
                  }
                }
              }
            }}
            placeholder={
              lmStudioOnline
                ? 'What do you want to create? (Type @ for character/LoRA, or drop/paste an image)'
                : 'What do you want to create? (Type @ to mention a character or LoRA)'
            }
            className={`w-full bg-transparent text-zinc-100 placeholder-zinc-500 text-sm resize-none focus:outline-none leading-relaxed transition-[height,min-height] duration-200 overflow-y-auto ${
              isPromptExpanded ? 'min-h-[5.5rem] max-h-36 sm:max-h-48' : 'min-h-[1.5rem] max-h-24'
            }`}
          />
          {prompt.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setPrompt('');
                setAttachedLoras((prev) => prev.filter((l) => l.showPill !== false));
                setMentionOpen(false);
                setIsPromptFocused(false);
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
          {/* Left Controls: + (@character picker), Image Interrogate Upload, & Agent Toggle */}
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => {
                setMentionOpen((prev) => !prev);
                setShowSettingsMenu(false);
                setMentionTriggerRange(null);
              }}
              className="w-8 h-8 rounded-full bg-zinc-800/90 hover:bg-zinc-700 text-zinc-300 flex items-center justify-center transition-colors cursor-pointer shrink-0"
              title="Mention a character (@)"
            >
              {mentionOpen ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
            </button>

            <button
              type="button"
              disabled={!lmStudioOnline || isInterrogating}
              onClick={() => {
                if (!lmStudioOnline || isInterrogating) return;
                fileInputRef.current?.click();
              }}
              className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors shrink-0 ${
                !lmStudioOnline
                  ? 'opacity-40 cursor-not-allowed bg-zinc-800/50 text-zinc-500'
                  : isInterrogating
                  ? 'bg-indigo-600/30 border border-indigo-500/60 text-indigo-200 cursor-wait'
                  : 'bg-zinc-800/90 hover:bg-zinc-700 text-zinc-300 cursor-pointer'
              }`}
              title={
                lmStudioOnline
                  ? 'Upload or drop an image to interrogate into a prompt (auto-downscales to 1MP)'
                  : 'LM Studio is offline — connect LM Studio to interrogate images'
              }
            >
              {isInterrogating ? (
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
                setAgentEnabled((prev) => !prev);
              }}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors shrink-0 ${
                !lmStudioOnline
                  ? 'opacity-40 cursor-not-allowed bg-zinc-800/50 text-zinc-500 border border-transparent'
                  : agentEnabled
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
          </div>

          {/* Right Controls: Workflow / Aspect Ratio / Count Pill + Submit Button */}
          <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
            <button
              type="button"
              onClick={() => {
                setShowSettingsMenu((prev) => !prev);
                setMentionOpen(false);
              }}
              className="inline-flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-1.5 rounded-full bg-zinc-800/90 hover:bg-zinc-700/90 text-zinc-200 text-xs font-medium transition-colors cursor-pointer min-w-0 truncate"
              title="Configure Aspect Ratio & Number of Generations"
            >
              <Sparkles className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span className="truncate max-w-[65px] xs:max-w-[85px] sm:max-w-[110px]">
                {resolvedWorkflow?.name || 'Krea2_turbo'}
              </span>
              <span className="inline-flex items-center gap-1 font-mono text-zinc-300 shrink-0">
                <span className="inline-block w-2 h-3 border border-zinc-400 rounded-[2px]" />
                <span>{resolvedShortRatio}</span>
              </span>
              <span className="font-mono text-zinc-100 shrink-0">x{batchCount}</span>
            </button>

            <button
              type="button"
              onClick={handleSubmit}
              disabled={!prompt.trim() || isSubmitting}
              className="w-8 h-8 rounded-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:hover:bg-zinc-800 disabled:bg-zinc-800 text-white flex items-center justify-center transition-colors cursor-pointer shrink-0 shadow-sm"
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
        </>
      )}
    </div>
  );
};
