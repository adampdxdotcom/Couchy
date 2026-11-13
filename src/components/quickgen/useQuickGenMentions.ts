import React, { useEffect, useMemo, useRef, useState } from 'react';
import type {
  CharacterProfile,
  GenerationLoraSelection,
  ImageRecord,
  LoraExplorerItem,
} from '../../shared/types.ts';
import {
  buildMentionEntries,
  getCleanLoraLabel,
  normalizeLoraKey,
  type MentionEntry,
  type MentionTab,
} from './quickGenUtils.ts';

interface UseQuickGenMentionsParams {
  characters: CharacterProfile[];
  loras: LoraExplorerItem[];
  allImages: ImageRecord[];
  prompt: string;
  setPrompt: React.Dispatch<React.SetStateAction<string>>;
  setAttachedCharacter: React.Dispatch<React.SetStateAction<CharacterProfile | null>>;
  setAttachedLoras: React.Dispatch<React.SetStateAction<GenerationLoraSelection[]>>;
  setRemovedLoraKeys: React.Dispatch<React.SetStateAction<Set<string>>>;
  setShowSettingsMenu: React.Dispatch<React.SetStateAction<boolean>>;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
}

/**
 * Manages @character / @lora mention autocomplete state, keyboard navigation, and selection insertion.
 */
export function useQuickGenMentions({
  characters,
  loras,
  allImages,
  prompt,
  setPrompt,
  setAttachedCharacter,
  setAttachedLoras,
  setRemovedLoraKeys,
  setShowSettingsMenu,
  inputRef,
}: UseQuickGenMentionsParams) {
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionTab, setMentionTab] = useState<MentionTab>('all');
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionTriggerRange, setMentionTriggerRange] = useState<{
    start: number;
    end: number;
  } | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const focusTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (focusTimerRef.current !== null) window.clearTimeout(focusTimerRef.current);
    };
  }, []);

  const { mentionEntries, mentionCounts } = useMemo(
    () =>
      buildMentionEntries({
        characters,
        loras,
        allImages,
        query: mentionQuery,
        tab: mentionTab,
      }),
    [characters, loras, allImages, mentionQuery, mentionTab]
  );

  useEffect(() => {
    if (activeIndex >= mentionEntries.length) {
      setActiveIndex(0);
    }
  }, [mentionEntries.length, activeIndex]);

  const highlightedEntry = mentionEntries[activeIndex] || mentionEntries[0] || null;

  const resetMentions = () => {
    setMentionOpen(false);
    setMentionTriggerRange(null);
    setMentionQuery('');
  };

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
      setAttachedLoras((prev) => {
        const existingIdx = prev.findIndex((al) => normalizeLoraKey(al.loraName) === loraKey);
        if (existingIdx >= 0) {
          const updated = [...prev];
          updated[existingIdx] = {
            ...updated[existingIdx],
            nickname: cleanLabel,
            triggerWord: lora.triggerWord || updated[existingIdx].triggerWord || '',
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
            triggerWord: lora.triggerWord || '',
            nickname: cleanLabel,
            showPill: true,
          },
        ];
      });

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
        const trimmed = prompt.trim();
        if (!trimmed.toLowerCase().includes(char.name.toLowerCase())) {
          nextPrompt = trimmed ? `${char.name} ${trimmed}` : `${char.name} `;
        }
      }
    }

    setPrompt(nextPrompt);
    resetMentions();

    if (focusTimerRef.current !== null) window.clearTimeout(focusTimerRef.current);
    focusTimerRef.current = window.setTimeout(() => {
      inputRef.current?.focus({ preventScroll: true });
    }, 10);
  };

  /** Handles keyboard navigation inside the mention popover. Returns true if the key was handled. */
  const handleMentionKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (!mentionOpen || mentionEntries.length === 0) return false;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((prev) => (prev + 1) % mentionEntries.length);
      return true;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((prev) => (prev - 1 + mentionEntries.length) % mentionEntries.length);
      return true;
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      if (highlightedEntry) handleSelectMention(highlightedEntry);
      return true;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      setMentionOpen(false);
      return true;
    }
    return false;
  };

  return {
    mentionOpen,
    setMentionOpen,
    mentionTab,
    setMentionTab,
    mentionQuery,
    setMentionQuery,
    setMentionTriggerRange,
    activeIndex,
    setActiveIndex,
    mentionEntries,
    mentionCounts,
    highlightedEntry,
    handlePromptChange,
    handleSelectMention,
    handleMentionKeyDown,
    resetMentions,
  };
}
