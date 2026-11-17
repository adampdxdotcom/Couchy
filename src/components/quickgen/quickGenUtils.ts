import type {
  CharacterProfile,
  ImageLoraRecord,
  ImageRecord,
  LoraExplorerItem,
  LoraPreset,
  ModelInventoryItem,
  PortraitCrop,
  QuickGenChatMessage,
} from '../../shared/types.ts';

export const MAX_SYSTEM_LORAS = 5;

export interface QuickGenPrefillLora {
  loraName: string;
  modelStrength?: number;
  clipStrength?: number;
  showPill?: boolean;
  triggerWord?: string;
  nickname?: string;
  isCharacterPill?: boolean;
  portraitThumbnailUrl?: string | null;
  portraitCrop?: PortraitCrop | null;
}

export interface QuickGenPrefill {
  prompt: string;
  character?: CharacterProfile | null;
  checkpointName?: string | null;
  loras?: Array<ImageLoraRecord | QuickGenPrefillLora>;
  excludedLoras?: string[];
  aspectRatio?: string;
  megapixels?: number;
  batchCount?: number;
  conversationMode?: boolean;
  chatMessages?: QuickGenChatMessage[];
  seriesId?: number | null;
  branchFromImageId?: number | null;
  stackSourceLabel?: string | null;
  timestamp: number;
}

export type MentionTab = 'all' | 'characters' | 'loras' | 'models' | 'presets';

export interface MentionEntry {
  key: string;
  type: 'character' | 'image' | 'lora' | 'model' | 'preset';
  character?: CharacterProfile;
  loraItem?: LoraExplorerItem;
  modelItem?: ModelInventoryItem;
  presetItem?: LoraPreset;
  title: string;
  subtitle: string;
  thumbnailUrl: string | null;
  promptSnippet?: string | null;
}

/** Returns preferred display label for a LoRA Preset (nickname without @ first, fallback to name). */
export function getCleanPresetLabel(
  preset?: { nickname?: string | null; name?: string } | null
): string {
  if (!preset) return 'Preset';
  const nick = (preset.nickname || '').trim().replace(/^@+/, '');
  return nick || preset.name?.trim() || 'Preset';
}

export const BATCH_COUNT_OPTIONS = [1, 2, 4, 6, 8] as const;

/**
 * Returns the clean display label for a LoRA in Quick Gen:
 * prefers the user-configured nickname (without @ prefix), falling back to clean name.
 */
export function getCleanLoraLabel(
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

/** Returns the clean display label for a base model / checkpoint filename. */
export function getCleanModelLabel(name?: string | null): string {
  if (!name) return 'Default Model';
  return name
    .trim()
    .replace(/\\/g, '/')
    .split('/')
    .pop()!
    .replace(/\.(safetensors|pt|ckpt|pth|bin|gguf|sft)$/i, '');
}

/** Returns preferred display label for a base model in Quick Gen @mention (nickname first). */
export function getCleanModelMentionLabel(
  model?: { nickname?: string | null; name?: string; filename?: string } | null
): string {
  if (!model) return 'Model';
  const nick = (model.nickname || '').trim().replace(/^@+/, '');
  if (nick) return nick;
  return getCleanModelLabel(model.name || model.filename);
}

/** Normalizes a LoRA or model filename/path to a lowercase base key without extension. */
export function normalizeLoraKey(name: string): string {
  return name
    .trim()
    .replace(/\\/g, '/')
    .split('/')
    .pop()!
    .replace(/\.(safetensors|pt|ckpt|pth|bin|gguf|sft)$/i, '')
    .toLowerCase();
}

/**
 * Resolves a base model checkpoint filename to its user-configured @nickname if present,
 * falling back to its inventory name or stripped filename stem.
 */
export function resolveBaseModelDisplayLabel(
  checkpointName?: string | null,
  models: ModelInventoryItem[] = []
): string {
  if (!checkpointName) return 'Default Model';
  const key = normalizeLoraKey(checkpointName);
  if (key && models.length > 0) {
    const match = models.find(
      (m) =>
        m.modelType !== 'lora' &&
        (normalizeLoraKey(m.filename) === key || normalizeLoraKey(m.name) === key)
    );
    if (match) {
      return getCleanModelMentionLabel(match);
    }
  }
  return getCleanModelLabel(checkpointName);
}

/**
 * Resolves an image's checkpointName for Quick Gen reuse:
 * returns canonical installed filename when verified in ComfyUI, or marks unavailable if missing/un-imported.
 */
export function resolveReusableCheckpoint(
  checkpointName?: string | null,
  models: ModelInventoryItem[] = []
): { checkpointName: string | null; unavailableLabel: string | null } {
  const clean = (checkpointName || '').trim();
  if (!clean) return { checkpointName: null, unavailableLabel: null };
  const key = normalizeLoraKey(clean);
  if (key && models.length > 0) {
    const match = models.find(
      (m) =>
        m.modelType !== 'lora' &&
        (normalizeLoraKey(m.filename) === key || normalizeLoraKey(m.name) === key)
    );
    if (match) {
      if (match.isInstalled) {
        return { checkpointName: match.filename, unavailableLabel: null };
      }
      return { checkpointName: null, unavailableLabel: getCleanModelMentionLabel(match) };
    }
  }
  return { checkpointName: clean, unavailableLabel: null };
}

/** Checks whether a LoRA filename belongs to the given CharacterProfile. */
export function isCharacterLora(
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

/** Clamps and snaps any megapixel value to 0.5 MP increments between 0.5 and 10.0. */
export function snapToHalfMp(val: number | null | undefined, fallback = 3.0): number {
  const n = Number(val);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.max(0.5, Math.min(10.0, Math.round(n * 2) / 2));
}

/**
 * Downscales an uploaded/dropped image file in the browser so its pixel area is at most ~1MP,
 * preserving original aspect ratio and returning a compact JPEG data URL + original dimensions.
 */
export async function downscaleImageFileTo1Mp(file: File): Promise<{
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
        const maxArea = 1024 * 1024;
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

/**
 * Returns true when pasted text is a single Civitai `/images/:id` or `/posts/:id` share URL.
 */
export function isCivitaiShareUrl(rawText: string): boolean {
  const trimmed = String(rawText || '').trim();
  if (!trimmed || /\s/.test(trimmed)) return false;
  return /^https?:\/\/(www\.)?civitai\.(com|red)\/(images|posts)\/\d+(?:[/?#].*)?$/i.test(trimmed);
}

/**
 * Builds categorized @mention candidates for Characters, confirmed reference images, and LoRAs.
 */
export function buildMentionEntries(params: {
  characters: CharacterProfile[];
  loras: LoraExplorerItem[];
  models?: ModelInventoryItem[];
  presets?: LoraPreset[];
  allImages: ImageRecord[];
  query: string;
  tab: MentionTab;
}): {
  mentionEntries: MentionEntry[];
  mentionCounts: {
    all: number;
    characters: number;
    loras: number;
    models: number;
    presets: number;
  };
} {
  const { characters, loras, models = [], presets = [], allImages, query, tab } = params;
  const q = query.trim().toLowerCase();
  const directCharEntries: MentionEntry[] = [];
  const loraEntries: MentionEntry[] = [];
  const modelEntries: MentionEntry[] = [];
  const presetEntries: MentionEntry[] = [];
  const imagePromptEntries: MentionEntry[] = [];

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
        (l) => l.triggerWord?.toLowerCase().includes(q) || l.loraName.toLowerCase().includes(q)
      );

    if (matchesChar) {
      directCharEntries.push({
        key: `char-${char.id}`,
        type: 'character',
        character: char,
        title: char.name,
        subtitle: 'Character',
        thumbnailUrl: fallbackThumb,
      });
    }

    if (matchesChar || q.length >= 2) {
      for (const img of charImages.slice(0, 4)) {
        const promptLine = (img.positivePrompt || '').trim();
        const shortTitle = promptLine
          ? promptLine.slice(0, 42) + (promptLine.length > 42 ? '...' : '')
          : `${char.name} (${img.filename})`;
        if (!q || matchesChar || shortTitle.toLowerCase().includes(q)) {
          imagePromptEntries.push({
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

  for (const lora of loras.filter((l) => l.mentionEnabled && l.isInstalled && !l.isHidden)) {
    const nick = (lora.nickname || '').toLowerCase();
    const loraName = lora.name.toLowerCase();
    const loraFile = lora.filename.toLowerCase();
    const trig = (lora.triggerWord || '').toLowerCase();

    const matchesLora =
      !q ||
      (nick && nick.includes(q)) ||
      loraName.includes(q) ||
      loraFile.includes(q) ||
      (trig && trig.includes(q));

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

  for (const model of models.filter(
    (m) =>
      (m.modelType === 'diffusion' || m.modelType === 'checkpoint') &&
      m.isInstalled &&
      !m.isHidden &&
      m.mentionEnabled
  )) {
    const nick = (model.nickname || '').toLowerCase();
    const mName = model.name.toLowerCase();
    const mFile = model.filename.toLowerCase();
    const mArch = (model.baseModel || '').toLowerCase();
    const mDetails = (model.llmDescription || '').toLowerCase();

    const matchesModel =
      !q ||
      (nick && nick.includes(q)) ||
      mName.includes(q) ||
      mFile.includes(q) ||
      (mArch && mArch.includes(q)) ||
      (mDetails && mDetails.includes(q));

    if (matchesModel) {
      const displayLabel = getCleanModelMentionLabel(model);
      modelEntries.push({
        key: `model-${model.id}`,
        type: 'model',
        modelItem: model,
        title: displayLabel,
        subtitle: `Base Model${model.baseModel ? ` · ${model.baseModel}` : ''}`,
        thumbnailUrl: model.previewImages?.[0]?.url || null,
        promptSnippet: displayLabel,
      });
    }
  }

  for (const preset of presets) {
    const pName = preset.name.toLowerCase();
    const pNick = (preset.nickname || '').toLowerCase();
    const pUser = (preset.userDescription || '').toLowerCase();
    const pAgent = (preset.agentDescription || '').toLowerCase();
    const pCkpt = (preset.checkpointName || '').toLowerCase();

    const matchesPreset =
      !q ||
      pName.includes(q) ||
      (pNick && pNick.includes(q)) ||
      (pUser && pUser.includes(q)) ||
      (pAgent && pAgent.includes(q)) ||
      (pCkpt && pCkpt.includes(q)) ||
      preset.items.some(
        (it) =>
          it.loraName.toLowerCase().includes(q) ||
          (it.displayName || '').toLowerCase().includes(q)
      );

    if (matchesPreset) {
      const displayLabel = getCleanPresetLabel(preset);
      const basePart = preset.checkpointDisplayName
        ? ` + ${preset.checkpointDisplayName}`
        : '';
      presetEntries.push({
        key: `preset-${preset.id}`,
        type: 'preset',
        presetItem: preset,
        title: displayLabel,
        subtitle: `Preset · ${preset.items.length} LoRA${preset.items.length === 1 ? '' : 's'}${basePart}`,
        thumbnailUrl: null,
        promptSnippet: preset.name,
      });
    }
  }

  // Place Character, Preset, LoRA, and Base Model matches above matching image prompts
  const charTabEntries = [...directCharEntries, ...imagePromptEntries];
  const allCombined = [
    ...directCharEntries,
    ...presetEntries,
    ...loraEntries,
    ...modelEntries,
    ...imagePromptEntries,
  ];
  const mentionCounts = {
    all: allCombined.length,
    characters: charTabEntries.length,
    loras: loraEntries.length,
    models: modelEntries.length,
    presets: presetEntries.length,
  };

  const mentionEntries =
    tab === 'characters'
      ? charTabEntries
      : tab === 'loras'
      ? loraEntries
      : tab === 'models'
      ? modelEntries
      : tab === 'presets'
      ? presetEntries
      : allCombined;

  return { mentionEntries, mentionCounts };
}
