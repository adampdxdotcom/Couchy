import type {
  CharacterProfile,
  GenerationLoraSelection,
  LoraExplorerItem,
  LoraPreset,
  QuickGenChatMessage,
} from '../../shared/types.ts';
import {
  MAX_SYSTEM_LORAS,
  getCleanLoraLabel,
  normalizeLoraKey,
  type QuickGenPrefill,
} from './quickGenUtils.ts';

/**
 * Resolves the active ordered LoRA stack and deduplicated comma-separated trigger words
 * from the attached Character, pilled LoRAs, explorer defaults, and removed keys.
 */
export function resolveActiveLoraStackData(params: {
  attachedCharacter: CharacterProfile | null;
  attachedLoras: GenerationLoraSelection[];
  removedLoraKeys: ReadonlySet<string>;
  characterLoraStrength: number;
  loras: LoraExplorerItem[];
}): { selectedLoras: GenerationLoraSelection[]; triggerWord: string } {
  const {
    attachedCharacter,
    attachedLoras,
    removedLoraKeys,
    characterLoraStrength,
    loras,
  } = params;

  const activeCharLoraRecords = attachedCharacter
    ? attachedCharacter.loras.filter((l) => !removedLoraKeys.has(normalizeLoraKey(l.loraName)))
    : [];

  const charLoras: GenerationLoraSelection[] = activeCharLoraRecords.map((l) => {
    const matchingAttached = attachedLoras.find(
      (al) => normalizeLoraKey(al.loraName) === normalizeLoraKey(l.loraName)
    );
    const resolvedModelStrength = matchingAttached
      ? matchingAttached.modelStrength
      : characterLoraStrength;
    const resolvedClipStrength = matchingAttached
      ? matchingAttached.clipStrength
      : characterLoraStrength;
    return {
      loraName: l.loraName,
      modelStrength: resolvedModelStrength,
      clipStrength: resolvedClipStrength,
      triggerWord: l.triggerWord || '',
      appearanceLabel: l.appearanceLabel || '',
    };
  });

  // Character-only mode: include only the attached character's own LoRAs
  const selectedLoras: GenerationLoraSelection[] = [...charLoras];

  // Join unique trigger tokens from the active character LoRAs
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

  return { selectedLoras, triggerWord: triggerTokens.join(', ') };
}

/**
 * Hydrates reused LoRA selections and initial character strength from a QuickGen prefill payload.
 */
export function buildReusedLoraSelections(params: {
  prefillLoras: NonNullable<QuickGenPrefill['loras']>;
  prefillCharacter?: CharacterProfile | null;
  excludedKeySet: ReadonlySet<string>;
  loras: LoraExplorerItem[];
}): {
  reusedSelections: GenerationLoraSelection[];
  characterStrength: number | null;
} {
  const { prefillLoras, prefillCharacter, excludedKeySet, loras } = params;
  const reusedSelections: GenerationLoraSelection[] = [];
  const seenLoraNames = new Set<string>();
  const prefillCharLoraKeys = new Set(
    (prefillCharacter?.loras || []).map((cl) => normalizeLoraKey(cl.loraName))
  );

  for (const imgLora of prefillLoras) {
    const rawKey = normalizeLoraKey(imgLora.loraName);
    if (!rawKey || seenLoraNames.has(rawKey)) continue;
    seenLoraNames.add(rawKey);

    const cleanBase = imgLora.loraName.replace(/\.(safetensors|pt|ckpt)$/i, '').toLowerCase();
    const matchedExplorerLora = loras.find(
      (l) =>
        l.filename.toLowerCase() === imgLora.loraName.toLowerCase() ||
        l.name.toLowerCase() === cleanBase
    );

    const prefillExtra = imgLora as {
      triggerWord?: string;
      nickname?: string;
      showPill?: boolean;
      isCharacterPill?: boolean;
      portraitThumbnailUrl?: string | null;
      portraitCrop?: CharacterProfile['portraitCrop'];
    };

    const belongsToAttachedChar = prefillCharLoraKeys.has(rawKey);
    if (!belongsToAttachedChar) continue;

    reusedSelections.push({
      loraName: matchedExplorerLora?.filename || imgLora.loraName,
      modelStrength: Number(
        imgLora.modelStrength ?? matchedExplorerLora?.defaultModelStrength ?? 1.0
      ),
      clipStrength: Number(
        imgLora.clipStrength ?? matchedExplorerLora?.defaultClipStrength ?? 1.0
      ),
      triggerWord: prefillExtra.triggerWord || matchedExplorerLora?.triggerWord || '',
      nickname:
        prefillExtra.nickname ||
        getCleanLoraLabel(matchedExplorerLora || { loraName: imgLora.loraName }),
      showPill: false,
      isCharacterPill: prefillExtra.isCharacterPill,
      portraitThumbnailUrl: prefillExtra.portraitThumbnailUrl,
      portraitCrop: prefillExtra.portraitCrop,
    });
  }

  let characterStrength: number | null = null;
  if (prefillCharacter) {
    const charLoraKeys = new Set(
      prefillCharacter.loras
        .map((cl) => normalizeLoraKey(cl.loraName))
        .filter((k) => !excludedKeySet.has(k))
    );
    const matchedCharReused = reusedSelections.find((rs) =>
      charLoraKeys.has(normalizeLoraKey(rs.loraName))
    );
    characterStrength = matchedCharReused ? matchedCharReused.modelStrength : 1.0;
  } else if (prefillCharacter === null) {
    characterStrength = 1.0;
  }

  return { reusedSelections, characterStrength };
}

/**
 * Merges a preset's LoRAs onto existing Quick Gen LoRA pills, replacing previous preset pills
 * while preserving character LoRAs, manual pills, and the 5-LoRA system cap.
 */
export function mergePresetLoras(params: {
  prevLoras: GenerationLoraSelection[];
  preset: LoraPreset;
  prevPreset: LoraPreset | null;
  attachedCharacter: CharacterProfile | null;
  removedLoraKeys: ReadonlySet<string>;
  respectRemovedKeys: boolean;
  loras: LoraExplorerItem[];
}): {
  nextLoras: GenerationLoraSelection[];
  matchedCharacterStrength: number | null;
  truncatedCount: number;
} {
  const {
    prevLoras,
    preset,
    prevPreset,
    attachedCharacter,
    removedLoraKeys,
    respectRemovedKeys,
    loras,
  } = params;

  const charLoraKeys = new Set(
    attachedCharacter
      ? attachedCharacter.loras.map((cl) => normalizeLoraKey(cl.loraName))
      : []
  );
  const activeCharLoraCount = attachedCharacter
    ? attachedCharacter.loras.filter((cl) => !removedLoraKeys.has(normalizeLoraKey(cl.loraName)))
        .length
    : 0;
  const prevPresetKeys = new Set(
    (prevPreset?.items || []).map((it) => normalizeLoraKey(it.loraName))
  );

  // Keep character LoRAs + manual pills not introduced solely by the previous preset
  const nextList = prevLoras.filter((al) => {
    const k = normalizeLoraKey(al.loraName);
    if (charLoraKeys.has(k)) return true;
    return !prevPresetKeys.has(k);
  });

  const countActiveNonChar = () =>
    nextList.filter((al) => !charLoraKeys.has(normalizeLoraKey(al.loraName))).length;

  let truncatedCount = 0;
  let matchedCharacterStrength: number | null = null;

  for (const item of preset.items) {
    const itemKey = normalizeLoraKey(item.loraName);
    if (respectRemovedKeys && removedLoraKeys.has(itemKey)) continue;

    const matchedExplorer = loras.find(
      (l) => normalizeLoraKey(l.filename) === itemKey || normalizeLoraKey(l.name) === itemKey
    );
    const belongsToChar = charLoraKeys.has(itemKey);
    const resolvedLabel = getCleanLoraLabel(
      matchedExplorer || { name: item.displayName, loraName: item.loraName }
    );
    const resolvedTrigger = matchedExplorer?.triggerWord || item.triggerWord || '';

    const existingIdx = nextList.findIndex((al) => normalizeLoraKey(al.loraName) === itemKey);
    if (existingIdx >= 0) {
      nextList[existingIdx] = {
        ...nextList[existingIdx],
        loraName: matchedExplorer?.filename || item.loraName,
        modelStrength: item.modelStrength,
        clipStrength: item.clipStrength,
        triggerWord: resolvedTrigger || nextList[existingIdx].triggerWord || '',
        nickname: resolvedLabel,
        showPill: belongsToChar ? false : true,
      };
      if (belongsToChar) {
        matchedCharacterStrength = item.modelStrength;
      }
      continue;
    }

    if (!belongsToChar && activeCharLoraCount + countActiveNonChar() >= MAX_SYSTEM_LORAS) {
      truncatedCount += 1;
      continue;
    }

    nextList.push({
      loraName: matchedExplorer?.filename || item.loraName,
      modelStrength: item.modelStrength,
      clipStrength: item.clipStrength,
      triggerWord: resolvedTrigger,
      nickname: resolvedLabel,
      showPill: !belongsToChar,
    });
  }

  return { nextLoras: nextList, matchedCharacterStrength, truncatedCount };
}

/** Clamps a Quick Gen LoRA strength multiplier to [-10.0, 10.0] rounded to 2 decimals. */
export function clampLoraStrength(value: number): number {
  return Math.max(-10.0, Math.min(10.0, Math.round(value * 100) / 100));
}

/**
 * Stamps the latest assistant chat message with the active excluded LoRA list so
 * stack re-opening preserves which character/preset LoRAs the user manually removed.
 */
export function patchLastAssistantExclusions(
  chatMessages: QuickGenChatMessage[],
  excludedLoras: string[]
): QuickGenChatMessage[] {
  if (chatMessages.length === 0) return chatMessages;
  const lastAssistantIdx = [...chatMessages].reverse().findIndex((m) => m.role === 'assistant');
  if (lastAssistantIdx < 0) return chatMessages;
  const actualIdx = chatMessages.length - 1 - lastAssistantIdx;
  const nextExcluded = excludedLoras.length > 0 ? excludedLoras : undefined;
  return chatMessages.map((m, idx) =>
    idx === actualIdx ? { ...m, excludedLoras: nextExcluded } : m
  );
}
