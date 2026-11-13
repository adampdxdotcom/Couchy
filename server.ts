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
import { syncModelInventory } from './src/server/services/comfyuiService.ts';
import { imagesRouter } from './src/server/routes/imagesRoutes.ts';
import { charactersRouter } from './src/server/routes/charactersRoutes.ts';
import { modelsAndWorkflowsRouter } from './src/server/routes/modelsAndWorkflowsRoutes.ts';
import { systemRouter } from './src/server/routes/systemRoutes.ts';
import { generationRouter } from './src/server/routes/generationRoutes.ts';
import {
  getTaggerSettings,
  isTaggerModelDownloaded,
  startVisualTaggerQueue,
} from './src/server/services/visualTaggerService.ts';

async function startServer() {
  // 1. Run SQLite schema migrations & one-time prompt backfill
  runMigrations();
  backfillMissingImagePrompts(false);

  // 2. Start filesystem monitoring
  startFilesystemWatcher();

  const app = express();
  app.use(express.json({ limit: '25mb' }));

  // 3. Mount API routes
  app.use('/api/images', imagesRouter);
  app.use('/api/characters', charactersRouter);
  app.use('/api/generation', generationRouter);
  app.use('/api', modelsAndWorkflowsRouter);
  app.use('/api', systemRouter);

  // Periodic reconciliation every 5 minutes
  setInterval(() => {
    runDirectoryScan('reconcile').catch(() => {});
  }, 5 * 60 * 1000);

  // 4. Mount Vite in development or static dist in production
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(appConfig.port, '0.0.0.0', () => {
    logger.info('Server', `Couchy running on http://0.0.0.0:${appConfig.port}`);
    logger.info('Server', `Watching ComfyUI Output Directory: ${appConfig.comfyuiOutputDir}`);
    logger.info('Server', `WebP Thumbnail Cache (384px long-side): ${appConfig.thumbnailPath}`);
    logger.info('Server', `Local Models Directory: ${appConfig.localModelsDir}`);
    logger.info('Server', `Rotating Log File: ${logger.logFilePath}`);

    // Trigger initial thumbnail migration, model inventory sync, and incremental scan in the background
    setImmediate(async () => {
      try {
        await runBackgroundThumbnailMigration();
        await syncModelInventory();
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
}

startServer().catch((err) => {
  logger.error('Server', 'Failed to start Couchy server', err);
  process.exit(1);
});
