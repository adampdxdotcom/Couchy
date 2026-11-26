import express from 'express';
import compression from 'compression';
import path from 'path';
import { appConfig } from './src/server/config.ts';
import { logger } from './src/server/logger.ts';

async function startServer() {
  const outerApp = express();
  const innerApp = express();
  // Compress JSON/text API responses >= 1 KB (already-compressed WebP/PNG/ZIP streams are auto-skipped)
  innerApp.use(compression({ threshold: 1024 }));
  innerApp.use(express.json({ limit: '25mb' }));

  const disableHmr = process.env.DISABLE_HMR === 'true';
  let viteServer: import('vite').ViteDevServer | null = null;
  let reconcileTimer: ReturnType<typeof setInterval> | null = null;

  // Prepare DB migrations, API routers, and Vite/static middleware while port binding proceeds immediately
  const readyPromise = (async () => {
    const [
      { runMigrations },
      { imagesRouter },
      { charactersRouter },
      { modelsAndWorkflowsRouter },
      { systemRouter },
      { generationRouter },
      { presetsRouter },
      { notifyWorkspaceDataChanged },
      viteInstance,
    ] = await Promise.all([
      import('./src/server/db.ts'),
      import('./src/server/routes/imagesRoutes.ts'),
      import('./src/server/routes/charactersRoutes.ts'),
      import('./src/server/routes/modelsAndWorkflowsRoutes.ts'),
      import('./src/server/routes/systemRoutes.ts'),
      import('./src/server/routes/generationRoutes.ts'),
      import('./src/server/routes/presetsRoutes.ts'),
      import('./src/server/services/comfyuiLiveMonitor.ts'),
      process.env.NODE_ENV !== 'production'
        ? import('vite').then(({ createServer: createViteServer }) =>
            createViteServer({
              server: {
                middlewareMode: true,
                ...(disableHmr ? { hmr: false, ws: false, watch: null } : {}),
              },
              appType: 'spa',
            })
          )
        : Promise.resolve(null),
    ]);

    runMigrations();

    // Read-only POST endpoints that must not bump workspaceVersion (e.g. gallery queries)
    const readOnlyApiPostPaths = new Set([
      '/images/query',
      '/images/export-zip',
      '/comfyui/test',
      '/reproduce/validate',
      '/help/ask',
      '/characters/match-face',
      '/models/resolve-url',
      '/generation/lmstudio/chat',
      '/generation/lmstudio/generate-prompts',
      '/generation/interrogate-image',
      '/generation/civitai-image',
    ]);

    innerApp.use('/api', (req, res, next) => {
      if (
        (req.method === 'PUT' ||
          req.method === 'PATCH' ||
          req.method === 'DELETE' ||
          (req.method === 'POST' && !readOnlyApiPostPaths.has(req.path)))
      ) {
        res.on('finish', () => {
          if (res.statusCode >= 200 && res.statusCode < 400) {
            notifyWorkspaceDataChanged();
          }
        });
      }
      next();
    });

    innerApp.use('/api/images', imagesRouter);
    innerApp.use('/api/characters', charactersRouter);
    innerApp.use('/api/generation', generationRouter);
    innerApp.use('/api/presets', presetsRouter);
    innerApp.use('/api', modelsAndWorkflowsRouter);
    innerApp.use('/api', systemRouter);

    if (viteInstance) {
      viteServer = viteInstance;
      innerApp.use(viteInstance.middlewares);
    } else {
      const distPath = path.join(process.cwd(), 'dist');
      innerApp.use(express.static(distPath));
      innerApp.get('*', (_req, res) => {
        res.sendFile(path.join(distPath, 'index.html'));
      });
    }
  })();

  // Queue incoming HTTP requests cleanly until routes and Vite middlewares finish mounting
  outerApp.use(async (req, res, next) => {
    try {
      await readyPromise;
      innerApp(req, res, next);
    } catch (err) {
      next(err);
    }
  });

  const httpServer = outerApp.listen(appConfig.port, '0.0.0.0', () => {
    logger.info('Server', `Couchy listening on http://0.0.0.0:${appConfig.port}`);
    logger.info('Server', `Watching ComfyUI Output Directory: ${appConfig.comfyuiOutputDir}`);
    logger.info('Server', `WebP Thumbnail Cache (384px long-side): ${appConfig.thumbnailPath}`);
    logger.info('Server', `Local Models Directory: ${appConfig.localModelsDir}`);
    logger.info('Server', `Rotating Log File: ${logger.logFilePath}`);

    // Start background watchers and directory reconciliation only after core init completes
    readyPromise
      .then(async () => {
        try {
          const [
            {
              backfillMissingImagePrompts,
              runBackgroundThumbnailMigration,
              runDirectoryScan,
              startFilesystemWatcher,
            },
            { syncModelInventory },
            { startModelFilesystemWatcher },
            { ensureComfyUiWsMonitor },
            { getTaggerSettings, isTaggerModelDownloaded, startVisualTaggerQueue },
            { startDownloadScheduler },
            { scanAndCleanCopiedDownloads, startModelCleanupScheduler },
            { startLoraHeadshotWatcher },
            {
              startCivitaiActivityScheduler,
            },
          ] = await Promise.all([
            import('./src/server/services/scannerService.ts'),
            import('./src/server/services/modelInventoryService.ts'),
            import('./src/server/services/modelWatcherService.ts'),
            import('./src/server/services/comfyuiLiveMonitor.ts'),
            import('./src/server/services/visualTaggerService.ts'),
            import('./src/server/services/downloadSchedulerService.ts'),
            import('./src/server/services/modelCleanupService.ts'),
            import('./src/server/services/characterDownloadAutomationService.ts'),
            import('./src/server/services/civitai/civitaiActivitySyncService.ts'),
          ]);

          backfillMissingImagePrompts(false);
          startFilesystemWatcher();
          startModelFilesystemWatcher();
          ensureComfyUiWsMonitor();
          startDownloadScheduler();
          startLoraHeadshotWatcher();
          startModelCleanupScheduler();
          startCivitaiActivityScheduler();

          await runBackgroundThumbnailMigration();
          await syncModelInventory();
          await scanAndCleanCopiedDownloads().catch(() => {});
          await runDirectoryScan('incremental');
          if (getTaggerSettings().enabled && isTaggerModelDownloaded()) {
            startVisualTaggerQueue().catch(() => {});
          }

          reconcileTimer = setInterval(() => {
            runDirectoryScan('reconcile').catch(() => {});
            syncModelInventory().catch(() => {});
          }, 5 * 60 * 1000);
        } catch (err) {
          logger.error('Server', 'Background startup scan error', err);
        }
      })
      .catch(() => {
        // Core init errors are handled by the top-level readyPromise error handler below
      });
  });

  readyPromise.catch((err) => {
    logger.error('Server', 'Core initialization failed', err);
    httpServer.close(() => process.exit(1));
  });

  httpServer.on('error', (err) => {
    logger.error('Server', 'HTTP server listen error', err);
    process.exit(1);
  });

  const shutdown = async () => {
    if (reconcileTimer) clearInterval(reconcileTimer);
    await Promise.all([
      import('./src/server/services/civitai/civitaiActivitySyncService.ts')
        .then((m) => m.stopCivitaiActivityScheduler())
        .catch(() => {}),
      import('./src/server/services/modelWatcherService.ts')
        .then((m) => m.stopModelFilesystemWatcher())
        .catch(() => {}),
      import('./src/server/services/liveMonitor/comfyuiTransportMonitor.ts')
        .then((m) => m.stopComfyUiWsMonitor())
        .catch(() => {}),
    ]);
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
