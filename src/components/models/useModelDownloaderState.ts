import { useEffect, useState } from 'react';
import { api } from '../../api/client.ts';
import type { ActivePreviewDownloadEntry } from '../ModelDownloaderTab.tsx';
import type { ExternalModelSearchResult } from '../../shared/types.ts';

/**
 * Manages lifted downloader search state, active preview stack, and background polling
 * so navigating across LoRA/Model sub-tabs preserves queued downloads.
 */
export function useModelDownloaderState(
  subTab: 'loras' | 'dependencies' | 'downloader',
  onRefreshInventory: () => Promise<void>
) {
  const [extQuery, setExtQuery] = useState('');
  const [extTypeFilter, setExtTypeFilter] = useState('');
  const [searchResults, setSearchResults] = useState<ExternalModelSearchResult[]>([]);
  const [searchBatchTimestamp, setSearchBatchTimestamp] = useState<number>(0);
  const [activePreviewDownloads, setActivePreviewDownloads] = useState<
    ActivePreviewDownloadEntry[]
  >([]);
  const [isSearchingExt, setIsSearchingExt] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [downloads, setDownloads] = useState<any[]>([]);

  const refreshDownloads = async () => {
    try {
      const res = await api.listDownloads();
      setDownloads(res.items || []);
    } catch {
      // ignore transient network error
    }
  };

  useEffect(() => {
    refreshDownloads();
  }, [subTab]);

  // Automatically clear any preview card once its server-side download completes
  useEffect(() => {
    if (activePreviewDownloads.length === 0 || downloads.length === 0) return;
    const finishedEntries = activePreviewDownloads.filter((entry) => {
      const job = downloads.find((d: any) => Number(d.id) === entry.jobId);
      return Boolean(job && job.status !== 'downloading');
    });
    if (finishedEntries.length === 0) return;

    const finishedJobIds = new Set(finishedEntries.map((e) => e.jobId));
    const finishedCardKeys = new Set(finishedEntries.map((e) => e.cardKey));

    setActivePreviewDownloads((prev) => prev.filter((e) => !finishedJobIds.has(e.jobId)));
    setSearchResults((prev) =>
      prev.filter((r) => !finishedCardKeys.has(`${r.provider}-${r.id}-${r.filename}`))
    );
  }, [downloads, activePreviewDownloads]);

  // Poll every 1.5s while any model download is actively streaming
  const hasActiveDownload =
    downloads.some((d) => d.status === 'downloading') || activePreviewDownloads.length > 0;
  useEffect(() => {
    if (!hasActiveDownload) return;
    const timer = setInterval(async () => {
      try {
        const res = await api.listDownloads();
        const next = res.items || [];
        setDownloads(next);
        if (!next.some((d: any) => d.status === 'downloading')) {
          await onRefreshInventory();
        }
      } catch {
        // ignore transient polling failure
      }
    }, 1500);
    return () => clearInterval(timer);
  }, [hasActiveDownload, onRefreshInventory]);

  // Gently refresh every 15s while Early Access scheduled jobs are waiting
  const hasScheduledDownload = downloads.some((d) => d.status === 'scheduled');
  useEffect(() => {
    if (!hasScheduledDownload || hasActiveDownload) return;
    const timer = setInterval(() => {
      refreshDownloads();
    }, 15000);
    return () => clearInterval(timer);
  }, [hasScheduledDownload, hasActiveDownload]);

  const handleExternalSearch = async (e?: React.FormEvent, customQ?: string) => {
    if (e) e.preventDefault();
    const qToUse = customQ !== undefined ? customQ : extQuery;
    setIsSearchingExt(true);
    setSearchError(null);
    try {
      const res = await api.searchModels(qToUse, extTypeFilter);
      setSearchResults(res.items || []);
      setSearchBatchTimestamp(Date.now());
    } catch (err: any) {
      setSearchError(err.message || 'External model search failed');
    } finally {
      setIsSearchingExt(false);
    }
  };

  return {
    extQuery,
    setExtQuery,
    extTypeFilter,
    setExtTypeFilter,
    searchResults,
    setSearchResults,
    searchBatchTimestamp,
    activePreviewDownloads,
    setActivePreviewDownloads,
    isSearchingExt,
    searchError,
    downloads,
    refreshDownloads,
    handleExternalSearch,
  };
}
