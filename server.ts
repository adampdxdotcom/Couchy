import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { appConfig } from './src/server/config.ts';
import { logger } from './src/server/logger.ts';
import { runMigrations } from './src/server/db.ts';
import {
  backfillMissingImagePrompts,
  runBackgroundThumbnailMigration,
  runDirectoryScan,
  startFilesystemWatcher,
} from './src/server/services/scannerService.ts';
import { syncModelInventory } from './src/server/services/modelInventoryService.ts';
import { imagesRouter } from './src/server/routes/imagesRoutes.ts';
import { charactersRouter } from './src/server/routes/charactersRoutes.ts';
import { modelsAndWorkflowsRouter } from './src/server/routes/modelsAndWorkflowsRoutes.ts';
import { systemRouter } from './src/server/routes/systemRoutes.ts';
import { generationRouter } from './src/server/routes/generationRoutes.ts';
import { presetsRouter } from './src/server/routes/presetsRoutes.ts';
import {
  getTaggerSettings,
  isTaggerModelDownloaded,
  startVisualTaggerQueue,
} from './src/server/services/visualTaggerService.ts';
import { startDownloadScheduler } from './src/server/services/downloadSchedulerService.ts';
import {
  scanAndCleanCopiedDownloads,
  startModelCleanupScheduler,
} from './src/server/services/modelCleanupService.ts';
import { startLoraHeadshotWatcher } from './src/server/services/characterDownloadAutomationService.ts';

async function startServer() {
  // 1. Run SQLite schema migrations before serving API routes
  runMigrations();

  const app = express();
  app.use(express.json({ limit: '25mb' }));

  // 2. Mount API routes
  app.use('/api/images', imagesRouter);
  app.use('/api/characters', charactersRouter);
  app.use('/api/generation', generationRouter);
  app.use('/api/presets', presetsRouter);
  app.use('/api', modelsAndWorkflowsRouter);
  app.use('/api', systemRouter);

  // 3. Mount Vite in development or static dist in production
  const disableHmr = process.env.DISABLE_HMR === 'true';
  let viteServer: Awaited<ReturnType<typeof createViteServer>> | null = null;
  if (process.env.NODE_ENV !== 'production') {
    viteServer = await createViteServer({
      server: {
        middlewareMode: true,
        ...(disableHmr ? { hmr: false, ws: false, watch: null } : {}),
      },
      appType: 'spa',
    });
    app.use(viteServer.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const httpServer = app.listen(appConfig.port, '0.0.0.0', () => {
    logger.info('Server', `Couchy running on http://0.0.0.0:${appConfig.port}`);
    logger.info('Server', `Watching ComfyUI Output Directory: ${appConfig.comfyuiOutputDir}`);
    logger.info('Server', `WebP Thumbnail Cache (384px long-side): ${appConfig.thumbnailPath}`);
    logger.info('Server', `Local Models Directory: ${appConfig.localModelsDir}`);
    logger.info('Server', `Rotating Log File: ${logger.logFilePath}`);

    // Defer prompt backfill, filesystem watchers, and background scans until after port binding
    setImmediate(async () => {
      try {
        backfillMissingImagePrompts(false);
        startFilesystemWatcher();
        startDownloadScheduler();
        startLoraHeadshotWatcher();
        startModelCleanupScheduler();

        await runBackgroundThumbnailMigration();
        await syncModelInventory();
        await scanAndCleanCopiedDownloads().catch(() => {});
        await runDirectoryScan('incremental');
        // Only resume visual tagging if user previously enabled it AND model is already on disk
        if (getTaggerSettings().enabled && isTaggerModelDownloaded()) {
          startVisualTaggerQueue().catch(() => {});
        }
      } catch (err) {
        logger.error('Server', 'Background startup scan error', err);
      }
    });
  });

  // Periodic reconciliation every 5 minutes
  const reconcileTimer = setInterval(() => {
    runDirectoryScan('reconcile').catch(() => {});
  }, 5 * 60 * 1000);

  const shutdown = async () => {
    clearInterval(reconcileTimer);
    httpServer.close();
    if (viteServer) {
      await viteServer.close().catch(() => {});
    }
    process.exit(0);
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}

startServer().catch((err) => {
  logger.error('Server', 'Failed to start Couchy server', err);
  process.exit(1);
});
