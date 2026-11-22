import { db } from '../db.ts';
import type {
  LibraryUsageStatsResponse,
  LoraCategory,
  LoraCategorySummary,
  UsageRankGroup,
  UsageRankItem,
} from '../../shared/types.ts';
import {
  computeSublinearPopularityWeight,
  normalizeBaseModelGroup,
} from './randomRollService.ts';

interface RawRankRow {
  id: number;
  name: string;
  subtitle: string | null;
  usageCount: number;
  favoriteCount: number;
  rollEligible: boolean;
  excludedReasons: string[];
  category?: LoraCategory;
  baseModel?: string | null;
  baseGroup?: string | null;
  portraitImageId?: number | null;
}

const LORA_CATEGORY_META: Array<{ category: LoraCategory; label: string }> = [
  { category: 'style', label: 'Style' },
  { category: 'clothing', label: 'Clothing' },
  { category: 'concept', label: 'Concept' },
  { category: 'pose', label: 'Pose' },
  { category: 'object', label: 'Object' },
  { category: 'other', label: 'Other' },
  { category: 'character', label: 'Character' },
  { category: 'unclassified', label: 'Unclassified' },
];

const VALID_LORA_CATEGORIES = new Set<LoraCategory>(
  LORA_CATEGORY_META.map((entry) => entry.category)
);

function normalizeLoraCategory(raw: string | null | undefined): LoraCategory {
  const normalized = (raw || '').trim().toLowerCase() as LoraCategory;
  return VALID_LORA_CATEGORIES.has(normalized) ? normalized : 'unclassified';
}

/**
 * Assigns usageRank, rollRank, rollScore, and baseline rollOddsPercent
 * for a group of items. Eligible items receive baseline odds proportional to
 * computeSublinearPopularityWeight; excluded items receive 0% odds.
 */
function buildUsageRankGroup(rawRows: RawRankRow[]): UsageRankGroup {
  const rawScores = new Map<number, number>();
  let totalEligibleScore = 0;

  for (const row of rawRows) {
    const score = computeSublinearPopularityWeight(row.usageCount, row.favoriteCount, false);
    rawScores.set(row.id, score);
    if (row.rollEligible) {
      totalEligibleScore += score;
    }
  }

  const items: UsageRankItem[] = rawRows.map((row) => {
    const rawScore = rawScores.get(row.id) ?? 1;
    const rollOddsPercent =
      row.rollEligible && totalEligibleScore > 0
        ? Number(((rawScore / totalEligibleScore) * 100).toFixed(1))
        : 0;

    return {
      id: row.id,
      name: row.name,
      subtitle: row.subtitle,
      usageCount: row.usageCount,
      favoriteCount: row.favoriteCount,
      rollScore: Number(rawScore.toFixed(2)),
      rollOddsPercent,
      usageRank: 0,
      rollRank: 0,
      rollEligible: row.rollEligible,
      excludedReasons: row.excludedReasons,
      category: row.category,
      baseModel: row.baseModel ?? null,
      baseGroup: row.baseGroup ?? null,
      portraitImageId: row.portraitImageId ?? null,
    };
  });

  // Compute usageRank (strictly by confirmed non-rejected usage, then favorites, then name)
  const byUsage = [...items].sort((a, b) => {
    if (b.usageCount !== a.usageCount) return b.usageCount - a.usageCount;
    if (b.favoriteCount !== a.favoriteCount) return b.favoriteCount - a.favoriteCount;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });
  byUsage.forEach((item, index) => {
    item.usageRank = index + 1;
  });

  // Compute rollRank (roll-eligible items ranked first by un-cooled roll score)
  const byRoll = [...items].sort((a, b) => {
    if (a.rollEligible !== b.rollEligible) return a.rollEligible ? -1 : 1;
    const scoreA = rawScores.get(a.id) ?? 0;
    const scoreB = rawScores.get(b.id) ?? 0;
    if (Math.abs(scoreB - scoreA) > 1e-9) return scoreB - scoreA;
    if (b.usageCount !== a.usageCount) return b.usageCount - a.usageCount;
    if (b.favoriteCount !== a.favoriteCount) return b.favoriteCount - a.favoriteCount;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });
  byRoll.forEach((item, index) => {
    item.rollRank = index + 1;
  });

  const eligibleCount = items.filter((i) => i.rollEligible).length;
  const totalUses = items.reduce((sum, i) => sum + i.usageCount, 0);
  const totalFavorites = items.reduce((sum, i) => sum + i.favoriteCount, 0);

  return {
    totalCount: items.length,
    eligibleCount,
    totalUses,
    totalFavorites,
    topByUsage: byUsage[0] ?? null,
    topByRollScore: byRoll[0] ?? null,
    items: byUsage,
  };
}

function queryCharacterUsageRows(): RawRankRow[] {
  // Rejection filter stays inside COUNT(DISTINCT CASE ...) so characters whose images
  // were all rejected still appear in totals with 0 uses instead of being dropped.
  const rows = db
    .prepare(
      `SELECT
         c.id,
         c.name,
         c.portrait_image_id,
         COUNT(DISTINCT CASE
           WHEN i.id IS NOT NULL AND COALESCE(r.is_rejected, 0) = 0
           THEN ic.image_content_hash
         END) AS usage_count,
         COUNT(DISTINCT CASE
           WHEN i.id IS NOT NULL AND COALESCE(r.is_rejected, 0) = 0 AND COALESCE(r.is_favorite, 0) = 1
           THEN ic.image_content_hash
         END) AS fav_count,
         EXISTS (
           SELECT 1
           FROM character_loras cl
           JOIN models m ON m.id = cl.model_id OR LOWER(m.filename) = LOWER(cl.lora_name)
           WHERE cl.character_id = c.id
             AND COALESCE(m.is_installed, 0) = 1
         ) AS has_installed_lora
       FROM characters c
       LEFT JOIN image_characters ic ON ic.character_id = c.id AND ic.status = 'confirmed'
       LEFT JOIN images i ON i.content_hash = ic.image_content_hash
         AND i.is_missing = 0
         AND COALESCE(i.is_uploaded_reference, 0) = 0
       LEFT JOIN ratings r ON r.content_hash = i.content_hash
       GROUP BY c.id`
    )
    .all() as Array<{
    id: number;
    name: string;
    portrait_image_id: number | null;
    usage_count: number;
    fav_count: number;
    has_installed_lora: number;
  }>;

  return rows.map((row) => {
    const hasLora = Boolean(row.has_installed_lora);
    return {
      id: row.id,
      name: row.name,
      subtitle: null,
      usageCount: Number(row.usage_count || 0),
      favoriteCount: Number(row.fav_count || 0),
      rollEligible: hasLora,
      excludedReasons: hasLora ? [] : ['No installed LoRA'],
      portraitImageId: row.portrait_image_id ?? null,
    };
  });
}

function queryBaseModelUsageRows(): RawRankRow[] {
  const rows = db
    .prepare(
      `SELECT
         m.id,
         m.name,
         m.nickname,
         m.filename,
         m.base_model,
         COALESCE(m.is_hidden, 0) AS is_hidden,
         COALESCE(m.mention_enabled, 0) AS mention_enabled,
         TRIM(COALESCE(m.llm_description, '')) AS llm_description,
         COUNT(DISTINCT CASE
           WHEN i.id IS NOT NULL AND COALESCE(r.is_rejected, 0) = 0
           THEN i.id
         END) AS usage_count,
         COUNT(DISTINCT CASE
           WHEN i.id IS NOT NULL AND COALESCE(r.is_rejected, 0) = 0 AND COALESCE(r.is_favorite, 0) = 1
           THEN i.id
         END) AS fav_count
       FROM models m
       LEFT JOIN image_metadata im ON LOWER(im.checkpoint_name) = LOWER(m.filename)
       LEFT JOIN images i ON i.id = im.image_id
         AND i.is_missing = 0
         AND COALESCE(i.is_uploaded_reference, 0) = 0
       LEFT JOIN ratings r ON r.content_hash = i.content_hash
       WHERE m.model_type IN ('checkpoint', 'diffusion')
         AND COALESCE(m.is_installed, 0) = 1
       GROUP BY m.id`
    )
    .all() as Array<{
    id: number;
    name: string;
    nickname: string | null;
    filename: string;
    base_model: string | null;
    is_hidden: number;
    mention_enabled: number;
    llm_description: string;
    usage_count: number;
    fav_count: number;
  }>;

  return rows.map((row) => {
    const excludedReasons: string[] = [];
    if (row.is_hidden) excludedReasons.push('Hidden');
    if (!row.mention_enabled) excludedReasons.push('Mention off');
    if (!row.llm_description) excludedReasons.push('No description');

    const displayName = (row.nickname || '').trim() || row.name || row.filename;
    const baseGroup = normalizeBaseModelGroup(row.base_model) || null;

    return {
      id: row.id,
      name: displayName,
      subtitle: row.filename !== displayName ? row.filename : null,
      usageCount: Number(row.usage_count || 0),
      favoriteCount: Number(row.fav_count || 0),
      rollEligible: excludedReasons.length === 0,
      excludedReasons,
      baseModel: row.base_model,
      baseGroup,
    };
  });
}

function queryLoraUsageRows(): RawRankRow[] {
  const rows = db
    .prepare(
      `SELECT
         m.id,
         m.name,
         m.nickname,
         m.filename,
         m.lora_category,
         m.base_model,
         COALESCE(m.is_hidden, 0) AS is_hidden,
         COALESCE(m.mention_enabled, 0) AS mention_enabled,
         EXISTS (
           SELECT 1
           FROM character_loras cl
           WHERE cl.model_id = m.id OR LOWER(cl.lora_name) = LOWER(m.filename)
         ) AS is_linked_to_character,
         COUNT(DISTINCT CASE
           WHEN i.id IS NOT NULL AND COALESCE(r.is_rejected, 0) = 0
           THEN i.id
         END) AS usage_count,
         COUNT(DISTINCT CASE
           WHEN i.id IS NOT NULL AND COALESCE(r.is_rejected, 0) = 0 AND COALESCE(r.is_favorite, 0) = 1
           THEN i.id
         END) AS fav_count
       FROM models m
       LEFT JOIN image_loras il ON LOWER(il.lora_name) = LOWER(m.filename)
       LEFT JOIN images i ON i.id = il.image_id
         AND i.is_missing = 0
         AND COALESCE(i.is_uploaded_reference, 0) = 0
       LEFT JOIN ratings r ON r.content_hash = i.content_hash
       WHERE m.model_type = 'lora'
         AND COALESCE(m.is_installed, 0) = 1
       GROUP BY m.id`
    )
    .all() as Array<{
    id: number;
    name: string;
    nickname: string | null;
    filename: string;
    lora_category: string | null;
    base_model: string | null;
    is_hidden: number;
    mention_enabled: number;
    is_linked_to_character: number;
    usage_count: number;
    fav_count: number;
  }>;

  return rows.map((row) => {
    const category = normalizeLoraCategory(row.lora_category);
    const excludedReasons: string[] = [];
    if (category === 'character' || row.is_linked_to_character) {
      excludedReasons.push('Character LoRA (via character)');
    }
    if (row.is_hidden) excludedReasons.push('Hidden');
    if (!row.mention_enabled) excludedReasons.push('Mention off');

    const displayName = (row.nickname || '').trim() || row.name || row.filename;
    const baseGroup = normalizeBaseModelGroup(row.base_model) || null;

    return {
      id: row.id,
      name: displayName,
      subtitle: row.filename !== displayName ? row.filename : null,
      usageCount: Number(row.usage_count || 0),
      favoriteCount: Number(row.fav_count || 0),
      rollEligible: excludedReasons.length === 0,
      excludedReasons,
      category,
      baseModel: row.base_model,
      baseGroup,
    };
  });
}

function buildLoraCategorySummaries(loras: UsageRankItem[]): LoraCategorySummary[] {
  return LORA_CATEGORY_META.map(({ category, label }) => {
    const inCategory = loras.filter((item) => item.category === category);
    const byUsage = [...inCategory].sort((a, b) => a.usageRank - b.usageRank);
    const byRoll = [...inCategory].sort((a, b) => a.rollRank - b.rollRank);

    return {
      category,
      label,
      totalCount: inCategory.length,
      eligibleCount: inCategory.filter((i) => i.rollEligible).length,
      totalUses: inCategory.reduce((sum, i) => sum + i.usageCount, 0),
      topByUsage: byUsage[0] ?? null,
      topByRollScore: byRoll[0] ?? null,
    };
  });
}

/**
 * Computes library usage totals, rankings, roll scores, and Random Roll eligibility
 * across all characters, installed base models, and installed LoRAs by type.
 */
export function getLibraryUsageStats(): LibraryUsageStatsResponse {
  const characters = buildUsageRankGroup(queryCharacterUsageRows());
  const baseModels = buildUsageRankGroup(queryBaseModelUsageRows());
  const loras = buildUsageRankGroup(queryLoraUsageRows());
  const loraByCategory = buildLoraCategorySummaries(loras.items);

  return {
    characters,
    baseModels,
    loras,
    loraByCategory,
    generatedAt: new Date().toISOString(),
  };
}
