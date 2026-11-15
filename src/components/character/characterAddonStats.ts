import type {
  CharacterProfile,
  ImageRecord,
  LoraCategory,
  LoraExplorerItem,
  ModelInventoryItem,
  PortraitCrop,
} from '../../shared/types.ts';
import { normalizeLoraKey } from '../quickgen/quickGenUtils.ts';

export type AddonSortMode = 'most_used' | 'highest_rated';

export interface FavoriteBaseModelItem {
  key: string;
  name: string;
  count: number;
  sharePercent: number;
  avgRating: number;
  favoriteCount: number;
  isInstalled: boolean;
  isDownloadedPendingImport: boolean;
}

export interface FavoriteAddonLoraItem {
  key: string;
  loraName: string;
  displayName: string;
  category: LoraCategory;
  count: number;
  avgModelStrength: number;
  avgClipStrength: number;
  avgRating: number;
  favoriteCount: number;
  isInstalled: boolean;
  isDownloadedPendingImport: boolean;
}

export interface CharacterFriendItem {
  key: string;
  characterId: number | null;
  characterName: string;
  portraitThumbnailUrl: string | null;
  portraitCrop?: PortraitCrop | null;
  loraName: string;
  loraDisplayName: string;
  count: number;
  avgModelStrength: number;
  avgClipStrength: number;
  avgRating: number;
  favoriteCount: number;
  isInstalled: boolean;
  isDownloadedPendingImport: boolean;
}

function getCleanDisplayStem(rawName: string): string {
  return (rawName || '')
    .trim()
    .replace(/^.*[\\/]/, '')
    .replace(/\.(safetensors|pt|ckpt|bin)$/i, '');
}

function compareBySortMode(
  a: { count: number; avgRating: number; favoriteCount: number },
  b: { count: number; avgRating: number; favoriteCount: number },
  labelA: string,
  labelB: string,
  mode: AddonSortMode
): number {
  if (mode === 'highest_rated') {
    const aHasRating = a.avgRating > 0 ? 1 : 0;
    const bHasRating = b.avgRating > 0 ? 1 : 0;
    if (bHasRating !== aHasRating) return bHasRating - aHasRating;
    if (Math.abs(b.avgRating - a.avgRating) > 0.01) return b.avgRating - a.avgRating;
    if (b.favoriteCount !== a.favoriteCount) return b.favoriteCount - a.favoriteCount;
    if (b.count !== a.count) return b.count - a.count;
    return labelA.localeCompare(labelB);
  }
  if (b.count !== a.count) return b.count - a.count;
  if (Math.abs(b.avgRating - a.avgRating) > 0.01) return b.avgRating - a.avgRating;
  return labelA.localeCompare(labelB);
}

/**
 * Computes aggregated base models, non-character addon LoRAs, and co-occurring friend character LoRAs
 * across a character's confirmed, non-rejected images.
 */
export function computeCharacterAddonStats(params: {
  character: CharacterProfile;
  confirmedImages: ImageRecord[];
  allCharacters: CharacterProfile[];
  allLoras: LoraExplorerItem[];
  allModels?: ModelInventoryItem[];
  defaultCheckpoint?: string | null;
  sortMode: AddonSortMode;
}): {
  baseModels: FavoriteBaseModelItem[];
  addonLoras: FavoriteAddonLoraItem[];
  friends: CharacterFriendItem[];
} {
  const {
    character,
    confirmedImages,
    allCharacters,
    allLoras,
    allModels = [],
    defaultCheckpoint,
    sortMode,
  } = params;
  const totalImages = confirmedImages.length;

  // Build normalized lookup maps
  const ownLoraKeys = new Set(character.loras.map((l) => normalizeLoraKey(l.loraName)).filter(Boolean));

  const modelByKey = new Map<string, ModelInventoryItem>();
  for (const m of allModels) {
    if (m.modelType === 'lora') continue;
    const k1 = normalizeLoraKey(m.filename);
    const k2 = normalizeLoraKey(m.name);
    if (k1 && !modelByKey.has(k1)) modelByKey.set(k1, m);
    if (k2 && !modelByKey.has(k2)) modelByKey.set(k2, m);
  }
  const defaultCkptKey = defaultCheckpoint ? normalizeLoraKey(defaultCheckpoint) : '';

  const explorerByKey = new Map<string, LoraExplorerItem>();
  for (const item of allLoras) {
    const k1 = normalizeLoraKey(item.filename);
    const k2 = normalizeLoraKey(item.name);
    if (k1 && !explorerByKey.has(k1)) explorerByKey.set(k1, item);
    if (k2 && !explorerByKey.has(k2)) explorerByKey.set(k2, item);
  }

  // Map normalized LoRA keys owned by *other* characters so multi-character renders surface under Friends
  const friendByLoraKey = new Map<string, CharacterProfile>();
  for (const other of allCharacters) {
    if (other.id === character.id) continue;
    for (const cl of other.loras) {
      const k = normalizeLoraKey(cl.loraName);
      if (k && !ownLoraKeys.has(k) && !friendByLoraKey.has(k)) {
        friendByLoraKey.set(k, other);
      }
    }
  }
  for (const item of allLoras) {
    if (item.loraCategory !== 'character') continue;
    const k = normalizeLoraKey(item.filename);
    if (!k || ownLoraKeys.has(k) || friendByLoraKey.has(k)) continue;
    const linkedOther = item.characters.find((c) => c.id !== character.id);
    if (linkedOther) {
      const profile = allCharacters.find((c) => c.id === linkedOther.id);
      if (profile) friendByLoraKey.set(k, profile);
    }
  }

  const baseModelAcc = new Map<
    string,
    { name: string; count: number; ratingSum: number; ratedCount: number; favoriteCount: number }
  >();
  const addonAcc = new Map<
    string,
    {
      loraName: string;
      displayName: string;
      category: LoraCategory;
      count: number;
      modelStrengthSum: number;
      clipStrengthSum: number;
      ratingSum: number;
      ratedCount: number;
      favoriteCount: number;
      isInstalled: boolean;
      isDownloadedPendingImport: boolean;
    }
  >();
  const friendAcc = new Map<
    string,
    {
      characterId: number | null;
      characterName: string;
      portraitThumbnailUrl: string | null;
      portraitCrop?: PortraitCrop | null;
      loraName: string;
      loraDisplayName: string;
      count: number;
      modelStrengthSum: number;
      clipStrengthSum: number;
      ratingSum: number;
      ratedCount: number;
      favoriteCount: number;
      isInstalled: boolean;
      isDownloadedPendingImport: boolean;
    }
  >();

  for (const img of confirmedImages) {
    const ratingVal = Number(img.rating || 0);
    const hasRating = ratingVal > 0;
    const favInc = img.isFavorite ? 1 : 0;

    // 1. Aggregate Base Models / Checkpoints
    const rawCkpt = (img.checkpointName || '').trim();
    if (rawCkpt) {
      const ckptKey = normalizeLoraKey(rawCkpt);
      const existing = baseModelAcc.get(ckptKey) || {
        name: rawCkpt,
        count: 0,
        ratingSum: 0,
        ratedCount: 0,
        favoriteCount: 0,
      };
      existing.count += 1;
      existing.favoriteCount += favInc;
      if (hasRating) {
        existing.ratingSum += ratingVal;
        existing.ratedCount += 1;
      }
      baseModelAcc.set(ckptKey, existing);
    }

    // 2. Aggregate Addon LoRAs and Friend Character LoRAs (deduplicated per image)
    const seenKeysInImage = new Set<string>();
    for (const imgLora of img.loras || []) {
      const loraKey = normalizeLoraKey(imgLora.loraName);
      if (!loraKey || ownLoraKeys.has(loraKey) || seenKeysInImage.has(loraKey)) continue;
      seenKeysInImage.add(loraKey);

      const explorer = explorerByKey.get(loraKey);
      const category: LoraCategory = explorer?.loraCategory || imgLora.loraCategory || 'unclassified';
      const friendProfile = friendByLoraKey.get(loraKey) || null;
      const isFriendLora = Boolean(friendProfile) || category === 'character';

      const nick = (explorer?.nickname || '').trim().replace(/^@+/, '');
      const displayName = nick || explorer?.name?.trim() || getCleanDisplayStem(imgLora.loraName);
      const canonicalFilename = explorer?.filename || imgLora.loraName;
      const isInstalled = explorer ? Boolean(explorer.isInstalled) : Boolean(imgLora.isInstalled);
      const isDownloadedPendingImport = explorer
        ? Boolean(explorer.isDownloadedPendingImport)
        : Boolean(imgLora.isDownloadedPendingImport);

      if (isFriendLora) {
        // Group co-occurring friend by characterId if known, otherwise by normalized LoRA key
        const groupKey = friendProfile ? `char-${friendProfile.id}` : `lora-${loraKey}`;
        const existingFriend = friendAcc.get(groupKey) || {
          characterId: friendProfile?.id ?? null,
          characterName: friendProfile?.name || displayName,
          portraitThumbnailUrl: friendProfile?.portraitThumbnailUrl || null,
          portraitCrop: friendProfile?.portraitCrop ?? null,
          loraName: canonicalFilename,
          loraDisplayName: displayName,
          count: 0,
          modelStrengthSum: 0,
          clipStrengthSum: 0,
          ratingSum: 0,
          ratedCount: 0,
          favoriteCount: 0,
          isInstalled,
          isDownloadedPendingImport,
        };
        existingFriend.count += 1;
        existingFriend.modelStrengthSum += Number(imgLora.modelStrength ?? 1.0);
        existingFriend.clipStrengthSum += Number(imgLora.clipStrength ?? 1.0);
        existingFriend.favoriteCount += favInc;
        if (hasRating) {
          existingFriend.ratingSum += ratingVal;
          existingFriend.ratedCount += 1;
        }
        friendAcc.set(groupKey, existingFriend);
        continue;
      }

      const existingAddon = addonAcc.get(loraKey) || {
        loraName: canonicalFilename,
        displayName,
        category,
        count: 0,
        modelStrengthSum: 0,
        clipStrengthSum: 0,
        ratingSum: 0,
        ratedCount: 0,
        favoriteCount: 0,
        isInstalled,
        isDownloadedPendingImport,
      };
      existingAddon.count += 1;
      existingAddon.modelStrengthSum += Number(imgLora.modelStrength ?? 1.0);
      existingAddon.clipStrengthSum += Number(imgLora.clipStrength ?? 1.0);
      existingAddon.favoriteCount += favInc;
      if (hasRating) {
        existingAddon.ratingSum += ratingVal;
        existingAddon.ratedCount += 1;
      }
      addonAcc.set(loraKey, existingAddon);
    }
  }

  const baseModels: FavoriteBaseModelItem[] = Array.from(baseModelAcc.entries())
    .map(([key, item]) => {
      const matchedModel = modelByKey.get(key);
      const isInstalled = matchedModel
        ? Boolean(matchedModel.isInstalled)
        : allModels.length === 0 || (Boolean(defaultCkptKey) && key === defaultCkptKey);
      return {
        key,
        name: matchedModel?.filename || item.name,
        count: item.count,
        sharePercent: totalImages > 0 ? Math.round((item.count / totalImages) * 100) : 0,
        avgRating: item.ratedCount > 0 ? Math.round((item.ratingSum / item.ratedCount) * 10) / 10 : 0,
        favoriteCount: item.favoriteCount,
        isInstalled,
        isDownloadedPendingImport: Boolean(matchedModel?.isDownloadedPendingImport),
      };
    })
    .sort((a, b) => compareBySortMode(a, b, a.name, b.name, sortMode));

  const addonLoras: FavoriteAddonLoraItem[] = Array.from(addonAcc.entries())
    .map(([key, item]) => ({
      key,
      loraName: item.loraName,
      displayName: item.displayName,
      category: item.category,
      count: item.count,
      avgModelStrength: Math.round((item.modelStrengthSum / item.count) * 100) / 100,
      avgClipStrength: Math.round((item.clipStrengthSum / item.count) * 100) / 100,
      avgRating: item.ratedCount > 0 ? Math.round((item.ratingSum / item.ratedCount) * 10) / 10 : 0,
      favoriteCount: item.favoriteCount,
      isInstalled: item.isInstalled,
      isDownloadedPendingImport: item.isDownloadedPendingImport,
    }))
    .sort((a, b) => compareBySortMode(a, b, a.displayName, b.displayName, sortMode));

  const friends: CharacterFriendItem[] = Array.from(friendAcc.entries())
    .map(([key, item]) => ({
      key,
      characterId: item.characterId,
      characterName: item.characterName,
      portraitThumbnailUrl: item.portraitThumbnailUrl,
      portraitCrop: item.portraitCrop,
      loraName: item.loraName,
      loraDisplayName: item.loraDisplayName,
      count: item.count,
      avgModelStrength: Math.round((item.modelStrengthSum / item.count) * 100) / 100,
      avgClipStrength: Math.round((item.clipStrengthSum / item.count) * 100) / 100,
      avgRating: item.ratedCount > 0 ? Math.round((item.ratingSum / item.ratedCount) * 10) / 10 : 0,
      favoriteCount: item.favoriteCount,
      isInstalled: item.isInstalled,
      isDownloadedPendingImport: item.isDownloadedPendingImport,
    }))
    .sort((a, b) => compareBySortMode(a, b, a.characterName, b.characterName, sortMode));

  return { baseModels, addonLoras, friends };
}
