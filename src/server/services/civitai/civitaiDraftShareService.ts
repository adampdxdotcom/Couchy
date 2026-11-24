import { db } from '../../db.ts';
import { appConfig } from '../../config.ts';
import { resolveImageDiskPath } from '../scannerService.ts';
import { probeCivitaiWebDomain } from './civitaiHttpAndParse.ts';
import { mapDraftRowToRecord } from './civitaiActivitySyncService.ts';
import { evaluateCivitaiShareEligibility } from './civitaiShareEligibility.ts';
import { CIVITAI_MAX_POST_IMAGES } from './civitaiShareStackEligibility.ts';
import { prepareCivitaiImagePayload } from './civitaiImagePayload.ts';
import {
  CivitaiMcpClient,
  CivitaiPayloadTooLargeError,
  type CivitaiMcpClientDeps,
} from './civitaiMcpClient.ts';
import type {
  CivitaiDomain,
  CivitaiDraftRecord,
  CivitaiModelVersionCandidate,
  CivitaiShareDraftRequest,
  CivitaiShareDraftResponse,
  CivitaiShareStackItem,
  CivitaiShareUploadMode,
} from '../../../shared/apiTypes.ts';

export class CivitaiShareValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CivitaiShareValidationError';
  }
}

async function resolveDraftDomain(params: {
  explicitDomain?: CivitaiDomain;
  recommendedDomain: CivitaiDomain;
  candidateModelVersions: CivitaiModelVersionCandidate[];
  modelVersionId: number | null;
  skipNetworkProbe: boolean;
}): Promise<CivitaiDomain> {
  let resolvedDomain: CivitaiDomain =
    params.explicitDomain === 'civitai.red' || params.explicitDomain === 'civitai.com'
      ? params.explicitDomain
      : params.recommendedDomain;

  if (!params.explicitDomain && resolvedDomain === 'civitai.com' && !params.skipNetworkProbe) {
    const candidatesToProbe = params.modelVersionId
      ? params.candidateModelVersions.filter((c) => c.modelVersionId === params.modelVersionId)
      : params.candidateModelVersions;
    for (const cand of candidatesToProbe) {
      if (cand.domain === 'civitai.red') {
        return 'civitai.red';
      }
      if (cand.civitaiId) {
        const probed = await probeCivitaiWebDomain(cand.civitaiId, 'civitai.com');
        if (probed === 'civitai.red') {
          return 'civitai.red';
        }
      }
    }
  }
  return resolvedDomain;
}

function normalizeTagList(rawTags?: string[]): string[] {
  if (!Array.isArray(rawTags)) return [];
  const seen = new Set<string>();
  const clean: string[] = [];
  for (const raw of rawTags) {
    const trimmed = String(raw).trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      clean.push(trimmed);
    }
  }
  return clean;
}

function resolveSelectedStackItems(
  eligibleItems: CivitaiShareStackItem[],
  requestedIds?: number[]
): CivitaiShareStackItem[] {
  if (!Array.isArray(requestedIds)) {
    return eligibleItems;
  }

  const eligibleIdSet = new Set(eligibleItems.map((i) => i.imageId));
  const wantedIds = new Set<number>();
  for (const rawId of requestedIds) {
    const id = Number(rawId);
    if (!Number.isInteger(id) || id <= 0) continue;
    if (!eligibleIdSet.has(id)) {
      throw new CivitaiShareValidationError(
        `Stack image #${id} is not eligible to share on Civitai.`
      );
    }
    wantedIds.add(id);
  }

  // Always preserve Poster-first, step-order sequence from server eligibility
  const selected = eligibleItems.filter((item) => wantedIds.has(item.imageId));
  if (selected.length === 0) {
    throw new CivitaiShareValidationError('Select at least 1 eligible stack image to upload.');
  }
  if (selected.length > CIVITAI_MAX_POST_IMAGES) {
    throw new CivitaiShareValidationError(
      `Civitai posts allow up to ${CIVITAI_MAX_POST_IMAGES} images (${selected.length} selected).`
    );
  }
  return selected;
}

/**
 * Validates server-side eligibility, prepares per-image bytes (`original_png` or `jpeg_exif`),
 * creates a private single- or multi-image draft (`publish: false`) on Civitai via MCP, and logs SQLite rows.
 */
export async function shareImageAsCivitaiDraft(
  imageId: number,
  request: CivitaiShareDraftRequest = {},
  deps?: CivitaiMcpClientDeps
): Promise<CivitaiShareDraftResponse> {
  const shareScope: 'single' | 'stack' = request.shareScope === 'stack' ? 'stack' : 'single';
  const eligibility = await evaluateCivitaiShareEligibility(imageId);

  if (shareScope === 'stack') {
    return shareStackAsCivitaiDraft(eligibility, request, deps);
  }

  if (!eligibility.eligible) {
    throw new CivitaiShareValidationError(
      eligibility.reasons[0] || 'This image is not eligible to share on Civitai.'
    );
  }

  const imageRow = db
    .prepare(
      `SELECT id, content_hash, relative_path, width, height
       FROM images WHERE id = ?`
    )
    .get(imageId) as { id: number; content_hash: string; relative_path: string; width: number | null; height: number | null } | undefined;

  if (!imageRow) {
    throw new CivitaiShareValidationError('Image not found.');
  }

  const diskPath = resolveImageDiskPath(imageRow);
  const uploadMode: CivitaiShareUploadMode =
    request.uploadMode === 'jpeg_exif' ? 'jpeg_exif' : 'original_png';

  const prepared = await prepareCivitaiImagePayload(
    imageId,
    diskPath,
    Number(imageRow.width || eligibility.width || 0),
    Number(imageRow.height || eligibility.height || 0),
    uploadMode
  );

  const client = new CivitaiMcpClient(appConfig.civitaiApiKey, deps);
  await client.initialize();
  await client.verifyAccountReady();

  const uploaded = await client.uploadImage({
    base64Data: prepared.base64Data,
    contentType: prepared.contentType,
  });

  const cleanTags = Array.isArray(request.tags)
    ? normalizeTagList(request.tags)
    : eligibility.prefilledTags;

  const modelVersionId =
    request.modelVersionId === null
      ? null
      : request.modelVersionId !== undefined && Number(request.modelVersionId) > 0
      ? Number(request.modelVersionId)
      : eligibility.recommendedModelVersionId;

  const resolvedDomain = await resolveDraftDomain({
    explicitDomain: request.targetDomain,
    recommendedDomain: eligibility.recommendedDomain,
    candidateModelVersions: eligibility.candidateModelVersions,
    modelVersionId,
    skipNetworkProbe: Boolean(deps?.fetchFn),
  });

  const title = (request.title ?? eligibility.prefilledTitle).trim();
  const detail = (request.detail ?? eligibility.prefilledDescription).trim();

  const created = await client.createDraftPost({
    title,
    detail,
    tags: cleanTags,
    modelVersionId,
    images: [
      {
        uuid: uploaded.uuid,
        width: uploaded.width || prepared.width || 1024,
        height: uploaded.height || prepared.height || 1024,
      },
    ],
  });

  // Link directly to /posts/:id/edit so Civitai opens the Draft Editor (mature rating & Publish controls)
  const draftUrl = `https://${resolvedDomain}/posts/${created.postId}/edit`;
  const insertInfo = db
    .prepare(
      `INSERT INTO image_civitai_drafts
        (image_id, image_content_hash, civitai_post_id, draft_url, title, upload_mode, model_version_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      imageId,
      imageRow.content_hash,
      created.postId,
      draftUrl,
      title,
      uploadMode,
      modelVersionId
    );

  const row = db
    .prepare('SELECT * FROM image_civitai_drafts WHERE id = ?')
    .get(Number(insertInfo.lastInsertRowid)) as any;

  const draft: CivitaiDraftRecord = mapDraftRowToRecord(row);

  return {
    ok: true,
    shareScope: 'single',
    postId: created.postId,
    domain: resolvedDomain,
    draftUrl,
    uploadMode,
    uploadedCount: 1,
    jpegFallbackCount: uploadMode === 'jpeg_exif' ? 1 : 0,
    processingImageIds: created.processingImageIds,
    draft,
  };
}

async function shareStackAsCivitaiDraft(
  eligibility: Awaited<ReturnType<typeof evaluateCivitaiShareEligibility>>,
  request: CivitaiShareDraftRequest,
  deps?: CivitaiMcpClientDeps
): Promise<CivitaiShareDraftResponse> {
  const stack = eligibility.stack;
  if (!stack) {
    throw new CivitaiShareValidationError('This image does not belong to a multi-image stack.');
  }
  if (!stack.eligible) {
    throw new CivitaiShareValidationError(
      stack.disabledReason || 'This stack is not eligible to share on Civitai.'
    );
  }

  const selectedItems = resolveSelectedStackItems(stack.eligibleItems, request.selectedImageIds);
  const representative =
    selectedItems.find((item) => item.isPoster) ||
    [...selectedItems].sort((a, b) => b.stepOrder - a.stepOrder)[0];

  const mergedTags = normalizeTagList(selectedItems.flatMap((i) => i.tags));
  const cleanTags = Array.isArray(request.tags) ? normalizeTagList(request.tags) : mergedTags;

  const selectedCandidates: CivitaiModelVersionCandidate[] = [];
  const seenCandidateIds = new Set<number>();
  const orderedForCandidates = [
    representative,
    ...selectedItems.filter((i) => i.imageId !== representative.imageId),
  ];
  let recommendedDomain: CivitaiDomain = 'civitai.com';
  for (const item of orderedForCandidates) {
    if (item.recommendedDomain === 'civitai.red') {
      recommendedDomain = 'civitai.red';
    }
    for (const cand of item.candidateModelVersions) {
      if (!seenCandidateIds.has(cand.modelVersionId)) {
        seenCandidateIds.add(cand.modelVersionId);
        selectedCandidates.push(cand);
      }
    }
  }

  const modelVersionId =
    request.modelVersionId === null
      ? null
      : request.modelVersionId !== undefined && Number(request.modelVersionId) > 0
      ? Number(request.modelVersionId)
      : representative.recommendedModelVersionId ?? selectedCandidates[0]?.modelVersionId ?? null;

  const resolvedDomain = await resolveDraftDomain({
    explicitDomain: request.targetDomain,
    recommendedDomain,
    candidateModelVersions: selectedCandidates,
    modelVersionId,
    skipNetworkProbe: Boolean(deps?.fetchFn),
  });

  const title = (request.title ?? representative.prefilledTitle).trim();
  const detail = (request.detail ?? representative.prefilledDescription).trim();
  const initialMode: CivitaiShareUploadMode =
    request.uploadMode === 'jpeg_exif' ? 'jpeg_exif' : 'original_png';

  const client = new CivitaiMcpClient(appConfig.civitaiApiKey, deps);
  await client.initialize();
  await client.verifyAccountReady();

  const uploadedEntries: Array<{
    imageId: number;
    contentHash: string;
    uploadMode: CivitaiShareUploadMode;
    uploaded: { uuid: string; width: number; height: number };
  }> = [];
  let jpegFallbackCount = 0;

  for (const item of selectedItems) {
    const imageRow = db
      .prepare('SELECT id, content_hash, relative_path, width, height FROM images WHERE id = ?')
      .get(item.imageId) as
      | { id: number; content_hash: string; relative_path: string; width: number | null; height: number | null }
      | undefined;

    if (!imageRow) {
      throw new CivitaiShareValidationError(`Stack image #${item.imageId} was not found.`);
    }

    const diskPath = resolveImageDiskPath(imageRow);
    const width = Number(imageRow.width || item.width || 0);
    const height = Number(imageRow.height || item.height || 0);

    let usedMode: CivitaiShareUploadMode = initialMode;
    let prepared = await prepareCivitaiImagePayload(item.imageId, diskPath, width, height, initialMode);
    let uploaded: { uuid: string; width?: number; height?: number };

    try {
      uploaded = await client.uploadImage({
        base64Data: prepared.base64Data,
        contentType: prepared.contentType,
      });
    } catch (err) {
      if (err instanceof CivitaiPayloadTooLargeError && initialMode === 'original_png') {
        // Auto-fallback to JPEG+EXIF for only this oversized step without aborting the stack
        usedMode = 'jpeg_exif';
        jpegFallbackCount += 1;
        prepared = await prepareCivitaiImagePayload(item.imageId, diskPath, width, height, 'jpeg_exif');
        uploaded = await client.uploadImage({
          base64Data: prepared.base64Data,
          contentType: prepared.contentType,
        });
      } else {
        throw err;
      }
    }

    uploadedEntries.push({
      imageId: item.imageId,
      contentHash: imageRow.content_hash,
      uploadMode: usedMode,
      uploaded: {
        uuid: uploaded.uuid,
        width: uploaded.width || prepared.width || 1024,
        height: uploaded.height || prepared.height || 1024,
      },
    });
  }

  const created = await client.createDraftPost({
    title,
    detail,
    tags: cleanTags,
    modelVersionId,
    images: uploadedEntries.map((e) => e.uploaded),
  });

  const draftUrl = `https://${resolvedDomain}/posts/${created.postId}/edit`;
  const insertStmt = db.prepare(
    `INSERT INTO image_civitai_drafts
      (image_id, image_content_hash, civitai_post_id, draft_url, title, upload_mode, model_version_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );

  let firstRowId = 0;
  const tx = db.transaction(() => {
    for (const entry of uploadedEntries) {
      const info = insertStmt.run(
        entry.imageId,
        entry.contentHash,
        created.postId,
        draftUrl,
        title,
        entry.uploadMode,
        modelVersionId
      );
      if (firstRowId === 0) {
        firstRowId = Number(info.lastInsertRowid);
      }
    }
  });
  tx();

  const row = db
    .prepare('SELECT * FROM image_civitai_drafts WHERE id = ?')
    .get(firstRowId) as any;

  const summaryMode: CivitaiShareUploadMode =
    jpegFallbackCount === uploadedEntries.length ? 'jpeg_exif' : initialMode;

  return {
    ok: true,
    shareScope: 'stack',
    postId: created.postId,
    domain: resolvedDomain,
    draftUrl,
    uploadMode: summaryMode,
    uploadedCount: uploadedEntries.length,
    jpegFallbackCount,
    processingImageIds: created.processingImageIds,
    draft: mapDraftRowToRecord(row),
  };
}
