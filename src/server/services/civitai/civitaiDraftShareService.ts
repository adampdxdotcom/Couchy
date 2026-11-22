import { db } from '../../db.ts';
import { appConfig } from '../../config.ts';
import { resolveImageDiskPath } from '../scannerService.ts';
import { probeCivitaiWebDomain } from './civitaiHttpAndParse.ts';
import { mapDraftRowToRecord } from './civitaiActivitySyncService.ts';
import { evaluateCivitaiShareEligibility } from './civitaiShareEligibility.ts';
import { prepareCivitaiImagePayload } from './civitaiImagePayload.ts';
import {
  CivitaiMcpClient,
  type CivitaiMcpClientDeps,
} from './civitaiMcpClient.ts';
import type {
  CivitaiDomain,
  CivitaiDraftRecord,
  CivitaiShareDraftRequest,
  CivitaiShareDraftResponse,
  CivitaiShareUploadMode,
} from '../../../shared/apiTypes.ts';

export class CivitaiShareValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CivitaiShareValidationError';
  }
}

/**
 * Validates server-side eligibility, prepares image bytes (`original_png` or `jpeg_exif`),
 * creates a private draft (`publish: false`) on Civitai via MCP, and logs the draft in SQLite.
 */
export async function shareImageAsCivitaiDraft(
  imageId: number,
  request: CivitaiShareDraftRequest = {},
  deps?: CivitaiMcpClientDeps
): Promise<CivitaiShareDraftResponse> {
  const eligibility = await evaluateCivitaiShareEligibility(imageId);
  if (!eligibility.eligible) {
    throw new CivitaiShareValidationError(
      eligibility.reasons[0] || 'This image is not eligible to share on Civitai.'
    );
  }

  const imageRow = db
    .prepare(
      `SELECT id, content_hash, relative_path, width, height, COALESCE(is_uploaded_reference, 0) AS is_uploaded_reference
       FROM images WHERE id = ?`
    )
    .get(imageId) as any;

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
    ? Array.from(new Set(request.tags.map((t) => String(t).trim()).filter(Boolean)))
    : eligibility.prefilledTags;

  const modelVersionId =
    request.modelVersionId === null
      ? null
      : request.modelVersionId !== undefined && Number(request.modelVersionId) > 0
      ? Number(request.modelVersionId)
      : eligibility.recommendedModelVersionId;

  // Determine civitai.red vs civitai.com from explicit override, attached models/tags, or live web probe
  let resolvedDomain: CivitaiDomain =
    request.targetDomain === 'civitai.red' || request.targetDomain === 'civitai.com'
      ? request.targetDomain
      : eligibility.recommendedDomain;

  if (!request.targetDomain && resolvedDomain === 'civitai.com' && !deps?.fetchFn) {
    const candidatesToProbe = modelVersionId
      ? eligibility.candidateModelVersions.filter((c) => c.modelVersionId === modelVersionId)
      : eligibility.candidateModelVersions;
    for (const cand of candidatesToProbe) {
      if (cand.domain === 'civitai.red') {
        resolvedDomain = 'civitai.red';
        break;
      }
      if (cand.civitaiId) {
        const probed = await probeCivitaiWebDomain(cand.civitaiId, 'civitai.com');
        if (probed === 'civitai.red') {
          resolvedDomain = 'civitai.red';
          break;
        }
      }
    }
  }

  const title = (request.title ?? eligibility.prefilledTitle).trim();
  const detail = (request.detail ?? eligibility.prefilledDescription).trim();

  const created = await client.createDraftPost({
    title,
    detail,
    tags: cleanTags,
    modelVersionId,
    image: {
      uuid: uploaded.uuid,
      width: uploaded.width || prepared.width || 1024,
      height: uploaded.height || prepared.height || 1024,
    },
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
    postId: created.postId,
    domain: resolvedDomain,
    draftUrl,
    uploadMode,
    processingImageIds: created.processingImageIds,
    draft,
  };
}
