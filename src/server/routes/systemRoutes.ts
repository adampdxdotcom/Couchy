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
import {
  getModelCleanupSettings,
  getModelCleanupStatus,
  scanAndCleanCopiedDownloads,
  updateModelCleanupSettings,
} from '../services/modelCleanupService.ts';
import {
  askReadmeHelpAssistant,
  getHelpDocsPayload,
} from '../services/helpDocsService.ts';
import { getGenerationStats } from '../services/statsService.ts';
import { getStorageUsageStats } from '../services/storageStatsService.ts';
import {
  getBoolSetting,
  getJsonSetting,
  getSettingsMap,
  setSettings,
} from '../services/settingsService.ts';
import { normalizePillTypeSettings } from '../../shared/pillSettings.ts';
import type { ComfyUiInstanceRecord, UpdateConfigPayload } from '../../shared/apiTypes.ts';
import { getErrorMessage } from '../utils/httpError.ts';

interface SavedSearchDbRow {
  id: number;
  name: string;
  query_string: string;
  filter_json: string | null;
  created_at: string;
}

export const systemRouter = Router();

/**
 * GET /api/health
 * Health check and high-level system statistics.
 */
systemRouter.get('/health', (_req, res) => {
  const imgCount = (
    db
      .prepare(
        'SELECT COUNT(*) AS c FROM images WHERE is_missing = 0 AND COALESCE(is_uploaded_reference, 0) = 0'
      )
      .get() as { c: number }
  ).c;
  const charCount = (db.prepare('SELECT COUNT(*) AS c FROM characters').get() as { c: number }).c;
  const loraCount = (
    db.prepare("SELECT COUNT(*) AS c FROM models WHERE model_type = 'lora'").get() as { c: number }
  ).c;
  const wfCount = (db.prepare('SELECT COUNT(*) AS c FROM workflows').get() as { c: number }).c;
  const comfyRow = db
    .prepare('SELECT * FROM comfyui_instances WHERE is_default = 1')
    .get() as ComfyUiInstanceRecord | undefined;
  const settingsMap = getSettingsMap([
    'quick_gen_box_enabled',
    'save_uploaded_prompt_images',
    'save_civitai_import_images',
    'gallery_pill_colors_enabled',
    'pill_type_settings_json',
  ]);
  const quickGenBoxEnabled = getBoolSetting('quick_gen_box_enabled', true, settingsMap);
  const saveUploadedPromptImages = getBoolSetting(
    'save_uploaded_prompt_images',
    false,
    settingsMap
  );
  const saveCivitaiImportImages = getBoolSetting('save_civitai_import_images', true, settingsMap);
  const galleryPillColorsEnabled = getBoolSetting(
    'gallery_pill_colors_enabled',
    false,
    settingsMap
  );
  const pillTypeSettings = normalizePillTypeSettings(
    getJsonSetting<unknown>('pill_type_settings_json', null, settingsMap)
  );

  const cleanupSettings = getModelCleanupSettings();

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
      uploadedImagesDir: appConfig.uploadedImagesDir,
      hasCivitaiKey: Boolean(appConfig.civitaiApiKey),
      hasHfToken: Boolean(appConfig.hfApiToken),
      scheduledBackupHours: appConfig.scheduledBackupHours,
      quickGenBoxEnabled,
      saveUploadedPromptImages,
      saveCivitaiImportImages,
      galleryPillColorsEnabled,
      pillTypeSettings,
      autoCleanCopiedModels: cleanupSettings.enabled,
      autoCleanCopiedModelsHours: cleanupSettings.retentionHours,
    },
    comfyuiInstance: comfyRow || null,
    activeScan: getActiveScanStatus(),
    visualTagger: getVisualTaggerStatus(),
    modelCleanup: getModelCleanupStatus(),
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
      saveUploadedPromptImages,
      saveCivitaiImportImages,
      galleryPillColorsEnabled,
      pillTypeSettings,
    } = (req.body || {}) as UpdateConfigPayload;

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
    const settingUpdates: [string, string][] = [];
    if (quickGenBoxEnabled !== undefined) {
      settingUpdates.push(['quick_gen_box_enabled', quickGenBoxEnabled ? '1' : '0']);
    }
    if (saveUploadedPromptImages !== undefined) {
      settingUpdates.push(['save_uploaded_prompt_images', saveUploadedPromptImages ? '1' : '0']);
    }
    if (saveCivitaiImportImages !== undefined) {
      settingUpdates.push(['save_civitai_import_images', saveCivitaiImportImages ? '1' : '0']);
    }
    if (galleryPillColorsEnabled !== undefined) {
      settingUpdates.push(['gallery_pill_colors_enabled', galleryPillColorsEnabled ? '1' : '0']);
    }
    if (pillTypeSettings !== undefined) {
      const normalized = normalizePillTypeSettings(pillTypeSettings);
      settingUpdates.push(['pill_type_settings_json', JSON.stringify(normalized)]);
    }
    setSettings(settingUpdates);

    res.json({ ok: true, config: appConfig });
  } catch (err: unknown) {
    res.status(400).json({ error: getErrorMessage(err, 'Failed to update configuration') });
  }
});

/**
 * POST /api/scans/trigger
 * Triggers a directory scan ('incremental', 'full', 'reconcile', or 'rebuild_metadata').
 */
systemRouter.post('/scans/trigger', async (req, res) => {
  try {
    const scanType = (req.body?.scanType || 'incremental') as
      | 'incremental'
      | 'full'
      | 'reconcile'
      | 'rebuild_metadata';
    const jobId = await runDirectoryScan(scanType);
    res.json({ jobId, scan: getActiveScanStatus() });
  } catch (err: unknown) {
    res.status(500).json({ error: getErrorMessage(err, 'Failed to start scan') });
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

  const savedSearches = (
    db.prepare('SELECT * FROM saved_searches ORDER BY created_at DESC').all() as SavedSearchDbRow[]
  ).map((s) => ({
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
    const { name, description } = (req.body || {}) as { name?: unknown; description?: unknown };
    if (!name || !String(name).trim()) {
      res.status(400).json({ error: 'Collection name is required' });
      return;
    }
    const info = db
      .prepare('INSERT INTO collections (name, description) VALUES (?, ?)')
      .run(String(name).trim(), String(description || ''));
    res.json({ id: Number(info.lastInsertRowid), name: String(name).trim() });
  } catch (err: unknown) {
    res.status(400).json({ error: getErrorMessage(err, 'Failed to create collection') });
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
    const { name, color } = (req.body || {}) as { name?: unknown; color?: unknown };
    if (!name || !String(name).trim()) {
      res.status(400).json({ error: 'Tag name is required' });
      return;
    }
    const info = db
      .prepare('INSERT INTO tags (name, color) VALUES (?, ?)')
      .run(String(name).trim(), typeof color === 'string' && color ? color : '#6366f1');
    res.json({ id: Number(info.lastInsertRowid), name: String(name).trim() });
  } catch (err: unknown) {
    res.status(400).json({ error: getErrorMessage(err, 'Failed to create tag') });
  }
});

/**
 * POST /api/organization/saved-searches
 */
systemRouter.post('/organization/saved-searches', (req, res) => {
  try {
    const { name, queryString, filterJson } = (req.body || {}) as {
      name?: unknown;
      queryString?: unknown;
      filterJson?: unknown;
    };
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
  } catch (err: unknown) {
    res.status(400).json({ error: getErrorMessage(err, 'Failed to save search') });
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
    const label = typeof req.body?.label === 'string' && req.body.label ? req.body.label : 'manual';
    const backup = await createDatabaseBackup(label);
    res.json({ backup });
  } catch (err: unknown) {
    res.status(500).json({ error: getErrorMessage(err, 'Backup failed') });
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
  } catch (err: unknown) {
    res.status(400).json({ error: getErrorMessage(err, 'Failed to restore annotations') });
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
  } catch (err: unknown) {
    res.status(400).json({ error: getErrorMessage(err, 'Failed to update visual tagger settings') });
  }
});

/**
 * POST /api/tagger/control
 * Controls background queue ('pause' | 'resume' | 'scan_unindexed' | 'rescan_all').
 */
systemRouter.post('/tagger/control', (req, res) => {
  try {
    const action = req.body?.action;
    if (
      action !== 'pause' &&
      action !== 'resume' &&
      action !== 'scan_unindexed' &&
      action !== 'rescan_all'
    ) {
      res.status(400).json({ error: 'Invalid tagger control action' });
      return;
    }
    const status = controlVisualTaggerQueue(action);
    res.json(status);
  } catch (err: unknown) {
    res.status(400).json({ error: getErrorMessage(err, 'Failed to control visual tagger queue') });
  }
});

/**
 * GET /api/models/cleanup
 * Returns Auto-Clean Copied Downloads settings and verified duplicate candidates.
 */
systemRouter.get('/models/cleanup', (_req, res) => {
  res.json(getModelCleanupStatus());
});

/**
 * PATCH /api/models/cleanup
 * Updates Auto-Clean Copied Downloads toggle and retention hours.
 */
systemRouter.patch('/models/cleanup', (req, res) => {
  try {
    const { enabled, retentionHours } = (req.body || {}) as {
      enabled?: unknown;
      retentionHours?: unknown;
    };
    updateModelCleanupSettings({
      enabled: enabled !== undefined ? Boolean(enabled) : undefined,
      retentionHours: retentionHours !== undefined ? Number(retentionHours) : undefined,
    });
    if (enabled === true) {
      setImmediate(() => {
        scanAndCleanCopiedDownloads().catch(() => {});
      });
    }
    res.json(getModelCleanupStatus());
  } catch (err: unknown) {
    res.status(400).json({ error: getErrorMessage(err, 'Failed to update model cleanup settings') });
  }
});

/**
 * POST /api/models/cleanup/run
 * Runs a duplicate verification scan against COMFYUI_MODELS_DIR and optionally cleans due or all verified copies.
 */
systemRouter.post('/models/cleanup/run', async (req, res) => {
  try {
    const action = req.body?.action || 'scan';
    if (action !== 'scan' && action !== 'clean_due' && action !== 'clean_all') {
      res.status(400).json({ error: 'Invalid cleanup action' });
      return;
    }
    const result = await scanAndCleanCopiedDownloads({
      deleteEligible: action !== 'scan',
      forceImmediate: action === 'clean_all',
    });
    res.json(result);
  } catch (err: unknown) {
    res.status(500).json({ error: getErrorMessage(err, 'Model cleanup scan failed') });
  }
});

/**
 * GET /api/help/readme
 * Returns live README.md markdown and parsed section outline.
 */
systemRouter.get('/help/readme', (_req, res) => {
  try {
    res.json(getHelpDocsPayload());
  } catch (err: unknown) {
    res.status(500).json({ error: getErrorMessage(err, 'Failed to load README.md') });
  }
});

/**
 * POST /api/help/ask
 * Answers user questions grounded in retrieved README.md sections via the Local LLM.
 */
systemRouter.post('/help/ask', async (req, res) => {
  try {
    const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];
    const result = await askReadmeHelpAssistant({ messages });
    res.json(result);
  } catch (err: unknown) {
    res.status(500).json({ error: getErrorMessage(err, 'Help Assistant request failed') });
  }
});

/**
 * GET /api/stats/generations
 * Returns bucketed generation counts (including rejected & archived images)
 * for a calendar day, week, month, or year.
 */
systemRouter.get('/stats/generations', (req, res) => {
  try {
    const period = typeof req.query.period === 'string' ? req.query.period : undefined;
    const granularity =
      typeof req.query.granularity === 'string' ? req.query.granularity : undefined;
    const anchorDate =
      typeof req.query.anchorDate === 'string' ? req.query.anchorDate : undefined;
    const tzOffsetRaw =
      typeof req.query.tzOffsetMinutes === 'string' ? Number(req.query.tzOffsetMinutes) : 0;

    const result = getGenerationStats({
      period,
      granularity,
      anchorDate,
      tzOffsetMinutes: Number.isFinite(tzOffsetRaw) ? tzOffsetRaw : 0,
    });
    res.json(result);
  } catch (err: unknown) {
    res.status(500).json({ error: getErrorMessage(err, 'Failed to compute generation stats') });
  }
});

/**
 * GET /api/stats/storage
 * Returns ComfyUI cached model/photo usage alongside local uploaded, thumbnail, and cleanup queue usage.
 */
systemRouter.get('/stats/storage', async (_req, res) => {
  try {
    const result = await getStorageUsageStats();
    res.json(result);
  } catch (err: unknown) {
    res.status(500).json({ error: getErrorMessage(err, 'Failed to compute storage usage stats') });
  }
});
