import React, { useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Download,
  ExternalLink,
  FileText,
  Heart,
  Link2,
  MessageSquare,
  Pin,
  RefreshCw,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  UserCheck,
  Zap,
} from 'lucide-react';
import type { LoraExplorerItem } from '../../shared/types.ts';

interface LoraCivitaiDescriptionCardProps {
  lora: LoraExplorerItem;
  civitaiActivityNotificationsEnabled: boolean;
  isFetchingCivitai: boolean;
  isRefreshingStats: boolean;
  onFetchFromCivitai: (modelId: number) => void;
  onRefreshStats: (modelId: number) => Promise<void>;
  onOpenLinkModal: () => void;
}

function formatUtcDisplay(raw?: string | null): string | null {
  if (!raw) return null;
  const normalized = raw.includes('T') ? raw : `${raw.replace(' ', 'T')}Z`;
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString();
}

/**
 * Displays a LoRA's Civitai / Hugging Face description card alongside notification-gated
 * Civitai upload stats, creator attribution, manual linking controls, and collapsible model comments.
 */
export const LoraCivitaiDescriptionCard: React.FC<LoraCivitaiDescriptionCardProps> = ({
  lora,
  civitaiActivityNotificationsEnabled,
  isFetchingCivitai,
  isRefreshingStats,
  onFetchFromCivitai,
  onRefreshStats,
  onOpenLinkModal,
}) => {
  const [commentsExpanded, setCommentsExpanded] = useState(false);

  const isCivitaiLinked = Boolean(lora.civitaiUrl || lora.civitaiId || lora.civitaiVersionId);
  const showCivitaiActivity = civitaiActivityNotificationsEnabled && isCivitaiLinked;
  const stats = lora.civitaiStats ?? null;
  const comments = lora.civitaiComments || [];
  const totalCommentCount = Math.max(stats?.commentCount ?? 0, comments.length);
  const syncedLabel = formatUtcDisplay(lora.civitaiStatsSyncedAt || lora.civitaiFetchedAt);

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5 min-w-0">
          <FileText className="w-4 h-4 text-indigo-400 shrink-0" />
          <h2 className="text-sm font-display font-semibold text-zinc-100">
            {!lora.civitaiUrl && lora.hfRepoId
              ? 'Hugging Face Model Card'
              : 'CivitAI Description'}
          </h2>
          {showCivitaiActivity && lora.isOwnCivitaiUpload && (
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-400">
              <UserCheck className="w-3.5 h-3.5" />
              <span>
                Uploaded by you
                {lora.civitaiCreatorUsername ? ` · @${lora.civitaiCreatorUsername}` : ''}
              </span>
            </span>
          )}
          {showCivitaiActivity && !lora.isOwnCivitaiUpload && lora.civitaiCreatorUsername && (
            <span className="text-[11px] font-mono text-zinc-400">
              by @{lora.civitaiCreatorUsername}
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3 text-[11px] font-mono text-zinc-500">
          {syncedLabel && <span>Synced {syncedLabel}</span>}
          {showCivitaiActivity && lora.modelId && (
            <button
              type="button"
              disabled={isRefreshingStats}
              onClick={() => onRefreshStats(lora.modelId!)}
              className="inline-flex items-center gap-1 text-zinc-300 hover:text-white font-sans cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3 h-3 ${isRefreshingStats ? 'animate-spin text-indigo-400' : ''}`} />
              <span>{isRefreshingStats ? 'Refreshing...' : 'Refresh Stats'}</span>
            </button>
          )}
          {lora.modelId && (
            <button
              type="button"
              onClick={onOpenLinkModal}
              className="inline-flex items-center gap-1 text-zinc-300 hover:text-indigo-300 font-sans cursor-pointer"
            >
              <Link2 className="w-3 h-3" />
              <span>{isCivitaiLinked ? 'Change Link' : 'Link Civitai'}</span>
            </button>
          )}
          {lora.civitaiUrl && (
            <a
              href={lora.civitaiUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-indigo-400 hover:text-indigo-300 font-sans"
            >
              <span>Open original page</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          )}
          {lora.hfRepoId && (
            <a
              href={`https://huggingface.co/${lora.hfRepoId}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-amber-300 hover:text-amber-200 font-sans"
            >
              <span>Open on Hugging Face</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>
      </div>

      {/* Civitai Model & Version Stats Strip (hidden when Civitai Activity Notifications are off) */}
      {showCivitaiActivity && stats && (
        <div
          className={`grid grid-cols-2 sm:grid-cols-4 ${
            stats.matchedVersion ? 'lg:grid-cols-5' : ''
          } divide-y sm:divide-y-0 sm:divide-x divide-zinc-800 bg-zinc-950 border border-zinc-800 rounded-lg`}
        >
          <div className="px-4 py-2.5">
            <div className="text-[10px] uppercase tracking-wider text-zinc-500 flex items-center gap-1.5">
              <Download className="w-3 h-3 text-zinc-400" />
              <span>Downloads</span>
            </div>
            <div className="text-sm font-mono tabular-nums font-semibold text-zinc-100 mt-0.5">
              {stats.downloadCount.toLocaleString()}
            </div>
          </div>

          <div className="px-4 py-2.5">
            <div className="text-[10px] uppercase tracking-wider text-zinc-500 flex items-center gap-1.5">
              <ThumbsUp className="w-3 h-3 text-zinc-400" />
              <span>Thumbs Up</span>
            </div>
            <div className="flex items-baseline gap-2 mt-0.5">
              <span className="text-sm font-mono tabular-nums font-semibold text-zinc-100">
                {stats.thumbsUpCount.toLocaleString()}
              </span>
              {stats.thumbsDownCount > 0 && (
                <span className="inline-flex items-center gap-0.5 text-[11px] font-mono tabular-nums text-zinc-500">
                  <ThumbsDown className="w-2.5 h-2.5" />
                  {stats.thumbsDownCount.toLocaleString()}
                </span>
              )}
            </div>
          </div>

          <div className="px-4 py-2.5">
            <div className="text-[10px] uppercase tracking-wider text-zinc-500 flex items-center gap-1.5">
              <MessageSquare className="w-3 h-3 text-zinc-400" />
              <span>Comments</span>
            </div>
            <div className="text-sm font-mono tabular-nums font-semibold text-zinc-100 mt-0.5">
              {totalCommentCount.toLocaleString()}
            </div>
          </div>

          <div className="px-4 py-2.5">
            <div className="text-[10px] uppercase tracking-wider text-zinc-500 flex items-center gap-1.5">
              <Zap className="w-3 h-3 text-amber-400" />
              <span>Buzz Tipped</span>
            </div>
            <div className="text-sm font-mono tabular-nums font-semibold text-amber-300 mt-0.5">
              {stats.tippedAmountCount.toLocaleString()}
            </div>
          </div>

          {stats.matchedVersion && (
            <div className="px-4 py-2.5 col-span-2 sm:col-span-4 lg:col-span-1">
              <div className="text-[10px] uppercase tracking-wider text-zinc-500 truncate">
                {stats.totalVersionsCount > 1
                  ? `Version (1 of ${stats.totalVersionsCount})`
                  : 'Matched Version'}
              </div>
              <div className="text-xs font-medium text-zinc-200 truncate mt-0.5">
                {stats.matchedVersion.versionName}
              </div>
              <div className="text-[11px] font-mono tabular-nums text-zinc-400">
                {stats.matchedVersion.downloadCount.toLocaleString()} dl ·{' '}
                {stats.matchedVersion.thumbsUpCount.toLocaleString()} up
              </div>
            </div>
          )}
        </div>
      )}

      {showCivitaiActivity && !stats && (
        <div className="bg-zinc-950/70 border border-zinc-800/80 rounded-lg px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-400">
          <span>
            Civitai download and Buzz stats will sync on the next 15-minute check.
          </span>
          {lora.modelId && (
            <button
              type="button"
              disabled={isRefreshingStats}
              onClick={() => onRefreshStats(lora.modelId!)}
              className="text-indigo-400 hover:text-indigo-300 font-medium cursor-pointer disabled:opacity-50"
            >
              {isRefreshingStats ? 'Refreshing...' : 'Refresh now'}
            </button>
          )}
        </div>
      )}

      {/* Collapsible Civitai Model Comments Thread */}
      {showCivitaiActivity && totalCommentCount > 0 && (
        <div className="bg-zinc-950 border border-zinc-800 rounded-lg overflow-hidden">
          <button
            type="button"
            onClick={() => setCommentsExpanded((prev) => !prev)}
            className="w-full px-3.5 py-2.5 flex items-center justify-between text-xs font-medium text-zinc-200 hover:bg-zinc-900/60 transition-colors cursor-pointer"
          >
            <span className="inline-flex items-center gap-2">
              {commentsExpanded ? (
                <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5 text-zinc-400" />
              )}
              <MessageSquare className="w-3.5 h-3.5 text-indigo-400" />
              <span>Model Comments</span>
              <span className="font-mono tabular-nums text-zinc-400">({totalCommentCount})</span>
            </span>
            <span className="text-[11px] text-zinc-500">
              {commentsExpanded ? 'Collapse' : 'Show thread'}
            </span>
          </button>

          {commentsExpanded && (
            <div className="border-t border-zinc-800/90 divide-y divide-zinc-800/60 max-h-72 overflow-y-auto">
              {comments.length === 0 ? (
                <div className="px-4 py-3 text-xs text-zinc-500 flex items-center justify-between gap-2">
                  <span>Comment text has not been synced yet for this model.</span>
                  {lora.modelId && (
                    <button
                      type="button"
                      disabled={isRefreshingStats}
                      onClick={() => onRefreshStats(lora.modelId!)}
                      className="text-indigo-400 hover:text-indigo-300 font-medium cursor-pointer disabled:opacity-50"
                    >
                      {isRefreshingStats ? 'Syncing...' : 'Load comments'}
                    </button>
                  )}
                </div>
              ) : (
                comments.map((comment) => (
                  <div
                    key={comment.id}
                    className={`px-4 py-3 space-y-1 text-xs ${
                      comment.depth > 0 ? 'pl-8 border-l-2 border-zinc-800 ml-3 bg-zinc-950/60' : ''
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-zinc-200">
                          @{comment.authorUsername}
                        </span>
                        {comment.isPinned && (
                          <span className="inline-flex items-center gap-0.5 text-amber-400">
                            <Pin className="w-3 h-3" />
                            Pinned
                          </span>
                        )}
                        {comment.createdAt && (
                          <span className="font-mono text-zinc-500">
                            {new Date(comment.createdAt).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                      {(comment.reactionCount > 0 || comment.heartCount > 0) && (
                        <span className="inline-flex items-center gap-1 font-mono tabular-nums text-zinc-400">
                          <Heart className="w-3 h-3 text-rose-400" />
                          {Math.max(comment.reactionCount, comment.heartCount)}
                        </span>
                      )}
                    </div>
                    <p className="text-zinc-300 leading-relaxed whitespace-pre-wrap break-words">
                      {comment.content}
                    </p>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      )}

      {/* Description Body */}
      {lora.civitaiDescription ? (
        <div className="bg-zinc-950 border border-zinc-800/80 rounded-lg p-4 max-h-80 overflow-y-auto text-xs leading-relaxed text-zinc-300 whitespace-pre-wrap break-words">
          {lora.civitaiDescription}
        </div>
      ) : (
        <div className="bg-zinc-950/60 border border-zinc-800/70 rounded-lg px-4 py-4 flex flex-wrap items-center justify-between gap-3 text-xs text-zinc-400">
          <span className="flex items-center gap-2">
            <Sparkles className="w-3.5 h-3.5 text-zinc-500" />
            <span>No Civitai or Hugging Face description stored yet for this LoRA.</span>
          </span>
          {lora.modelId && (
            <div className="flex items-center gap-4">
              <button
                type="button"
                onClick={onOpenLinkModal}
                className="text-zinc-300 hover:text-white font-medium cursor-pointer"
              >
                Link Civitai URL / ID
              </button>
              <button
                type="button"
                disabled={isFetchingCivitai}
                onClick={() => onFetchFromCivitai(lora.modelId!)}
                className="text-indigo-400 hover:text-indigo-300 font-medium cursor-pointer disabled:opacity-50"
              >
                {isFetchingCivitai ? 'Fetching...' : 'Fetch Details now'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
