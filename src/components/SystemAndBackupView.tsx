import React, { useEffect, useState } from 'react';
import {
  Server,
  Database,
  RefreshCw,
  Download,
  Upload,
  FolderPlus,
  CheckCircle2,
  XCircle,
  ShieldCheck,
} from 'lucide-react';
import { api } from '../api/client.ts';

interface SystemAndBackupViewProps {
  healthData: any;
  collections: { id: number; name: string; description: string; imageCount: number }[];
  onRefreshAll: () => Promise<void>;
}

/**
 * ComfyUI Connection Settings, Directory Scanner Controls, Collections Manager,
 * and Database Backup & Restore Console.
 */
export const SystemAndBackupView: React.FC<SystemAndBackupViewProps> = ({
  healthData,
  collections,
  onRefreshAll,
}) => {
  const [comfyuiUrl, setComfyuiUrl] = useState(healthData?.config?.comfyuiUrl || 'http://comfyui:8188');
  const [outputDir, setOutputDir] = useState(healthData?.config?.comfyuiOutputDir || '/data/output');
  const [modelsDir, setModelsDir] = useState(healthData?.config?.comfyuiModelsDir || '/data/models');
  const [downloadsDir, setDownloadsDir] = useState(healthData?.config?.downloadsDir || '/downloads');
  const [scheduledHours, setScheduledHours] = useState<number>(
    healthData?.config?.scheduledBackupHours || 0
  );

  const [connTestResult, setConnTestResult] = useState<any | null>(null);
  const [isTestingConn, setIsTestingConn] = useState(false);

  const [scanHistory, setScanHistory] = useState<any[]>([]);
  const [backups, setBackups] = useState<any[]>([]);
  const [integrityOk, setIntegrityOk] = useState(true);
  const [backupMsg, setBackupMsg] = useState<string | null>(null);

  const [newColName, setNewColName] = useState('');
  const [newColDesc, setNewColDesc] = useState('');

  const loadSystemDetails = async () => {
    try {
      const [scansRes, backupsRes] = await Promise.all([api.getScans(), api.getBackups()]);
      setScanHistory(scansRes.history || []);
      setBackups(backupsRes.backups || []);
      setIntegrityOk(backupsRes.integrityOk);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    loadSystemDetails();
  }, []);

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
    });
    await onRefreshAll();
    setBackupMsg('Configuration updated and filesystem watcher rebound.');
    setTimeout(() => setBackupMsg(null), 3000);
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

  return (
    <div className="px-6 py-6 max-w-7xl mx-auto space-y-8 text-xs">
      {backupMsg && (
        <div className="p-3.5 bg-indigo-500/15 border border-indigo-500/40 rounded-xl text-indigo-200">
          {backupMsg}
        </div>
      )}

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
