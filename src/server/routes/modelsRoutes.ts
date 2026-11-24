import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { db } from '../db.ts';
import {
  listModelInventory,
  syncModelInventory,
  updateModelConfig,
  updateModelVisibility,
} from '../services/modelInventoryService.ts';
import {
  fetchAndEnrichModelFromCivitai,
  healExistingCivitaiLinks,
  resolveSafeModelPreviewPath,
} from '../services/civitai/civitaiModelEnrichmentService.ts';
import {
  listMyCivitaiUploads,
  syncLinkedModelsCivitaiStats,
} from '../services/civitai/civitaiCreatorModelsService.ts';

export const modelsRouter = Router();

/**
 * GET /api/models/inventory
 * Returns known model inventory and Missing Dependencies summary.
 */
modelsRouter.get('/models/inventory', (_req, res) => {
  try {
    res.json({ items: listModelInventory() });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to list model inventory' });
  }
});

/**
 * POST /api/models/sync
 * Syncs installed models from both filesystem and ComfyUI /object_info API.
 */
modelsRouter.post('/models/sync', async (_req, res) => {
  try {
    const items = await syncModelInventory();
    res.json({ items });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to sync model inventory' });
  }
});

/**
 * POST /api/models/civitai-heal
 * Scans existing models in the database, detects whether each belongs on civitai.red vs civitai.com,
 * and heals broken or missing Civitai page URLs.
 */
modelsRouter.post('/models/civitai-heal', async (_req, res) => {
  try {
    const summary = await healExistingCivitaiLinks();
    res.json({ ok: true, ...summary });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to heal Civitai links' });
  }
});

/**
 * POST /api/models/:id/civitai-fetch
 * Computes file SHA-256 if missing, fetches Civitai version + parent metadata,
 * caches up to 4 preview thumbnails locally, and merges non-destructively.
 */
modelsRouter.post('/models/:id/civitai-fetch', async (req, res) => {
  try {
    const modelId = Number(req.params.id);
    if (!Number.isFinite(modelId) || modelId <= 0) {
      res.status(400).json({ error: 'Valid numeric model ID is required' });
      return;
    }
    const result = await fetchAndEnrichModelFromCivitai(modelId);
    res.json({
      ok: true,
      provider: result.provider,
      hfRepoId: result.hfRepoId,
      filledTriggerWord: result.filledTriggerWord,
      filledDefaultStrength: result.filledDefaultStrength,
      civitaiUrl: result.meta.civitaiUrl,
      baseModel: result.meta.baseModel,
      recommendedWeight: result.meta.recommendedWeight,
      previewCount: result.cachedPreviews.length,
    });
  } catch (err: any) {
    const status = typeof err?.statusCode === 'number' ? err.statusCode : 500;
    res.status(status).json({ error: err?.message || 'Failed to fetch model details' });
  }
});

/**
 * GET /api/models/civitai-uploads
 * Resolves the authenticated Civitai user via `whoami` and lists their uploaded models/versions.
 */
modelsRouter.get('/models/civitai-uploads', async (req, res) => {
  try {
    const forceRefresh = req.query.refresh === '1';
    const result = await listMyCivitaiUploads({ forceRefresh });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to load Civitai uploads' });
  }
});

/**
 * POST /api/models/:id/civitai-link
 * Explicitly binds a local model/LoRA to a Civitai URL or Version ID and syncs metadata, stats, and comments.
 */
modelsRouter.post('/models/:id/civitai-link', async (req, res) => {
  try {
    const modelId = Number(req.params.id);
    if (!Number.isFinite(modelId) || modelId <= 0) {
      res.status(400).json({ error: 'Valid numeric model ID is required' });
      return;
    }
    const { input, versionId, modelId: civitaiModelId, domain } = req.body || {};
    if (
      !String(input || '').trim() &&
      !String(versionId || '').trim() &&
      !String(civitaiModelId || '').trim()
    ) {
      res.status(400).json({ error: 'Provide a Civitai URL or Model Version ID.' });
      return;
    }

    const result = await fetchAndEnrichModelFromCivitai(modelId, {
      allowHuggingFaceFallback: false,
      explicitLinkInput: typeof input === 'string' ? input : undefined,
      explicitVersionId: versionId ? String(versionId) : undefined,
      explicitModelId: civitaiModelId ? String(civitaiModelId) : undefined,
      explicitDomain: domain === 'civitai.red' ? 'civitai.red' : undefined,
    });
    res.json({
      ok: true,
      civitaiUrl: result.meta.civitaiUrl,
      civitaiId: result.meta.civitaiId,
      civitaiVersionId: result.meta.civitaiVersionId,
      baseModel: result.meta.baseModel,
      creatorUsername: result.creatorUsername,
      isOwnUpload: result.isOwnUpload,
      stats: result.stats,
      filledTriggerWord: result.filledTriggerWord,
      filledDefaultStrength: result.filledDefaultStrength,
    });
  } catch (err: any) {
    const status = typeof err?.statusCode === 'number' ? err.statusCode : 500;
    res.status(status).json({ error: err?.message || 'Failed to link Civitai model' });
  }
});

/**
 * POST /api/models/:id/civitai-stats-refresh
 * Refreshes live Civitai model/version engagement stats and MCP comments for a single model.
 */
modelsRouter.post('/models/:id/civitai-stats-refresh', async (req, res) => {
  try {
    const modelId = Number(req.params.id);
    if (!Number.isFinite(modelId) || modelId <= 0) {
      res.status(400).json({ error: 'Valid numeric model ID is required' });
      return;
    }
    const syncRes = await syncLinkedModelsCivitaiStats({
      onlyModelId: modelId,
      minIntervalMs: 0,
    });
    res.json({
      ok: true,
      checkedModels: syncRes.checkedModels,
      stats: syncRes.latestStats ?? null,
      comments: syncRes.latestComments ?? [],
      creatorUsername: syncRes.creatorUsername ?? null,
      isOwnUpload: Boolean(syncRes.isOwnUpload),
      syncedAt: syncRes.syncedAt ?? null,
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to refresh Civitai model stats' });
  }
});

/**
 * GET /api/models/:id/preview/:filename
 * Serves locally cached WebP preview thumbnails for models.
 */
modelsRouter.get('/models/:id/preview/:filename', (req, res) => {
  const targetPath = resolveSafeModelPreviewPath(req.params.filename);
  if (!targetPath || !fs.existsSync(targetPath)) {
    res.status(404).end();
    return;
  }
  res.setHeader('Content-Type', 'image/webp');
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.sendFile(path.resolve(targetPath));
});

/**
 * GET /api/models/:name/impact
 * Model Usage Impact Report before removing or replacing a LoRA or Checkpoint.
 */
modelsRouter.get('/models/:name/impact', (req, res) => {
  try {
    const modelName = req.params.name;
    const images = db
      .prepare(
        `SELECT DISTINCT i.id, i.filename, i.file_mtime, r.rating
         FROM image_models im
         JOIN images i ON i.id = im.image_id AND i.is_missing = 0
         LEFT JOIN ratings r ON r.content_hash = i.content_hash
         WHERE LOWER(im.model_name) = LOWER(?)
         ORDER BY COALESCE(r.rating, 0) DESC, i.file_mtime DESC`
      )
      .all(modelName);

    const workflows = db
      .prepare(
        `SELECT DISTINCT w.id, w.name, w.is_saved_library
         FROM image_models im
         JOIN image_workflows iw ON iw.image_id = im.image_id
         JOIN workflows w ON w.id = iw.workflow_id
         WHERE LOWER(im.model_name) = LOWER(?)`
      )
      .all(modelName);

    const characters = db
      .prepare(
        `SELECT c.id, c.name, cl.appearance_label AS appearanceLabel
         FROM character_loras cl
         JOIN characters c ON c.id = cl.character_id
         WHERE LOWER(cl.lora_name) = LOWER(?)`
      )
      .all(modelName);

    res.json({
      modelName,
      dependentImageCount: images.length,
      dependentWorkflowCount: workflows.length,
      images,
      workflows,
      characters,
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to compute model impact report' });
  }
});

/**
 * PATCH /api/models/:id/visibility
 * Toggles whether a base or utility model is hidden in Base Models & Quick Gen @mention.
 */
modelsRouter.patch('/models/:id/visibility', (req, res) => {
  try {
    const modelId = Number(req.params.id);
    if (!Number.isFinite(modelId) || modelId <= 0) {
      res.status(400).json({ error: 'Valid numeric model ID is required' });
      return;
    }
    const { isHidden } = req.body || {};
    updateModelVisibility(modelId, Boolean(isHidden));
    res.json({ ok: true, items: listModelInventory() });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Failed to update model visibility' });
  }
});

/**
 * PATCH /api/models/:id/config
 * Updates @mention settings, Model Details & Strengths, and personal notes for a model.
 */
modelsRouter.patch('/models/:id/config', (req, res) => {
  try {
    const modelId = Number(req.params.id);
    if (!Number.isFinite(modelId) || modelId <= 0) {
      res.status(400).json({ error: 'Valid numeric model ID is required' });
      return;
    }
    const { name, mentionEnabled, nickname, llmDescription, userNotes } = req.body || {};
    updateModelConfig(modelId, { name, mentionEnabled, nickname, llmDescription, userNotes });
    res.json({ ok: true, items: listModelInventory() });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Failed to update model settings' });
  }
});
