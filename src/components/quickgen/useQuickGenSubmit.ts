import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api/client.ts';
import type {
  CharacterProfile,
  GenerationLoraSelection,
  LoraExplorerItem,
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
 * image interrogation, attachment removal, and batch submission.
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

  // Auto-disable agent mode if LM Studio goes offline
  useEffect(() => {
    if (!lmStudioOnline && agentEnabled) {
      setAgentEnabled(false);
    }
  }, [lmStudioOnline, agentEnabled]);

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

  // Handle incoming reuse / prefill requests once per unique timestamp
  useEffect(() => {
    if (!prefillPayload || lastAppliedTimestampRef.current === prefillPayload.timestamp) return;
    lastAppliedTimestampRef.current = prefillPayload.timestamp;

    setIsMinimized(false);
    setRemovedLoraKeys(new Set());

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
          nickname: getCleanLoraLabel(matchedExplorerLora || { loraName: imgLora.loraName }),
          showPill: Boolean(matchedExplorerLora?.mentionEnabled),
        });
      }
      setAttachedLoras(reusedSelections);
    } else {
      setAttachedLoras([]);
    }

    if (prefillPayload.aspectRatio) setAspectRatio(prefillPayload.aspectRatio);
    if (prefillPayload.batchCount !== undefined) setBatchCount(prefillPayload.batchCount);

    focusInputAtEnd(60, true);
    pulseHighlight(1400);
  }, [prefillPayload, loras]);

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
    setRemovedLoraKeys((prev) => new Set(prev).add(keyToRemove));
    setAttachedLoras((prev) => {
      const remaining = prev.filter((l) => normalizeLoraKey(l.loraName) !== keyToRemove);
      if (!attachedCharacter && !remaining.some((l) => l.showPill !== false)) {
        return [];
      }
      return remaining;
    });
  };

  const handleSubmit = async (onAfterReset?: () => void) => {
    const cleanPrompt = prompt.trim();
    if (!cleanPrompt || isSubmitting) return;

    if (!resolvedWorkflow) {
      onPushToast('System workflow is not loaded yet.', 'error');
      return;
    }

    setIsSubmitting(true);
    try {
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
        megapixels,
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

      setPrompt('');
      setAttachedCharacter(null);
      setAttachedLoras([]);
      setRemovedLoraKeys(new Set());
      setAgentEnabled(false);
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

  return {
    prompt,
    setPrompt,
    agentEnabled,
    setAgentEnabled,
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
  };
}
