import { Router } from 'express';
import { db } from '../db.ts';
import {
  submitWorkflowReproduction,
  testComfyUiConnection,
  validateWorkflowReproduction,
} from '../services/comfyuiService.ts';
import { cancelComfyUiJob, getComfyUiLiveStatus } from '../services/comfyuiLiveMonitor.ts';

export const comfyuiRouter = Router();

/**
 * GET /api/comfyui/live-status
 * Returns real-time ComfyUI queue counts and active job step percentage.
 */
comfyuiRouter.get('/comfyui/live-status', async (_req, res) => {
  try {
    const status = await getComfyUiLiveStatus();
    res.json(status);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to read ComfyUI live status' });
  }
});

/**
 * POST /api/comfyui/cancel
 * Immediately cancels an active generation batch/series, reproduction job, or ComfyUI queue job.
 */
comfyuiRouter.post('/comfyui/cancel', async (req, res) => {
  try {
    const { itemId, batchId, comfyuiPromptId } = req.body || {};
    const result = await cancelComfyUiJob({
      itemId: itemId !== undefined && itemId !== null ? Number(itemId) : null,
      batchId: batchId !== undefined && batchId !== null ? Number(batchId) : null,
      comfyuiPromptId: typeof comfyuiPromptId === 'string' ? comfyuiPromptId : null,
    });
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Failed to cancel generation job' });
  }
});

/**
 * POST /api/comfyui/test
 */
comfyuiRouter.post('/comfyui/test', async (req, res) => {
  const result = await testComfyUiConnection(req.body?.baseUrl);
  res.json(result);
});

/**
 * POST /api/reproduce/validate
 */
comfyuiRouter.post('/reproduce/validate', async (req, res) => {
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
comfyuiRouter.post('/reproduce/submit', async (req, res) => {
  try {
    const { imageId, workflowId, positivePrompt, loras, generationParams } = req.body || {};
    const job = await submitWorkflowReproduction({
      imageId: imageId ? Number(imageId) : undefined,
      workflowId: workflowId ? Number(workflowId) : undefined,
      positivePrompt: typeof positivePrompt === 'string' ? positivePrompt : undefined,
      loras: Array.isArray(loras) ? loras : undefined,
      generationParams:
        generationParams && typeof generationParams === 'object' ? generationParams : undefined,
    });
    res.json({ job });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Workflow execution failed' });
  }
});

/**
 * GET /api/reproduce/jobs
 */
comfyuiRouter.get('/reproduce/jobs', (_req, res) => {
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
