import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Cpu,
  Database,
  Download,
  FolderPlus,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Save,
  Server,
  ShieldCheck,
  Tags,
  Trash2,
  Upload,
  XCircle,
} from 'lucide-react';
import { api } from '../api/client.ts';
import { formatMb } from '../shared/utils.ts';
import type {
  LmStudioGuidingTemplate,
  LmStudioStatus,
  VisualTaggerStatus,
} from '../shared/types.ts';

interface SystemAndBackupViewProps {
  healthData: any;
  collections: { id: number; name: string; description: string; imageCount: number }[];
  onRefreshAll: () => Promise<void>;
}

/**
 * ComfyUI Connection Settings, LM Studio Guiding Prompt Templates Manager,
 * Directory Scanner Controls, Collections Manager, and Database Backup & Restore Console.
 */
export const SystemAndBackupView: React.FC<SystemAndBackupViewProps> = ({
  healthData,
  collections,
  onRefreshAll,
}) => {
  const [comfyuiUrl, setComfyuiUrl] = useState(
    healthData?.config?.comfyuiUrl || 'http://comfyui:8188'
  );
  const [outputDir, setOutputDir] = useState(
    healthData?.config?.comfyuiOutputDir || '/data/output'
  );
  const [modelsDir, setModelsDir] = useState(
    healthData?.config?.comfyuiModelsDir || '/data/models'
  );
  const [downloadsDir, setDownloadsDir] = useState(
    healthData?.config?.downloadsDir || '/downloads'
  );
  const [scheduledHours, setScheduledHours] = useState<number>(
    healthData?.config?.scheduledBackupHours || 0
  );
  const [quickGenBoxEnabled, setQuickGenBoxEnabled] = useState<boolean>(
    healthData?.config?.quickGenBoxEnabled !== false
  );

  // Visual Keyword Tagger (WD14 ONNX) State
  const [taggerStatus, setTaggerStatus] = useState<VisualTaggerStatus | null>(
    healthData?.visualTagger || null
  );
  const [isUpdatingTagger, setIsUpdatingTagger] = useState(false);

  useEffect(() => {
    if (healthData?.config?.quickGenBoxEnabled !== undefined) {
      setQuickGenBoxEnabled(healthData.config.quickGenBoxEnabled !== false);
    }
    if (healthData?.visualTagger) {
      setTaggerStatus(healthData.visualTagger);
    }
  }, [healthData?.config?.quickGenBoxEnabled, healthData?.visualTagger]);

  const [connTestResult, setConnTestResult] = useState<any | null>(null);
  const [isTestingConn, setIsTestingConn] = useState(false);

  const [scanHistory, setScanHistory] = useState<any[]>([]);
  const [backups, setBackups] = useState<any[]>([]);
  const [integrityOk, setIntegrityOk] = useState(true);
  const [backupMsg, setBackupMsg] = useState<string | null>(null);

  const [newColName, setNewColName] = useState('');
  const [newColDesc, setNewColDesc] = useState('');

  // LM Studio & Guiding Prompt Templates State
  const [lmStatus, setLmStatus] = useState<LmStudioStatus | null>(null);
  const [lmBaseUrl, setLmBaseUrl] = useState('http://localhost:1234/v1');
  const [lmSelectedModel, setLmSelectedModel] = useState('');
  const [isTestingLm, setIsTestingLm] = useState(false);

  const [guidingTemplates, setGuidingTemplates] = useState<LmStudioGuidingTemplate[]>([]);
  const [selectedGuidingId, setSelectedGuidingId] = useState<number | null>(null);
  const [guidingName, setGuidingName] = useState('');
  const [guidingSystemPrompt, setGuidingSystemPrompt] = useState('');
  const [guidingUserTemplate, setGuidingUserTemplate] = useState('');
  const [guidingIsDefault, setGuidingIsDefault] = useState(false);
  const [guidingFeedback, setGuidingFeedback] = useState<string | null>(null);

  const loadSystemDetails = async () => {
    try {
      const [scansRes, backupsRes, lmRes, taggerRes] = await Promise.all([
        api.getScans(),
        api.getBackups(),
        api.getLmStudioStatus(),
        api.getVisualTaggerStatus(),
      ]);
      setScanHistory(scansRes.history || []);
      setBackups(backupsRes.backups || []);
      setIntegrityOk(backupsRes.integrityOk);
      setTaggerStatus(taggerRes);

      setLmStatus(lmRes);
      setLmBaseUrl(lmRes.baseUrl || 'http://localhost:1234/v1');
      setLmSelectedModel(lmRes.selectedModel || lmRes.availableModels[0] || '');

      const tpls = lmRes.guidingTemplates || [];
      setGuidingTemplates(tpls);
      if (tpls.length > 0 && !selectedGuidingId) {
        const def = tpls.find((t) => t.isDefault) || tpls[0];
        setSelectedGuidingId(def.id);
        setGuidingName(def.name);
        setGuidingSystemPrompt(def.systemPrompt);
        setGuidingUserTemplate(def.userPromptTemplate);
        setGuidingIsDefault(def.isDefault);
      }
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    loadSystemDetails();
  }, []);

  // Poll visual tagger status while model is downloading or background scan is active
  useEffect(() => {
    if (!taggerStatus?.isDownloading && !taggerStatus?.isScanning) return;
    const timer = setInterval(async () => {
      try {
        const nextStatus = await api.getVisualTaggerStatus();
        setTaggerStatus(nextStatus);
        if (!nextStatus.isDownloading && !nextStatus.isScanning) {
          onRefreshAll();
        }
      } catch {
        // ignore
      }
    }, 1500);
    return () => clearInterval(timer);
  }, [taggerStatus?.isDownloading, taggerStatus?.isScanning, onRefreshAll]);

  const handleSelectGuidingTemplate = (id: number) => {
    setSelectedGuidingId(id);
    const found = guidingTemplates.find((t) => t.id === id);
    if (found) {
      setGuidingName(found.name);
      setGuidingSystemPrompt(found.systemPrompt);
      setGuidingUserTemplate(found.userPromptTemplate);
      setGuidingIsDefault(found.isDefault);
    }
  };

  const handleSaveGuidingTemplate = async (asNew = false) => {
    setGuidingFeedback(null);
    try {
      const res = await api.saveLmStudioGuidingTemplate({
        id: asNew ? undefined : selectedGuidingId || undefined,
        name: asNew ? `${guidingName.trim() || 'Guiding Prompt'} (Copy)` : guidingName.trim(),
        systemPrompt: guidingSystemPrompt,
        userPromptTemplate: guidingUserTemplate,
        isDefault: guidingIsDefault,
      });
      setGuidingTemplates(res.items);
      setSelectedGuidingId(res.template.id);
      setGuidingName(res.template.name);
      setGuidingSystemPrompt(res.template.systemPrompt);
      setGuidingUserTemplate(res.template.userPromptTemplate);
      setGuidingIsDefault(res.template.isDefault);
      setGuidingFeedback(
        asNew
          ? `Created new LM Studio Guiding Prompt template "${res.template.name}".`
          : `Saved changes to "${res.template.name}".`
      );
      setTimeout(() => setGuidingFeedback(null), 3500);
    } catch (err: any) {
      setGuidingFeedback(`Error: ${err.message}`);
    }
  };

  const handleDeleteGuidingTemplate = async () => {
    if (!selectedGuidingId || guidingTemplates.length <= 1) return;
    try {
      const res = await api.deleteLmStudioGuidingTemplate(selectedGuidingId);
      setGuidingTemplates(res.items);
      if (res.items.length > 0) {
        const next = res.items[0];
        setSelectedGuidingId(next.id);
        setGuidingName(next.name);
        setGuidingSystemPrompt(next.systemPrompt);
        setGuidingUserTemplate(next.userPromptTemplate);
        setGuidingIsDefault(next.isDefault);
      }
      setGuidingFeedback('Deleted guiding prompt template.');
      setTimeout(() => setGuidingFeedback(null), 3000);
    } catch (err: any) {
      setGuidingFeedback(`Error: ${err.message}`);
    }
  };

  const handleTestLmStudio = async () => {
    setIsTestingLm(true);
    try {
      const res = await api.updateLmStudioConfig({
        baseUrl: lmBaseUrl,
        selectedModel: lmSelectedModel,
      });
      setLmStatus(res);
      if (res.selectedModel) setLmSelectedModel(res.selectedModel);
      setGuidingFeedback(
        res.online
          ? `Connected to LM Studio at ${res.baseUrl} (${res.availableModels.length} model(s) available).`
          : `LM Studio offline at ${res.baseUrl}: ${res.error}`
      );
    } finally {
      setIsTestingLm(false);
    }
  };

  const handleTestComfyUi = async () => {
    setIsTestingConn(true);
    try {
      const res = await api.testComfyUi(comfyuiUrl);
      setConnTestResult(res);
    } finally {
      setIsTestingConn(false);
    }
  };

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    await api.updateConfig({
      comfyuiUrl,
      comfyuiOutputDir: outputDir,
      comfyuiModelsDir: modelsDir,
      downloadsDir,
      scheduledBackupHours: scheduledHours,
      quickGenBoxEnabled,
    });
    await onRefreshAll();
    setBackupMsg('Configuration updated and filesystem watcher rebound.');
    setTimeout(() => setBackupMsg(null), 3000);
  };

  const handleToggleQuickGenBox = async (nextVal: boolean) => {
    setQuickGenBoxEnabled(nextVal);
    await api.updateConfig({ quickGenBoxEnabled: nextVal });
    await onRefreshAll();
    setBackupMsg(
      nextVal
        ? 'Floating Quick Generation Box enabled across all tabs.'
        : 'Floating Quick Generation Box disabled.'
    );
    setTimeout(() => setBackupMsg(null), 3000);
  };

  const handleToggleVisualTagger = async (nextEnabled: boolean) => {
    setIsUpdatingTagger(true);
    try {
      const nextStatus = await api.updateVisualTaggerConfig({ enabled: nextEnabled });
      setTaggerStatus(nextStatus);
      await onRefreshAll();
      setBackupMsg(
        nextEnabled
          ? 'Visual Keyword Tagging enabled. Model download (if needed) and background indexing have started.'
          : 'Visual Keyword Tagging disabled and background scan paused.'
      );
      setTimeout(() => setBackupMsg(null), 4000);
    } catch (err: any) {
      setBackupMsg(`Tagger error: ${err.message}`);
    } finally {
      setIsUpdatingTagger(false);
    }
  };

  const handleTaggerConfigChange = async (payload: {
    threshold?: number;
    device?: 'cpu' | 'gpu';
  }) => {
    setIsUpdatingTagger(true);
    try {
      const nextStatus = await api.updateVisualTaggerConfig(payload);
      setTaggerStatus(nextStatus);
    } catch (err: any) {
      setBackupMsg(`Tagger config error: ${err.message}`);
    } finally {
      setIsUpdatingTagger(false);
    }
  };

  const handleTaggerControl = async (
    action: 'pause' | 'resume' | 'scan_unindexed' | 'rescan_all'
  ) => {
    setIsUpdatingTagger(true);
    try {
      const nextStatus = await api.controlVisualTaggerQueue(action);
      setTaggerStatus(nextStatus);
    } catch (err: any) {
      setBackupMsg(`Tagger queue error: ${err.message}`);
    } finally {
      setIsUpdatingTagger(false);
    }
  };

  const handleCreateBackup = async () => {
    const res = await api.createBackup('manual');
    await loadSystemDetails();
    setBackupMsg(`Created SQLite backup: ${res.backup.filename}`);
    setTimeout(() => setBackupMsg(null), 3500);
  };

  const handleRestoreAnnotationsFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const res = await api.restoreAnnotationsJson(parsed);
      await onRefreshAll();
      setBackupMsg(
        `Restored annotations: ${res.restoredCounts.ratings} ratings, ${res.restoredCounts.characters} characters, ${res.restoredCounts.collections} collections.`
      );
    } catch (err: any) {
      setBackupMsg(`Restore error: ${err.message}`);
    }
  };

  const scanPct =
    taggerStatus && taggerStatus.totalImagesCount > 0
      ? Math.min(
          100,
          Math.round((taggerStatus.scannedCount / taggerStatus.totalImagesCount) * 100)
        )
      : 0;

  return (
    <div className="px-6 py-6 max-w-7xl mx-auto space-y-8 text-xs">
      {backupMsg && (
        <div className="p-3.5 bg-indigo-500/15 border border-indigo-500/40 rounded-xl text-indigo-200">
          {backupMsg}
        </div>
      )}

      {/* Workspace UI Preferences: Floating Quick Generation Box */}
      <section className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-sm font-display font-semibold text-zinc-100">
            Floating Quick Generation Box
          </h2>
          <p className="text-zinc-400">
            Show a floating prompt bar across all tabs with <code className="text-zinc-200">@character</code> mentions, aspect ratio & batch count controls, and LM Studio Agent support.
          </p>
        </div>

        <label className="inline-flex items-center gap-3 cursor-pointer select-none">
          <span className="text-zinc-300 font-medium">
            {quickGenBoxEnabled ? 'Enabled' : 'Disabled'}
          </span>
          <input
            type="checkbox"
            checked={quickGenBoxEnabled}
            onChange={(e) => handleToggleQuickGenBox(e.target.checked)}
            className="sr-only peer"
          />
          <div className="w-10 h-5 bg-zinc-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all relative peer-checked:bg-indigo-600" />
        </label>
      </section>

      {/* Opt-In Visual Keyword Tagging (WD14 ONNX Search Indexer) */}
      <section className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-zinc-800 pb-4">
          <div className="flex items-start gap-2.5 max-w-3xl">
            <Tags className="w-4 h-4 text-indigo-400 mt-0.5 shrink-0" />
            <div className="space-y-1">
              <h2 className="text-sm font-display font-semibold text-zinc-100">
                Visual Keyword Tagging & Search Indexer (WD14 v3 ONNX)
              </h2>
              <p className="text-zinc-400">
                Scans images with a lightweight vision tagger to extract searchable visual keywords (clothing, hair, lighting, setting, composition) even when hidden inside LoRA trigger words.
              </p>
            </div>
          </div>

          <label className="inline-flex items-center gap-3 cursor-pointer select-none shrink-0">
            <span className="text-zinc-300 font-medium">
              {taggerStatus?.enabled ? 'Enabled' : 'Disabled'}
            </span>
            <input
              type="checkbox"
              disabled={isUpdatingTagger}
              checked={Boolean(taggerStatus?.enabled)}
              onChange={(e) => handleToggleVisualTagger(e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-10 h-5 bg-zinc-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all relative peer-checked:bg-indigo-600" />
          </label>
        </div>

        {/* First-time download & large library duration note */}
        <div className="p-3.5 bg-amber-500/10 border border-amber-500/30 rounded-lg flex items-start gap-2.5 text-amber-200/90">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <div className="space-y-1 text-xs leading-relaxed">
            <p className="font-medium text-amber-200">
              On-Demand Model Download & Large Library Indexing Notice
            </p>
            <p className="text-amber-200/80">
              No model is downloaded until you turn this toggle on. When enabled for the first time, the app downloads the ~360 MB ONNX vision tagger into{' '}
              <code className="font-mono text-amber-100">
                {taggerStatus?.localModelsDir || 'data/local_models/wd-vit-tagger-v3'}
              </code>{' '}
              and begins indexing your gallery thumbnails in the background. For large libraries (2,000 to 20,000+ images), the initial scan can take a while—you can continue using the app normally or pause/resume anytime.
            </p>
          </div>
        </div>

        {/* Model Download Progress Bar (when downloading) */}
        {taggerStatus?.isDownloading && (
          <div className="p-3.5 bg-zinc-950 border border-indigo-500/40 rounded-lg space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-indigo-300 font-medium flex items-center gap-2">
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                <span>Downloading WD14 v3 ONNX model to data/local_models...</span>
              </span>
              <span className="font-mono tabular-nums text-zinc-300">
                {formatMb(taggerStatus.downloadedBytes)} / {formatMb(taggerStatus.totalDownloadBytes)} ({taggerStatus.downloadProgressPercent}%)
              </span>
            </div>
            <div className="w-full h-2 bg-zinc-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-indigo-500 transition-all duration-300"
                style={{ width: `${taggerStatus.downloadProgressPercent}%` }}
              />
            </div>
          </div>
        )}

        {taggerStatus?.downloadError && (
          <div className="p-3 bg-rose-950/50 border border-rose-800 rounded-lg text-rose-200">
            Download Error: {taggerStatus.downloadError}
          </div>
        )}

        {/* Controls & Live Indexing Status */}
        {taggerStatus && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-center pt-1">
            {/* Progress & Counts */}
            <div className="lg:col-span-6 bg-zinc-950 border border-zinc-800 rounded-lg p-3.5 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-zinc-300 font-medium">
                  Gallery Indexing Progress{' '}
                  {taggerStatus.isScanning ? (
                    <span className="text-indigo-400 font-mono ml-1">(Scanning...)</span>
                  ) : taggerStatus.isPaused && taggerStatus.pendingCount > 0 ? (
                    <span className="text-amber-400 font-mono ml-1">(Paused)</span>
                  ) : null}
                </span>
                <span className="font-mono tabular-nums text-zinc-200">
                  {taggerStatus.scannedCount.toLocaleString()} /{' '}
                  {taggerStatus.totalImagesCount.toLocaleString()} images ({scanPct}%)
                </span>
              </div>

              <div className="w-full h-2 bg-zinc-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-indigo-500 transition-all duration-300"
                  style={{ width: `${scanPct}%` }}
                />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-zinc-400 font-mono tabular-nums pt-0.5">
                <span>
                  Model: {taggerStatus.modelDownloaded ? 'Ready on disk' : 'Not downloaded yet'}
                </span>
                <span>·</span>
                <span>
                  Extracted Keywords: {taggerStatus.totalVisualTagsCount.toLocaleString()}
                </span>
                <span>·</span>
                <span>Pending: {taggerStatus.pendingCount.toLocaleString()}</span>
              </div>
            </div>

            {/* Threshold, Device & Queue Action Buttons */}
            <div className="lg:col-span-6 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-3 space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-zinc-300 font-medium">Confidence Threshold</label>
                  <span className="font-mono tabular-nums text-indigo-400 font-semibold">
                    {taggerStatus.threshold.toFixed(2)}
                  </span>
                </div>
                <input
                  type="range"
                  min="0.15"
                  max="0.80"
                  step="0.05"
                  value={taggerStatus.threshold}
                  onChange={(e) =>
                    handleTaggerConfigChange({ threshold: parseFloat(e.target.value) })
                  }
                  className="w-full accent-indigo-500 cursor-pointer"
                />
                <p className="text-[11px] text-zinc-500">
                  Lower values add more tags; higher values keep only high-certainty tags.
                </p>
              </div>

              <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-3 space-y-2 flex flex-col justify-between">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-zinc-300 font-medium flex items-center gap-1.5">
                    <Cpu className="w-3.5 h-3.5 text-zinc-400" />
                    <span>Execution Device</span>
                  </span>
                  <select
                    value={taggerStatus.device}
                    onChange={(e) =>
                      handleTaggerConfigChange({
                        device: e.target.value === 'gpu' ? 'gpu' : 'cpu',
                      })
                    }
                    className="px-2 py-1 bg-zinc-900 border border-zinc-700 rounded text-xs font-mono text-zinc-100"
                  >
                    <option value="cpu">CPU (Default)</option>
                    <option value="gpu">GPU (CUDA if passed)</option>
                  </select>
                </div>

                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                  {taggerStatus.isScanning ? (
                    <button
                      type="button"
                      onClick={() => handleTaggerControl('pause')}
                      className="inline-flex items-center gap-1 px-2.5 py-1 bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border border-amber-500/30 rounded-md font-medium cursor-pointer"
                    >
                      <Pause className="w-3 h-3" />
                      <span>Pause</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={!taggerStatus.enabled}
                      onClick={() => handleTaggerControl('scan_unindexed')}
                      className="inline-flex items-center gap-1 px-2.5 py-1 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white rounded-md font-medium cursor-pointer"
                    >
                      <Play className="w-3 h-3" />
                      <span>Scan Pending</span>
                    </button>
                  )}

                  <button
                    type="button"
                    disabled={!taggerStatus.enabled || taggerStatus.isDownloading}
                    onClick={() => handleTaggerControl('rescan_all')}
                    className="inline-flex items-center gap-1 px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-zinc-200 rounded-md font-medium cursor-pointer"
                    title="Re-run visual keyword extraction across all images"
                  >
                    <RefreshCw className="w-3 h-3" />
                    <span>Rescan All</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* LM Studio Agent & Guiding Prompt Templates Manager */}
      <section className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 pb-4">
          <div className="flex items-center gap-2.5">
            <Bot className="w-4 h-4 text-indigo-400" />
            <div>
              <h2 className="text-sm font-display font-semibold text-zinc-100">
                LM Studio Agent & Guiding Prompt Templates (Database)
              </h2>
              <p className="text-zinc-400">
                Configure your local LM Studio endpoint and manage the saved System & User Guiding Prompts used when generating multi-image photo sets on a theme.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-zinc-400 font-mono">
              Status: {lmStatus?.online ? 'Connected' : 'Offline'}
            </span>
            <button
              type="button"
              onClick={handleTestLmStudio}
              disabled={isTestingLm}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-100 font-medium rounded-lg cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isTestingLm ? 'animate-spin' : ''}`} />
              <span>{isTestingLm ? 'Testing...' : 'Save & Test LM Studio'}</span>
            </button>
          </div>
        </div>

        {guidingFeedback && (
          <div className="p-3 bg-indigo-950/50 border border-indigo-800/70 rounded-lg text-indigo-200">
            {guidingFeedback}
          </div>
        )}

        {/* LM Studio Endpoint & Model Row */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-zinc-400 mb-1">
              LM Studio OpenAI-Compatible Endpoint URL
            </label>
            <input
              type="text"
              value={lmBaseUrl}
              onChange={(e) => setLmBaseUrl(e.target.value)}
              placeholder="http://localhost:1234/v1"
              className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg font-mono text-zinc-100"
            />
          </div>

          <div>
            <label className="block text-zinc-400 mb-1">
              Default LM Studio Model
            </label>
            {lmStatus && lmStatus.availableModels.length > 0 ? (
              <select
                value={lmSelectedModel}
                onChange={(e) => setLmSelectedModel(e.target.value)}
                className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-100"
              >
                {lmStatus.availableModels.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={lmSelectedModel}
                onChange={(e) => setLmSelectedModel(e.target.value)}
                placeholder="local-model (auto-detected when LM Studio is running)"
                className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg font-mono text-zinc-100"
              />
            )}
          </div>
        </div>

        {/* Saved Guiding Prompt Templates Editor */}
        <div className="pt-3 border-t border-zinc-800/80 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
            <div className="md:col-span-5">
              <label className="block text-zinc-400 mb-1">
                Select Saved Guiding Prompt Template ({guidingTemplates.length})
              </label>
              <select
                value={selectedGuidingId ?? ''}
                onChange={(e) => handleSelectGuidingTemplate(Number(e.target.value))}
                className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-100"
              >
                {guidingTemplates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} {t.isDefault ? '(Default)' : ''}
                  </option>
                ))}
              </select>
            </div>

            <div className="md:col-span-4">
              <label className="block text-zinc-400 mb-1">Template Name</label>
              <input
                type="text"
                value={guidingName}
                onChange={(e) => setGuidingName(e.target.value)}
                className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-100"
              />
            </div>

            <div className="md:col-span-3 flex items-center gap-2 pb-1">
              <label className="inline-flex items-center gap-2 text-zinc-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={guidingIsDefault}
                  onChange={(e) => setGuidingIsDefault(e.target.checked)}
                  className="rounded border-zinc-700 text-indigo-600 focus:ring-indigo-500"
                />
                <span>Default Guiding Template</span>
              </label>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="font-medium text-zinc-200">
                  System Prompt (Guides how the LLM scripts the photo set)
                </label>
                <span className="text-[11px] text-zinc-400 font-mono">role: &quot;system&quot;</span>
              </div>
              <textarea
                rows={7}
                value={guidingSystemPrompt}
                onChange={(e) => setGuidingSystemPrompt(e.target.value)}
                className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-100 font-mono text-xs focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="font-medium text-zinc-200">
                  User Payload Template (Variables: {'{character}'}, {'{lora}'}, {'{theme}'}, {'{count}'}, {'{base_prompt}'})
                </label>
                <span className="text-[11px] text-zinc-400 font-mono">role: &quot;user&quot;</span>
              </div>
              <textarea
                rows={7}
                value={guidingUserTemplate}
                onChange={(e) => setGuidingUserTemplate(e.target.value)}
                className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-100 font-mono text-xs focus:outline-none focus:border-indigo-500"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <p className="text-[11px] text-zinc-400">
              Placeholders <code className="text-zinc-200">{'{character}'}</code>,{' '}
              <code className="text-zinc-200">{'{lora}'}</code>,{' '}
              <code className="text-zinc-200">{'{theme}'}</code>,{' '}
              <code className="text-zinc-200">{'{count}'}</code>, and{' '}
              <code className="text-zinc-200">{'{base_prompt}'}</code> are automatically replaced when you generate a themed set in the Generation tab.
            </p>

            <div className="flex items-center gap-2">
              {guidingTemplates.length > 1 && (
                <button
                  type="button"
                  onClick={handleDeleteGuidingTemplate}
                  className="inline-flex items-center gap-1.5 px-3 py-2 bg-zinc-950 hover:bg-red-950/50 text-zinc-400 hover:text-red-300 border border-zinc-800 rounded-lg cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Delete</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => handleSaveGuidingTemplate(true)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-100 font-medium rounded-lg cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Save as New Template</span>
              </button>
              <button
                type="button"
                onClick={() => handleSaveGuidingTemplate(false)}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-medium rounded-lg cursor-pointer"
              >
                <Save className="w-3.5 h-3.5" />
                <span>Save Guiding Template</span>
              </button>
            </div>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* ComfyUI Connection & Volume Mount Configuration */}
        <form
          onSubmit={handleSaveConfig}
          className="lg:col-span-6 bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-4"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Server className="w-4 h-4 text-indigo-400" />
              <h2 className="text-sm font-display font-semibold text-zinc-100">
                ComfyUI Connection & Mounted Paths
              </h2>
            </div>
            <button
              type="button"
              onClick={handleTestComfyUi}
              disabled={isTestingConn}
              className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-100 font-medium rounded-lg cursor-pointer"
            >
              {isTestingConn ? 'Testing...' : 'Test ComfyUI Connection'}
            </button>
          </div>

          {connTestResult && (
            <div
              className={`p-3 rounded-lg border flex items-center justify-between ${
                connTestResult.online
                  ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-300'
                  : 'bg-amber-500/10 border-amber-500/40 text-amber-300'
              }`}
            >
              <div className="flex items-center gap-2">
                {connTestResult.online ? (
                  <CheckCircle2 className="w-4 h-4" />
                ) : (
                  <XCircle className="w-4 h-4" />
                )}
                <span>
                  {connTestResult.online
                    ? `Connected to ComfyUI at ${connTestResult.baseUrl}`
                    : `Offline (${connTestResult.error}) — Library operates independently offline`}
                </span>
              </div>
            </div>
          )}

          <div>
            <label className="block text-zinc-400 mb-1">
              ComfyUI Base URL (COMFYUI_URL — LAN or Docker host)
            </label>
            <input
              type="text"
              value={comfyuiUrl}
              onChange={(e) => setComfyuiUrl(e.target.value)}
              className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg font-mono text-zinc-100"
            />
          </div>

          <div>
            <label className="block text-zinc-400 mb-1">
              Mounted Read-Only Output Directory (COMFYUI_OUTPUT_DIR)
            </label>
            <input
              type="text"
              value={outputDir}
              onChange={(e) => setOutputDir(e.target.value)}
              className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg font-mono text-zinc-100"
            />
          </div>

          <div>
            <label className="block text-zinc-400 mb-1">
              Mounted Read-Only Models Directory (COMFYUI_MODELS_DIR)
            </label>
            <input
              type="text"
              value={modelsDir}
              onChange={(e) => setModelsDir(e.target.value)}
              className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg font-mono text-zinc-100"
            />
          </div>

          <div>
            <label className="block text-zinc-400 mb-1">
              Writable Model Downloads Directory (DOWNLOADS_DIR)
            </label>
            <input
              type="text"
              value={downloadsDir}
              onChange={(e) => setDownloadsDir(e.target.value)}
              className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg font-mono text-zinc-100"
            />
          </div>

          <div>
            <label className="block text-zinc-400 mb-1">
              Scheduled Automatic Database Backup Interval
            </label>
            <select
              value={scheduledHours}
              onChange={(e) => setScheduledHours(Number(e.target.value))}
              className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-100"
            >
              <option value={0}>Manual Backups Only</option>
              <option value={6}>Every 6 Hours</option>
              <option value={12}>Every 12 Hours</option>
              <option value={24}>Every 24 Hours</option>
            </select>
          </div>

          <div className="flex justify-end pt-1">
            <button
              type="submit"
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-medium rounded-lg cursor-pointer"
            >
              Save Configuration
            </button>
          </div>
        </form>

        {/* Database Backup, Restore & Annotation Preservation */}
        <div className="lg:col-span-6 bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Database className="w-4 h-4 text-indigo-400" />
              <h2 className="text-sm font-display font-semibold text-zinc-100">
                Database Backup, Restore & Annotation Export
              </h2>
            </div>
            <span className="inline-flex items-center gap-1 text-emerald-400 font-mono">
              <ShieldCheck className="w-4 h-4" />
              <span>SQLite Integrity: {integrityOk ? 'Verified OK' : 'Warning'}</span>
            </span>
          </div>

          <p className="text-zinc-400 leading-relaxed">
            User annotations (ratings, favorites, tags, collections, character profiles, aliases, and
            saved workflows) are keyed by SHA-256 content hashes and stored independently of
            machine-extracted metadata. You can rebuild machine metadata at any time without losing user
            organization.
          </p>

          <div className="flex flex-wrap items-center gap-2.5 pt-1">
            <button
              type="button"
              onClick={handleCreateBackup}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-medium rounded-lg cursor-pointer"
            >
              <Database className="w-3.5 h-3.5" />
              <span>Create SQLite Backup Now</span>
            </button>

            <a
              href="/api/backups/annotations-export"
              className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-100 font-medium rounded-lg"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export Annotations (.JSON)</span>
            </a>

            <label className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-100 font-medium rounded-lg cursor-pointer">
              <Upload className="w-3.5 h-3.5" />
              <span>Restore Annotations (.JSON)</span>
              <input
                type="file"
                accept=".json"
                onChange={handleRestoreAnnotationsFile}
                className="hidden"
              />
            </label>
          </div>

          {/* Existing Backups List */}
          <div className="space-y-2 pt-2">
            <span className="font-medium text-zinc-300 block">
              Stored Database Snapshots ({backups.length})
            </span>
            {backups.length === 0 ? (
              <p className="text-zinc-500">No snapshots created yet.</p>
            ) : (
              <div className="max-h-48 overflow-y-auto space-y-1.5">
                {backups.map((b) => (
                  <div
                    key={b.filename}
                    className="flex items-center justify-between bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 font-mono"
                  >
                    <span className="text-zinc-200 truncate">{b.filename}</span>
                    <span className="text-zinc-400 shrink-0">
                      {(b.sizeBytes / 1024).toFixed(1)} KB · {b.createdAt.slice(0, 19)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Virtual Collections Manager & Scanner Reconciliation History */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-5 bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-4">
          <div className="flex items-center gap-2">
            <FolderPlus className="w-4 h-4 text-indigo-400" />
            <h2 className="text-sm font-display font-semibold text-zinc-100">
              Virtual Collections ({collections.length})
            </h2>
          </div>

          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!newColName.trim()) return;
              await api.createCollection(newColName.trim(), newColDesc.trim());
              setNewColName('');
              setNewColDesc('');
              await onRefreshAll();
            }}
            className="flex items-center gap-2"
          >
            <input
              type="text"
              value={newColName}
              onChange={(e) => setNewColName(e.target.value)}
              placeholder="New collection name..."
              className="flex-1 px-3 py-1.5 bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-100"
            />
            <button
              type="submit"
              className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white font-medium rounded-lg cursor-pointer"
            >
              Create
            </button>
          </form>

          <div className="space-y-1.5 max-h-56 overflow-y-auto">
            {collections.map((col) => (
              <div
                key={col.id}
                className="flex items-center justify-between bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2"
              >
                <div>
                  <span className="font-medium text-zinc-200">{col.name}</span>
                  <span className="text-zinc-500 font-mono ml-2">({col.imageCount} images)</span>
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    await api.deleteCollection(col.id);
                    await onRefreshAll();
                  }}
                  className="text-zinc-500 hover:text-rose-400 cursor-pointer"
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Scanner & Metadata Rebuild Jobs */}
        <div className="lg:col-span-7 bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-display font-semibold text-zinc-100">
                Filesystem Scanner & Machine Metadata Rebuild
              </h2>
              <p className="text-zinc-400">
                Incremental scans run automatically. Rebuilding metadata re-parses all embedded PNG
                workflows while preserving ratings, tags, collections, and characters.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={async () => {
                  await api.triggerScan('incremental');
                  await loadSystemDetails();
                  await onRefreshAll();
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-100 rounded-lg cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Incremental Scan</span>
              </button>
              <button
                type="button"
                onClick={async () => {
                  await api.triggerScan('rebuild_metadata');
                  await loadSystemDetails();
                  await onRefreshAll();
                }}
                className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white font-medium rounded-lg cursor-pointer"
              >
                Rebuild Machine Metadata
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left font-mono tabular-nums">
              <thead className="border-b border-zinc-800 text-zinc-400">
                <tr>
                  <th className="py-2 px-2.5">Scan ID</th>
                  <th className="py-2 px-2.5">Type</th>
                  <th className="py-2 px-2.5">Status</th>
                  <th className="py-2 px-2.5 text-right">Files</th>
                  <th className="py-2 px-2.5 text-right">+Added / ~Mod / -Del</th>
                  <th className="py-2 px-2.5">Started At</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60">
                {scanHistory.map((s) => (
                  <tr key={s.id}>
                    <td className="py-2 px-2.5 text-zinc-300">#{s.id}</td>
                    <td className="py-2 px-2.5 text-zinc-200">{s.scan_type}</td>
                    <td className="py-2 px-2.5 text-emerald-400">{s.status}</td>
                    <td className="py-2 px-2.5 text-right">
                      {s.processed_files}/{s.total_files}
                    </td>
                    <td className="py-2 px-2.5 text-right text-zinc-300">
                      +{s.added_count} / ~{s.modified_count} / -{s.deleted_count}
                    </td>
                    <td className="py-2 px-2.5 text-zinc-400">{s.started_at}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};
