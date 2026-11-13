import React from 'react';
import { RefreshCw } from 'lucide-react';
import { api } from '../../api/client.ts';

interface CollectionsAndScannerSectionProps {
  scanHistory: any[];
  onRefreshAll: () => Promise<void>;
  onReloadSystemDetails: () => Promise<void>;
}

/**
 * Filesystem Scanner & Machine Metadata Rebuild panel with incremental scan,
 * metadata rebuild triggers, and recent scan job history.
 */
export const CollectionsAndScannerSection: React.FC<CollectionsAndScannerSectionProps> = ({
  scanHistory,
  onRefreshAll,
  onReloadSystemDetails,
}) => {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-display font-semibold text-zinc-100">
            Filesystem Scanner &amp; Machine Metadata Rebuild
          </h2>
          <p className="text-zinc-400 mt-0.5">
            Incremental scans run automatically. Rebuilding metadata re-parses all embedded PNG
            workflows while preserving ratings, tags, collections, and characters.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={async () => {
              await api.triggerScan('incremental');
              await onReloadSystemDetails();
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
              await onReloadSystemDetails();
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
  );
};
