import { Router } from 'express';
import {
  WorkflowServiceError,
  getWorkflowRecordById,
  listWorkflowLibraryItems,
  saveOrUpdateWorkflow,
  setDefaultWorkflow,
} from '../services/workflowLibraryService.ts';

export const workflowsRouter = Router();

/**
 * GET /api/workflows
 * Lists workflows in the Independent Workflow Library and extracted image workflows.
 */
workflowsRouter.get('/workflows', (_req, res) => {
  try {
    res.json({ items: listWorkflowLibraryItems() });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to list workflows' });
  }
});

/**
 * GET /api/workflows/:id
 */
workflowsRouter.get('/workflows/:id', (req, res) => {
  try {
    const workflow = getWorkflowRecordById(Number(req.params.id));
    res.json({ workflow });
  } catch (err: any) {
    const status = err instanceof WorkflowServiceError ? err.statusCode : 500;
    res.status(status).json({ error: err?.message || 'Failed to read workflow' });
  }
});

/**
 * POST /api/workflows/:id/set-default
 * Marks a workflow as the primary default workflow across Quick Gen and Generation Studio.
 */
workflowsRouter.post('/workflows/:id/set-default', (req, res) => {
  try {
    const updated = setDefaultWorkflow(Number(req.params.id));
    res.json({ ok: true, workflow: updated });
  } catch (err: any) {
    const status = err instanceof WorkflowServiceError ? err.statusCode : 400;
    res.status(status).json({ error: err?.message || 'Failed to set default workflow' });
  }
});

/**
 * POST /api/workflows
 * Saves, updates, or imports a workflow in the Independent Workflow Library.
 */
workflowsRouter.post('/workflows', (req, res) => {
  try {
    const workflow = saveOrUpdateWorkflow(req.body || {});
    res.json({ workflow });
  } catch (err: any) {
    const status = err instanceof WorkflowServiceError ? err.statusCode : 400;
    res.status(status).json({ error: err?.message || 'Failed to save workflow' });
  }
});
