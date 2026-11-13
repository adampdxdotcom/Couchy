import type {
  CharacterProfile,
  ImageLoraRecord,
  ImageRecord,
  LoraExplorerItem,
  QuickGenChatMessage,
} from '../../shared/types.ts';

export interface QuickGenPrefill {
  prompt: string;
  character?: CharacterProfile | null;
  loras?: ImageLoraRecord[];
  excludedLoras?: string[];
  aspectRatio?: string;
  megapixels?: number;
  batchCount?: number;
  conversationMode?: boolean;
  chatMessages?: QuickGenChatMessage[];
  seriesId?: number | null;
  branchFromImageId?: number | null;
  timestamp: number;
}

export type MentionTab = 'all' | 'characters' | 'loras';

export interface MentionEntry {
  key: string;
  type: 'character' | 'image' | 'lora';
  character?: CharacterProfile;
  loraItem?: LoraExplorerItem;
  title: string;
  subtitle: string;
  thumbnailUrl: string | null;
  promptSnippet?: string | null;
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

/** Normalizes a LoRA filename/path to a lowercase base key without extension. */
export function normalizeLoraKey(name: string): string {
  return name
    .trim()
    .replace(/\\/g, '/')
    .split('/')
    .pop()!
    .replace(/\.(safetensors|pt|ckpt)$/i, '')
    .toLowerCase();
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
 * Builds categorized @mention candidates for Characters, confirmed reference images, and LoRAs.
 */
export function buildMentionEntries(params: {
  characters: CharacterProfile[];
  loras: LoraExplorerItem[];
  allImages: ImageRecord[];
  query: string;
  tab: MentionTab;
}): {
  mentionEntries: MentionEntry[];
  mentionCounts: { all: number; characters: number; loras: number };
} {
  const { characters, loras, allImages, query, tab } = params;
  const q = query.trim().toLowerCase();
  const charEntries: MentionEntry[] = [];
  const loraEntries: MentionEntry[] = [];

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
      charEntries.push({
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

  for (const lora of loras.filter((l) => l.mentionEnabled)) {
    const nick = (lora.nickname || '').toLowerCase();
    const loraName = lora.name.toLowerCase();
    const loraFile = lora.filename.toLowerCase();

    const matchesLora =
      !q || (nick && nick.includes(q)) || loraName.includes(q) || loraFile.includes(q);

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
  const mentionCounts = {
    all: allCombined.length,
    characters: charEntries.length,
    loras: loraEntries.length,
  };

  const mentionEntries =
    tab === 'characters' ? charEntries : tab === 'loras' ? loraEntries : allCombined;

  return { mentionEntries, mentionCounts };
}
