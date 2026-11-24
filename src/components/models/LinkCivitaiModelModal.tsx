import React, { useEffect, useState } from 'react';
import {
  Check,
  Download,
  ExternalLink,
  Link2,
  Loader2,
  RefreshCw,
  Search,
  Upload,
  X,
  Zap,
} from 'lucide-react';
import { api } from '../../api/client.ts';
import type { CivitaiMyUploadModelItem } from '../../shared/apiTypes.ts';
import type { LoraExplorerItem } from '../../shared/types.ts';

interface LinkCivitaiModelModalProps {
  lora: LoraExplorerItem;
  isSubmitting: boolean;
  onClose: () => void;
  onLink: (payload: {
    input?: string;
    versionId?: string;
    modelId?: string;
    domain?: 'civitai.com' | 'civitai.red';
  }) => Promise<void>;
}

/**
 * Modal allowing users to bind a LoRA to Civitai either by pasting a model URL / Version ID
 * or picking directly from their authenticated Civitai uploads list.
 */
export const LinkCivitaiModelModal: React.FC<LinkCivitaiModelModalProps> = ({
  lora,
  isSubmitting,
  onClose,
  onLink,
}) => {
  const [activeTab, setActiveTab] = useState<'paste' | 'uploads'>('paste');
  const [inputValue, setInputValue] = useState(
    lora.civitaiVersionId || lora.civitaiUrl || ''
  );
  const [formError, setFormError] = useState<string | null>(null);

  const [uploadsLoading, setUploadsLoading] = useState(false);
  const [uploadsLoaded, setUploadsLoaded] = useState(false);
  const [uploadsError, setUploadsError] = useState<string | null>(null);
  const [uploadsUsername, setUploadsUsername] = useState<string | null>(null);
  const [hasCivitaiKey, setHasCivitaiKey] = useState(true);
  const [uploads, setUploads] = useState<CivitaiMyUploadModelItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSubmitting) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isSubmitting, onClose]);

  const loadUploads = async (forceRefresh = false) => {
    setUploadsLoading(true);
    setUploadsError(null);
    try {
      const res = await api.listMyCivitaiUploads(forceRefresh);
      setUploadsUsername(res.username);
      setHasCivitaiKey(res.hasCivitaiKey);
      setUploads(res.items || []);
      setUploadsLoaded(true);
    } catch (err: any) {
      setUploadsError(err?.message || 'Failed to load your Civitai uploads');
    } finally {
      setUploadsLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'uploads' && !uploadsLoaded && !uploadsLoading) {
      loadUploads(false);
    }
  }, [activeTab, uploadsLoaded, uploadsLoading]);

  const handlePasteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = inputValue.trim();
    if (!trimmed) {
      setFormError('Enter a Civitai model URL or numeric Version ID.');
      return;
    }
    setFormError(null);
    try {
      await onLink({ input: trimmed });
      onClose();
    } catch (err: any) {
      setFormError(err?.message || 'Could not link that Civitai URL or Version ID.');
    }
  };

  const handlePickVersion = async (
    model: CivitaiMyUploadModelItem,
    versionId: string
  ) => {
    setFormError(null);
    try {
      await onLink({
        versionId,
        modelId: model.civitaiId,
        domain: model.domain,
      });
      onClose();
    } catch (err: any) {
      setFormError(err?.message || 'Failed to link selected Civitai upload.');
    }
  };

  const filteredUploads = uploads.filter((u) => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    return (
      u.name.toLowerCase().includes(q) ||
      u.civitaiId.includes(q) ||
      u.versions.some(
        (v) =>
          v.versionName.toLowerCase().includes(q) ||
          (v.baseModel && v.baseModel.toLowerCase().includes(q)) ||
          v.versionId.includes(q)
      )
    );
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
      onClick={() => {
        if (!isSubmitting) onClose();
      }}
    >
      <div
        className="w-full max-w-2xl bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-zinc-800 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-sm font-display font-semibold text-zinc-100 flex items-center gap-2">
              <Link2 className="w-4 h-4 text-indigo-400 shrink-0" />
              <span>Link Civitai Model</span>
            </h3>
            <p className="text-xs text-zinc-400 truncate mt-0.5">{lora.filename}</p>
          </div>
          <button
            type="button"
            disabled={isSubmitting}
            onClick={onClose}
            aria-label="Close link Civitai modal"
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 cursor-pointer disabled:opacity-50"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Mode Switcher */}
        <div className="px-5 pt-3 border-b border-zinc-800 flex items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveTab('paste')}
            className={`px-3 py-2 text-xs font-medium border-b-2 transition-colors cursor-pointer ${
              activeTab === 'paste'
                ? 'border-indigo-500 text-zinc-100'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Paste URL / Version ID
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('uploads')}
            className={`px-3 py-2 text-xs font-medium border-b-2 transition-colors cursor-pointer inline-flex items-center gap-1.5 ${
              activeTab === 'uploads'
                ? 'border-indigo-500 text-zinc-100'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Upload className="w-3.5 h-3.5" />
            <span>My Civitai Uploads</span>
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-4">
          {formError && (
            <div className="px-3.5 py-2.5 rounded-lg bg-red-950/60 border border-red-800/70 text-xs text-red-200">
              {formError}
            </div>
          )}

          {activeTab === 'paste' ? (
            <form onSubmit={handlePasteSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-zinc-300 block">
                  Civitai URL or Model Version ID
                </label>
                <input
                  type="text"
                  autoFocus
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  placeholder="https://civitai.com/models/123456?modelVersionId=789012 or 789012"
                  className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 focus:border-indigo-500 rounded-lg text-xs font-mono text-zinc-100 placeholder-zinc-600 focus:outline-none"
                />
                <p className="text-[11px] text-zinc-500 leading-relaxed">
                  Paste any <span className="font-mono text-zinc-400">civitai.com</span> or{' '}
                  <span className="font-mono text-zinc-400">civitai.red</span> model URL, download
                  link, or Version ID number. Ideal when a local LoRA was re-saved or quantized and
                  its file hash differs from Civitai.
                </p>
              </div>

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={onClose}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-200 cursor-pointer disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || !inputValue.trim()}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-medium bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white cursor-pointer"
                >
                  {isSubmitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>{isSubmitting ? 'Linking...' : 'Link & Sync'}</span>
                </button>
              </div>
            </form>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="relative flex-1 min-w-[200px]">
                  <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Filter your uploaded models..."
                    className="w-full pl-8 pr-3 py-1.5 bg-zinc-950 border border-zinc-800 focus:border-indigo-500 rounded-lg text-xs text-zinc-100 placeholder-zinc-600 focus:outline-none"
                  />
                </div>
                <div className="flex items-center gap-2">
                  {uploadsUsername && (
                    <span className="text-[11px] font-mono text-zinc-400">@{uploadsUsername}</span>
                  )}
                  <button
                    type="button"
                    disabled={uploadsLoading}
                    onClick={() => loadUploads(true)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-zinc-950 border border-zinc-800 hover:border-zinc-700 text-zinc-200 cursor-pointer disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3 h-3 ${uploadsLoading ? 'animate-spin' : ''}`} />
                    <span>Refresh</span>
                  </button>
                </div>
              </div>

              {uploadsLoading && !uploadsLoaded ? (
                <div className="py-10 text-center text-xs text-zinc-400 flex items-center justify-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
                  <span>Loading your Civitai uploads...</span>
                </div>
              ) : uploadsError ? (
                <div className="px-3.5 py-3 rounded-lg bg-red-950/50 border border-red-800/70 text-xs text-red-200">
                  {uploadsError}
                </div>
              ) : !hasCivitaiKey ? (
                <div className="px-4 py-6 rounded-lg bg-zinc-950 border border-zinc-800 text-center space-y-1.5">
                  <p className="text-xs font-medium text-zinc-200">
                    Civitai API key required to list your uploads
                  </p>
                  <p className="text-[11px] text-zinc-500">
                    Add <span className="font-mono text-zinc-400">CIVITAI_API_KEY</span> in System
                    & Backup, or paste any public Civitai URL / Version ID in the first tab.
                  </p>
                </div>
              ) : filteredUploads.length === 0 ? (
                <div className="px-4 py-6 rounded-lg bg-zinc-950 border border-zinc-800 text-center text-xs text-zinc-500">
                  {uploads.length === 0
                    ? 'No Civitai model uploads were found for this account.'
                    : 'No uploaded models match your filter.'}
                </div>
              ) : (
                <div className="space-y-2.5 max-h-[48vh] overflow-y-auto pr-1">
                  {filteredUploads.map((item) => (
                    <div
                      key={item.civitaiId}
                      className="bg-zinc-950 border border-zinc-800 rounded-lg p-3 space-y-2.5"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-2.5 min-w-0">
                          {item.previewUrl && (
                            <img
                              src={item.previewUrl}
                              alt=""
                              className="w-10 h-10 rounded object-cover border border-zinc-800 shrink-0"
                            />
                          )}
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-medium text-zinc-100 truncate">
                                {item.name}
                              </span>
                              <span className="text-[10px] font-mono text-zinc-500">
                                {item.domain === 'civitai.red' ? 'civitai.red' : 'civitai.com'}
                              </span>
                            </div>
                            <div className="flex items-center gap-3 mt-1 text-[11px] font-mono tabular-nums text-zinc-400">
                              <span className="inline-flex items-center gap-1">
                                <Download className="w-3 h-3 text-zinc-500" />
                                {item.stats.downloadCount.toLocaleString()}
                              </span>
                              {item.stats.tippedAmountCount > 0 && (
                                <span className="inline-flex items-center gap-1 text-amber-300">
                                  <Zap className="w-3 h-3" />
                                  {item.stats.tippedAmountCount.toLocaleString()} Buzz
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        <a
                          href={item.civitaiUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[11px] text-indigo-400 hover:text-indigo-300 inline-flex items-center gap-1 shrink-0"
                        >
                          <span>Open</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      </div>

                      <div className="divide-y divide-zinc-800/80 border-t border-zinc-800/80 pt-1">
                        {item.versions.map((ver) => {
                          const isCurrent =
                            lora.civitaiVersionId &&
                            String(lora.civitaiVersionId) === String(ver.versionId);
                          return (
                            <div
                              key={ver.versionId}
                              className="py-1.5 flex flex-wrap items-center justify-between gap-2 text-[11px]"
                            >
                              <div className="min-w-0 flex items-center gap-2">
                                <span className="font-medium text-zinc-200 truncate">
                                  {ver.versionName}
                                </span>
                                {ver.baseModel && (
                                  <span className="font-mono text-zinc-500">{ver.baseModel}</span>
                                )}
                                <span className="font-mono text-zinc-600">#{ver.versionId}</span>
                              </div>

                              <div className="flex items-center gap-2.5 shrink-0">
                                <span className="font-mono tabular-nums text-zinc-400">
                                  {ver.downloadCount.toLocaleString()} dl
                                </span>
                                {ver.alreadyLinkedFilename && !isCurrent && (
                                  <span
                                    title={`Linked to ${ver.alreadyLinkedFilename}`}
                                    className="text-[10px] text-zinc-500 truncate max-w-[110px]"
                                  >
                                    {ver.alreadyLinkedFilename}
                                  </span>
                                )}
                                <button
                                  type="button"
                                  disabled={isSubmitting || Boolean(isCurrent)}
                                  onClick={() => handlePickVersion(item, ver.versionId)}
                                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-medium cursor-pointer disabled:cursor-default ${
                                    isCurrent
                                      ? 'bg-emerald-950/60 border border-emerald-700/60 text-emerald-300'
                                      : 'bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-50'
                                  }`}
                                >
                                  {isCurrent && <Check className="w-3 h-3" />}
                                  <span>{isCurrent ? 'Linked' : 'Link'}</span>
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
