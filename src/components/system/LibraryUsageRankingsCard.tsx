import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Cpu,
  Crown,
  Dices,
  Layers,
  RefreshCw,
  Sparkles,
  Users,
} from 'lucide-react';
import { api } from '../../api/client.ts';
import { UsageRankList } from './UsageRankList.tsx';
import type {
  LibraryUsageStatsResponse,
  LoraCategory,
  UsageRankGroup,
  UsageRankSortMode,
} from '../../shared/types.ts';

type LibraryTab = 'characters' | 'baseModels' | 'loras';
type LoraSubFilter = 'all' | 'roll_pool' | LoraCategory;

interface SummaryTileProps {
  title: string;
  icon: React.ReactNode;
  accentClass: string;
  group: UsageRankGroup | undefined;
  sortMode: UsageRankSortMode;
  active: boolean;
  onClick: () => void;
  unitLabel: string;
}

const GroupSummaryTile: React.FC<SummaryTileProps> = ({
  title,
  icon,
  accentClass,
  group,
  sortMode,
  active,
  onClick,
  unitLabel,
}) => {
  const leader = sortMode === 'usage' ? group?.topByUsage : group?.topByRollScore;

  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-left rounded-xl p-3.5 border transition-colors cursor-pointer ${
        active
          ? 'bg-zinc-950 border-indigo-500/60 ring-1 ring-indigo-500/20'
          : 'bg-black/45 border-zinc-800/90 hover:border-zinc-700'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`p-1.5 rounded-lg border shrink-0 ${accentClass}`}>{icon}</span>
          <span className="text-xs font-semibold text-zinc-100 truncate">{title}</span>
        </div>
        <div className="text-right shrink-0 tabular-nums">
          <div className="text-base font-bold text-zinc-100 leading-tight">
            {group ? group.totalCount.toLocaleString() : '—'}
          </div>
          <div className="text-[10px] text-zinc-500">{unitLabel}</div>
        </div>
      </div>

      <div className="mt-2.5 pt-2 border-t border-zinc-800/80 space-y-1">
        <div className="flex items-center justify-between text-[10px] text-zinc-400 tabular-nums">
          <span>Roll Eligible</span>
          <span className="text-emerald-400/90 font-medium">
            {group ? `${group.eligibleCount.toLocaleString()} / ${group.totalCount.toLocaleString()}` : '—'}
          </span>
        </div>

        <div className="flex items-center justify-between gap-2 text-[11px]">
          <span className="inline-flex items-center gap-1 text-amber-300/90 shrink-0">
            <Crown className="w-3 h-3" />
            #1
          </span>
          {leader ? (
            <span className="text-zinc-200 font-medium truncate" title={leader.name}>
              {leader.name}{' '}
              <span className="text-zinc-500 font-normal tabular-nums">
                ({sortMode === 'usage' ? `${leader.usageCount} uses` : `${leader.rollScore.toFixed(2)} pts`})
              </span>
            </span>
          ) : (
            <span className="text-zinc-500">None</span>
          )}
        </div>
      </div>
    </button>
  );
};

/**
 * Displays total counts, #1 leaders, Random Roll eligibility, and sorted rankings
 * across Characters, Base Models, and LoRAs broken out by type.
 */
export const LibraryUsageRankingsCard: React.FC = () => {
  const [data, setData] = useState<LibraryUsageStatsResponse | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<UsageRankSortMode>('usage');
  const [activeTab, setActiveTab] = useState<LibraryTab>('characters');
  const [loraFilter, setLoraFilter] = useState<LoraSubFilter>('all');

  const fetchLibraryStats = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await api.getLibraryUsageStats();
      setData(res);
    } catch (err: any) {
      setError(err?.message || 'Failed to load library usage rankings.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLibraryStats();
  }, [fetchLibraryStats]);

  const filteredLoraItems = useMemo(() => {
    const all = data?.loras.items ?? [];
    if (loraFilter === 'all') return all;
    if (loraFilter === 'roll_pool') return all.filter((item) => item.rollEligible);
    return all.filter((item) => item.category === loraFilter);
  }, [data, loraFilter]);

  const activeItems = useMemo(() => {
    if (!data) return [];
    if (activeTab === 'characters') return data.characters.items;
    if (activeTab === 'baseModels') return data.baseModels.items;
    return filteredLoraItems;
  }, [data, activeTab, filteredLoraItems]);

  return (
    <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-4 sm:p-5 space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <div className="p-2 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-300 shrink-0">
            <Dices className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-zinc-100">
              Library Usage &amp; Random Roll Rankings
            </h2>
            <p className="text-[11px] text-zinc-400">
              Non-rejected gallery counts feeding Random Roll · Score = (1 + √uses) × fav boost
              (baseline odds before recent-roll cooldown).
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          {/* Sort Mode Toggle */}
          <div className="inline-flex bg-zinc-950 border border-zinc-800 rounded-xl p-1">
            <button
              type="button"
              onClick={() => setSortMode('usage')}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors cursor-pointer ${
                sortMode === 'usage'
                  ? 'bg-cyan-500/20 text-cyan-200 border border-cyan-500/40'
                  : 'text-zinc-400 hover:text-zinc-200 border border-transparent'
              }`}
            >
              Usage
            </button>
            <button
              type="button"
              onClick={() => setSortMode('roll_score')}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors cursor-pointer ${
                sortMode === 'roll_score'
                  ? 'bg-indigo-500/25 text-indigo-200 border border-indigo-500/40'
                  : 'text-zinc-400 hover:text-zinc-200 border border-transparent'
              }`}
            >
              Roll Score
            </button>
          </div>

          <button
            type="button"
            onClick={fetchLibraryStats}
            disabled={isLoading}
            title="Refresh library usage stats"
            className="p-2 rounded-xl bg-zinc-950 border border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:border-zinc-700 disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-xl bg-rose-500/15 border border-rose-500/40 text-rose-200 text-xs">
          {error}
        </div>
      )}

      {/* Top Summary Tiles */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <GroupSummaryTile
          title="Characters"
          icon={<Users className="w-3.5 h-3.5 text-emerald-300" />}
          accentClass="bg-emerald-500/15 border-emerald-500/30"
          group={data?.characters}
          sortMode={sortMode}
          active={activeTab === 'characters'}
          onClick={() => setActiveTab('characters')}
          unitLabel="total"
        />
        <GroupSummaryTile
          title="Base Models"
          icon={<Cpu className="w-3.5 h-3.5 text-violet-300" />}
          accentClass="bg-violet-500/15 border-violet-500/30"
          group={data?.baseModels}
          sortMode={sortMode}
          active={activeTab === 'baseModels'}
          onClick={() => setActiveTab('baseModels')}
          unitLabel="installed"
        />
        <GroupSummaryTile
          title="LoRAs (All Types)"
          icon={<Sparkles className="w-3.5 h-3.5 text-indigo-300" />}
          accentClass="bg-indigo-500/15 border-indigo-500/30"
          group={data?.loras}
          sortMode={sortMode}
          active={activeTab === 'loras'}
          onClick={() => setActiveTab('loras')}
          unitLabel="installed"
        />
      </div>

      {/* LoRAs by Type Breakdown Strip */}
      {data && (
        <div className="bg-black/45 border border-zinc-800/90 rounded-xl p-3.5 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-indigo-300">
              <Layers className="w-3.5 h-3.5" />
              LoRAs by Type
            </div>
            <span className="text-[10px] text-zinc-500">
              Click any type to filter the ranked list below
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {data.loraByCategory.map((cat) => {
              const leader = sortMode === 'usage' ? cat.topByUsage : cat.topByRollScore;
              const isSelected = activeTab === 'loras' && loraFilter === cat.category;

              return (
                <button
                  key={cat.category}
                  type="button"
                  disabled={cat.totalCount === 0}
                  onClick={() => {
                    setActiveTab('loras');
                    setLoraFilter(cat.category);
                  }}
                  className={`text-left rounded-lg p-2.5 border transition-colors ${
                    cat.totalCount === 0
                      ? 'bg-zinc-950/40 border-zinc-800/50 opacity-45 cursor-default'
                      : isSelected
                        ? 'bg-indigo-500/15 border-indigo-500/50 cursor-pointer'
                        : 'bg-zinc-950/80 border-zinc-800/90 hover:border-zinc-700 cursor-pointer'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1.5">
                    <span className="text-[11px] font-semibold text-zinc-200">{cat.label}</span>
                    <span className="text-xs font-bold text-zinc-100 tabular-nums">
                      {cat.totalCount}
                    </span>
                  </div>
                  <div className="text-[10px] text-zinc-500 tabular-nums mt-0.5">
                    {cat.category === 'character'
                      ? 'Rolled via character'
                      : `${cat.eligibleCount} in roll`}
                  </div>
                  <div className="mt-1.5 pt-1 border-t border-zinc-800/70 text-[10px] truncate">
                    {leader ? (
                      <span className="text-zinc-300" title={leader.name}>
                        <span className="text-amber-300/90">#1</span> {leader.name}{' '}
                        <span className="text-zinc-500 tabular-nums">
                          ({sortMode === 'usage' ? `${leader.usageCount}` : leader.rollScore.toFixed(1)})
                        </span>
                      </span>
                    ) : (
                      <span className="text-zinc-600">No installed LoRAs</span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Detail Tabs & LoRA Sub-Filters */}
      <div className="space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div className="inline-flex bg-zinc-950 border border-zinc-800 rounded-xl p-1 self-start">
            <button
              type="button"
              onClick={() => setActiveTab('characters')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                activeTab === 'characters'
                  ? 'bg-emerald-500/20 text-emerald-200 border border-emerald-500/40'
                  : 'text-zinc-400 hover:text-zinc-200 border border-transparent'
              }`}
            >
              Characters ({data?.characters.totalCount ?? 0})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('baseModels')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                activeTab === 'baseModels'
                  ? 'bg-violet-500/20 text-violet-200 border border-violet-500/40'
                  : 'text-zinc-400 hover:text-zinc-200 border border-transparent'
              }`}
            >
              Base Models ({data?.baseModels.totalCount ?? 0})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('loras')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                activeTab === 'loras'
                  ? 'bg-indigo-500/20 text-indigo-200 border border-indigo-500/40'
                  : 'text-zinc-400 hover:text-zinc-200 border border-transparent'
              }`}
            >
              LoRAs ({data?.loras.totalCount ?? 0})
            </button>
          </div>

          {activeTab === 'loras' && data && (
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => setLoraFilter('all')}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-colors cursor-pointer ${
                  loraFilter === 'all'
                    ? 'bg-indigo-500/20 text-indigo-200 border-indigo-500/40'
                    : 'bg-zinc-950 text-zinc-400 border-zinc-800 hover:text-zinc-200'
                }`}
              >
                All ({data.loras.totalCount})
              </button>
              <button
                type="button"
                onClick={() => setLoraFilter('roll_pool')}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-colors cursor-pointer ${
                  loraFilter === 'roll_pool'
                    ? 'bg-emerald-500/20 text-emerald-200 border-emerald-500/40'
                    : 'bg-zinc-950 text-zinc-400 border-zinc-800 hover:text-zinc-200'
                }`}
              >
                Roll Pool ({data.loras.eligibleCount})
              </button>
              {data.loraByCategory
                .filter((cat) => cat.totalCount > 0)
                .map((cat) => (
                  <button
                    key={cat.category}
                    type="button"
                    onClick={() => setLoraFilter(cat.category)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-colors cursor-pointer ${
                      loraFilter === cat.category
                        ? 'bg-indigo-500/20 text-indigo-200 border-indigo-500/40'
                        : 'bg-zinc-950 text-zinc-400 border-zinc-800 hover:text-zinc-200'
                    }`}
                  >
                    {cat.label} ({cat.totalCount})
                  </button>
                ))}
            </div>
          )}
        </div>

        {/* Ranked List */}
        {isLoading && !data ? (
          <div className="h-44 rounded-xl bg-zinc-950/60 border border-zinc-800/80 flex items-center justify-center text-xs text-zinc-500">
            Loading library usage rankings…
          </div>
        ) : (
          <UsageRankList
            key={`${activeTab}-${loraFilter}`}
            items={activeItems}
            sortMode={sortMode}
            showCategoryTag={activeTab === 'loras' && (loraFilter === 'all' || loraFilter === 'roll_pool')}
            isFilteredSubset={activeTab === 'loras' && loraFilter !== 'all'}
            emptyMessage={
              activeTab === 'characters'
                ? 'No characters defined yet.'
                : activeTab === 'baseModels'
                  ? 'No installed base models found.'
                  : 'No installed LoRAs match the selected filter.'
            }
          />
        )}
      </div>
    </div>
  );
};
