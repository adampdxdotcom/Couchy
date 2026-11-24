import React, { useEffect, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Heart,
  MessageSquare,
  Pin,
  RefreshCw,
} from 'lucide-react';
import type {
  CivitaiCommentRecord,
  CivitaiReactionBreakdown,
} from '../../shared/apiTypes.ts';

interface InspectorCivitaiFeedbackSectionProps {
  activeImageId: number;
  status: 'draft' | 'published';
  primaryUrl: string;
  hasUnseenActivity: boolean;
  reactionCount: number;
  reactionBreakdown: CivitaiReactionBreakdown;
  commentCount: number;
  comments: CivitaiCommentRecord[];
  hasCivitaiKey: boolean;
  isRefreshing?: boolean;
  onRefresh?: () => void;
  onNavigateToImage?: (imageId: number) => void;
}

function formatCommentDate(raw: string | null): string {
  if (!raw) return '';
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) return '';
  return new Date(ms).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Desktop-only inspector section displaying the Civitai post status pill, explicit Heart vs. Emoji
 * reaction breakdown, and a collapsible image-linked comment thread below the header action bar.
 */
export const InspectorCivitaiFeedbackSection: React.FC<InspectorCivitaiFeedbackSectionProps> = ({
  activeImageId,
  status,
  primaryUrl,
  hasUnseenActivity,
  reactionCount,
  reactionBreakdown,
  commentCount,
  comments,
  hasCivitaiKey,
  isRefreshing = false,
  onRefresh,
  onNavigateToImage,
}) => {
  // Comments start collapsed by default and reset whenever switching images
  const [isCommentsExpanded, setIsCommentsExpanded] = useState(false);

  useEffect(() => {
    setIsCommentsExpanded(false);
  }, [activeImageId]);

  const { heartCount, likeCount, laughCount, cryCount } = reactionBreakdown;
  const emojiTotal = likeCount + laughCount + cryCount;
  const hasDetailedReactions = heartCount > 0 || emojiTotal > 0;
  const displayedCommentCount = Math.max(commentCount, comments.length);

  return (
    <section
      aria-label="Civitai Feedback"
      className="hidden lg:block bg-zinc-950 border border-zinc-800 rounded-xl p-3 space-y-2.5 min-w-0"
    >
      {/* Top row: Published/Draft pill + section label + refresh + collapsible comments toggle */}
      <div className="flex items-center justify-between gap-2 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <a
            href={primaryUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border text-[11px] font-medium shrink-0 transition-colors ${
              hasUnseenActivity
                ? 'bg-amber-500/15 border-amber-500/45 text-amber-200 hover:bg-amber-500/25'
                : status === 'published'
                ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-200 hover:bg-emerald-500/25'
                : 'bg-sky-500/15 border-sky-500/40 text-sky-200 hover:bg-sky-500/25'
            }`}
            title={status === 'published' ? 'Open published post on Civitai' : 'Open draft editor on Civitai'}
          >
            {hasUnseenActivity && <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />}
            <span>{status === 'published' ? 'Published' : 'Draft'}</span>
            <ExternalLink className="w-2.5 h-2.5 opacity-75" />
          </a>

          <span className="text-[11px] font-display font-semibold text-zinc-400 uppercase tracking-wider truncate">
            Civitai Feedback
          </span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              disabled={isRefreshing}
              className="p-1 rounded-md text-zinc-500 hover:text-zinc-200 hover:bg-zinc-900 cursor-pointer disabled:opacity-50 transition-colors"
              title="Refresh Civitai reactions & comments"
              aria-label="Refresh Civitai feedback"
            >
              <RefreshCw className={`w-3 h-3 ${isRefreshing ? 'animate-spin text-indigo-400' : ''}`} />
            </button>
          )}

          {displayedCommentCount > 0 && (
            <button
              type="button"
              onClick={() => setIsCommentsExpanded((prev) => !prev)}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-[11px] text-zinc-300 hover:text-white cursor-pointer transition-colors"
              aria-expanded={isCommentsExpanded}
            >
              <MessageSquare className="w-3 h-3 text-sky-400" />
              <span className="font-mono tabular-nums">{displayedCommentCount}</span>
              <span>{displayedCommentCount === 1 ? 'Comment' : 'Comments'}</span>
              {isCommentsExpanded ? (
                <ChevronDown className="w-3 h-3 text-zinc-400" />
              ) : (
                <ChevronRight className="w-3 h-3 text-zinc-400" />
              )}
            </button>
          )}
        </div>
      </div>

      {/* Reaction Breakdown: explicitly separating Heart reactions vs Emoji reactions */}
      {(hasDetailedReactions || reactionCount > 0) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] pt-0.5">
          {hasDetailedReactions ? (
            <>
              <div
                className="inline-flex items-center gap-1.5 text-rose-300"
                title="Civitai Heart reactions"
              >
                <Heart className="w-3.5 h-3.5 fill-rose-400 text-rose-400 shrink-0" />
                <span className="font-mono tabular-nums font-semibold">{heartCount}</span>
                <span className="text-zinc-400">{heartCount === 1 ? 'Heart' : 'Hearts'}</span>
              </div>

              {emojiTotal > 0 && (
                <>
                  <span aria-hidden="true" className="text-zinc-700">|</span>
                  <div className="inline-flex flex-wrap items-center gap-2 text-zinc-300">
                    <span className="text-zinc-500">Emoji</span>
                    {likeCount > 0 && (
                      <span
                        className="inline-flex items-center gap-1 font-mono tabular-nums"
                        title="Like emoji reactions"
                      >
                        <span aria-hidden="true">👍</span>
                        <span>{likeCount}</span>
                      </span>
                    )}
                    {laughCount > 0 && (
                      <span
                        className="inline-flex items-center gap-1 font-mono tabular-nums"
                        title="Laugh emoji reactions"
                      >
                        <span aria-hidden="true">😂</span>
                        <span>{laughCount}</span>
                      </span>
                    )}
                    {cryCount > 0 && (
                      <span
                        className="inline-flex items-center gap-1 font-mono tabular-nums"
                        title="Cry emoji reactions"
                      >
                        <span aria-hidden="true">😢</span>
                        <span>{cryCount}</span>
                      </span>
                    )}
                  </div>
                </>
              )}
            </>
          ) : (
            <div className="inline-flex items-center gap-1.5 text-zinc-300">
              <Heart className="w-3.5 h-3.5 text-rose-400" />
              <span className="font-mono tabular-nums font-semibold">{reactionCount}</span>
              <span className="text-zinc-400">{reactionCount === 1 ? 'Reaction' : 'Reactions'}</span>
            </div>
          )}
        </div>
      )}

      {/* Collapsible Comment Thread tied to Civitai / Local Images */}
      {isCommentsExpanded && displayedCommentCount > 0 && (
        <div className="pt-2 border-t border-zinc-800/80 space-y-2 max-h-60 overflow-y-auto pr-0.5">
          {comments.length > 0 ? (
            comments.map((comment) => {
              const dateLabel = formatCommentDate(comment.createdAt);
              const isCurrentImage =
                comment.targetType === 'image' && comment.localImageId === activeImageId;
              const isOtherLocalImage =
                comment.targetType === 'image' &&
                comment.localImageId != null &&
                comment.localImageId !== activeImageId;

              return (
                <div
                  key={`${comment.targetType}-${comment.id}`}
                  style={comment.depth > 0 ? { marginLeft: `${Math.min(comment.depth, 2) * 12}px` } : undefined}
                  className="bg-zinc-900/75 border border-zinc-800/80 rounded-lg px-2.5 py-2 space-y-1.5"
                >
                  <div className="flex items-center justify-between gap-2 text-[11px]">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="font-medium text-zinc-200 truncate">
                        {comment.authorUsername}
                      </span>
                      {comment.isPinned && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] text-amber-300">
                          <Pin className="w-2.5 h-2.5" />
                          Pinned
                        </span>
                      )}
                      {dateLabel && <span className="text-zinc-500 shrink-0">{dateLabel}</span>}
                    </div>

                    {comment.reactionCount > 0 && (
                      <span className="inline-flex items-center gap-0.5 text-[10px] font-mono tabular-nums text-zinc-400 shrink-0">
                        <Heart className="w-2.5 h-2.5 text-rose-400" />
                        {comment.reactionCount}
                      </span>
                    )}
                  </div>

                  <p className="text-[11px] text-zinc-200 leading-relaxed whitespace-pre-wrap break-words">
                    {comment.content}
                  </p>

                  {/* Image / Post attribution footer */}
                  <div className="flex items-center justify-between gap-2 pt-0.5 text-[10px] text-zinc-500">
                    {isCurrentImage ? (
                      <span className="text-emerald-400/90 font-medium">On this image</span>
                    ) : isOtherLocalImage ? (
                      <button
                        type="button"
                        onClick={() => onNavigateToImage?.(comment.localImageId!)}
                        className="inline-flex items-center gap-1.5 text-indigo-300 hover:text-indigo-200 cursor-pointer min-w-0"
                        title={`Jump to ${comment.localFilename || 'image'} in inspector`}
                      >
                        {comment.localThumbnailUrl && (
                          <img
                            src={comment.localThumbnailUrl}
                            alt={comment.localFilename || 'Frame'}
                            className="w-4 h-4 rounded object-cover border border-zinc-700 shrink-0"
                          />
                        )}
                        <span className="truncate">
                          On {comment.localFilename || `Image #${comment.localImageId}`}
                        </span>
                      </button>
                    ) : comment.targetType === 'image' && comment.civitaiImageId ? (
                      <span>On Civitai image #{comment.civitaiImageId}</span>
                    ) : (
                      <span>On Civitai post</span>
                    )}

                    <a
                      href={comment.civitaiUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-zinc-400 hover:text-zinc-200 shrink-0"
                      title="View on Civitai"
                    >
                      <span>View</span>
                      <ExternalLink className="w-2.5 h-2.5" />
                    </a>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="flex items-center justify-between gap-2 text-[11px] text-zinc-400 py-1">
              <span>
                {hasCivitaiKey
                  ? 'Comment text is not cached yet. Click refresh or view directly on Civitai.'
                  : 'Configure CIVITAI_API_KEY to fetch comment text locally.'}
              </span>
              <a
                href={primaryUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-indigo-300 hover:text-indigo-200 shrink-0"
              >
                <span>Open</span>
                <ExternalLink className="w-2.5 h-2.5" />
              </a>
            </div>
          )}
        </div>
      )}
    </section>
  );
};
