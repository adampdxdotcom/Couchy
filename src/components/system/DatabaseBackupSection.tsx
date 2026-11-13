import React from 'react';
import {
  Database,
  Download,
  ShieldCheck,
  Upload,
} from 'lucide-react';

interface DatabaseBackupSectionProps {
  integrityOk: boolean;
  backups: any[];
  onCreateBackup: () => Promise<void>;
  onRestoreAnnotationsFile: (e: React.ChangeEvent<HTMLInputElement>) => Promise<void>;
}

export const DatabaseBackupSection: React.FC<DatabaseBackupSectionProps> = ({
  integrityOk,
  backups,
  onCreateBackup,
  onRestoreAnnotationsFile,
}) => {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Database className="w-4 h-4 text-indigo-400" />
          <h2 className="text-sm font-display font-semibold text-zinc-100">
            Database Backup, Restore &amp; Annotation Export
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
          onClick={onCreateBackup}
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
            onChange={onRestoreAnnotationsFile}
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
  );
};
