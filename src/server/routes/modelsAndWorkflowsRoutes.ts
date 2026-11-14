import { Router } from 'express';
import { lorasRouter } from './lorasRoutes.ts';
import { modelsRouter } from './modelsRoutes.ts';
import { modelDownloadsRouter } from './modelDownloadsRoutes.ts';
import { workflowsRouter } from './workflowsRoutes.ts';
import { comfyuiRouter } from './comfyuiRoutes.ts';

/**
 * Aggregated router composing LoRA, Model Inventory/Search/Download,
 * Workflow Library, and ComfyUI execution endpoints under /api.
 */
export const modelsAndWorkflowsRouter = Router();

modelsAndWorkflowsRouter.use(comfyuiRouter);
modelsAndWorkflowsRouter.use(lorasRouter);
modelsAndWorkflowsRouter.use(modelsRouter);
modelsAndWorkflowsRouter.use(modelDownloadsRouter);
modelsAndWorkflowsRouter.use(workflowsRouter);
