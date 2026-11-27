import { db } from '../../db.ts';
import { parseCivitaiStatsJson } from './civitaiModelStatsHelper.ts';
import type { CivitaiEligibleCharacterCardStats } from '../../../shared/apiTypes.ts';

interface LinkedLoraStatsRow {
  characterId: number;
  modelId: number;
  civitaiId: string | null;
  isOwnUpload: number;
  charLoraCategory: string | null;
  modelLoraCategory: string | null;
  civitaiStatsJson: string | null;
}

interface CharacterDraftRow {
  characterId: number;
  draftId: number;
  civitaiPostId: number | null;
  status: string;
  reactionCount: number;
  commentCount: number;
}

/**
 * Aggregates local Civitai engagement metrics for every CivitAI-eligible character:
 * - Model downloads & thumbs-up/down from linked LoRAs (Option A scoping: prefers
 *   the user's own Civitai uploads, otherwise falls back to `character`-category LoRAs,
 *   deduplicated by `civitai_id` so multiple versions of the same model aren't double-counted).
 * - Cumulative photo reactions, comments, and post counts from `image_civitai_drafts`
 *   (deduplicated per character by `civitai_post_id`).
 */
export function readEligibleCharacterCivitaiStats(): CivitaiEligibleCharacterCardStats[] {
  const eligibleRows = db
    .prepare(
      `SELECT id
       FROM characters
       WHERE COALESCE(allow_civitai_share, 0) = 1`
    )
    .all() as Array<{ id: number }>;

  if (eligibleRows.length === 0) return [];

  const statsMap = new Map<number, CivitaiEligibleCharacterCardStats>();
  for (const row of eligibleRows) {
    statsMap.set(Number(row.id), {
      characterId: Number(row.id),
      modelDownloadCount: 0,
      modelThumbsUpCount: 0,
      modelThumbsDownCount: 0,
      photoReactionCount: 0,
      photoCommentCount: 0,
      publishedPostCount: 0,
      draftPostCount: 0,
    });
  }

  // 1. Collect linked LoRA model stats for eligible characters
  const loraRows = db
    .prepare(
      `SELECT
         c.id AS characterId,
         m.id AS modelId,
         m.civitai_id AS civitaiId,
         COALESCE(m.is_own_civitai_upload, 0) AS isOwnUpload,
         cl.lora_category AS charLoraCategory,
         m.lora_category AS modelLoraCategory,
         m.civitai_stats_json AS civitaiStatsJson
       FROM characters c
       JOIN character_loras cl ON cl.character_id = c.id
       JOIN models m ON m.id = cl.model_id OR LOWER(m.filename) = LOWER(cl.lora_name)
       WHERE COALESCE(c.allow_civitai_share, 0) = 1
         AND m.civitai_stats_json IS NOT NULL
         AND TRIM(m.civitai_stats_json) != ''`
    )
    .all() as LinkedLoraStatsRow[];

  const lorasByChar = new Map<number, LinkedLoraStatsRow[]>();
  for (const row of loraRows) {
    const charId = Number(row.characterId);
    const list = lorasByChar.get(charId);
    if (list) list.push(row);
    else lorasByChar.set(charId, [row]);
  }

  for (const [charId, rows] of lorasByChar.entries()) {
    const entry = statsMap.get(charId);
    if (!entry) continue;

    // Option A: prefer own uploaded LoRAs; otherwise fall back to character-category LoRAs
    const ownRows = rows.filter((r) => Number(r.isOwnUpload) === 1);
    const scopedRows =
      ownRows.length > 0
        ? ownRows
        : rows.filter((r) => {
            const cat = String(r.charLoraCategory || r.modelLoraCategory || '').toLowerCase();
            return cat === 'character';
          });

    // Deduplicate by civitai_id so multiple versions of one Civitai model don't double-count
    const seenModelKeys = new Set<string>();
    for (const row of scopedRows) {
      const parsed = parseCivitaiStatsJson(row.civitaiStatsJson);
      if (!parsed) continue;
      const key =
        row.civitaiId && String(row.civitaiId).trim()
          ? `civitai:${String(row.civitaiId).trim()}`
          : `model:${row.modelId}`;
      if (seenModelKeys.has(key)) continue;
      seenModelKeys.add(key);

      entry.modelDownloadCount += parsed.downloadCount;
      entry.modelThumbsUpCount += parsed.thumbsUpCount;
      entry.modelThumbsDownCount += parsed.thumbsDownCount;
    }
  }

  // 2. Collect cumulative photo reactions & comments across published Civitai posts
  const draftRows = db
    .prepare(
      `SELECT
         ic.character_id AS characterId,
         d.id AS draftId,
         d.civitai_post_id AS civitaiPostId,
         d.status AS status,
         COALESCE(d.reaction_count, 0) AS reactionCount,
         COALESCE(d.comment_count, 0) AS commentCount
       FROM characters c
       JOIN image_characters ic ON ic.character_id = c.id AND ic.status = 'confirmed'
       JOIN image_civitai_drafts d
         ON (ic.image_id IS NOT NULL AND d.image_id = ic.image_id)
         OR d.image_content_hash = ic.image_content_hash
       WHERE COALESCE(c.allow_civitai_share, 0) = 1
       ORDER BY d.id DESC`
    )
    .all() as CharacterDraftRow[];

  const seenPostsByChar = new Map<number, Set<string>>();
  for (const row of draftRows) {
    const charId = Number(row.characterId);
    const entry = statsMap.get(charId);
    if (!entry) continue;

    let seen = seenPostsByChar.get(charId);
    if (!seen) {
      seen = new Set<string>();
      seenPostsByChar.set(charId, seen);
    }

    const postKey =
      row.civitaiPostId !== null && Number.isFinite(Number(row.civitaiPostId))
        ? `post:${Number(row.civitaiPostId)}`
        : `draft:${Number(row.draftId)}`;
    if (seen.has(postKey)) continue;
    seen.add(postKey);

    if (row.status === 'published') {
      entry.publishedPostCount += 1;
      entry.photoReactionCount += Math.max(0, Number(row.reactionCount || 0));
      entry.photoCommentCount += Math.max(0, Number(row.commentCount || 0));
    } else {
      entry.draftPostCount += 1;
    }
  }

  return Array.from(statsMap.values()).sort((a, b) => {
    if (b.modelDownloadCount !== a.modelDownloadCount) {
      return b.modelDownloadCount - a.modelDownloadCount;
    }
    if (b.photoReactionCount !== a.photoReactionCount) {
      return b.photoReactionCount - a.photoReactionCount;
    }
    if (b.modelThumbsUpCount !== a.modelThumbsUpCount) {
      return b.modelThumbsUpCount - a.modelThumbsUpCount;
    }
    if (b.publishedPostCount !== a.publishedPostCount) {
      return b.publishedPostCount - a.publishedPostCount;
    }
    return a.characterId - b.characterId;
  });
}
