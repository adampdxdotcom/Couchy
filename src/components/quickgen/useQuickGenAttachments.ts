import React, { useEffect, useRef } from 'react';
import type {
  CharacterProfile,
  GenerationLoraSelection,
  LoraExplorerItem,
  LoraPreset,
  QuickGenChatMessage,
} from '../../shared/types.ts';
import {
  MAX_SYSTEM_LORAS,
  isCharacterLora,
  normalizeLoraKey,
  snapToHalfMp,
  type QuickGenPrefill,
} from './quickGenUtils.ts';
import {
  buildReusedLoraSelections,
  clampLoraStrength,
  mergePresetLoras,
  patchLastAssistantExclusions,
  resolveActiveLoraStackData,
} from './quickGenStackHelpers.ts';

interface UseQuickGenAttachmentsParams {
  loras: LoraExplorerItem[];
  prefillPayload?: QuickGenPrefill | null;
  workflowDefaultMp: number;
  onClearPrefill?: () => void;
  onPushToast: (text: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
  focusInputAtEnd: (delayMs?: number, moveToEnd?: boolean) => void;
  pulseHighlight: (durationMs?: number) => void;
  setPrompt: React.Dispatch<React.SetStateAction<string>>;
  agentEnabled: boolean;
  setAgentEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  setChatMessages: React.Dispatch<React.SetStateAction<QuickGenChatMessage[]>>;
  setActiveSeriesId: React.Dispatch<React.SetStateAction<number | null>>;
  setBranchFromImageId: React.Dispatch<React.SetStateAction<number | null>>;
  setStackSourceLabel: React.Dispatch<React.SetStateAction<string | null>>;
  setInspirationFilename: React.Dispatch<React.SetStateAction<string | null>>;
  setAspectRatio: React.Dispatch<React.SetStateAction<string>>;
  setMegapixels: React.Dispatch<React.SetStateAction<number>>;
  setBatchCount: React.Dispatch<React.SetStateAction<number>>;
  setIsMinimized: React.Dispatch<React.SetStateAction<boolean>>;
  attachedCharacter: CharacterProfile | null;
  setAttachedCharacter: React.Dispatch<React.SetStateAction<CharacterProfile | null>>;
  characterLoraStrength: number;
  setCharacterLoraStrength: React.Dispatch<React.SetStateAction<number>>;
  attachedPreset: LoraPreset | null;
  setAttachedPreset: React.Dispatch<React.SetStateAction<LoraPreset | null>>;
  attachedCheckpoint: string | null;
  setAttachedCheckpoint: React.Dispatch<React.SetStateAction<string | null>>;
  attachedLoras: GenerationLoraSelection[];
  setAttachedLoras: React.Dispatch<React.SetStateAction<GenerationLoraSelection[]>>;
  removedLoraKeys: Set<string>;
  setRemovedLoraKeys: React.Dispatch<React.SetStateAction<Set<string>>>;
}

/**
 * Manages Quick Gen reuse prefill hydration, active LoRA stack assembly,
 * preset application, pill removal, and session-only LoRA strength adjustments.
 */
export function useQuickGenAttachments({
  loras,
  prefillPayload,
  workflowDefaultMp,
  onClearPrefill,
  onPushToast,
  focusInputAtEnd,
  pulseHighlight,
  setPrompt,
  agentEnabled,
  setAgentEnabled,
  setChatMessages,
  setActiveSeriesId,
  setBranchFromImageId,
  setStackSourceLabel,
  setInspirationFilename,
  setAspectRatio,
  setMegapixels,
  setBatchCount,
  setIsMinimized,
  attachedCharacter,
  setAttachedCharacter,
  characterLoraStrength,
  setCharacterLoraStrength,
  attachedPreset,
  setAttachedPreset,
  attachedCheckpoint,
  setAttachedCheckpoint,
  attachedLoras,
  setAttachedLoras,
  removedLoraKeys,
  setRemovedLoraKeys,
}: UseQuickGenAttachmentsParams) {
  const lastAppliedTimestampRef = useRef<number | null>(null);

  const resolveActiveLoraStack = () =>
    resolveActiveLoraStackData({
      attachedCharacter,
      attachedLoras,
      removedLoraKeys,
      characterLoraStrength,
      loras,
    });

  // Handle incoming reuse / prefill requests once per unique timestamp
  useEffect(() => {
    if (!prefillPayload || lastAppliedTimestampRef.current === prefillPayload.timestamp) return;
    lastAppliedTimestampRef.current = prefillPayload.timestamp;

    setIsMinimized(false);
    setInspirationFilename(null);
    setAttachedPreset(null);

    const excludedKeySet = new Set(
      (prefillPayload.excludedLoras || []).map((k) => normalizeLoraKey(k)).filter(Boolean)
    );
    setRemovedLoraKeys(excludedKeySet);

    if (prefillPayload.prompt !== undefined) setPrompt(prefillPayload.prompt);
    if (prefillPayload.character !== undefined) setAttachedCharacter(prefillPayload.character);
    setAttachedCheckpoint(
      prefillPayload.checkpointName ? String(prefillPayload.checkpointName).trim() || null : null
    );

    if (prefillPayload.loras !== undefined) {
      const { reusedSelections, characterStrength } = buildReusedLoraSelections({
        prefillLoras: prefillPayload.loras,
        prefillCharacter: prefillPayload.character,
        excludedKeySet,
        loras,
      });
      setAttachedLoras(reusedSelections);
      if (characterStrength !== null) {
        setCharacterLoraStrength(characterStrength);
      }
    } else {
      setAttachedLoras([]);
      if (prefillPayload.character !== undefined) {
        setCharacterLoraStrength(1.0);
      }
    }

    if (prefillPayload.aspectRatio) setAspectRatio(prefillPayload.aspectRatio);
    if (prefillPayload.megapixels !== undefined) {
      setMegapixels(snapToHalfMp(prefillPayload.megapixels, workflowDefaultMp));
    }
    if (prefillPayload.batchCount !== undefined) setBatchCount(prefillPayload.batchCount);

    if (prefillPayload.conversationMode) {
      setAgentEnabled(true);
      setBatchCount(1);
      setChatMessages(prefillPayload.chatMessages || []);
    } else {
      setAgentEnabled(false);
      setChatMessages([]);
    }
    setActiveSeriesId(prefillPayload.seriesId ?? null);
    setBranchFromImageId(prefillPayload.branchFromImageId ?? null);
    setStackSourceLabel(prefillPayload.stackSourceLabel ?? null);

    onClearPrefill?.();
    focusInputAtEnd(60, true);
    pulseHighlight(1400);
  }, [prefillPayload, loras, workflowDefaultMp, onClearPrefill]);

  const applyPreset = (
    preset: LoraPreset,
    _options?: { respectRemovedKeys?: boolean; silent?: boolean }
  ) => {
    // Character-only mode: apply preset checkpoint if defined, without adding extra LoRAs
    if (preset.checkpointName) {
      setAttachedCheckpoint(preset.checkpointName);
    }
    setAttachedPreset(null);
  };

  const handleRemovePreset = () => {
    const presetToRemove = attachedPreset;
    setAttachedPreset(null);
    if (!presetToRemove) return;

    if (
      presetToRemove.checkpointName &&
      attachedCheckpoint &&
      normalizeLoraKey(presetToRemove.checkpointName) === normalizeLoraKey(attachedCheckpoint)
    ) {
      setAttachedCheckpoint(null);
    }

    const presetKeys = new Set(presetToRemove.items.map((it) => normalizeLoraKey(it.loraName)));
    const charKeys = new Set(
      attachedCharacter
        ? attachedCharacter.loras.map((cl) => normalizeLoraKey(cl.loraName))
        : []
    );

    setAttachedLoras((prev) =>
      prev.filter((al) => {
        const k = normalizeLoraKey(al.loraName);
        if (charKeys.has(k)) return true;
        return !presetKeys.has(k);
      })
    );
  };

  const handleRemoveCheckpoint = () => {
    setAttachedCheckpoint(null);
  };

  const handleRemoveStackTarget = () => {
    setActiveSeriesId(null);
    setBranchFromImageId(null);
    setStackSourceLabel(null);
  };

  const handleRemoveCharacter = () => {
    const charToRemove = attachedCharacter;
    setAttachedCharacter(null);
    setCharacterLoraStrength(1.0);
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

    if (agentEnabled) {
      setChatMessages((prev) => patchLastAssistantExclusions(prev, Array.from(nextRemoved)));
    }
  };

  const handleUpdateLoraStrength = (loraName: string, nextStrength: number) => {
    if (!Number.isFinite(nextStrength)) return;
    const clamped = clampLoraStrength(nextStrength);
    const targetKey = normalizeLoraKey(loraName);

    if (
      attachedCharacter &&
      attachedCharacter.loras.some((cl) => normalizeLoraKey(cl.loraName) === targetKey)
    ) {
      setCharacterLoraStrength(clamped);
    }

    setAttachedLoras((prev) =>
      prev.map((al) =>
        normalizeLoraKey(al.loraName) === targetKey
          ? { ...al, modelStrength: clamped, clipStrength: clamped }
          : al
      )
    );
  };

  const handleUpdateCharacterStrength = (nextStrength: number) => {
    if (!Number.isFinite(nextStrength) || !attachedCharacter) return;
    const clamped = clampLoraStrength(nextStrength);
    setCharacterLoraStrength(clamped);

    const charKeys = new Set(attachedCharacter.loras.map((cl) => normalizeLoraKey(cl.loraName)));
    setAttachedLoras((prev) => {
      if (!prev.some((al) => charKeys.has(normalizeLoraKey(al.loraName)))) return prev;
      return prev.map((al) =>
        charKeys.has(normalizeLoraKey(al.loraName))
          ? { ...al, modelStrength: clamped, clipStrength: clamped }
          : al
      );
    });
  };

  return {
    resolveActiveLoraStack,
    applyPreset,
    handleRemoveCharacter,
    handleRemovePreset,
    handleRemoveCheckpoint,
    handleRemoveStackTarget,
    handleRemoveLora,
    handleUpdateLoraStrength,
    handleUpdateCharacterStrength,
  };
}
