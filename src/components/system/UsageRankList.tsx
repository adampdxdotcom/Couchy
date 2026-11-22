import React, { useMemo, useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronUp, EyeOff, Heart, Sparkles } from 'lucide-react';
import type { UsageRankItem, UsageRankSortMode } from '../../shared/types.ts';

interface UsageRankListProps {
  items: UsageRankItem[];
  sortMode: UsageRankSortMode;
  emptyMessage: string;
  showCategoryTag?: boolean;
  /** True when viewing a filtered LoRA subset where row position differs from overall group rank. */
  isFilteredSubset?: boolean;
}

const DEFAULT_VISIBLE_LIMIT = 10;

function getRankBadgeClass(rank: number, hasActivity: boolean): string {
  if (!hasActivity && rank > 3) {
    return 'bg-zinc-900 border-zinc-800 text-zinc-500';
  }
  if (rank === 1) {
    return 'bg-amber-500/20 border-amber-400/50 text-amber-300';
  }
  if (rank === 2) {
    return 'bg-zinc-300/15 border-zinc-400/40 text-zinc-200';
  }
  if (rank === 3) {
    return 'bg-orange-500/15 border-orange-400/40 text-orange-300';
  }
  return 'bg-zinc-900 border-zinc-800 text-zinc-400';
}

/**
 * Displays ranked Characters, Base Models, or LoRAs with usage counts, favorites,
 * Random Roll scores/odds, and subtle Roll-Eligible vs Excluded indicators.
 */
export const UsageRankList: React.FC<UsageRankListProps> = ({
  items,
  sortMode,
  emptyMessage,
  showCategoryTag = false,
  isFilteredSubset = false,
}) => {
  const [expanded, setExpanded] = useState(false);

  const sortedItems = useMemo(() => {
    return [...items].sort((a, b) =>
      sortMode === 'usage' ? a.usageRank - b.usageRank : a.rollRank - b.rollRank
    );
  }, [items, sortMode]);

  const maxMetric = useMemo(() => {
    if (sortedItems.length === 0) return 1;
    if (sortMode === 'usage') {
      return Math.max(1, ...sortedItems.map((i) => i.usageCount));
    }
    return Math.max(1, ...sortedItems.map((i) => i.rollScore));
  }, [sortedItems, sortMode]);

  if (sortedItems.length === 0) {
    return (
      <div className="bg-zinc-950/70 border border-zinc-800/80 rounded-xl py-8 px-4 text-center text-xs text-zinc-500">
        {emptyMessage}
      </div>
    );
  }

  const hasOverflow = sortedItems.length > DEFAULT_VISIBLE_LIMIT;
  const visibleItems = expanded ? sortedItems : sortedItems.slice(0, DEFAULT_VISIBLE_LIMIT);

  return (
    <div className="space-y-2">
      <div className="divide-y divide-zinc-800/70 bg-zinc-950/80 border border-zinc-800/90 rounded-xl overflow-hidden">
        {visibleItems.map((item, idx) => {
          const displayRank = isFilteredSubset
            ? idx + 1
            : sortMode === 'usage'
              ? item.usageRank
              : item.rollRank;
          const overallRank = sortMode === 'usage' ? item.usageRank : item.rollRank;
          const metricValue = sortMode === 'usage' ? item.usageCount : item.rollScore;
          const barPct =
            metricValue > 0 ? Math.min(100, Math.max(3, (metricValue / maxMetric) * 100)) : 0;
          const hasActivity = item.usageCount > 0 || item.favoriteCount > 0;

          return (
            <div
              key={`${item.id}-${item.name}`}
              className={`px-3.5 py-2.5 transition-colors hover:bg-zinc-900/60 ${
                !item.rollEligible && sortMode === 'roll_score' ? 'opacity-70' : ''
              }`}
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                {/* Left: Rank, Name, Subtle Metadata & Eligibility */}
                <div className="flex items-start sm:items-center gap-3 min-w-0">
                  <span
                    title={`Usage rank #${item.usageRank} · Roll rank #${item.rollRank}`}
                    className={`inline-flex items-center justify-center min-w-[2.1rem] h-6 px-1.5 rounded-lg border text-[11px] font-semibold tabular-nums shrink-0 ${getRankBadgeClass(
                      displayRank,
                      hasActivity
                    )}`}
                  >
                    #{displayRank}
                  </span>

                  <div className="min-w-0 space-y-0.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-medium text-zinc-100 truncate max-w-[260px] sm:max-w-[360px]">
                        {item.name}
                      </span>

                      {showCategoryTag && item.category && (
                        <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-zinc-400">
                          {item.category}
                        </span>
                      )}

                      {item.baseGroup && (
                        <span className="text-[10px] uppercase tracking-wide text-zinc-500">
                          {item.baseGroup}
                        </span>
                      )}

                      {isFilteredSubset && overallRank !== displayRank && (
                        <span className="text-[10px] text-zinc-500 tabular-nums">
                          (All #{overallRank})
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2.5 flex-wrap text-[10px]">
                      {item.subtitle && (
                        <span className="text-zinc-500 truncate max-w-[240px]">
                          {item.subtitle}
                        </span>
                      )}

                      {item.rollEligible ? (
                        <span className="inline-flex items-center gap-1 text-emerald-400/85">
                          <CheckCircle2 className="w-2.5 h-2.5" />
                          In Roll
                        </span>
                      ) : (
                        <span
                          className="inline-flex items-center gap-1 text-zinc-500"
                          title={`Excluded from Random Roll: ${item.excludedReasons.join(', ')}`}
                        >
                          <EyeOff className="w-2.5 h-2.5 text-amber-400/70" />
                          Excluded: {item.excludedReasons.join(' · ')}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Right: Uses, Favs, Roll Score, Odds */}
                <div className="flex items-center gap-4 sm:gap-5 pl-11 sm:pl-0 shrink-0 tabular-nums">
                  <div className="text-right">
                    <div className="text-xs font-semibold text-zinc-100">
                      {item.usageCount.toLocaleString()}
                    </div>
                    <div className="text-[10px] text-zinc-500">uses</div>
                  </div>

                  <div className="text-right min-w-[2.5rem]">
                    <div className="inline-flex items-center justify-end gap-1 text-xs font-medium text-rose-300">
                      <Heart className="w-2.5 h-2.5 fill-rose-400/30 text-rose-400" />
                      {item.favoriteCount.toLocaleString()}
                    </div>
                    <div className="text-[10px] text-zinc-500">favs</div>
                  </div>

                  <div className="text-right min-w-[3.4rem]">
                    <div className="inline-flex items-center justify-end gap-1 text-xs font-semibold text-indigo-300">
                      <Sparkles className="w-2.5 h-2.5 text-indigo-400" />
                      {item.rollScore.toFixed(2)}
                    </div>
                    <div className="text-[10px] text-zinc-500">score</div>
                  </div>

                  <div className="text-right min-w-[3.2rem]">
                    <div
                      className={`text-xs font-medium ${
                        item.rollEligible ? 'text-cyan-300' : 'text-zinc-600'
                      }`}
                    >
                      {item.rollEligible ? `${item.rollOddsPercent.toFixed(1)}%` : '0.0%'}
                    </div>
                    <div className="text-[10px] text-zinc-500">odds</div>
                  </div>
                </div>
              </div>

              {/* Relative progress bar */}
              <div className="mt-2 pl-11">
                <div className="h-1 w-full rounded-full bg-zinc-900 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${
                      sortMode === 'usage'
                        ? 'bg-cyan-400/80'
                        : item.rollEligible
                          ? 'bg-indigo-400/90'
                          : 'bg-zinc-600/70'
                    }`}
                    style={{ width: `${barPct}%` }}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {hasOverflow && (
        <div className="flex justify-center pt-1">
          <button
            type="button"
            onClick={() => setExpanded((prev) => !prev)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-zinc-950 border border-zinc-800 text-[11px] font-medium text-zinc-300 hover:text-zinc-100 hover:border-zinc-700 cursor-pointer"
          >
            {expanded ? (
              <>
                <ChevronUp className="w-3.5 h-3.5" />
                Show top {DEFAULT_VISIBLE_LIMIT}
              </>
            ) : (
              <>
                <ChevronDown className="w-3.5 h-3.5" />
                Show all {sortedItems.length.toLocaleString()}
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
};
