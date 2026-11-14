import React from 'react';
import { CheckCircle2, ExternalLink, ShieldCheck } from 'lucide-react';
import { formatBytes } from '../../shared/utils.ts';
import type { ModelInventoryItem } from '../../shared/types.ts';

interface ModelInventoryTabProps {
  models: ModelInventoryItem[];
  missingModels: ModelInventoryItem[];
  fetchingModelId: number | null;
  impactReport: any | null;
  onLocateMissing: (query: string) => void;
  onFetchFromCivitai: (modelId: number) => void;
  onLoadImpact: (filename: string) => void;
}

/**
 * Displays missing workflow model dependencies and the full installed model inventory
 * with Civitai metadata enrichment, link resolution, and usage impact inspection.
 */
export const ModelInventoryTab: React.FC<ModelInventoryTabProps> = ({
  models,
  missingModels,
  fetchingModelId,
  impactReport,
  onLocateMissing,
  onFetchFromCivitai,
  onLoadImpact,
}) => {
  return (
    <div className="space-y-6">
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-display font-semibold text-zinc-100">
              Missing Model Dependencies ({missingModels.length})
            </h3>
            <p className="text-xs text-zinc-400">
              Models referenced by indexed workflows that are not currently installed in your ComfyUI
              model inventory.
            </p>
          </div>
        </div>

        {missingModels.length === 0 ? (
          <div className="flex items-center gap-2 text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-4 py-3">
            <CheckCircle2 className="w-4 h-4" />
            <span>All model dependencies referenced by your indexed library are available.</span>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-zinc-800 text-zinc-400">
                <tr>
                  <th className="py-2.5 px-3">Model Filename</th>
                  <th className="py-2.5 px-3">Type</th>
                  <th className="py-2.5 px-3">Historical Hash</th>
                  <th className="py-2.5 px-3 text-right">Dependent Images</th>
                  <th className="py-2.5 px-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60">
                {missingModels.map((m) => (
                  <tr key={m.id}>
                    <td className="py-2.5 px-3 font-mono text-zinc-200">{m.filename}</td>
                    <td className="py-2.5 px-3 capitalize text-zinc-400">{m.modelType}</td>
                    <td className="py-2.5 px-3 font-mono text-zinc-400">
                      {m.sha256Hash || m.autov2Hash || 'Unrecorded'}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-amber-400">
                      {m.dependentImageCount}
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      <button
                        type="button"
                        onClick={() => onLocateMissing(m.sha256Hash || m.autov2Hash || m.name)}
                        className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded cursor-pointer"
                      >
                        Locate &amp; Download
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-4">
        <h3 className="text-sm font-display font-semibold text-zinc-100">
          Complete Model Inventory ({models.length})
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-zinc-800 text-zinc-400">
              <tr>
                <th className="py-2.5 px-3">Filename</th>
                <th className="py-2.5 px-3">Type</th>
                <th className="py-2.5 px-3">Base Model</th>
                <th className="py-2.5 px-3">Verification / Hash</th>
                <th className="py-2.5 px-3 text-right">Size</th>
                <th className="py-2.5 px-3 text-right">Used In</th>
                <th className="py-2.5 px-3 text-right">Civitai &amp; Impact</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60">
              {models.map((m) => (
                <tr key={m.id}>
                  <td className="py-2.5 px-3 font-mono text-zinc-200">{m.filename}</td>
                  <td className="py-2.5 px-3 capitalize text-zinc-300">{m.modelType}</td>
                  <td className="py-2.5 px-3 font-mono text-[11px] text-indigo-300">
                    {m.baseModel || '—'}
                  </td>
                  <td className="py-2.5 px-3 font-mono">
                    {m.sha256Hash ? (
                      <span className="inline-flex items-center gap-1 text-emerald-400">
                        <ShieldCheck className="w-3.5 h-3.5" />
                        <span>{m.autov2Hash || m.sha256Hash.slice(0, 10)}</span>
                      </span>
                    ) : m.isInstalled ? (
                      <span className="text-sky-400">Installed (Unverified Hash)</span>
                    ) : (
                      <span className="text-amber-400">Missing</span>
                    )}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono tabular-nums text-zinc-400">
                    {formatBytes(m.fileSize)}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono tabular-nums text-zinc-200">
                    {m.dependentImageCount} imgs · {m.dependentWorkflowCount} wfs
                  </td>
                  <td className="py-2.5 px-3 text-right">
                    <div className="inline-flex items-center gap-2.5">
                      {m.civitaiUrl && (
                        <a
                          href={m.civitaiUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-indigo-300 hover:text-indigo-200"
                          title={
                            m.civitaiUrl.includes('civitai.red')
                              ? 'Open on Civitai.red'
                              : 'Open on Civitai.com'
                          }
                        >
                          <ExternalLink className="w-3 h-3" />
                          <span>{m.civitaiUrl.includes('civitai.red') ? 'Civitai.red' : 'Page'}</span>
                        </a>
                      )}
                      {(m.isInstalled || m.sha256Hash || m.civitaiId) && (
                        <button
                          type="button"
                          disabled={fetchingModelId === m.id}
                          onClick={() => onFetchFromCivitai(m.id)}
                          className="text-zinc-300 hover:text-white disabled:opacity-50 cursor-pointer"
                        >
                          {fetchingModelId === m.id ? 'Fetching...' : 'Fetch Civitai'}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => onLoadImpact(m.filename)}
                        className="text-indigo-400 hover:text-indigo-300 cursor-pointer"
                      >
                        Impact
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {impactReport && (
          <div className="p-4 bg-zinc-950 border border-indigo-500/40 rounded-lg text-xs space-y-1">
            <div className="font-semibold text-zinc-100">
              Impact Report for {impactReport.modelName}
            </div>
            <div className="text-zinc-400">
              Dependent Images: {impactReport.dependentImageCount} · Dependent Workflows:{' '}
              {impactReport.dependentWorkflowCount} · Linked Characters:{' '}
              {impactReport.characters.length}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
