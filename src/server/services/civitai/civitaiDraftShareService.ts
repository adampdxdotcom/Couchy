import { db } from '../../db.ts';
import { appConfig } from '../../config.ts';
import { resolveImageDiskPath } from '../scannerService.ts';
import { evaluateCivitaiShareEligibility } from './civitaiShareEligibility.ts';
import { prepareCivitaiImagePayload } from './civitaiImagePayload.ts';
import {
  CivitaiMcpClient,
  type CivitaiMcpClientDeps,
} from './civitaiMcpClient.ts';
import type {
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

  const draftUrl = `https://civitai.com/posts/${created.postId}`;
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

  const draft: CivitaiDraftRecord = {
    id: row.id,
    civitaiPostId: row.civitai_post_id,
    draftUrl: row.draft_url,
    title: row.title,
    uploadMode: row.upload_mode === 'jpeg_exif' ? 'jpeg_exif' : 'original_png',
    modelVersionId: row.model_version_id ?? null,
    createdAt: row.created_at,
  };

  return {
    ok: true,
    postId: created.postId,
    draftUrl,
    uploadMode,
    processingImageIds: created.processingImageIds,
    draft,
  };
}
