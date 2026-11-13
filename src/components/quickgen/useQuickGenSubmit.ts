import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api/client.ts';
import type {
  CharacterProfile,
  GenerationLoraSelection,
  LoraExplorerItem,
  QuickGenChatMessage,
  WorkflowLibraryItem,
} from '../../shared/types.ts';
import { resolveClosestAspectRatio, resolveDefaultWorkflow } from '../../shared/utils.ts';
import {
  downscaleImageFileTo1Mp,
  getCleanLoraLabel,
  isCharacterLora,
  normalizeLoraKey,
  snapToHalfMp,
  type QuickGenPrefill,
} from './quickGenUtils.ts';

interface UseQuickGenSubmitParams {
  loras: LoraExplorerItem[];
  workflows: WorkflowLibraryItem[];
  prefillPayload?: QuickGenPrefill | null;
  lmStudioOnline: boolean;
  onRefreshAll: () => Promise<void>;
  onPushToast: (text: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
}

/**
 * Manages Quick Gen form state, workflow default syncing, reuse prefill hydration,
 * image interrogation, attachment removal, Agent Conversation turns, and batch submission.
 */
export function useQuickGenSubmit({
  loras,
  workflows,
  prefillPayload,
  lmStudioOnline,
  onRefreshAll,
  onPushToast,
  inputRef,
}: UseQuickGenSubmitParams) {
  const [prompt, setPrompt] = useState('');
  const [agentEnabled, setAgentEnabled] = useState(false);
  const [conversationEnabled, setConversationEnabled] = useState(false);
  const [chatMessages, setChatMessages] = useState<QuickGenChatMessage[]>([]);
  const [activeSeriesId, setActiveSeriesId] = useState<number | null>(null);
  const [branchFromImageId, setBranchFromImageId] = useState<number | null>(null);
  const [isChatting, setIsChatting] = useState(false);

  const [aspectRatio, setAspectRatio] = useState('2:3 (Portrait Photo)');
  const [megapixels, setMegapixels] = useState<number>(3.0);
  const [batchCount, setBatchCount] = useState<number>(1);
  const [attachedCharacter, setAttachedCharacter] = useState<CharacterProfile | null>(null);
  const [attachedLoras, setAttachedLoras] = useState<GenerationLoraSelection[]>([]);
  const [removedLoraKeys, setRemovedLoraKeys] = useState<Set<string>>(new Set());
  const [isHighlighted, setIsHighlighted] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [showSettingsMenu, setShowSettingsMenu] = useState(false);
  const [isPromptFocused, setIsPromptFocused] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isInterrogating, setIsInterrogating] = useState(false);

  const lastAppliedTimestampRef = useRef<number | null>(null);
  const highlightTimerRef = useRef<number | null>(null);
  const focusTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (highlightTimerRef.current !== null) window.clearTimeout(highlightTimerRef.current);
      if (focusTimerRef.current !== null) window.clearTimeout(focusTimerRef.current);
    };
  }, []);

  // Auto-disable agent and conversation mode if LM Studio goes offline
  useEffect(() => {
    if (!lmStudioOnline) {
      if (agentEnabled) setAgentEnabled(false);
      if (conversationEnabled) setConversationEnabled(false);
    }
  }, [lmStudioOnline, agentEnabled, conversationEnabled]);

  // Turn off conversation mode if Agent is turned off; lock batchCount to 1 in Conversation mode
  useEffect(() => {
    if (!agentEnabled && conversationEnabled) {
      setConversationEnabled(false);
    }
    if (conversationEnabled && batchCount !== 1) {
      setBatchCount(1);
    }
  }, [agentEnabled, conversationEnabled, batchCount]);

  const pulseHighlight = (durationMs = 1400) => {
    if (highlightTimerRef.current !== null) window.clearTimeout(highlightTimerRef.current);
    setIsHighlighted(true);
    highlightTimerRef.current = window.setTimeout(() => setIsHighlighted(false), durationMs);
  };

  const focusInputAtEnd = (delayMs = 60, moveToEnd = true) => {
    if (focusTimerRef.current !== null) window.clearTimeout(focusTimerRef.current);
    focusTimerRef.current = window.setTimeout(() => {
      if (!inputRef.current) return;
      inputRef.current.focus({ preventScroll: true });
      if (moveToEnd) {
        const len = inputRef.current.value.length;
        inputRef.current.setSelectionRange(len, len);
      }
    }, delayMs);
  };

  // Resolve primary system workflow & defaults
  const resolvedWorkflow = useMemo(() => resolveDefaultWorkflow(workflows), [workflows]);

  const workflowDefaultMp = useMemo(
    () => snapToHalfMp(resolvedWorkflow?.defaultMegapixels, 3.0),
    [resolvedWorkflow?.defaultMegapixels]
  );

  const workflowDefaultAr = useMemo(
    () => resolvedWorkflow?.defaultAspectRatio || '2:3 (Portrait Photo)',
    [resolvedWorkflow?.defaultAspectRatio]
  );

  useEffect(() => {
    setMegapixels(workflowDefaultMp);
  }, [resolvedWorkflow?.id, workflowDefaultMp]);

  useEffect(() => {
    setAspectRatio(workflowDefaultAr);
  }, [resolvedWorkflow?.id, workflowDefaultAr]);

  // Build active LoRAs and combined comma-separated trigger word from character + attached LoRAs
  const resolveActiveLoraStack = () => {
    const activeCharLoraRecords = attachedCharacter
      ? attachedCharacter.loras.filter((l) => !removedLoraKeys.has(normalizeLoraKey(l.loraName)))
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

    const selectedLoras: GenerationLoraSelection[] = [...charLoras];
    for (const al of attachedLoras) {
      const alKey = normalizeLoraKey(al.loraName);
      if (removedLoraKeys.has(alKey)) continue;
      if (!selectedLoras.some((sl) => normalizeLoraKey(sl.loraName) === alKey)) {
        const matchedExplorer = loras.find(
          (l) => normalizeLoraKey(l.filename) === alKey || normalizeLoraKey(l.name) === alKey
        );
        selectedLoras.push({
          ...al,
          triggerWord: al.triggerWord?.trim() || matchedExplorer?.triggerWord?.trim() || '',
        });
      }
    }

    // Join unique trigger tokens (character trigger words first, then active pilled LoRAs) comma-separated
    const triggerTokens: string[] = [];
    const seenTokens = new Set<string>();
    const appendTriggerTokens = (raw?: string | null) => {
      if (!raw) return;
      for (const part of raw.split(',')) {
        const trimmed = part.trim();
        const lower = trimmed.toLowerCase();
        if (trimmed && !seenTokens.has(lower)) {
          seenTokens.add(lower);
          triggerTokens.push(trimmed);
        }
      }
    };

    for (const cl of activeCharLoraRecords) {
      appendTriggerTokens(cl.triggerWord);
    }
    for (const sl of selectedLoras) {
      appendTriggerTokens(sl.triggerWord);
    }

    const triggerWord = triggerTokens.join(', ');

    return { selectedLoras, triggerWord };
  };

  // Handle incoming reuse / prefill requests once per unique timestamp
  useEffect(() => {
    if (!prefillPayload || lastAppliedTimestampRef.current === prefillPayload.timestamp) return;
    lastAppliedTimestampRef.current = prefillPayload.timestamp;

    setIsMinimized(false);
    setRemovedLoraKeys(
      new Set((prefillPayload.excludedLoras || []).map((k) => normalizeLoraKey(k)).filter(Boolean))
    );

    if (prefillPayload.prompt !== undefined) setPrompt(prefillPayload.prompt);
    if (prefillPayload.character !== undefined) setAttachedCharacter(prefillPayload.character);

    if (prefillPayload.loras !== undefined) {
      const reusedSelections: GenerationLoraSelection[] = [];
      const seenLoraNames = new Set<string>();

      for (const imgLora of prefillPayload.loras) {
        const rawKey = imgLora.loraName.toLowerCase();
        if (seenLoraNames.has(rawKey)) continue;
        seenLoraNames.add(rawKey);

        const cleanBase = imgLora.loraName.replace(/\.(safetensors|pt|ckpt)$/i, '').toLowerCase();
        const matchedExplorerLora = loras.find(
          (l) => l.filename.toLowerCase() === rawKey || l.name.toLowerCase() === cleanBase
        );

        reusedSelections.push({
          loraName: matchedExplorerLora?.filename || imgLora.loraName,
          modelStrength: Number(
            imgLora.modelStrength ?? matchedExplorerLora?.defaultModelStrength ?? 1.0
          ),
          clipStrength: Number(
            imgLora.clipStrength ?? matchedExplorerLora?.defaultClipStrength ?? 1.0
          ),
          triggerWord: matchedExplorerLora?.triggerWord || '',
          nickname: getCleanLoraLabel(matchedExplorerLora || { loraName: imgLora.loraName }),
          showPill: Boolean(matchedExplorerLora?.mentionEnabled),
        });
      }
      setAttachedLoras(reusedSelections);
    } else {
      setAttachedLoras([]);
    }

    if (prefillPayload.aspectRatio) setAspectRatio(prefillPayload.aspectRatio);
    if (prefillPayload.megapixels !== undefined) {
      setMegapixels(snapToHalfMp(prefillPayload.megapixels, workflowDefaultMp));
    }
    if (prefillPayload.batchCount !== undefined) setBatchCount(prefillPayload.batchCount);

    if (prefillPayload.conversationMode) {
      setAgentEnabled(true);
      setConversationEnabled(true);
      setBatchCount(1);
      setChatMessages(prefillPayload.chatMessages || []);
      setActiveSeriesId(prefillPayload.seriesId ?? null);
      setBranchFromImageId(prefillPayload.branchFromImageId ?? null);
    } else {
      setActiveSeriesId(null);
      setBranchFromImageId(null);
    }

    focusInputAtEnd(60, true);
    pulseHighlight(1400);
  }, [prefillPayload, loras, workflowDefaultMp]);

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
        pulseHighlight(1200);
        const modeLabel = res.pipelineUsed === 'vision' ? 'Vision Model' : 'WD14 + LLM';
        onPushToast(`Interrogated image via ${modeLabel} (${matchedRatio})`, 'success');
        focusInputAtEnd(50, false);
      }
    } catch (err: any) {
      onPushToast(err?.message || 'Failed to interrogate uploaded image.', 'error');
    } finally {
      setIsInterrogating(false);
    }
  };

  const handleRemoveCharacter = () => {
    const charToRemove = attachedCharacter;
    setAttachedCharacter(null);
    if (!charToRemove) return;

    const removedKeys = new Set(charToRemove.loras.map((cl) => normalizeLoraKey(cl.loraName)));
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
  };

  const handleRemoveLora = (loraName: string) => {
    const keyToRemove = normalizeLoraKey(loraName);
    const nextRemoved = new Set(removedLoraKeys);
    nextRemoved.add(keyToRemove);
    setRemovedLoraKeys(nextRemoved);

    setAttachedLoras((prev) => {
      const remaining = prev.filter((l) => normalizeLoraKey(l.loraName) !== keyToRemove);
      if (!attachedCharacter && !remaining.some((l) => l.showPill !== false)) {
        return [];
      }
      return remaining;
    });

    if (conversationEnabled) {
      const nextExcludedArray = Array.from(nextRemoved);
      setChatMessages((prev) => {
        if (prev.length === 0) return prev;
        const lastAssistantIdx = [...prev].reverse().findIndex((m) => m.role === 'assistant');
        if (lastAssistantIdx < 0) return prev;
        const actualIdx = prev.length - 1 - lastAssistantIdx;
        return prev.map((m, idx) =>
          idx === actualIdx ? { ...m, excludedLoras: nextExcludedArray } : m
        );
      });
    }
  };

  /** Sends a conversational turn to LM Studio when Conversation mode is active. */
  const handleSendChatTurn = async () => {
    const cleanInput = prompt.trim();
    if (!cleanInput || isChatting || isSubmitting) return;

    const userMsg: QuickGenChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: cleanInput,
    };
    const nextHistory = [...chatMessages, userMsg];
    setChatMessages(nextHistory);
    setPrompt('');
    setIsChatting(true);

    try {
      const { selectedLoras } = resolveActiveLoraStack();
      const currentRemovedKeys = Array.from(removedLoraKeys);
      const res = await api.chatQuickGenPrompt({
        messages: nextHistory.map((m) => ({
          role: m.role,
          content: m.content,
          proposedPrompt: m.proposedPrompt ?? undefined,
        })),
        characterName: attachedCharacter?.name || undefined,
        characterDescription: attachedCharacter?.description || undefined,
        loraNames: selectedLoras.map((l) => l.loraName),
        excludedLoras: currentRemovedKeys,
      });

      const resolvedPickedLoras: LoraExplorerItem[] = [];
      if (Array.isArray(res.selectedLoras) && res.selectedLoras.length > 0) {
        const seenKeys = new Set<string>();
        for (const pickedName of res.selectedLoras) {
          if (resolvedPickedLoras.length >= 3) break;
          const pickedKey = normalizeLoraKey(pickedName);
          if (!pickedKey || seenKeys.has(pickedKey) || removedLoraKeys.has(pickedKey)) continue;
          const matched = loras.find(
            (l) =>
              normalizeLoraKey(l.filename) === pickedKey || normalizeLoraKey(l.name) === pickedKey
          );
          if (!matched) continue;
          // Character LoRAs stay locked to Characters
          if (
            matched.loraCategory === 'character' ||
            matched.characters.length > 0 ||
            isCharacterLora(matched.filename, attachedCharacter, loras)
          ) {
            continue;
          }
          seenKeys.add(pickedKey);
          resolvedPickedLoras.push(matched);
        }
      }

      if (resolvedPickedLoras.length > 0) {
        setAttachedLoras((prev) => {
          const next = [...prev];
          for (const matched of resolvedPickedLoras) {
            const matchedKey = normalizeLoraKey(matched.filename);
            if (removedLoraKeys.has(matchedKey)) continue;
            const existingIdx = next.findIndex((al) => normalizeLoraKey(al.loraName) === matchedKey);
            const cleanLabel = getCleanLoraLabel(matched);
            if (existingIdx >= 0) {
              next[existingIdx] = {
                ...next[existingIdx],
                nickname: cleanLabel,
                triggerWord: matched.triggerWord || next[existingIdx].triggerWord || '',
                showPill: true,
              };
            } else {
              next.push({
                loraName: matched.filename,
                modelStrength: matched.defaultModelStrength ?? 1.0,
                clipStrength: matched.defaultClipStrength ?? 1.0,
                triggerWord: matched.triggerWord || '',
                nickname: cleanLabel,
                showPill: true,
              });
            }
          }
          return next;
        });
      }

      const assistantMsg: QuickGenChatMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: res.reply,
        proposedPrompt: res.proposedPrompt,
        selectedLoras:
          resolvedPickedLoras.length > 0 ? resolvedPickedLoras.map((l) => l.filename) : undefined,
        excludedLoras: currentRemovedKeys.length > 0 ? currentRemovedKeys : undefined,
      };
      setChatMessages((prev) => [...prev, assistantMsg]);
      focusInputAtEnd(30, false);
    } catch (err: any) {
      onPushToast(err?.message || 'Failed to converse with LM Studio.', 'error');
    } finally {
      setIsChatting(false);
    }
  };

  /** Dispatches a generation batch to ComfyUI and resets the Quick Gen dock back to defaults. */
  const dispatchBatchToComfy = async (
    rawPromptText: string,
    expandWithAgentSet: boolean,
    onAfterReset?: () => void
  ) => {
    const cleanPrompt = rawPromptText.trim();
    if (!cleanPrompt || isSubmitting) return;

    if (!resolvedWorkflow) {
      onPushToast('System workflow is not loaded yet.', 'error');
      return;
    }

    setIsSubmitting(true);
    try {
      const { selectedLoras, triggerWord } = resolveActiveLoraStack();

      let promptsToRun: string[] = [];
      if (expandWithAgentSet) {
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

      const currentExcludedLoras = Array.from(removedLoraKeys);
      let snapshotForBatch: QuickGenChatMessage[] | undefined;
      if (chatMessages.length > 0) {
        snapshotForBatch = chatMessages.map((m, idx) => {
          const isLastAssistant =
            m.role === 'assistant' &&
            !chatMessages.slice(idx + 1).some((later) => later.role === 'assistant');
          if (isLastAssistant) {
            return {
              ...m,
              excludedLoras: currentExcludedLoras.length > 0 ? currentExcludedLoras : undefined,
            };
          }
          return m;
        });
      }

      const res = await api.submitGenerationBatch({
        characterId: attachedCharacter?.id || null,
        workflowId: resolvedWorkflow.id,
        mode: expandWithAgentSet ? 'theme_set' : 'single',
        themeTitle: cleanPrompt.slice(0, 80),
        aspectRatio,
        megapixels,
        prompts: promptsToRun,
        triggerWord,
        negativePrompt: '',
        loras: selectedLoras,
        seriesId: activeSeriesId,
        branchFromImageId: branchFromImageId,
        chatSnapshot: snapshotForBatch,
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

      // Reset Quick Gen box & conversation back to default state
      setPrompt('');
      setChatMessages([]);
      setActiveSeriesId(null);
      setBranchFromImageId(null);
      setConversationEnabled(false);
      setAgentEnabled(false);
      setAttachedCharacter(null);
      setAttachedLoras([]);
      setRemovedLoraKeys(new Set());
      setAspectRatio(workflowDefaultAr);
      setMegapixels(workflowDefaultMp);
      setBatchCount(1);
      setShowSettingsMenu(false);
      setIsPromptFocused(false);
      onAfterReset?.();
      inputRef.current?.blur();
      await onRefreshAll();
    } catch (err: any) {
      onPushToast(err?.message || 'Failed to submit quick generation.', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  /** Primary Enter / Arrow button handler: chats if in Conversation mode, otherwise dispatches batch. */
  const handleSubmit = async (onAfterReset?: () => void) => {
    if (conversationEnabled) {
      await handleSendChatTurn();
      return;
    }
    await dispatchBatchToComfy(prompt, agentEnabled, onAfterReset);
  };

  /** Submits a proposed prompt from Conversation mode and resets the Quick Gen dock. */
  const handleSubmitProposedPrompt = async (
    proposedPromptText: string,
    onAfterReset?: () => void
  ) => {
    await dispatchBatchToComfy(proposedPromptText, false, onAfterReset);
  };

  return {
    prompt,
    setPrompt,
    agentEnabled,
    setAgentEnabled,
    conversationEnabled,
    setConversationEnabled,
    chatMessages,
    setChatMessages,
    activeSeriesId,
    setActiveSeriesId,
    branchFromImageId,
    setBranchFromImageId,
    isChatting,
    aspectRatio,
    setAspectRatio,
    megapixels,
    setMegapixels,
    batchCount,
    setBatchCount,
    attachedCharacter,
    setAttachedCharacter,
    attachedLoras,
    setAttachedLoras,
    setRemovedLoraKeys,
    isHighlighted,
    isMinimized,
    setIsMinimized,
    showSettingsMenu,
    setShowSettingsMenu,
    isPromptFocused,
    setIsPromptFocused,
    isSubmitting,
    isInterrogating,
    workflowDefaultMp,
    handleInterrogateImageFile,
    handleRemoveCharacter,
    handleRemoveLora,
    handleSubmit,
    handleSubmitProposedPrompt,
  };
}
