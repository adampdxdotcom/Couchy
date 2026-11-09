import { Router } from 'express';
import crypto from 'crypto';
import { db } from '../db.ts';
import { listLoraExplorerItems } from '../services/galleryQueryService.ts';
import { updateLoraCategory } from '../services/characterService.ts';
import {
  listModelInventory,
  submitWorkflowReproduction,
  syncModelInventory,
  testComfyUiConnection,
  validateWorkflowReproduction,
} from '../services/comfyuiService.ts';
import {
  searchCivitaiModels,
  searchHuggingFaceModels,
  startConfirmedModelDownload,
} from '../services/modelManagerService.ts';
import type { WorkflowLibraryItem } from '../../shared/types.ts';

export const modelsAndWorkflowsRouter = Router();

/**
 * GET /api/loras
 * Returns LoRA Explorer items with image counts, strength ranges, ratings, and character associations.
 */
modelsAndWorkflowsRouter.get('/loras', (_req, res) => {
  try {
    res.json({ items: listLoraExplorerItems() });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to list LoRAs' });
  }
});

/**
 * PATCH /api/loras/classify
 * Updates semantic classification of a LoRA (character, style, clothing, concept, pose, object, other).
 */
modelsAndWorkflowsRouter.patch('/loras/classify', (req, res) => {
  try {
    const { loraName, loraCategory, userNotes } = req.body || {};
    if (!loraName) {
      res.status(400).json({ error: 'loraName is required' });
      return;
    }
    updateLoraCategory(String(loraName), loraCategory || 'other', userNotes);
    res.json({ ok: true, items: listLoraExplorerItems() });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Failed to classify LoRA' });
  }
});

/**
 * GET /api/models/inventory
 * Returns known model inventory and Missing Dependencies summary.
 */
modelsAndWorkflowsRouter.get('/models/inventory', (_req, res) => {
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
modelsAndWorkflowsRouter.post('/models/sync', async (_req, res) => {
  try {
    const items = await syncModelInventory();
    res.json({ items });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to sync model inventory' });
  }
});

/**
 * GET /api/models/:name/impact
 * Model Usage Impact Report before removing or replacing a LoRA or Checkpoint.
 */
modelsAndWorkflowsRouter.get('/models/:name/impact', (req, res) => {
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
 * GET /api/models/search/civitai
 */
modelsAndWorkflowsRouter.get('/models/search/civitai', async (req, res) => {
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
modelsAndWorkflowsRouter.get('/models/search/huggingface', async (req, res) => {
  try {
    const q = String(req.query.q || '');
    const items = await searchHuggingFaceModels(q);
    res.json({ items });
  } catch (err: any) {
    res.status(502).json({ error: err?.message || 'Hugging Face search failed' });
  }
});

/**
 * POST /api/downloads/start
 * Starts a confirmed server-side model download with SHA-256 verification.
 */
modelsAndWorkflowsRouter.post('/downloads/start', async (req, res) => {
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
    } = req.body || {};

    if (!userConfirmed) {
      res.status(400).json({ error: 'Explicit user confirmation is required before downloading models.' });
      return;
    }

    const job = await startConfirmedModelDownload({
      provider,
      modelName,
      filename,
      modelType,
      sourceUrl,
      expectedHash,
      subfolder,
      allowOverwrite: Boolean(allowOverwrite),
    });
    res.json({ job });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Failed to start download' });
  }
});

/**
 * GET /api/downloads
 * Lists all historical and active model downloads.
 */
modelsAndWorkflowsRouter.get('/downloads', (_req, res) => {
  const jobs = db.prepare('SELECT * FROM download_jobs ORDER BY id DESC LIMIT 50').all();
  res.json({ items: jobs });
});

/**
 * GET /api/workflows
 * Lists workflows in the Independent Workflow Library and extracted image workflows.
 */
modelsAndWorkflowsRouter.get('/workflows', (_req, res) => {
  try {
    const rows = db
      .prepare(
        `
        SELECT
          w.*,
          COUNT(DISTINCT iw.image_id) AS imageCount
        FROM workflows w
        LEFT JOIN image_workflows iw ON iw.workflow_id = w.id
        GROUP BY w.id
        ORDER BY w.is_saved_library DESC, w.updated_at DESC
      `
      )
      .all() as any[];

    const getChars = db.prepare(`
      SELECT c.id, c.name, cw.role_label AS roleLabel
      FROM character_workflows cw
      JOIN characters c ON c.id = cw.character_id
      WHERE cw.workflow_id = ?
    `);

    const items: WorkflowLibraryItem[] = rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description || '',
      isSavedLibrary: Boolean(r.is_saved_library),
      hasVisualWorkflow: Boolean(r.visual_workflow_json),
      hasApiWorkflow: Boolean(r.api_workflow_json),
      workflowHash: r.workflow_hash,
      imageCount: Number(r.imageCount || 0),
      characters: getChars.all(r.id) as any[],
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));

    res.json({ items });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to list workflows' });
  }
});

/**
 * GET /api/workflows/:id
 */
modelsAndWorkflowsRouter.get('/workflows/:id', (req, res) => {
  const wf = db.prepare('SELECT * FROM workflows WHERE id = ?').get(Number(req.params.id));
  if (!wf) {
    res.status(404).json({ error: 'Workflow not found' });
    return;
  }
  res.json({ workflow: wf });
});

/**
 * POST /api/workflows
 * Saves or imports a workflow into the Independent Workflow Library.
 */
modelsAndWorkflowsRouter.post('/workflows', (req, res) => {
  try {
    const { id, name, description, visualWorkflowJson, apiWorkflowJson } = req.body || {};
    if (id) {
      db.prepare(
        `UPDATE workflows
         SET name = ?, description = ?, is_saved_library = 1, updated_at = datetime('now')
         WHERE id = ?`
      ).run(String(name || 'Saved Workflow'), String(description || ''), Number(id));
      res.json({ workflow: db.prepare('SELECT * FROM workflows WHERE id = ?').get(Number(id)) });
      return;
    }

    if (!visualWorkflowJson && !apiWorkflowJson) {
      res.status(400).json({ error: 'Provide visual or API workflow JSON' });
      return;
    }

    const wfHash = crypto
      .createHash('sha256')
      .update((visualWorkflowJson || '') + '||' + (apiWorkflowJson || ''))
      .digest('hex');

    db.prepare(
      `INSERT INTO workflows (name, description, is_saved_library, visual_workflow_json, api_workflow_json, workflow_hash)
       VALUES (?, ?, 1, ?, ?, ?)
       ON CONFLICT(workflow_hash) DO UPDATE SET
         name = excluded.name,
         description = excluded.description,
         is_saved_library = 1,
         updated_at = datetime('now')`
    ).run(
      String(name || `Workflow ${wfHash.slice(0, 8)}`),
      String(description || ''),
      visualWorkflowJson || null,
      apiWorkflowJson || null,
      wfHash
    );

    const row = db.prepare('SELECT * FROM workflows WHERE workflow_hash = ?').get(wfHash);
    res.json({ workflow: row });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Failed to save workflow' });
  }
});

/**
 * POST /api/comfyui/test
 */
modelsAndWorkflowsRouter.post('/comfyui/test', async (req, res) => {
  const result = await testComfyUiConnection(req.body?.baseUrl);
  res.json(result);
});

/**
 * POST /api/reproduce/validate
 */
modelsAndWorkflowsRouter.post('/reproduce/validate', async (req, res) => {
  try {
    const { imageId, workflowId } = req.body || {};
    const result = await validateWorkflowReproduction({
      imageId: imageId ? Number(imageId) : undefined,
      workflowId: workflowId ? Number(workflowId) : undefined,
    });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Validation failed' });
  }
});

/**
 * POST /api/reproduce/submit
 */
modelsAndWorkflowsRouter.post('/reproduce/submit', async (req, res) => {
  try {
    const { imageId, workflowId } = req.body || {};
    const job = await submitWorkflowReproduction({
      imageId: imageId ? Number(imageId) : undefined,
      workflowId: Number(workflowId),
    });
    res.json({ job });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Reproduction submission failed' });
  }
});

/**
 * GET /api/reproduce/jobs
 */
modelsAndWorkflowsRouter.get('/reproduce/jobs', (_req, res) => {
  const jobs = db
    .prepare(
      `SELECT rj.*, w.name AS workflow_name, i.filename AS source_filename
       FROM reproduction_jobs rj
       LEFT JOIN workflows w ON w.id = rj.workflow_id
       LEFT JOIN images i ON i.id = rj.source_image_id
       ORDER BY rj.id DESC LIMIT 50`
    )
    .all();
  res.json({ items: jobs });
});
