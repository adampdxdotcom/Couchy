import { Router } from 'express';
import fs from 'fs';
import { db } from '../db.ts';
import { appConfig } from '../config.ts';
import {
  getActiveScanStatus,
  runDirectoryScan,
  startFilesystemWatcher,
} from '../services/scannerService.ts';
import {
  configureScheduledBackups,
  createDatabaseBackup,
  exportUserAnnotationsJson,
  listDatabaseBackups,
  restoreUserAnnotationsJson,
} from '../services/backupService.ts';
import {
  controlVisualTaggerQueue,
  getVisualTaggerStatus,
  updateVisualTaggerConfig,
} from '../services/visualTaggerService.ts';

export const systemRouter = Router();

/**
 * GET /api/health
 * Health check and high-level system statistics.
 */
systemRouter.get('/health', (_req, res) => {
  const imgCount = (
    db.prepare('SELECT COUNT(*) AS c FROM images WHERE is_missing = 0').get() as { c: number }
  ).c;
  const charCount = (db.prepare('SELECT COUNT(*) AS c FROM characters').get() as { c: number }).c;
  const loraCount = (
    db.prepare("SELECT COUNT(*) AS c FROM models WHERE model_type = 'lora'").get() as { c: number }
  ).c;
  const wfCount = (db.prepare('SELECT COUNT(*) AS c FROM workflows').get() as { c: number }).c;
  const comfyRow = db.prepare('SELECT * FROM comfyui_instances WHERE is_default = 1').get() as any;
  const quickGenRow = db
    .prepare("SELECT value FROM app_settings WHERE key = 'quick_gen_box_enabled'")
    .get() as { value: string } | undefined;
  const quickGenBoxEnabled = quickGenRow ? quickGenRow.value === '1' : true;

  res.json({
    status: 'ok',
    counts: {
      images: imgCount,
      characters: charCount,
      loras: loraCount,
      workflows: wfCount,
    },
    config: {
      comfyuiUrl: appConfig.comfyuiUrl,
      comfyuiOutputDir: appConfig.comfyuiOutputDir,
      comfyuiModelsDir: appConfig.comfyuiModelsDir,
      databasePath: appConfig.databasePath,
      thumbnailPath: appConfig.thumbnailPath,
      localModelsDir: appConfig.localModelsDir,
      downloadsDir: appConfig.downloadsDir,
      hasCivitaiKey: Boolean(appConfig.civitaiApiKey),
      hasHfToken: Boolean(appConfig.hfApiToken),
      scheduledBackupHours: appConfig.scheduledBackupHours,
      quickGenBoxEnabled,
    },
    comfyuiInstance: comfyRow || null,
    activeScan: getActiveScanStatus(),
    visualTagger: getVisualTaggerStatus(),
  });
});

/**
 * PATCH /api/config
 * Updates runtime configurable paths, ComfyUI connection URL, or UI preferences.
 */
systemRouter.patch('/config', (req, res) => {
  try {
    const {
      comfyuiUrl,
      comfyuiOutputDir,
      comfyuiModelsDir,
      downloadsDir,
      scheduledBackupHours,
      quickGenBoxEnabled,
    } = req.body || {};

    if (comfyuiUrl && String(comfyuiUrl).trim()) {
      appConfig.comfyuiUrl = String(comfyuiUrl).trim().replace(/\/+$/, '');
      db.prepare('UPDATE comfyui_instances SET base_url = ? WHERE is_default = 1').run(
        appConfig.comfyuiUrl
      );
    }
    if (comfyuiOutputDir && String(comfyuiOutputDir).trim()) {
      const nextOut = String(comfyuiOutputDir).trim();
      fs.mkdirSync(nextOut, { recursive: true });
      appConfig.comfyuiOutputDir = nextOut;
      startFilesystemWatcher();
    }
    if (comfyuiModelsDir && String(comfyuiModelsDir).trim()) {
      const nextMod = String(comfyuiModelsDir).trim();
      fs.mkdirSync(nextMod, { recursive: true });
      appConfig.comfyuiModelsDir = nextMod;
    }
    if (downloadsDir && String(downloadsDir).trim()) {
      const nextDl = String(downloadsDir).trim();
      fs.mkdirSync(nextDl, { recursive: true });
      appConfig.downloadsDir = nextDl;
    }
    if (scheduledBackupHours !== undefined) {
      configureScheduledBackups(Number(scheduledBackupHours));
    }
    if (quickGenBoxEnabled !== undefined) {
      db.prepare(
        `INSERT INTO app_settings (key, value, updated_at)
         VALUES ('quick_gen_box_enabled', ?, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
      ).run(quickGenBoxEnabled ? '1' : '0');
    }

    res.json({ ok: true, config: appConfig });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Failed to update configuration' });
  }
});

/**
 * POST /api/scans/trigger
 * Triggers a directory scan ('incremental', 'full', 'reconcile', or 'rebuild_metadata').
 */
systemRouter.post('/scans/trigger', async (req, res) => {
  try {
    const scanType = req.body?.scanType || 'incremental';
    const jobId = await runDirectoryScan(scanType);
    res.json({ jobId, scan: getActiveScanStatus() });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to start scan' });
  }
});

/**
 * GET /api/scans
 * Returns active scan and recent scan history.
 */
systemRouter.get('/scans', (_req, res) => {
  const history = db.prepare('SELECT * FROM scan_jobs ORDER BY id DESC LIMIT 20').all();
  res.json({ active: getActiveScanStatus(), history });
});

/**
 * GET /api/organization/meta
 * Returns all tags, collections, checkpoints, and saved searches for filter bars.
 */
systemRouter.get('/organization/meta', (_req, res) => {
  const tags = db
    .prepare(
      `SELECT t.*, COUNT(it.image_content_hash) AS imageCount
       FROM tags t
       LEFT JOIN image_tags it ON it.tag_id = t.id
       GROUP BY t.id ORDER BY t.name ASC`
    )
    .all();

  const collections = db
    .prepare(
      `SELECT c.*, COUNT(ci.image_content_hash) AS imageCount
       FROM collections c
       LEFT JOIN collection_images ci ON ci.collection_id = c.id
       GROUP BY c.id ORDER BY c.name ASC`
    )
    .all();

  const checkpoints = db
    .prepare(
      `SELECT DISTINCT checkpoint_name AS name
       FROM image_metadata
       WHERE checkpoint_name IS NOT NULL AND checkpoint_name != ''
       ORDER BY checkpoint_name ASC`
    )
    .all() as { name: string }[];

  const savedSearches = db
    .prepare('SELECT * FROM saved_searches ORDER BY created_at DESC')
    .all()
    .map((s: any) => ({
      id: s.id,
      name: s.name,
      queryString: s.query_string,
      filterJson: JSON.parse(s.filter_json || '{}'),
      createdAt: s.created_at,
    }));

  res.json({
    tags,
    collections,
    checkpoints: checkpoints.map((c) => c.name),
    savedSearches,
  });
});

/**
 * POST /api/organization/collections
 */
systemRouter.post('/organization/collections', (req, res) => {
  try {
    const { name, description } = req.body || {};
    if (!name || !String(name).trim()) {
      res.status(400).json({ error: 'Collection name is required' });
      return;
    }
    const info = db
      .prepare('INSERT INTO collections (name, description) VALUES (?, ?)')
      .run(String(name).trim(), String(description || ''));
    res.json({ id: Number(info.lastInsertRowid), name: String(name).trim() });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Failed to create collection' });
  }
});

/**
 * DELETE /api/organization/collections/:id
 */
systemRouter.delete('/organization/collections/:id', (req, res) => {
  db.prepare('DELETE FROM collections WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

/**
 * POST /api/organization/tags
 */
systemRouter.post('/organization/tags', (req, res) => {
  try {
    const { name, color } = req.body || {};
    if (!name || !String(name).trim()) {
      res.status(400).json({ error: 'Tag name is required' });
      return;
    }
    const info = db
      .prepare('INSERT INTO tags (name, color) VALUES (?, ?)')
      .run(String(name).trim(), color || '#6366f1');
    res.json({ id: Number(info.lastInsertRowid), name: String(name).trim() });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Failed to create tag' });
  }
});

/**
 * POST /api/organization/saved-searches
 */
systemRouter.post('/organization/saved-searches', (req, res) => {
  try {
    const { name, queryString, filterJson } = req.body || {};
    if (!name || !String(name).trim()) {
      res.status(400).json({ error: 'Saved search name is required' });
      return;
    }
    db.prepare(
      `INSERT INTO saved_searches (name, query_string, filter_json)
       VALUES (?, ?, ?)
       ON CONFLICT(name) DO UPDATE SET
         query_string = excluded.query_string,
         filter_json = excluded.filter_json`
    ).run(String(name).trim(), String(queryString || ''), JSON.stringify(filterJson || {}));
    res.json({ ok: true });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Failed to save search' });
  }
});

/**
 * DELETE /api/organization/saved-searches/:id
 */
systemRouter.delete('/organization/saved-searches/:id', (req, res) => {
  db.prepare('DELETE FROM saved_searches WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

/**
 * GET /api/backups
 */
systemRouter.get('/backups', (_req, res) => {
  const integrity = db.pragma('integrity_check', { simple: true });
  res.json({
    integrityOk: integrity === 'ok',
    backups: listDatabaseBackups(),
  });
});

/**
 * POST /api/backups/create
 */
systemRouter.post('/backups/create', async (req, res) => {
  try {
    const backup = await createDatabaseBackup(req.body?.label || 'manual');
    res.json({ backup });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Backup failed' });
  }
});

/**
 * GET /api/backups/annotations-export
 */
systemRouter.get('/backups/annotations-export', (_req, res) => {
  const payload = exportUserAnnotationsJson();
  res.setHeader('Content-Type', 'application/json');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="couchy-annotations-${new Date().toISOString().slice(0, 10)}.json"`
  );
  res.send(JSON.stringify(payload, null, 2));
});

/**
 * POST /api/backups/annotations-restore
 */
systemRouter.post('/backups/annotations-restore', (req, res) => {
  try {
    const result = restoreUserAnnotationsJson(req.body);
    res.json({ ok: true, ...result });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Failed to restore annotations' });
  }
});

/**
 * GET /api/tagger/status
 * Returns current status of opt-in WD14 ONNX visual keyword tagger.
 */
systemRouter.get('/tagger/status', (_req, res) => {
  res.json(getVisualTaggerStatus());
});

/**
 * PATCH /api/tagger/config
 * Toggles visual keyword tagging on/off, updates confidence threshold, or sets device ('cpu' | 'gpu').
 */
systemRouter.patch('/tagger/config', (req, res) => {
  try {
    const status = updateVisualTaggerConfig(req.body || {});
    res.json(status);
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Failed to update visual tagger settings' });
  }
});

/**
 * POST /api/tagger/control
 * Controls background queue ('pause' | 'resume' | 'scan_unindexed' | 'rescan_all').
 */
systemRouter.post('/tagger/control', (req, res) => {
  try {
    const action = req.body?.action;
    if (!['pause', 'resume', 'scan_unindexed', 'rescan_all'].includes(action)) {
      res.status(400).json({ error: 'Invalid tagger control action' });
      return;
    }
    const status = controlVisualTaggerQueue(action);
    res.json(status);
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Failed to control visual tagger queue' });
  }
});
