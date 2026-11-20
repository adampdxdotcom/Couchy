import React, { useEffect, useMemo, useRef, useState } from 'react';
import type {
  CharacterProfile,
  GenerationLoraSelection,
  LoraExplorerItem,
  LoraPreset,
  QuickGenChatMessage,
  WorkflowLibraryItem,
} from '../../shared/types.ts';
import { resolveDefaultWorkflow } from '../../shared/utils.ts';
import {
  clampQuickGenSteps,
  isCharacterLora,
  normalizeLoraKey,
  snapToHalfMp,
  type QuickGenPrefill,
} from './quickGenUtils.ts';
import { useQuickGenAttachments } from './useQuickGenAttachments.ts';
import { useQuickGenMediaImport } from './useQuickGenMediaImport.ts';
import { useQuickGenAgentAndBatch } from './useQuickGenAgentAndBatch.ts';

interface UseQuickGenSubmitParams {
  loras: LoraExplorerItem[];
  presets?: LoraPreset[];
  workflows: WorkflowLibraryItem[];
  prefillPayload?: QuickGenPrefill | null;
  lmStudioOnline: boolean;
  onRefreshAll: () => Promise<void>;
  onPushToast: (text: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
  onClearPrefill?: () => void;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  isInspectorOpen?: boolean;
}

/**
 * Orchestrates Quick Gen dock state, workflow default syncing, attachment/prefill hooks,
 * image interrogation/Civitai import, and Agent conversation + ComfyUI batch submission.
 */
export function useQuickGenSubmit({
  loras,
  presets = [],
  workflows,
  prefillPayload,
  lmStudioOnline,
  onRefreshAll,
  onPushToast,
  onClearPrefill,
  inputRef,
  isInspectorOpen = false,
}: UseQuickGenSubmitParams) {
  const [prompt, setPrompt] = useState('');
  const [agentEnabled, setAgentEnabled] = useState(false);
  const [chatMessages, setChatMessages] = useState<QuickGenChatMessage[]>([]);
  const [activeSeriesId, setActiveSeriesId] = useState<number | null>(null);
  const [branchFromImageId, setBranchFromImageId] = useState<number | null>(null);
  const [stackSourceLabel, setStackSourceLabel] = useState<string | null>(null);
  const [inspirationFilename, setInspirationFilename] = useState<string | null>(null);

  const [aspectRatio, setAspectRatio] = useState('2:3 (Portrait Photo)');
  const [megapixels, setMegapixels] = useState<number>(3.0);
  const [steps, setSteps] = useState<number>(10);
  const [batchCount, setBatchCount] = useState<number>(1);
  const [attachedCharacter, setAttachedCharacter] = useState<CharacterProfile | null>(null);
  const [characterLoraStrength, setCharacterLoraStrength] = useState<number>(1.0);
  const [attachedPreset, setAttachedPreset] = useState<LoraPreset | null>(null);
  const [attachedCheckpoint, setAttachedCheckpoint] = useState<string | null>(null);
  const [attachedLoras, setAttachedLoras] = useState<GenerationLoraSelection[]>([]);
  const [removedLoraKeys, setRemovedLoraKeys] = useState<Set<string>>(new Set());
  const [isHighlighted, setIsHighlighted] = useState(false);
  const [isMinimized, setIsMinimized] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth < 768 : false
  );
  const [showSettingsMenu, setShowSettingsMenu] = useState(false);
  const [isPromptFocused, setIsPromptFocused] = useState(false);

  const highlightTimerRef = useRef<number | null>(null);
  const focusTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (highlightTimerRef.current !== null) window.clearTimeout(highlightTimerRef.current);
      if (focusTimerRef.current !== null) window.clearTimeout(focusTimerRef.current);
    };
  }, []);

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

  const resolvedWorkflow = useMemo(() => resolveDefaultWorkflow(workflows), [workflows]);
  const workflowDefaultMp = useMemo(
    () => snapToHalfMp(resolvedWorkflow?.defaultMegapixels, 3.0),
    [resolvedWorkflow?.defaultMegapixels]
  );
  const workflowDefaultAr = useMemo(
    () => resolvedWorkflow?.defaultAspectRatio || '2:3 (Portrait Photo)',
    [resolvedWorkflow?.defaultAspectRatio]
  );
  const workflowDefaultSteps = useMemo(
    () => clampQuickGenSteps(resolvedWorkflow?.defaultSteps, 10),
    [resolvedWorkflow?.defaultSteps]
  );

  useEffect(() => {
    setMegapixels(workflowDefaultMp);
  }, [resolvedWorkflow?.id, workflowDefaultMp]);

  useEffect(() => {
    setAspectRatio(workflowDefaultAr);
  }, [resolvedWorkflow?.id, workflowDefaultAr]);

  useEffect(() => {
    setSteps(workflowDefaultSteps);
  }, [resolvedWorkflow?.id, workflowDefaultSteps]);

  const isQuickGenEmpty =
    prompt.trim().length === 0 &&
    !attachedCharacter &&
    !attachedPreset &&
    !attachedCheckpoint &&
    attachedLoras.length === 0 &&
    !stackSourceLabel &&
    !inspirationFilename &&
    chatMessages.length === 0;

  const resetQuickGenState = (options?: {
    minimizeIfNeeded?: boolean;
    clearInputValue?: boolean;
    onAfterReset?: () => void;
  }) => {
    setPrompt('');
    setChatMessages([]);
    setActiveSeriesId(null);
    setBranchFromImageId(null);
    setStackSourceLabel(null);
    setInspirationFilename(null);
    setAgentEnabled(false);
    setAttachedCharacter(null);
    setCharacterLoraStrength(1.0);
    setAttachedPreset(null);
    setAttachedCheckpoint(null);
    setAttachedLoras([]);
    setRemovedLoraKeys(new Set());
    setAspectRatio(workflowDefaultAr);
    setMegapixels(workflowDefaultMp);
    setSteps(workflowDefaultSteps);
    setBatchCount(1);
    setShowSettingsMenu(false);
    setIsPromptFocused(false);
    if (
      options?.minimizeIfNeeded &&
      (isInspectorOpen || (typeof window !== 'undefined' && window.innerWidth < 768))
    ) {
      setIsMinimized(true);
    }
    options?.onAfterReset?.();
    if (inputRef.current) {
      if (options?.clearInputValue) inputRef.current.value = '';
      inputRef.current.blur();
    }
  };

  const attachments = useQuickGenAttachments({
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
  });

  const mediaImport = useQuickGenMediaImport({
    loras,
    lmStudioOnline,
    isQuickGenEmpty,
    prompt,
    attachedCharacter,
    attachedLoras,
    onPushToast,
    focusInputAtEnd,
    pulseHighlight,
    setPrompt,
    setIsMinimized,
    setInspirationFilename,
    setAspectRatio,
    setAttachedCharacter,
    setCharacterLoraStrength,
    setAttachedCheckpoint,
    setAttachedLoras,
    setRemovedLoraKeys,
  });

  const clearCharacterAfterRandomRoll = () => {
    const charToClear = attachedCharacter;
    setAttachedCharacter(null);
    setCharacterLoraStrength(1.0);
    if (!charToClear) return;

    const charKeys = new Set(charToClear.loras.map((cl) => normalizeLoraKey(cl.loraName)));
    setAttachedLoras((prev) =>
      prev.filter(
        (al) =>
          !charKeys.has(normalizeLoraKey(al.loraName)) &&
          !isCharacterLora(al.loraName, charToClear, loras)
      )
    );
  };

  const agentAndBatch = useQuickGenAgentAndBatch({
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
    resolveActiveLoraStack: attachments.resolveActiveLoraStack,
    applyPreset: attachments.applyPreset,
    resetQuickGenState,
    onClearCharacterAfterRandomRoll: clearCharacterAfterRandomRoll,
    focusInputAtEnd,
    onRefreshAll,
    onPushToast,
  });

  /** Completely clears the Quick Gen box (prompt, character, LoRAs, conversation, and settings). */
  const handleClearBox = (onAfterReset?: () => void) => {
    agentAndBatch.setExpandingMessageId(null);
    onClearPrefill?.();
    resetQuickGenState({ clearInputValue: true, onAfterReset });
  };

  return {
    prompt,
    setPrompt,
    agentEnabled,
    setAgentEnabled,
    chatMessages,
    setChatMessages,
    activeSeriesId,
    setActiveSeriesId,
    branchFromImageId,
    setBranchFromImageId,
    stackSourceLabel,
    isChatting: agentAndBatch.isChatting,
    expandingMessageId: agentAndBatch.expandingMessageId,
    aspectRatio,
    setAspectRatio,
    megapixels,
    setMegapixels,
    steps,
    setSteps,
    batchCount,
    setBatchCount,
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
    isHighlighted,
    isMinimized,
    setIsMinimized,
    showSettingsMenu,
    setShowSettingsMenu,
    isPromptFocused,
    setIsPromptFocused,
    isSubmitting: agentAndBatch.isSubmitting,
    isRollingRandom: agentAndBatch.isRollingRandom,
    isInterrogating: mediaImport.isInterrogating,
    isImportingCivitai: mediaImport.isImportingCivitai,
    isQuickGenEmpty,
    hasInspirationImage: Boolean(inspirationFilename),
    modelMatchEnabled: mediaImport.modelMatchEnabled,
    isMatchingFace: mediaImport.isMatchingFace,
    toggleModelMatch: mediaImport.toggleModelMatch,
    workflowDefaultMp,
    workflowDefaultSteps,
    handleInterrogateImageFile: mediaImport.handleInterrogateImageFile,
    handleImportCivitaiUrl: mediaImport.handleImportCivitaiUrl,
    applyPreset: attachments.applyPreset,
    handleRemoveCharacter: attachments.handleRemoveCharacter,
    handleRemovePreset: attachments.handleRemovePreset,
    handleRemoveCheckpoint: attachments.handleRemoveCheckpoint,
    handleRemoveStackTarget: attachments.handleRemoveStackTarget,
    handleRemoveLora: attachments.handleRemoveLora,
    handleUpdateLoraStrength: attachments.handleUpdateLoraStrength,
    handleUpdateCharacterStrength: attachments.handleUpdateCharacterStrength,
    handleClearBox,
    handleSubmit: agentAndBatch.handleSubmit,
    handleRandomRoll: agentAndBatch.handleRandomRoll,
    handleUpdateProposedPrompt: agentAndBatch.handleUpdateProposedPrompt,
    handleSubmitProposedPrompt: agentAndBatch.handleSubmitProposedPrompt,
    handlePreviewExpandConcept: agentAndBatch.handlePreviewExpandConcept,
    handleUpdateExpandedPrompt: agentAndBatch.handleUpdateExpandedPrompt,
    handleCloseExpandedPreview: agentAndBatch.handleCloseExpandedPreview,
    handleSubmitExpandedPrompts: agentAndBatch.handleSubmitExpandedPrompts,
  };
}
