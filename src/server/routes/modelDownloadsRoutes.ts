import { Router } from 'express';
import path from 'path';
import { db } from '../db.ts';
import { parsePreviewImagesJson } from '../services/civitaiMetadataService.ts';
import {
  searchCivitaiModels,
  searchHuggingFaceModels,
  smartSearchModels,
  startConfirmedModelDownload,
} from '../services/modelManagerService.ts';
import {
  listHuggingFaceRepoFiles,
  resolveDirectModelUrl,
} from '../services/modelDownloadResolverService.ts';
import {
  cancelScheduledDownload,
  rescheduleFailedDownload,
  runScheduledDownloadNow,
} from '../services/downloadSchedulerService.ts';
import { VALID_LORA_CATEGORIES } from '../../shared/pillSettings.ts';
import type { LoraCategory } from '../../shared/types.ts';

export const modelDownloadsRouter = Router();

/**
 * GET /api/models/search
 * Unified smart search across Civitai, Hugging Face Hub, hashes, owner/repo IDs, and direct URLs.
 */
modelDownloadsRouter.get('/models/search', async (req, res) => {
  try {
    const q = String(req.query.q || '');
    const type = String(req.query.type || '');
    const items = await smartSearchModels(q, type);
    res.json({ items });
  } catch (err: any) {
    res.status(502).json({ error: err?.message || 'Model search failed' });
  }
});

/**
 * GET /api/models/search/civitai
 */
modelDownloadsRouter.get('/models/search/civitai', async (req, res) => {
  try {
    const q = String(req.query.q || '');
    const type = String(req.query.type || '');
    const items = await searchCivitaiModels(q, type);
    res.json({ items });
  } catch (err: any) {
    res.status(502).json({ error: err?.message || 'Civitai search failed' });
  }
});

/**
 * GET /api/models/search/huggingface
 */
modelDownloadsRouter.get('/models/search/huggingface', async (req, res) => {
  try {
    const q = String(req.query.q || '');
    const items = await searchHuggingFaceModels(q);
    res.json({ items });
  } catch (err: any) {
    res.status(502).json({ error: err?.message || 'Hugging Face search failed' });
  }
});

/**
 * GET /api/models/huggingface/files
 * Lists all downloadable model weight files in a Hugging Face repository (recursive tree + LFS SHA-256).
 */
modelDownloadsRouter.get('/models/huggingface/files', async (req, res) => {
  try {
    const repo = String(req.query.repo || '').trim();
    if (!repo) {
      res.status(400).json({ error: 'repo query parameter is required' });
      return;
    }
    const data = await listHuggingFaceRepoFiles(repo);
    res.json(data);
  } catch (err: any) {
    res.status(502).json({ error: err?.message || 'Failed to list Hugging Face repository files' });
  }
});

/**
 * POST /api/models/resolve-url
 * Resolves a pasted Civitai URL, Hugging Face URL/repo, or direct weight link into a downloadable item.
 */
modelDownloadsRouter.post('/models/resolve-url', async (req, res) => {
  try {
    const url = String(req.body?.url || '').trim();
    const item = await resolveDirectModelUrl(url);
    res.json({ item });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Failed to resolve model URL' });
  }
});

/**
 * POST /api/downloads/start
 * Starts a confirmed server-side model download with SHA-256 verification.
 */
modelDownloadsRouter.post('/downloads/start', async (req, res) => {
  try {
    const {
      provider,
      modelName,
      filename,
      modelType,
      sourceUrl,
      expectedHash,
      subfolder,
      allowOverwrite,
      userConfirmed,
      hfRepoId,
      civitaiMeta,
      loraCategory,
      characterAutomation,
      scheduledFor,
    } = req.body || {};

    if (!userConfirmed) {
      res.status(400).json({
        error: 'Explicit user confirmation is required before downloading models.',
      });
      return;
    }

    const validatedCategory: LoraCategory | null =
      typeof loraCategory === 'string' && VALID_LORA_CATEGORIES.has(loraCategory as LoraCategory)
        ? (loraCategory as LoraCategory)
        : null;

    const job = await startConfirmedModelDownload({
      provider,
      modelName,
      filename,
      modelType,
      sourceUrl,
      expectedHash,
      subfolder,
      allowOverwrite: Boolean(allowOverwrite),
      hfRepoId: hfRepoId || null,
      civitaiMeta: civitaiMeta || null,
      loraCategory: validatedCategory,
      characterAutomation:
        characterAutomation && typeof characterAutomation === 'object'
          ? {
              addCharacter: Boolean(characterAutomation.addCharacter),
              generateHeadshot: Boolean(characterAutomation.generateHeadshot),
              characterName: String(characterAutomation.characterName || ''),
              triggerWord: String(characterAutomation.triggerWord || ''),
            }
          : null,
      scheduledFor: scheduledFor || null,
    });
    res.json({ job });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Failed to start download' });
  }
});

/**
 * POST /api/downloads/:id/run-now
 * Immediately triggers a pending scheduled download job.
 */
modelDownloadsRouter.post('/downloads/:id/run-now', (req, res) => {
  try {
    const jobId = Number(req.params.id);
    if (!Number.isFinite(jobId)) {
      res.status(400).json({ error: 'Invalid download job id' });
      return;
    }
    const job = runScheduledDownloadNow(jobId);
    res.json({ job });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Failed to trigger scheduled download' });
  }
});

/**
 * POST /api/downloads/:id/reschedule
 * Converts a failed Civitai Early Access job into a scheduled job using its live unlock timestamp.
 */
modelDownloadsRouter.post('/downloads/:id/reschedule', async (req, res) => {
  try {
    const jobId = Number(req.params.id);
    if (!Number.isFinite(jobId)) {
      res.status(400).json({ error: 'Invalid download job id' });
      return;
    }
    const scheduledFor = req.body?.scheduledFor ? String(req.body.scheduledFor) : null;
    const job = await rescheduleFailedDownload(jobId, scheduledFor);
    res.json({ job });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Failed to reschedule download' });
  }
});

/**
 * DELETE /api/downloads/:id
 * Cancels and removes a pending scheduled download job.
 */
modelDownloadsRouter.delete('/downloads/:id', (req, res) => {
  try {
    const jobId = Number(req.params.id);
    if (!Number.isFinite(jobId)) {
      res.status(400).json({ error: 'Invalid download job id' });
      return;
    }
    const result = cancelScheduledDownload(jobId);
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Failed to cancel scheduled download' });
  }
});

/**
 * GET /api/downloads
 * Lists recent model downloads enriched with linked model record details and first Civitai preview URL.
 */
modelDownloadsRouter.get('/downloads', (_req, res) => {
  const jobs = db.prepare('SELECT * FROM download_jobs ORDER BY id DESC LIMIT 50').all() as any[];
  const modelRows = db
    .prepare(
      `SELECT id, filename, file_path, model_type, is_installed, download_file_path, preview_images_json
       FROM models`
    )
    .all() as Array<{
    id: number;
    filename: string;
    file_path: string | null;
    model_type: string;
    is_installed: number;
    download_file_path: string | null;
    preview_images_json: string | null;
  }>;

  const byFilePath = new Map<string, (typeof modelRows)[number]>();
  const byFilename = new Map<string, (typeof modelRows)[number]>();
  for (const m of modelRows) {
    if (m.file_path) byFilePath.set(m.file_path.toLowerCase(), m);
    if (m.filename) byFilename.set(m.filename.toLowerCase(), m);
  }

  const enriched = jobs.map((job) => {
    const destPath = typeof job.destination_path === 'string' ? job.destination_path : '';
    const baseName = destPath ? path.basename(destPath).toLowerCase() : '';
    const matched =
      (destPath ? byFilePath.get(destPath.toLowerCase()) : undefined) ||
      (baseName ? byFilename.get(baseName) : undefined);

    let firstPreviewUrl: string | null = null;
    if (job.provider === 'civitai' && matched?.preview_images_json) {
      const previews = parsePreviewImagesJson(matched.preview_images_json, matched.id);
      firstPreviewUrl = previews[0]?.url || null;
    }

    let parsedPayload: Record<string, any> | null = null;
    if (job.payload_json) {
      try {
        parsedPayload = JSON.parse(job.payload_json);
      } catch {
        parsedPayload = null;
      }
    }

    // For scheduled or failed Civitai downloads not yet on disk, show staged Civitai thumbnail if stored
    if (!firstPreviewUrl && job.provider === 'civitai' && parsedPayload?.civitaiMeta?.previewImages?.[0]?.url) {
      const stagedUrl = parsedPayload.civitaiMeta.previewImages[0].url;
      if (typeof stagedUrl === 'string' && stagedUrl.trim()) {
        firstPreviewUrl = stagedUrl.trim();
      }
    }

    const canReschedule =
      job.status === 'failed' &&
      job.provider === 'civitai' &&
      /401|403|early access/i.test(String(job.error_message || ''));

    return {
      ...job,
      installed_model_id: matched?.id ?? null,
      installed_filename: matched?.filename ?? null,
      installed_model_type: matched?.model_type ?? null,
      is_installed: matched ? Boolean(matched.is_installed) : false,
      in_downloads: Boolean(matched?.download_file_path),
      first_preview_url: firstPreviewUrl,
      early_access_ends_at: parsedPayload?.earlyAccessEndsAt ?? null,
      can_reschedule: canReschedule,
    };
  });

  res.json({ items: enriched });
});
