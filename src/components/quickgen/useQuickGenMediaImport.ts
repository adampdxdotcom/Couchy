import React, { useState } from 'react';
import { api } from '../../api/client.ts';
import type {
  CharacterProfile,
  GenerationLoraSelection,
  LoraExplorerItem,
} from '../../shared/types.ts';
import { resolveClosestAspectRatio } from '../../shared/utils.ts';
import {
  MAX_SYSTEM_LORAS,
  downscaleImageFileTo1Mp,
  getCleanLoraLabel,
  normalizeLoraKey,
} from './quickGenUtils.ts';

interface UseQuickGenMediaImportParams {
  loras: LoraExplorerItem[];
  lmStudioOnline: boolean;
  isQuickGenEmpty: boolean;
  prompt: string;
  attachedCharacter: CharacterProfile | null;
  attachedLoras: GenerationLoraSelection[];
  onPushToast: (text: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
  focusInputAtEnd: (delayMs?: number, moveToEnd?: boolean) => void;
  pulseHighlight: (durationMs?: number) => void;
  setPrompt: React.Dispatch<React.SetStateAction<string>>;
  setIsMinimized: React.Dispatch<React.SetStateAction<boolean>>;
  setInspirationFilename: React.Dispatch<React.SetStateAction<string | null>>;
  setAspectRatio: React.Dispatch<React.SetStateAction<string>>;
  setAttachedCharacter: React.Dispatch<React.SetStateAction<CharacterProfile | null>>;
  setCharacterLoraStrength: React.Dispatch<React.SetStateAction<number>>;
  setAttachedCheckpoint: React.Dispatch<React.SetStateAction<string | null>>;
  setAttachedLoras: React.Dispatch<React.SetStateAction<GenerationLoraSelection[]>>;
  setRemovedLoraKeys: React.Dispatch<React.SetStateAction<Set<string>>>;
}

/**
 * Handles Quick Gen image-to-prompt interrogation (with optional face-recognition character matching)
 * and Civitai image/post URL importing.
 */
export function useQuickGenMediaImport({
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
}: UseQuickGenMediaImportParams) {
  const [isInterrogating, setIsInterrogating] = useState(false);
  const [isImportingCivitai, setIsImportingCivitai] = useState(false);
  const [isMatchingFace, setIsMatchingFace] = useState(false);
  const [modelMatchEnabled, setModelMatchEnabled] = useState<boolean>(() => {
    try {
      return (
        typeof window !== 'undefined' &&
        localStorage.getItem('couchy_quickgen_model_match') === '1'
      );
    } catch {
      return false;
    }
  });

  const toggleModelMatch = () => {
    setModelMatchEnabled((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('couchy_quickgen_model_match', next ? '1' : '0');
      } catch {
        // ignore storage errors
      }
      return next;
    });
  };

  const handleInterrogateImageFile = async (file: File) => {
    if (!lmStudioOnline) {
      onPushToast('Local LLM is offline — start your Local LLM server to interrogate images.', 'warning');
      return;
    }
    if (!file.type.startsWith('image/')) {
      onPushToast('Please select or drop a valid image file.', 'warning');
      return;
    }
    if (isInterrogating) return;

    setIsInterrogating(true);
    setIsMinimized(false);
    setInspirationFilename(null);
    try {
      const { dataUrl, width, height } = await downscaleImageFileTo1Mp(file);
      const matchedRatio = resolveClosestAspectRatio(width, height);
      setAspectRatio(matchedRatio);

      // When Model Match mode is on and no subject is attached yet, scan faces and attach closest match first
      let effectiveCharacter = attachedCharacter;
      let matchedFaceInfo: { name: string; similarity: number } | null = null;

      if (modelMatchEnabled && !effectiveCharacter) {
        setIsMatchingFace(true);
        try {
          const matchRes = await api.matchCharacterFace({ imageBase64DataUrl: dataUrl });
          if (matchRes.matched && matchRes.character) {
            effectiveCharacter = matchRes.character;
            const matchedCharKeys = new Set(
              matchRes.character.loras.map((cl) => normalizeLoraKey(cl.loraName))
            );
            const preExistingCharLora = attachedLoras.find((al) =>
              matchedCharKeys.has(normalizeLoraKey(al.loraName))
            );
            setAttachedCharacter(matchRes.character);
            setCharacterLoraStrength(preExistingCharLora ? preExistingCharLora.modelStrength : 1.0);
            setAttachedLoras((prev) =>
              prev.map((al) =>
                matchedCharKeys.has(normalizeLoraKey(al.loraName))
                  ? { ...al, showPill: false }
                  : al
              )
            );
            setRemovedLoraKeys((prev) => {
              const next = new Set(prev);
              for (const cl of matchRes.character!.loras) {
                next.delete(normalizeLoraKey(cl.loraName));
              }
              return next;
            });
            matchedFaceInfo = {
              name: matchRes.character.name,
              similarity: matchRes.similarity ?? 0,
            };
          } else if (matchRes.indexedCharactersCount === 0) {
            onPushToast('Model Match: No character portraits indexed yet.', 'info');
          } else if (matchRes.facesDetected === 0) {
            onPushToast('Model Match: No face detected in uploaded image.', 'info');
          } else if (matchRes.bestCandidate) {
            onPushToast(
              `Model Match: No close match (closest: ${matchRes.bestCandidate.characterName} at ${Math.round(
                matchRes.bestCandidate.similarity * 100
              )}%).`,
              'info'
            );
          }
        } catch (matchErr: any) {
          onPushToast(
            `Model Match skipped (${matchErr?.message || 'face scan unavailable'}).`,
            'warning'
          );
        } finally {
          setIsMatchingFace(false);
        }
      }

      const existingHint = prompt.trim();
      const res = await api.interrogateImage({
        imageBase64DataUrl: dataUrl,
        characterName: effectiveCharacter?.name,
        userHint: existingHint || undefined,
      });

      if (res.savedFilename) {
        setInspirationFilename(res.savedFilename);
      }

      if (res.prompt) {
        setPrompt(res.prompt);
        pulseHighlight(1200);
        const modeLabel = res.pipelineUsed === 'vision' ? 'Vision Model' : 'WD14 + LLM';
        const prefix = matchedFaceInfo
          ? `Matched ${matchedFaceInfo.name} (${Math.round(matchedFaceInfo.similarity * 100)}%) · `
          : '';
        onPushToast(`${prefix}Interrogated image via ${modeLabel} (${matchedRatio})`, 'success');
        focusInputAtEnd(50, false);
      }
    } catch (err: any) {
      onPushToast(err?.message || 'Failed to interrogate uploaded image.', 'error');
    } finally {
      setIsMatchingFace(false);
      setIsInterrogating(false);
    }
  };

  /**
   * Imports prompt, aspect ratio, 1MP inspiration image, and locally available Base Model / LoRAs
   * from a Civitai image URL. Only runs when Quick Gen is empty.
   */
  const handleImportCivitaiUrl = async (rawUrl: string) => {
    if (isImportingCivitai || isInterrogating) return;
    if (!isQuickGenEmpty) {
      onPushToast('Clear Quick Gen first to import a Civitai image URL.', 'info');
      return;
    }

    setIsImportingCivitai(true);
    setIsMinimized(false);
    setInspirationFilename(null);
    try {
      const res = await api.importCivitaiImageUrl(rawUrl);
      const hasAnyPayload =
        Boolean(res.prompt) ||
        Boolean(res.checkpointName) ||
        res.loras.length > 0 ||
        Boolean(res.inspirationFilename);

      if (!hasAnyPayload) {
        onPushToast(
          'No usable prompt metadata or installed models were found for that Civitai URL.',
          'warning'
        );
        return;
      }

      if (res.inspirationFilename) setInspirationFilename(res.inspirationFilename);
      if (res.prompt) setPrompt(res.prompt);
      if (res.aspectRatio) setAspectRatio(res.aspectRatio);
      if (res.checkpointName) setAttachedCheckpoint(res.checkpointName);

      // Character-only mode: do not attach external Civitai LoRAs
      pulseHighlight(1400);
      focusInputAtEnd(60, true);

      const importedParts: string[] = [];
      if (res.inspirationFilename) importedParts.push('1MP photo');
      if (res.prompt) importedParts.push('prompt');
      if (res.checkpointName) importedParts.push('base model');
      if (res.aspectRatio) importedParts.push(res.aspectRatio.split(' ')[0]);

      const skippedCount = res.skippedCheckpoint ? 1 : 0;
      const omittedParts: string[] = [];
      if (!res.prompt) omittedParts.push('prompt unavailable');
      if (skippedCount > 0) {
        omittedParts.push(`${skippedCount} unavailable model${skippedCount === 1 ? '' : 's'} omitted`);
      }

      const suffix = omittedParts.length > 0 ? ` (${omittedParts.join('; ')})` : '';
      onPushToast(`Imported Civitai ${importedParts.join(' · ')}${suffix}`, 'success');
    } catch (err: any) {
      onPushToast(err?.message || 'Failed to read Civitai image URL.', 'warning');
    } finally {
      setIsImportingCivitai(false);
    }
  };

  return {
    isInterrogating,
    isImportingCivitai,
    isMatchingFace,
    modelMatchEnabled,
    toggleModelMatch,
    handleInterrogateImageFile,
    handleImportCivitaiUrl,
  };
}
