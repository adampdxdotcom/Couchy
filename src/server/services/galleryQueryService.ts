import { db } from '../db.ts';
import { getTaggerSettings } from './visualTaggerService.ts';
import {
  collapseSeriesInGalleryPool,
  enrichSingleImageWithSeries,
} from './seriesService.ts';
import type {
  GalleryFilterState,
  ImageRecord,
  LoraExplorerItem,
  VisualTagItem,
} from '../../shared/types.ts';

/**
 * Hydrates full ImageRecord objects from database rows using batched bulk queries
 * (avoids N+1 per-image queries and avoids loading large workflow JSON blobs).
 */
export function hydrateImageRecords(rows: any[]): ImageRecord[] {
  if (rows.length === 0) return [];

  const visualTaggerEnabled = getTaggerSettings().enabled;

  // Build fast lookup for installed models by id and lowercase filename
  const modelRows = db
    .prepare('SELECT id, LOWER(filename) AS lowerFilename, lora_category, is_installed FROM models')
    .all() as {
    id: number;
    lowerFilename: string;
    lora_category: string;
    is_installed: number;
  }[];
  const modelById = new Map<number, (typeof modelRows)[0]>();
  const modelByLowerName = new Map<string, (typeof modelRows)[0]>();
  for (const m of modelRows) {
    modelById.set(m.id, m);
    modelByLowerName.set(m.lowerFilename, m);
  }

  const lorasByImageId = new Map<number, any[]>();
  const modelsByImageId = new Map<number, any[]>();
  const charsByHash = new Map<string, any[]>();
  const tagsByHash = new Map<string, any[]>();
  const visualTagsByHash = new Map<string, VisualTagItem[]>();
  const colsByHash = new Map<string, any[]>();
  const wfByImageId = new Map<
    number,
    { id: number; hasVisual: boolean; hasApi: boolean }
  >();

  if (rows.length === 1) {
    const single = rows[0];
    const rawLoras = db
      .prepare(
        `SELECT
           id, image_id AS imageId, model_id AS modelId, lora_name AS loraName,
           lora_path AS loraPath, lora_hash AS loraHash,
           model_strength AS modelStrength, clip_strength AS clipStrength,
           node_id AS nodeId, node_type AS nodeType, provenance
         FROM image_loras
         WHERE image_id = ?`
      )
      .all(single.id) as any[];
    lorasByImageId.set(
      single.id,
      rawLoras.map((l) => {
        const m =
          (l.modelId ? modelById.get(l.modelId) : undefined) ||
          modelByLowerName.get(String(l.loraName || '').toLowerCase());
        return {
          ...l,
          loraCategory: m?.lora_category || 'unclassified',
          isInstalled: Boolean(m?.is_installed),
        };
      })
    );

    modelsByImageId.set(
      single.id,
      db
        .prepare(
          `SELECT
             id, image_id AS imageId, model_id AS modelId, model_name AS modelName,
             model_type AS modelType, model_hash AS modelHash,
             node_id AS nodeId, node_type AS nodeType, provenance, status
           FROM image_models
           WHERE image_id = ?`
        )
        .all(single.id) as any[]
    );

    charsByHash.set(
      single.content_hash,
      db
        .prepare(
          `SELECT
             ic.id, ic.character_id AS characterId, c.name AS characterName,
             ic.status, ic.source, ic.confidence, ic.match_reason AS matchReason,
             ic.appearance_label AS appearanceLabel
           FROM image_characters ic
           JOIN characters c ON c.id = ic.character_id
           WHERE ic.image_content_hash = ? AND ic.status != 'rejected'
           ORDER BY CASE WHEN ic.status = 'confirmed' THEN 0 ELSE 1 END, c.name ASC`
        )
        .all(single.content_hash) as any[]
    );

    tagsByHash.set(
      single.content_hash,
      db
        .prepare(
          `SELECT t.id, t.name, t.color
           FROM image_tags it
           JOIN tags t ON t.id = it.tag_id
           WHERE it.image_content_hash = ?
           ORDER BY t.name ASC`
        )
        .all(single.content_hash) as any[]
    );

    if (visualTaggerEnabled) {
      visualTagsByHash.set(
        single.content_hash,
        db
          .prepare(
            `SELECT tag, confidence
             FROM image_visual_tags
             WHERE image_content_hash = ?
             ORDER BY confidence DESC`
          )
          .all(single.content_hash) as VisualTagItem[]
      );
    }

    colsByHash.set(
      single.content_hash,
      db
        .prepare(
          `SELECT col.id, col.name
           FROM collection_images ci
           JOIN collections col ON col.id = ci.collection_id
           WHERE ci.image_content_hash = ?
           ORDER BY col.name ASC`
        )
        .all(single.content_hash) as any[]
    );

    const wfRow = db
      .prepare(
        `SELECT
           w.id,
           (w.visual_workflow_json IS NOT NULL AND w.visual_workflow_json != '') AS hasVisual,
           (w.api_workflow_json IS NOT NULL AND w.api_workflow_json != '') AS hasApi
         FROM image_workflows iw
         JOIN workflows w ON w.id = iw.workflow_id
         WHERE iw.image_id = ?
         LIMIT 1`
      )
      .get(single.id) as any;
    if (wfRow) {
      wfByImageId.set(single.id, {
        id: wfRow.id,
        hasVisual: Boolean(wfRow.hasVisual),
        hasApi: Boolean(wfRow.hasApi),
      });
    }
  } else {
    // Bulk fetch all image_loras in one query
    const allLoras = db
      .prepare(
        `SELECT
           id, image_id AS imageId, model_id AS modelId, lora_name AS loraName,
           lora_path AS loraPath, lora_hash AS loraHash,
           model_strength AS modelStrength, clip_strength AS clipStrength,
           node_id AS nodeId, node_type AS nodeType, provenance
         FROM image_loras`
      )
      .all() as any[];
    for (const l of allLoras) {
      const m =
        (l.modelId ? modelById.get(l.modelId) : undefined) ||
        modelByLowerName.get(String(l.loraName || '').toLowerCase());
      const enriched = {
        ...l,
        loraCategory: m?.lora_category || 'unclassified',
        isInstalled: Boolean(m?.is_installed),
      };
      const arr = lorasByImageId.get(l.imageId);
      if (arr) arr.push(enriched);
      else lorasByImageId.set(l.imageId, [enriched]);
    }

    // Bulk fetch all non-rejected image_characters in one query
    const allChars = db
      .prepare(
        `SELECT
           ic.image_content_hash AS contentHash,
           ic.id, ic.character_id AS characterId, c.name AS characterName,
           ic.status, ic.source, ic.confidence, ic.match_reason AS matchReason,
           ic.appearance_label AS appearanceLabel
         FROM image_characters ic
         JOIN characters c ON c.id = ic.character_id
         WHERE ic.status != 'rejected'
         ORDER BY CASE WHEN ic.status = 'confirmed' THEN 0 ELSE 1 END, c.name ASC`
      )
      .all() as any[];
    for (const c of allChars) {
      const { contentHash, ...rest } = c;
      const arr = charsByHash.get(contentHash);
      if (arr) arr.push(rest);
      else charsByHash.set(contentHash, [rest]);
    }

    // Bulk fetch all image_tags in one query
    const allTags = db
      .prepare(
        `SELECT it.image_content_hash AS contentHash, t.id, t.name, t.color
         FROM image_tags it
         JOIN tags t ON t.id = it.tag_id
         ORDER BY t.name ASC`
      )
      .all() as any[];
    for (const t of allTags) {
      const { contentHash, ...rest } = t;
      const arr = tagsByHash.get(contentHash);
      if (arr) arr.push(rest);
      else tagsByHash.set(contentHash, [rest]);
    }

    // Bulk fetch all collection_images in one query
    const allCols = db
      .prepare(
        `SELECT ci.image_content_hash AS contentHash, col.id, col.name
         FROM collection_images ci
         JOIN collections col ON col.id = ci.collection_id
         ORDER BY col.name ASC`
      )
      .all() as any[];
    for (const col of allCols) {
      const { contentHash, ...rest } = col;
      const arr = colsByHash.get(contentHash);
      if (arr) arr.push(rest);
      else colsByHash.set(contentHash, [rest]);
    }

    // Bulk fetch workflow presence flags without reading multi-MB workflow JSON blobs
    const allWfs = db
      .prepare(
        `SELECT
           iw.image_id AS imageId,
           w.id,
           (w.visual_workflow_json IS NOT NULL AND w.visual_workflow_json != '') AS hasVisual,
           (w.api_workflow_json IS NOT NULL AND w.api_workflow_json != '') AS hasApi
         FROM image_workflows iw
         JOIN workflows w ON w.id = iw.workflow_id`
      )
      .all() as any[];
    for (const w of allWfs) {
      if (!wfByImageId.has(w.imageId)) {
        wfByImageId.set(w.imageId, {
          id: w.id,
          hasVisual: Boolean(w.hasVisual),
          hasApi: Boolean(w.hasApi),
        });
      }
    }

    if (visualTaggerEnabled) {
      const allVTags = db
        .prepare(
          `SELECT image_content_hash AS contentHash, tag, confidence
           FROM image_visual_tags
           ORDER BY confidence DESC`
        )
        .all() as { contentHash: string; tag: string; confidence: number }[];
      for (const vt of allVTags) {
        const arr = visualTagsByHash.get(vt.contentHash);
        const item = { tag: vt.tag, confidence: vt.confidence };
        if (arr) arr.push(item);
        else visualTagsByHash.set(vt.contentHash, [item]);
      }
    }
  }

  const isSingleDetail = rows.length === 1;

  return rows.map((r) => {
    const loras = lorasByImageId.get(r.id) || [];
    const models = modelsByImageId.get(r.id) || [];
    const characters = charsByHash.get(r.content_hash) || [];
    const tags = tagsByHash.get(r.content_hash) || [];
    const visualTags = visualTagsByHash.get(r.content_hash) || [];
    const collections = colsByHash.get(r.content_hash) || [];
    const wf = wfByImageId.get(r.id);

    let missingFields: string[] = [];
    let provenance: Record<string, any> = {};
    if (isSingleDetail) {
      try {
        missingFields = r.missing_fields_json ? JSON.parse(r.missing_fields_json) : [];
      } catch {
        missingFields = [];
      }
      try {
        provenance = r.provenance_json ? JSON.parse(r.provenance_json) : {};
      } catch {
        provenance = {};
      }
    }

    const hashParam = r.content_hash ? `?h=${String(r.content_hash).slice(0, 12)}` : '';

    return {
      id: r.id,
      contentHash: r.content_hash,
      relativePath: r.relative_path,
      filename: r.filename,
      fileSize: r.file_size,
      width: r.width,
      height: r.height,
      format: r.format,
      createdAt: r.created_at,
      fileMtime: r.file_mtime,
      isMissing: Boolean(r.is_missing),
      thumbnailUrl: `/api/images/${r.id}/thumbnail${hashParam}`,
      originalUrl: `/api/images/${r.id}/file`,
      dependencyStatus: r.dependency_status,
      rating: Number(r.rating || 0),
      isFavorite: Boolean(r.is_favorite),
      isRejected: Boolean(r.is_rejected),
      isArchived: Boolean(r.is_archived),
      notes: r.notes || '',
      favoritedAt: r.favorited_at || null,
      positivePrompt: r.positive_prompt ?? null,
      negativePrompt: r.negative_prompt ?? null,
      seed: r.seed ?? null,
      steps: r.steps ?? null,
      cfg: r.cfg ?? null,
      sampler: r.sampler ?? null,
      scheduler: r.scheduler ?? null,
      denoise: r.denoise ?? null,
      batchSize: r.batch_size ?? null,
      batchIndex: r.batch_index ?? null,
      generationDate: r.generation_date ?? null,
      checkpointName: r.checkpoint_name ?? null,
      checkpointHash: r.checkpoint_hash ?? null,
      vaeName: r.vae_name ?? null,
      missingFields,
      provenance,
      hasVisualWorkflow: Boolean(wf?.hasVisual),
      hasApiWorkflow: Boolean(wf?.hasApi),
      workflowId: wf?.id ?? null,
      loras,
      models,
      characters,
      tags,
      visualTags,
      collections,
    };
  }).map((img) => (isSingleDetail ? enrichSingleImageWithSeries(img) : img));
}

/**
 * Evaluates a boolean search expression (supporting AND, OR, NOT, field:value, rating>=N, etc.)
 * against an hydrated ImageRecord.
 */
function matchesBooleanQuery(img: ImageRecord, rawQuery: string): boolean {
  const q = rawQuery.trim();
  if (!q) return true;

  // Support OR groups at top level
  if (/\s+OR\s+/i.test(q)) {
    const branches = q.split(/\s+OR\s+/i);
    return branches.some((b) => matchesBooleanQuery(img, b));
  }

  // Split by AND (or implicit space-separated clauses if no explicit AND)
  const clauses = /\s+AND\s+/i.test(q)
    ? q.split(/\s+AND\s+/i)
    : q.match(/(?:NOT\s+)?[a-zA-Z_]+\s*(?::|>=|<=|>|<|=)\s*"[^"]+"|(?:NOT\s+)?[a-zA-Z_]+\s*(?::|>=|<=|>|<|=)\s*\S+|"[^"]+"|\S+/g) || [q];

  for (let clause of clauses) {
    clause = clause.trim();
    if (!clause) continue;

    let negate = false;
    if (/^NOT\s+/i.test(clause)) {
      negate = true;
      clause = clause.replace(/^NOT\s+/i, '').trim();
    } else if (clause.startsWith('-')) {
      negate = true;
      clause = clause.slice(1).trim();
    }

    const matched = evaluateSinglePredicate(img, clause);
    if (negate ? matched : !matched) {
      return false;
    }
  }
  return true;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function testWordMatch(text: string, term: string): boolean {
  if (!text || !term) return false;
  try {
    const re = new RegExp(
      '(^|[\\s,;:.!?\'"()\\[\\]/_-])' + escapeRegex(term) + '(?=[\\s,;:.!?\'"()\\[\\]/_-]|$)',
      'i'
    );
    return re.test(text);
  } catch {
    return text.toLowerCase().includes(term.toLowerCase());
  }
}

function evaluateSinglePredicate(img: ImageRecord, predicate: string): boolean {
  // Numeric comparison e.g. rating >= 4, steps >= 20, cfg <= 8
  const numMatch = predicate.match(/^(rating|steps|cfg|filesize)\s*(>=|<=|>|<|=)\s*([\d.]+)$/i);
  if (numMatch) {
    const field = numMatch[1].toLowerCase();
    const op = numMatch[2];
    const target = Number(numMatch[3]);
    const actual =
      field === 'rating'
        ? img.rating
        : field === 'steps'
        ? img.steps ?? -1
        : field === 'cfg'
        ? img.cfg ?? -1
        : img.fileSize;
    if (op === '>=') return actual >= target;
    if (op === '<=') return actual <= target;
    if (op === '>') return actual > target;
    if (op === '<') return actual < target;
    return actual === target;
  }

  // Field:value predicate e.g. character:"Elena", lora:detail, checkpoint:xl, tag:portrait, visual:glasses, file:comfy
  const kvMatch = predicate.match(/^([a-zA-Z_]+)\s*[:=]\s*"?([^"]+)"?$/);
  if (kvMatch) {
    const key = kvMatch[1].toLowerCase();
    const val = kvMatch[2].toLowerCase().trim();
    if (key === 'character' || key === 'char') {
      return img.characters.some((c) => c.characterName.toLowerCase().includes(val));
    }
    if (key === 'lora') {
      return img.loras.some((l) => l.loraName.toLowerCase().includes(val));
    }
    if (key === 'checkpoint' || key === 'ckpt' || key === 'model') {
      return (img.checkpointName || '').toLowerCase().includes(val);
    }
    if (key === 'tag') {
      return (
        img.tags.some((t) => t.name.toLowerCase().includes(val)) ||
        (img.visualTags || []).some((vt) => vt.tag.toLowerCase().includes(val))
      );
    }
    if (key === 'visual' || key === 'vtag' || key === 'keyword') {
      return (img.visualTags || []).some((vt) => vt.tag.toLowerCase().includes(val));
    }
    if (key === 'collection') {
      return img.collections.some((c) => c.name.toLowerCase().includes(val));
    }
    if (key === 'hash') {
      return (
        img.contentHash.toLowerCase().includes(val) ||
        (img.checkpointHash || '').toLowerCase().includes(val) ||
        img.loras.some((l) => (l.loraHash || '').toLowerCase().includes(val))
      );
    }
    if (key === 'file' || key === 'filename') {
      return img.filename.toLowerCase().includes(val);
    }
    if (key === 'prompt' || key === 'pos') {
      return (img.positivePrompt || '').toLowerCase().includes(val);
    }
    if (key === 'negative' || key === 'neg') {
      return (img.negativePrompt || '').toLowerCase().includes(val);
    }
    if (key === 'notes' || key === 'note') {
      return img.notes.toLowerCase().includes(val);
    }
  }

  // Universal search scoped strictly to: prompts, tags, loras, characters, and visual keywords.
  // Filenames, negative prompts, hashes, and notes are excluded from universal search.
  const isQuoted = predicate.startsWith('"') && predicate.endsWith('"') && predicate.length >= 2;
  const needle = isQuoted ? predicate.slice(1, -1).trim() : predicate.trim();
  if (!needle) return true;

  if (isQuoted) {
    const lower = needle.toLowerCase();
    return (
      (img.positivePrompt || '').toLowerCase().includes(lower) ||
      img.loras.some((l) => l.loraName.toLowerCase().includes(lower)) ||
      img.characters.some((c) => c.characterName.toLowerCase().includes(lower)) ||
      img.tags.some((t) => t.name.toLowerCase().includes(lower)) ||
      (img.visualTags || []).some(
        (vt) =>
          vt.tag.toLowerCase().includes(lower) ||
          vt.tag.toLowerCase().replace(/_/g, ' ').includes(lower)
      )
    );
  }

  // Unquoted: Match whole words across positivePrompt, loras, characters, tags, and visualTags
  return (
    testWordMatch(img.positivePrompt || '', needle) ||
    img.loras.some((l) => testWordMatch(l.loraName, needle)) ||
    img.characters.some((c) => testWordMatch(c.characterName, needle)) ||
    img.tags.some((t) => testWordMatch(t.name, needle)) ||
    (img.visualTags || []).some(
      (vt) => testWordMatch(vt.tag, needle) || testWordMatch(vt.tag.replace(/_/g, ' '), needle)
    )
  );
}

/**
 * Queries and filters images according to GalleryFilterState.
 */
export function queryGalleryImages(filters: Partial<GalleryFilterState>): ImageRecord[] {
  const rows = db
    .prepare(
      `
      SELECT
        i.*,
        r.rating, r.is_favorite, r.is_rejected, r.is_archived, r.notes, r.favorited_at,
        m.positive_prompt, m.negative_prompt, m.seed, m.steps, m.cfg, m.sampler,
        m.scheduler, m.denoise, m.batch_size, m.batch_index, m.generation_date,
        m.checkpoint_name, m.checkpoint_hash, m.vae_name
      FROM images i
      LEFT JOIN ratings r ON r.content_hash = i.content_hash
      LEFT JOIN image_metadata m ON m.image_id = i.id
      WHERE i.is_missing = 0
    `
    )
    .all() as any[];

  let items = hydrateImageRecords(rows);

  // Rejected & Archived filtering
  const rejectedMode = filters.rejectedMode || 'exclude';
  if (rejectedMode === 'exclude') items = items.filter((i) => !i.isRejected);
  else if (rejectedMode === 'only') items = items.filter((i) => i.isRejected);

  const archivedMode = filters.archivedMode || 'exclude';
  if (archivedMode === 'exclude') items = items.filter((i) => !i.isArchived);
  else if (archivedMode === 'only') items = items.filter((i) => i.isArchived);

  // Collapse iteration stacks to their single representative card (poster/hearted or most recent)
  items = collapseSeriesInGalleryPool(items);

  if (filters.favoritesOnly) {
    items = items.filter((i) => i.isFavorite);
  }
  if (filters.minRating && filters.minRating > 0) {
    items = items.filter((i) => i.rating >= filters.minRating!);
  }
  if (filters.checkpoint) {
    const ck = filters.checkpoint.toLowerCase();
    items = items.filter((i) => (i.checkpointName || '').toLowerCase() === ck);
  }
  if (filters.dependencyStatus) {
    items = items.filter((i) => i.dependencyStatus === filters.dependencyStatus);
  }
  if (filters.collectionId) {
    items = items.filter((i) => i.collections.some((c) => c.id === filters.collectionId));
  }
  if (filters.tagIds && filters.tagIds.length > 0) {
    items = items.filter((i) =>
      filters.tagIds!.every((tid) => i.tags.some((t) => t.id === tid))
    );
  }
  if (filters.dateFrom) {
    items = items.filter((i) => i.fileMtime >= filters.dateFrom!);
  }
  if (filters.dateTo) {
    items = items.filter((i) => i.fileMtime.slice(0, 10) <= filters.dateTo!);
  }

  // Multi-LoRA filtering (ANY vs ALL + strength range)
  if (filters.loras && filters.loras.length > 0) {
    const selectedLoras = filters.loras.map((l) => l.toLowerCase());
    const mode = filters.loraMatchMode || 'ALL';
    items = items.filter((img) => {
      const checkLora = (targetLora: string) =>
        img.loras.some((il) => {
          const nameMatches = il.loraName.toLowerCase() === targetLora;
          if (!nameMatches) return false;
          if (filters.minLoraStrength !== null && filters.minLoraStrength !== undefined) {
            if (il.modelStrength < filters.minLoraStrength) return false;
          }
          if (filters.maxLoraStrength !== null && filters.maxLoraStrength !== undefined) {
            if (il.modelStrength > filters.maxLoraStrength) return false;
          }
          return true;
        });

      return mode === 'ALL'
        ? selectedLoras.every(checkLora)
        : selectedLoras.some(checkLora);
    });
  }

  // Multi-Character filtering (ANY vs ALL)
  if (filters.characterIds && filters.characterIds.length > 0) {
    const mode = filters.characterMatchMode || 'ALL';
    const includeSuggested = Boolean(filters.includeSuggestedCharacters);
    items = items.filter((img) => {
      const validCharIds = new Set(
        img.characters
          .filter((c) => c.status === 'confirmed' || (includeSuggested && c.status === 'suggested'))
          .map((c) => c.characterId)
      );
      return mode === 'ALL'
        ? filters.characterIds!.every((cid) => validCharIds.has(cid))
        : filters.characterIds!.some((cid) => validCharIds.has(cid));
    });
  }

  // Boolean / Universal Search Query
  if (filters.query && filters.query.trim()) {
    items = items.filter((img) => matchesBooleanQuery(img, filters.query!));
  }

  // Sorting (all 9 required sort modes)
  const sortBy = filters.sortBy || 'newest';
  items.sort((a, b) => {
    switch (sortBy) {
      case 'oldest':
        return a.fileMtime.localeCompare(b.fileMtime);
      case 'rating_desc':
        return b.rating - a.rating || b.fileMtime.localeCompare(a.fileMtime);
      case 'rating_asc':
        return a.rating - b.rating || b.fileMtime.localeCompare(a.fileMtime);
      case 'filename':
        return a.filename.localeCompare(b.filename);
      case 'filesize':
        return b.fileSize - a.fileSize;
      case 'checkpoint':
        return (a.checkpointName || 'zzz').localeCompare(b.checkpointName || 'zzz');
      case 'most_used_lora':
        return b.loras.length - a.loras.length || b.fileMtime.localeCompare(a.fileMtime);
      case 'recently_favorited':
        return (b.favoritedAt || '').localeCompare(a.favoritedAt || '');
      case 'newest':
      default:
        return b.fileMtime.localeCompare(a.fileMtime);
    }
  });

  return items;
}

/**
 * Aggregates LoRA Explorer records combining installed models and extracted image_loras.
 */
export function listLoraExplorerItems(): LoraExplorerItem[] {
  const rows = db
    .prepare(
      `
      SELECT
        COALESCE(m.filename, il.lora_name) AS filename,
        COALESCE(m.name, REPLACE(il.lora_name, '.safetensors', '')) AS name,
        m.id AS modelId,
        m.file_path AS filePath,
        m.file_size AS fileSize,
        m.sha256_hash AS sha256Hash,
        m.autov2_hash AS autov2Hash,
        COALESCE(m.lora_category, 'unclassified') AS loraCategory,
        COALESCE(m.is_installed, 0) AS isInstalled,
        m.download_url AS downloadUrl,
        m.civitai_id AS civitaiId,
        m.hf_repo_id AS hfRepoId,
        m.user_notes AS userNotes,
        m.nickname AS nickname,
        COALESCE(m.mention_enabled, 0) AS mentionEnabled,
        COALESCE(m.default_model_strength, 1.0) AS defaultModelStrength,
        COALESCE(m.default_clip_strength, 1.0) AS defaultClipStrength,
        m.trigger_word AS triggerWord,
        m.llm_description AS llmDescription,
        COUNT(DISTINCT il.image_id) AS imageCount,
        COUNT(DISTINCT iw.workflow_id) AS workflowCount,
        AVG(CASE WHEN r.rating > 0 THEN r.rating ELSE NULL END) AS avgRating,
        MIN(il.model_strength) AS minModelStrength,
        MAX(il.model_strength) AS maxModelStrength,
        AVG(il.model_strength) AS avgModelStrength,
        MIN(il.clip_strength) AS minClipStrength,
        MAX(il.clip_strength) AS maxClipStrength
      FROM models m
      LEFT JOIN image_loras il ON LOWER(il.lora_name) = LOWER(m.filename)
      LEFT JOIN images i ON i.id = il.image_id AND i.is_missing = 0
      LEFT JOIN ratings r ON r.content_hash = i.content_hash
      LEFT JOIN image_workflows iw ON iw.image_id = i.id
      WHERE m.model_type = 'lora'
      GROUP BY LOWER(m.filename)
      ORDER BY imageCount DESC, m.filename COLLATE NOCASE ASC
    `
    )
    .all() as any[];

  const getChars = db.prepare(`
    SELECT c.id, c.name, cl.appearance_label AS appearanceLabel
    FROM character_loras cl
    JOIN characters c ON c.id = cl.character_id
    WHERE LOWER(cl.lora_name) = LOWER(?)
  `);

  return rows.map((r) => ({
    name: r.name,
    modelId: r.modelId ?? null,
    filename: r.filename,
    filePath: r.filePath ?? null,
    fileSize: r.fileSize ?? null,
    sha256Hash: r.sha256Hash ?? null,
    autov2Hash: r.autov2Hash ?? null,
    loraCategory: r.loraCategory || 'unclassified',
    isInstalled: Boolean(r.isInstalled),
    downloadUrl: r.downloadUrl ?? null,
    civitaiId: r.civitaiId ?? null,
    hfRepoId: r.hfRepoId ?? null,
    userNotes: r.userNotes ?? null,
    nickname: r.nickname || null,
    mentionEnabled: Boolean(r.mentionEnabled),
    defaultModelStrength: Number(r.defaultModelStrength ?? 1.0),
    defaultClipStrength: Number(r.defaultClipStrength ?? 1.0),
    triggerWord: r.triggerWord || null,
    llmDescription: r.llmDescription || null,
    imageCount: Number(r.imageCount || 0),
    workflowCount: Number(r.workflowCount || 0),
    averageRating: Number(r.avgRating ? Number(r.avgRating).toFixed(2) : 0),
    minModelStrength: r.minModelStrength !== null ? Number(Number(r.minModelStrength).toFixed(2)) : null,
    maxModelStrength: r.maxModelStrength !== null ? Number(Number(r.maxModelStrength).toFixed(2)) : null,
    avgModelStrength: r.avgModelStrength !== null ? Number(Number(r.avgModelStrength).toFixed(2)) : null,
    minClipStrength: r.minClipStrength !== null ? Number(Number(r.minClipStrength).toFixed(2)) : null,
    maxClipStrength: r.maxClipStrength !== null ? Number(Number(r.maxClipStrength).toFixed(2)) : null,
    characters: getChars.all(r.filename) as { id: number; name: string; appearanceLabel: string }[],
  }));
}
