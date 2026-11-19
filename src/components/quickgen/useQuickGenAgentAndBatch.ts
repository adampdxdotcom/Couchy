import React, { useEffect, useState } from 'react';
import { api } from '../../api/client.ts';
import type {
  CharacterProfile,
  GenerationLoraSelection,
  LoraExplorerItem,
  LoraPreset,
  QuickGenChatMessage,
  WorkflowLibraryItem,
} from '../../shared/types.ts';
import { ASPECT_RATIO_PRESETS } from '../../shared/utils.ts';
import {
  MAX_SYSTEM_LORAS,
  getCleanLoraLabel,
  isCharacterLora,
  normalizeLoraKey,
} from './quickGenUtils.ts';
import { patchLastAssistantExclusions } from './quickGenStackHelpers.ts';

interface UseQuickGenAgentAndBatchParams {
  prompt: string;
  setPrompt: React.Dispatch<React.SetStateAction<string>>;
  lmStudioOnline: boolean;
  agentEnabled: boolean;
  setAgentEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  chatMessages: QuickGenChatMessage[];
  setChatMessages: React.Dispatch<React.SetStateAction<QuickGenChatMessage[]>>;
  attachedCharacter: CharacterProfile | null;
  attachedPreset: LoraPreset | null;
  attachedCheckpoint: string | null;
  setAttachedLoras: React.Dispatch<React.SetStateAction<GenerationLoraSelection[]>>;
  removedLoraKeys: Set<string>;
  loras: LoraExplorerItem[];
  presets: LoraPreset[];
  resolvedWorkflow: WorkflowLibraryItem | null | undefined;
  aspectRatio: string;
  megapixels: number;
  steps: number;
  workflowDefaultSteps: number;
  batchCount: number;
  activeSeriesId: number | null;
  branchFromImageId: number | null;
  inspirationFilename: string | null;
  resolveActiveLoraStack: () => { selectedLoras: GenerationLoraSelection[]; triggerWord: string };
  applyPreset: (
    preset: LoraPreset,
    options?: { respectRemovedKeys?: boolean; silent?: boolean }
  ) => void;
  resetQuickGenState: (options?: { minimizeIfNeeded?: boolean; onAfterReset?: () => void }) => void;
  focusInputAtEnd: (delayMs?: number, moveToEnd?: boolean) => void;
  onRefreshAll: () => Promise<void>;
  onPushToast: (text: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
}

/**
 * Manages Local LLM Agent conversation turns, shot-set concept expansion,
 * and final generation batch dispatch to ComfyUI.
 */
export function useQuickGenAgentAndBatch({
  prompt,
  setPrompt,
  lmStudioOnline,
  agentEnabled,
  setAgentEnabled,
  chatMessages,
  setChatMessages,
  attachedCharacter,
  attachedPreset,
  attachedCheckpoint,
  setAttachedLoras,
  removedLoraKeys,
  loras,
  presets,
  resolvedWorkflow,
  aspectRatio,
  megapixels,
  steps,
  workflowDefaultSteps,
  batchCount,
  activeSeriesId,
  branchFromImageId,
  inspirationFilename,
  resolveActiveLoraStack,
  applyPreset,
  resetQuickGenState,
  focusInputAtEnd,
  onRefreshAll,
  onPushToast,
}: UseQuickGenAgentAndBatchParams) {
  const [isChatting, setIsChatting] = useState(false);
  const [expandingMessageId, setExpandingMessageId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRollingRandom, setIsRollingRandom] = useState(false);

  // Auto-disable Agent (Conversation) mode if Local LLM goes offline
  useEffect(() => {
    if (!lmStudioOnline && agentEnabled) {
      setAgentEnabled(false);
    }
  }, [lmStudioOnline, agentEnabled, setAgentEnabled]);

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
          proposalKind: m.proposalKind,
        })),
        characterName: attachedCharacter?.name || undefined,
        characterDescription: attachedCharacter?.description || undefined,
        characterPhysicalDescription: attachedCharacter?.physicalDescription || undefined,
        loraNames: selectedLoras.map((l) => l.loraName),
        excludedLoras: currentRemovedKeys,
        activePresetName: attachedPreset?.name || undefined,
        batchCount,
      });

      let appliedAgentPreset: LoraPreset | null = null;
      if (res.selectedPreset?.id) {
        const matchedPreset = presets.find((p) => p.id === res.selectedPreset!.id) || null;
        if (matchedPreset) {
          appliedAgentPreset = matchedPreset;
          applyPreset(matchedPreset, { respectRemovedKeys: true, silent: true });
        }
      }

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
            } else if (next.length < MAX_SYSTEM_LORAS) {
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

      const preExistingLoraKeys = new Set(
        selectedLoras.map((l) => normalizeLoraKey(l.loraName)).filter(Boolean)
      );
      const pickedLoraHistory = Array.from(
        new Set([
          ...(appliedAgentPreset ? appliedAgentPreset.items.map((it) => it.loraName) : []),
          ...resolvedPickedLoras.map((l) => l.filename),
        ])
      ).filter((name) => !preExistingLoraKeys.has(normalizeLoraKey(name)));

      const assistantMsg: QuickGenChatMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: res.reply,
        proposedPrompt: res.proposedPrompt,
        proposalKind: res.proposalKind,
        selectedLoras: pickedLoraHistory.length > 0 ? pickedLoraHistory : undefined,
        excludedLoras: currentRemovedKeys.length > 0 ? currentRemovedKeys : undefined,
      };
      setChatMessages((prev) => [...prev, assistantMsg]);
      focusInputAtEnd(30, false);
    } catch (err: any) {
      onPushToast(err?.message || 'Failed to converse with Local LLM.', 'error');
    } finally {
      setIsChatting(false);
    }
  };

  const dispatchBatchToComfy = async (
    rawPromptText: string,
    expandWithAgentSet: boolean,
    onAfterReset?: () => void,
    preExpandedPrompts?: string[],
    sourceMessageId?: string
  ) => {
    const cleanPrompt = rawPromptText.trim();
    const cleanedPreExpanded = (preExpandedPrompts || []).map((p) => p.trim()).filter(Boolean);
    if ((!cleanPrompt && cleanedPreExpanded.length === 0) || isSubmitting) return;

    if (!resolvedWorkflow) {
      onPushToast('System workflow is not loaded yet.', 'error');
      return;
    }

    setIsSubmitting(true);
    try {
      const { selectedLoras, triggerWord } = resolveActiveLoraStack();

      let promptsToRun: string[] = [];
      if (cleanedPreExpanded.length > 0) {
        promptsToRun = cleanedPreExpanded;
      } else if (expandWithAgentSet) {
        const agentRes = await api.generateSetPromptsWithAgent({
          characterName: attachedCharacter?.name || '',
          characterDescription: attachedCharacter?.description || '',
          characterPhysicalDescription: attachedCharacter?.physicalDescription || '',
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

      const markedChatMessages =
        sourceMessageId && chatMessages.length > 0
          ? chatMessages.map((m) => (m.id === sourceMessageId ? { ...m, submitted: true } : m))
          : chatMessages;

      if (sourceMessageId && markedChatMessages !== chatMessages) {
        setChatMessages(markedChatMessages);
      }

      const snapshotForBatch =
        markedChatMessages.length > 0
          ? patchLastAssistantExclusions(markedChatMessages, Array.from(removedLoraKeys))
          : undefined;

      const isMultiShotSet = expandWithAgentSet || cleanedPreExpanded.length > 1;
      const res = await api.submitGenerationBatch({
        characterId: attachedCharacter?.id || null,
        workflowId: resolvedWorkflow.id,
        mode: isMultiShotSet ? 'theme_set' : 'single',
        themeTitle: (cleanPrompt || promptsToRun[0] || '').slice(0, 80),
        aspectRatio,
        megapixels,
        steps: steps !== workflowDefaultSteps ? steps : undefined,
        prompts: promptsToRun,
        triggerWord,
        negativePrompt: '',
        loras: selectedLoras,
        checkpointName: attachedCheckpoint || undefined,
        seriesId: isMultiShotSet ? null : activeSeriesId,
        branchFromImageId: isMultiShotSet ? null : branchFromImageId,
        inspirationFilename: !activeSeriesId && !branchFromImageId ? inspirationFilename : null,
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
        const attachedCharKeys = new Set(
          (attachedCharacter?.loras || []).map((cl) => normalizeLoraKey(cl.loraName))
        );
        const extraLoraCount = selectedLoras.filter(
          (sl) => !attachedCharKeys.has(normalizeLoraKey(sl.loraName))
        ).length;
        const loraCountNotice = extraLoraCount > 0 ? ` + ${extraLoraCount} LoRA(s)` : '';
        onPushToast(
          `Queued Batch #${res.batch.id} (${submittedCount}/${res.batch.totalCount} sent${
            attachedCharacter ? ` · ${attachedCharacter.name}` : ''
          }${loraCountNotice})`,
          'success'
        );
      }

      setExpandingMessageId(null);
      resetQuickGenState({ minimizeIfNeeded: true, onAfterReset });
      await onRefreshAll();
    } catch (err: any) {
      onPushToast(err?.message || 'Failed to submit quick generation.', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePreviewExpandConcept = async (messageId: string, conceptText: string) => {
    const cleanConcept = conceptText.trim();
    if (!cleanConcept || expandingMessageId || isSubmitting || isChatting) return;
    setExpandingMessageId(messageId);
    try {
      const { selectedLoras } = resolveActiveLoraStack();
      const agentRes = await api.generateSetPromptsWithAgent({
        characterName: attachedCharacter?.name || '',
        characterDescription: attachedCharacter?.description || '',
        characterPhysicalDescription: attachedCharacter?.physicalDescription || '',
        loraNames: selectedLoras.map((l) => l.loraName),
        theme: cleanConcept,
        count: batchCount,
        basePromptTemplate: '{theme}',
      });
      const expanded =
        agentRes.prompts && agentRes.prompts.length > 0
          ? agentRes.prompts
          : Array.from({ length: batchCount }, () => cleanConcept);
      setChatMessages((prev) =>
        prev.map((m) => (m.id === messageId ? { ...m, expandedPrompts: expanded } : m))
      );
      if (!agentRes.usedLmStudio) {
        onPushToast(
          agentRes.warning || 'Local LLM unavailable for expansion; loaded fallback shot variations.',
          'warning'
        );
      }
    } catch (err: any) {
      onPushToast(err?.message || 'Failed to expand concept into shots.', 'error');
    } finally {
      setExpandingMessageId(null);
    }
  };

  const handleUpdateProposedPrompt = (messageId: string, nextValue: string) => {
    setChatMessages((prev) =>
      prev.map((m) => (m.id === messageId ? { ...m, proposedPrompt: nextValue } : m))
    );
  };

  const handleUpdateExpandedPrompt = (messageId: string, shotIndex: number, nextValue: string) => {
    setChatMessages((prev) =>
      prev.map((m) => {
        if (m.id !== messageId || !Array.isArray(m.expandedPrompts)) return m;
        const nextList = [...m.expandedPrompts];
        nextList[shotIndex] = nextValue;
        return { ...m, expandedPrompts: nextList };
      })
    );
  };

  const handleCloseExpandedPreview = (messageId: string) => {
    setChatMessages((prev) =>
      prev.map((m) => (m.id === messageId ? { ...m, expandedPrompts: undefined } : m))
    );
  };

  const handleSubmitExpandedPrompts = async (
    messageId: string,
    promptsToSubmit: string[],
    conceptTheme: string,
    onAfterReset?: () => void
  ) => {
    const cleanPrompts = promptsToSubmit.map((p) => p.trim()).filter(Boolean);
    if (cleanPrompts.length === 0) {
      onPushToast('Add at least one non-empty shot prompt before submitting.', 'warning');
      return;
    }
    await dispatchBatchToComfy(conceptTheme, true, onAfterReset, cleanPrompts, messageId);
  };

  const handleSubmit = async (onAfterReset?: () => void) => {
    if (agentEnabled) {
      await handleSendChatTurn();
      return;
    }
    await dispatchBatchToComfy(prompt, false, onAfterReset);
  };

  const handleSubmitProposedPrompt = async (
    messageId: string,
    proposedPromptText: string,
    onAfterReset?: () => void
  ) => {
    await dispatchBatchToComfy(proposedPromptText, batchCount > 1, onAfterReset, undefined, messageId);
  };

  /** Runs a popularity-weighted Random Roll and dispatches immediately without modifying the draft. */
  const handleRandomRoll = async () => {
    if (isRollingRandom || isSubmitting || isChatting) return;
    setIsRollingRandom(true);
    try {
      const res = await api.triggerRandomRoll();
      const submittedCount = res.batch.items.filter((i) => i.status === 'submitted').length;
      const failedCount = res.batch.items.filter((i) => i.status === 'failed').length;
      const shortAr =
        ASPECT_RATIO_PRESETS.find((p) => p.value === res.rollSummary.aspectRatio)?.short ||
        res.rollSummary.aspectRatio.split(' ')[0] ||
        '2:3';

      if (failedCount > 0 && submittedCount === 0) {
        onPushToast(
          `Random Roll #${res.batch.id} failed (${res.batch.items[0]?.errorMessage || 'ComfyUI offline'})`,
          'warning'
        );
      } else {
        const extraLoraText =
          res.rollSummary.loraNames.length > 0
            ? ` · ${res.rollSummary.loraNames.length} LoRA(s)`
            : '';
        onPushToast(
          `Random Roll #${res.batch.id}: ${res.rollSummary.characterName} · ${shortAr}${extraLoraText}`,
          'success'
        );
      }

      await onRefreshAll();
    } catch (err: any) {
      onPushToast(err?.message || 'Failed to execute Random Roll.', 'error');
    } finally {
      setIsRollingRandom(false);
    }
  };

  return {
    isChatting,
    expandingMessageId,
    setExpandingMessageId,
    isSubmitting,
    isRollingRandom,
    handleSubmit,
    handleRandomRoll,
    handleUpdateProposedPrompt,
    handleSubmitProposedPrompt,
    handlePreviewExpandConcept,
    handleUpdateExpandedPrompt,
    handleCloseExpandedPreview,
    handleSubmitExpandedPrompts,
  };
}
