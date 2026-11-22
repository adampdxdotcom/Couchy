import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Cpu,
  Info,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { api } from '../../api/client.ts';
import type { GenerationReadinessResponse } from '../../shared/apiTypes.ts';

interface GenerationReadinessCardProps {
  onRefreshAll?: () => Promise<void>;
  onReadinessUpdated?: (readiness: GenerationReadinessResponse) => void;
}

/**
 * Displays First-Run & Generation Readiness checks for ComfyUI, Krea 2 custom/core nodes,
 * default workflow weights (#30_10 UNET, CLIP, VAE, 4x-ESRGAN), and optional Local LLM.
 */
export const GenerationReadinessCard: React.FC<GenerationReadinessCardProps> = ({
  onRefreshAll,
  onReadinessUpdated,
}) => {
  const [readiness, setReadiness] = useState<GenerationReadinessResponse | null>(null);
  const [selectedUnet, setSelectedUnet] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSavingUnet, setIsSavingUnet] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  const loadReadiness = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await api.getGenerationReadiness();
      setReadiness(res);
      setSelectedUnet(res.defaultUnetName || res.availableUnets[0] || '');
      onReadinessUpdated?.(res);
    } catch (err: any) {
      setError(err?.message || 'Failed to check generation readiness.');
    } finally {
      setIsLoading(false);
    }
  }, [onReadinessUpdated]);

  useEffect(() => {
    loadReadiness();
  }, [loadReadiness]);

  const handleSaveDefaultUnet = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = selectedUnet.trim();
    if (!trimmed) return;

    setIsSavingUnet(true);
    setError(null);
    setSavedMsg(null);
    try {
      const updated = await api.setDefaultWorkflowUnet(trimmed);
      setReadiness(updated);
      setSelectedUnet(updated.defaultUnetName);
      onReadinessUpdated?.(updated);
      setSavedMsg(`Default Krea 2 base model set to ${updated.defaultUnetName}.`);
      setTimeout(() => setSavedMsg(null), 3500);
      await onRefreshAll?.();
    } catch (err: any) {
      setError(err?.message || 'Failed to save default base model.');
    } finally {
      setIsSavingUnet(false);
    }
  };

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <ShieldCheck
            className={`w-4 h-4 shrink-0 ${
              readiness?.ready ? 'text-emerald-400' : 'text-amber-400'
            }`}
          />
          <div>
            <h2 className="text-sm font-display font-semibold text-zinc-100">
              Krea 2 Setup &amp; Generation Readiness
            </h2>
            <p className="text-[11px] text-zinc-400">
              Verifies ComfyUI nodes (rgthree-comfy &amp; comfy-core), default workflow weights, and
              gallery folder status.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={loadReadiness}
          disabled={isLoading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-100 text-xs font-medium rounded-lg disabled:opacity-50 cursor-pointer shrink-0"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          <span>Re-check</span>
        </button>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-rose-500/15 border border-rose-500/40 text-rose-200 text-xs">
          {error}
        </div>
      )}

      {savedMsg && (
        <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/40 text-emerald-300 text-xs">
          {savedMsg}
        </div>
      )}

      {readiness && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
          {readiness.checks.map((item) => (
            <div
              key={item.id}
              className="flex items-start gap-2.5 p-3 rounded-lg bg-zinc-950/90 border border-zinc-800/90"
            >
              {item.ok ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              ) : item.optional ? (
                <Info className="w-4 h-4 text-zinc-400 shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              )}
              <div className="min-w-0">
                <div className="text-xs font-medium text-zinc-100">{item.label}</div>
                <div className="text-[11px] text-zinc-400 break-words mt-0.5">{item.detail}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Default Krea 2 UNET quick selector */}
      {readiness && (
        <form
          onSubmit={handleSaveDefaultUnet}
          className="pt-2 border-t border-zinc-800/80 flex flex-col sm:flex-row sm:items-end gap-2.5"
        >
          <div className="flex-1 min-w-0">
            <label className="flex items-center gap-1.5 text-[11px] text-zinc-400 mb-1">
              <Cpu className="w-3.5 h-3.5 text-indigo-400" />
              <span>
                Default Krea 2 Base Model ({readiness.defaultWorkflowName || 'Default Workflow'} ·
                Node #30_10)
              </span>
            </label>

            {readiness.availableUnets.length > 0 ? (
              <select
                value={selectedUnet}
                onChange={(e) => setSelectedUnet(e.target.value)}
                className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-xs font-mono text-zinc-100"
              >
                {!readiness.availableUnets.includes(selectedUnet) && selectedUnet && (
                  <option value={selectedUnet}>{selectedUnet} (not detected)</option>
                )}
                {!selectedUnet && <option value="">Select an installed Krea 2 UNET...</option>}
                {readiness.availableUnets.map((unet) => (
                  <option key={unet} value={unet}>
                    {unet}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={selectedUnet}
                onChange={(e) => setSelectedUnet(e.target.value)}
                placeholder="e.g. flux_krea_dev_fp8.safetensors"
                className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-xs font-mono text-zinc-100"
              />
            )}
          </div>

          <button
            type="submit"
            disabled={isSavingUnet || !selectedUnet.trim()}
            className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-medium rounded-lg cursor-pointer shrink-0"
          >
            {isSavingUnet ? 'Saving...' : 'Save Default Model'}
          </button>
        </form>
      )}
    </div>
  );
};
