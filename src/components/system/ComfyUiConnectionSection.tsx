import React from 'react';
import {
  CheckCircle2,
  Server,
  XCircle,
} from 'lucide-react';

interface ComfyUiConnectionSectionProps {
  comfyuiUrl: string;
  setComfyuiUrl: (val: string) => void;
  outputDir: string;
  setOutputDir: (val: string) => void;
  modelsDir: string;
  setModelsDir: (val: string) => void;
  downloadsDir: string;
  setDownloadsDir: (val: string) => void;
  scheduledHours: number;
  setScheduledHours: (val: number) => void;
  connTestResult: any | null;
  isTestingConn: boolean;
  onTestComfyUi: () => Promise<void>;
  onSaveConfig: (e: React.FormEvent) => Promise<void>;
}

export const ComfyUiConnectionSection: React.FC<ComfyUiConnectionSectionProps> = ({
  comfyuiUrl,
  setComfyuiUrl,
  outputDir,
  setOutputDir,
  modelsDir,
  setModelsDir,
  downloadsDir,
  setDownloadsDir,
  scheduledHours,
  setScheduledHours,
  connTestResult,
  isTestingConn,
  onTestComfyUi,
  onSaveConfig,
}) => {
  return (
    <form
      onSubmit={onSaveConfig}
      className="lg:col-span-6 bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-4"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Server className="w-4 h-4 text-indigo-400" />
          <h2 className="text-sm font-display font-semibold text-zinc-100">
            ComfyUI Connection &amp; Mounted Paths
          </h2>
        </div>
        <button
          type="button"
          onClick={onTestComfyUi}
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
  );
};
