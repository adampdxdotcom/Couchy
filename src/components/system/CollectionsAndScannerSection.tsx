import React, { useState } from 'react';
import {
  FolderPlus,
  RefreshCw,
} from 'lucide-react';
import { api } from '../../api/client.ts';

interface CollectionsAndScannerSectionProps {
  collections: { id: number; name: string; description: string; imageCount: number }[];
  scanHistory: any[];
  onRefreshAll: () => Promise<void>;
  onReloadSystemDetails: () => Promise<void>;
}

export const CollectionsAndScannerSection: React.FC<CollectionsAndScannerSectionProps> = ({
  collections,
  scanHistory,
  onRefreshAll,
  onReloadSystemDetails,
}) => {
  const [newColName, setNewColName] = useState('');
  const [newColDesc, setNewColDesc] = useState('');

  return (
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
              Filesystem Scanner &amp; Machine Metadata Rebuild
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
    </div>
  );
};
