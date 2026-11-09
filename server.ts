import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { appConfig } from './src/server/config.ts';
import { runMigrations } from './src/server/db.ts';
import { runDirectoryScan, startFilesystemWatcher } from './src/server/services/scannerService.ts';
import { syncModelInventory } from './src/server/services/comfyuiService.ts';
import { imagesRouter } from './src/server/routes/imagesRoutes.ts';
import { charactersRouter } from './src/server/routes/charactersRoutes.ts';
import { modelsAndWorkflowsRouter } from './src/server/routes/modelsAndWorkflowsRoutes.ts';
import { systemRouter } from './src/server/routes/systemRoutes.ts';
import { generationRouter } from './src/server/routes/generationRoutes.ts';

async function startServer() {
  // 1. Run SQLite schema migrations
  runMigrations();

  // 2. Start filesystem monitoring and trigger initial non-blocking scan of mounted output folder
  startFilesystemWatcher();
  await syncModelInventory();
  await runDirectoryScan('incremental');

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
    console.log(`Couchy running on http://0.0.0.0:${appConfig.port}`);
    console.log(`Watching ComfyUI Output Directory: ${appConfig.comfyuiOutputDir}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start Couchy server:', err);
  process.exit(1);
});
