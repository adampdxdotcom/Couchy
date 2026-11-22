import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BarChart3, Calendar, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import { api } from '../../api/client.ts';
import { StorageUsageCard } from './StorageUsageCard.tsx';
import { LibraryUsageRankingsCard } from './LibraryUsageRankingsCard.tsx';
import type {
  GenerationStatsBucket,
  GenerationStatsResponse,
  StatsGranularity,
  StatsPeriod,
} from '../../shared/types.ts';

const PERIOD_OPTIONS: Array<{ id: StatsPeriod; label: string }> = [
  { id: 'day', label: 'Day' },
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
  { id: 'year', label: 'Year' },
];

const GRANULARITY_OPTIONS: Record<
  StatsPeriod,
  Array<{ id: StatsGranularity; label: string }>
> = {
  day: [
    { id: 'hour', label: 'Hourly' },
    { id: 'half_hour', label: '30 Min' },
    { id: 'quarter_hour', label: '15 Min' },
  ],
  week: [
    { id: 'day', label: 'Daily' },
    { id: 'half_day', label: 'Half Day (12h)' },
    { id: '6_hour', label: '6 Hours' },
  ],
  month: [
    { id: 'day', label: 'Daily' },
    { id: 'week', label: 'Weekly' },
  ],
  year: [
    { id: 'month', label: 'Monthly' },
    { id: 'week', label: 'Weekly' },
  ],
};

function getTodayLocalYmd(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function isoToLocalYmd(isoString: string): string {
  const dt = new Date(isoString);
  if (Number.isNaN(dt.getTime())) return getTodayLocalYmd();
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const d = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function shiftAnchorYmd(ymd: string, period: StatsPeriod, delta: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  if (period === 'day') {
    dt.setDate(dt.getDate() + delta);
  } else if (period === 'week') {
    dt.setDate(dt.getDate() + delta * 7);
  } else if (period === 'month') {
    dt.setDate(1);
    dt.setMonth(dt.getMonth() + delta);
  } else {
    dt.setMonth(0, 1);
    dt.setFullYear(dt.getFullYear() + delta);
  }
  const ny = dt.getFullYear();
  const nm = String(dt.getMonth() + 1).padStart(2, '0');
  const nd = String(dt.getDate()).padStart(2, '0');
  return `${ny}-${nm}-${nd}`;
}

/**
 * Computes a clean integer upper bound and 4 evenly-spaced Y-axis tick values.
 */
function computeYAxisScale(maxCount: number): { maxY: number; ticks: number[] } {
  if (maxCount <= 4) {
    return { maxY: 4, ticks: [4, 3, 2, 1, 0] };
  }
  const roughStep = maxCount / 4;
  const magnitude = Math.pow(10, Math.floor(Math.log10(roughStep)));
  const normalized = roughStep / magnitude;
  let niceStep = magnitude;
  if (normalized > 5) niceStep = 10 * magnitude;
  else if (normalized > 2) niceStep = 5 * magnitude;
  else if (normalized > 1) niceStep = 2 * magnitude;

  const maxY = Math.max(4, Math.ceil(maxCount / (4 * niceStep)) * 4 * niceStep);
  const step = maxY / 4;
  return {
    maxY,
    ticks: [maxY, maxY - step, maxY - step * 2, maxY - step * 3, 0],
  };
}

/**
 * Determines whether to print the X-axis tick label at a given bucket index so labels
 * stay readable across dense granularities (e.g. 96 quarter-hour bars or 53 weeks).
 */
function shouldShowXLabel(
  period: StatsPeriod,
  granularity: StatsGranularity,
  index: number,
  bucket: GenerationStatsBucket
): boolean {
  if (period === 'day') {
    if (granularity === 'hour') return index % 3 === 0;
    if (granularity === 'half_hour') return index % 6 === 0;
    return index % 12 === 0;
  }
  if (period === 'week') {
    if (granularity === 'day') return true;
    if (granularity === 'half_day') return index % 2 === 0;
    return index % 4 === 0;
  }
  if (period === 'month') {
    if (granularity === 'week') return true;
    const dayNum = index + 1;
    return dayNum === 1 || dayNum % 5 === 0;
  }
  // year
  if (granularity === 'month') return true;
  return Boolean(bucket.shortLabel);
}

/**
 * System Stats section: adjustable generations bar graph across Day, Week, Month, and Year
 * views with black canvas and alternating indigo / cyan bars.
 */
export const StatsSection: React.FC = () => {
  const [period, setPeriod] = useState<StatsPeriod>('day');
  const [granularity, setGranularity] = useState<StatsGranularity>('hour');
  const [anchorDate, setAnchorDate] = useState<string>(() => getTodayLocalYmd());
  const [stats, setStats] = useState<GenerationStatsResponse | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  const tzOffsetMinutes = useMemo(() => -new Date().getTimezoneOffset(), []);

  const fetchStats = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await api.getGenerationStats({
        period,
        granularity,
        anchorDate,
        tzOffsetMinutes,
      });
      setStats(res);
      setSelectedIndex(null);
    } catch (err: any) {
      setError(err?.message || 'Failed to load generation stats.');
    } finally {
      setIsLoading(false);
    }
  }, [period, granularity, anchorDate, tzOffsetMinutes]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  const handleSelectPeriod = (nextPeriod: StatsPeriod) => {
    setPeriod(nextPeriod);
    const defaultGranularity = GRANULARITY_OPTIONS[nextPeriod][0].id;
    setGranularity(defaultGranularity);
  };

  const buckets = stats?.buckets || [];
  const maxCount = useMemo(
    () => buckets.reduce((max, b) => Math.max(max, b.count), 0),
    [buckets]
  );
  const { maxY, ticks } = useMemo(() => computeYAxisScale(maxCount), [maxCount]);

  const activeBucket =
    selectedIndex !== null && buckets[selectedIndex] ? buckets[selectedIndex] : null;

  const isCurrentAnchorToday = anchorDate === getTodayLocalYmd();
  const latestLocalYmd = stats?.latestGenerationIso
    ? isoToLocalYmd(stats.latestGenerationIso)
    : null;

  return (
    <div className="space-y-4">
      <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-4 sm:p-5 space-y-4">
        {/* Header & Controls */}
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <div className="p-2 rounded-xl bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 shrink-0">
              <BarChart3 className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-zinc-100">
                Generations Over Time
              </h2>
              <p className="text-[11px] text-zinc-400">
                Counts all generated images on disk, including rejected and archived items.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Period Tabs */}
            <div className="inline-flex bg-zinc-950 border border-zinc-800 rounded-xl p-1 gap-1">
              {PERIOD_OPTIONS.map((opt) => {
                const active = period === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => handleSelectPeriod(opt.id)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                      active
                        ? 'bg-indigo-600 text-white'
                        : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/70'
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>

            {/* Refresh Button */}
            <button
              type="button"
              onClick={fetchStats}
              disabled={isLoading}
              title="Refresh stats"
              className="p-2 rounded-xl bg-zinc-950 border border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:border-zinc-700 disabled:opacity-50 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Date Navigation & Breakdown Selector */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-1 border-t border-zinc-800/80">
          {/* Date Navigator */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              type="button"
              onClick={() => setAnchorDate((prev) => shiftAnchorYmd(prev, period, -1))}
              className="p-1.5 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-300 hover:bg-zinc-800 cursor-pointer"
              aria-label={`Previous ${period}`}
            >
              <ChevronLeft className="w-4 h-4" />
            </button>

            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-100 font-medium min-w-[165px] justify-center">
              <Calendar className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
              <span>{stats?.rangeLabel || anchorDate}</span>
            </div>

            <button
              type="button"
              onClick={() => setAnchorDate((prev) => shiftAnchorYmd(prev, period, 1))}
              className="p-1.5 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-300 hover:bg-zinc-800 cursor-pointer"
              aria-label={`Next ${period}`}
            >
              <ChevronRight className="w-4 h-4" />
            </button>

            {!isCurrentAnchorToday && (
              <button
                type="button"
                onClick={() => setAnchorDate(getTodayLocalYmd())}
                className="px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-[11px] font-medium cursor-pointer"
              >
                {period === 'day' ? 'Today' : 'Current'}
              </button>
            )}

            {stats &&
              stats.totalCount === 0 &&
              latestLocalYmd &&
              latestLocalYmd !== anchorDate && (
                <button
                  type="button"
                  onClick={() => setAnchorDate(latestLocalYmd)}
                  className="px-2.5 py-1.5 rounded-lg bg-cyan-500/15 border border-cyan-500/35 hover:bg-cyan-500/25 text-cyan-300 text-[11px] font-medium cursor-pointer"
                >
                  Jump to Latest ({latestLocalYmd})
                </button>
              )}
          </div>

          {/* Breakdown Granularity Selector */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[11px] text-zinc-500 mr-1">Division:</span>
            {GRANULARITY_OPTIONS[period].map((opt) => {
              const active = granularity === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setGranularity(opt.id)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-colors cursor-pointer ${
                    active
                      ? 'bg-cyan-500/15 border-cyan-400/50 text-cyan-300'
                      : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:border-zinc-700'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Summary KPI Strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          <div className="bg-zinc-950/80 border border-zinc-800/90 rounded-xl px-3.5 py-2.5">
            <div className="text-[10px] uppercase tracking-wider text-zinc-500">
              In Period
            </div>
            <div className="text-lg font-semibold text-zinc-100 mt-0.5 tabular-nums">
              {stats ? stats.totalCount.toLocaleString() : '—'}
            </div>
          </div>

          <div className="bg-zinc-950/80 border border-zinc-800/90 rounded-xl px-3.5 py-2.5">
            <div className="text-[10px] uppercase tracking-wider text-zinc-500">
              Peak Division
            </div>
            <div className="text-sm font-semibold text-cyan-300 mt-1 truncate">
              {stats?.peakBucket
                ? `${stats.peakBucket.count.toLocaleString()} · ${stats.peakBucket.label}`
                : '0'}
            </div>
          </div>

          <div className="bg-zinc-950/80 border border-zinc-800/90 rounded-xl px-3.5 py-2.5">
            <div className="text-[10px] uppercase tracking-wider text-zinc-500">
              Avg / Division
            </div>
            <div className="text-lg font-semibold text-indigo-300 mt-0.5 tabular-nums">
              {stats ? stats.averagePerBucket : '—'}
            </div>
          </div>

          <div className="bg-zinc-950/80 border border-zinc-800/90 rounded-xl px-3.5 py-2.5">
            <div className="text-[10px] uppercase tracking-wider text-zinc-500">
              All-Time Images
            </div>
            <div className="text-lg font-semibold text-zinc-200 mt-0.5 tabular-nums">
              {stats ? stats.totalAllTime.toLocaleString() : '—'}
            </div>
          </div>
        </div>

        {error && (
          <div className="p-3 rounded-xl bg-rose-500/15 border border-rose-500/40 text-rose-200 text-xs">
            {error}
          </div>
        )}

        {/* Black Bar Graph Canvas */}
        <div className="bg-black border border-zinc-800 rounded-xl p-4 sm:p-5">
          {/* Active Bucket Inspection Header */}
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3 min-h-[24px]">
            <div className="text-[11px] text-zinc-400">
              {activeBucket ? (
                <span className="text-zinc-100 font-medium">
                  {activeBucket.rangeLabel}:{' '}
                  <span
                    className={
                      activeBucket.dayParity === 0 ? 'text-indigo-400' : 'text-cyan-300'
                    }
                  >
                    {activeBucket.count.toLocaleString()} generation
                    {activeBucket.count === 1 ? '' : 's'}
                  </span>
                </span>
              ) : (
                <span>Hover or tap any bar to inspect exact count and time window.</span>
              )}
            </div>

            <div className="flex items-center gap-3 text-[11px] text-zinc-400">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-indigo-500 inline-block" />
                <span className="w-2.5 h-2.5 rounded-sm bg-cyan-400 inline-block" />
                <span>
                  {granularity === 'week' || granularity === 'month'
                    ? 'Alternating periods'
                    : 'Alternating days'}
                </span>
              </span>
            </div>
          </div>

          {/* Chart Body: Y-axis + Plot Area */}
          <div className="flex gap-2 sm:gap-3">
            {/* Y-Axis Labels (matches h-[232px] plot container) */}
            <div className="flex flex-col justify-between items-end h-[232px] pr-1 text-[10px] text-zinc-400 tabular-nums select-none shrink-0 w-9 sm:w-11">
              {ticks.map((tick) => (
                <span key={tick} className="leading-none">
                  {tick.toLocaleString()}
                </span>
              ))}
            </div>

            {/* Plot + X-Axis */}
            <div className="flex-1 min-w-0 flex flex-col">
              {/* Plot Grid & Bars */}
              <div className="relative h-[232px] border-l border-b border-zinc-700">
                {/* Horizontal Reference Lines */}
                <div className="absolute inset-0 flex flex-col justify-between pointer-events-none">
                  {ticks.map((tick, idx) => (
                    <div
                      key={tick}
                      className={`w-full ${
                        idx === ticks.length - 1
                          ? ''
                          : 'border-t border-dashed border-zinc-800/90'
                      }`}
                    />
                  ))}
                </div>

                {/* Bars */}
                <div
                  className={`relative z-10 h-full w-full flex items-end ${
                    buckets.length > 60
                      ? 'gap-[1px] px-0.5'
                      : buckets.length > 24
                        ? 'gap-[2px] px-1'
                        : 'gap-1.5 px-1.5'
                  }`}
                  onMouseLeave={() => setSelectedIndex(null)}
                >
                  {buckets.map((bucket, idx) => {
                    const heightPct = bucket.count > 0 ? (bucket.count / maxY) * 100 : 0;
                    const isSelected = selectedIndex === idx;
                    const isIndigo = bucket.dayParity === 0;

                    return (
                      <button
                        key={bucket.key}
                        type="button"
                        onMouseEnter={() => setSelectedIndex(idx)}
                        onFocus={() => setSelectedIndex(idx)}
                        onClick={() => setSelectedIndex(idx)}
                        aria-label={`${bucket.rangeLabel}: ${bucket.count} generations`}
                        className="group relative flex-1 h-full flex items-end justify-center focus:outline-none cursor-pointer"
                      >
                        {/* Subtle hover column highlight */}
                        <span
                          className={`absolute inset-0 transition-colors ${
                            isSelected ? 'bg-white/[0.06]' : 'group-hover:bg-white/[0.04]'
                          }`}
                        />

                        {/* Bar Column */}
                        {bucket.count > 0 && (
                          <span
                            style={{ height: `${Math.max(2, heightPct)}%` }}
                            className={`relative w-full rounded-t-[2px] transition-all duration-150 ${
                              isIndigo
                                ? isSelected
                                  ? 'bg-indigo-400 shadow-[0_0_12px_rgba(129,140,248,0.5)]'
                                  : 'bg-indigo-500 group-hover:bg-indigo-400'
                                : isSelected
                                  ? 'bg-cyan-300 shadow-[0_0_12px_rgba(103,232,249,0.5)]'
                                  : 'bg-cyan-400 group-hover:bg-cyan-300'
                            }`}
                          />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* X-Axis Labels */}
              <div
                className={`h-6 pt-1.5 flex items-start ${
                  buckets.length > 60
                    ? 'gap-[1px] px-0.5'
                    : buckets.length > 24
                      ? 'gap-[2px] px-1'
                      : 'gap-1.5 px-1.5'
                }`}
              >
                {buckets.map((bucket, idx) => {
                  const showLabel = shouldShowXLabel(period, granularity, idx, bucket);
                  return (
                    <div
                      key={`${bucket.key}-lbl`}
                      className="flex-1 min-w-0 flex justify-center"
                    >
                      {showLabel && (
                        <span className="text-[10px] text-zinc-400 whitespace-nowrap select-none">
                          {bucket.shortLabel}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="mt-2 flex items-center justify-between text-[10px] text-zinc-500">
            <span>Y-axis: Generations</span>
            <span>X-axis: Time ({GRANULARITY_OPTIONS[period].find((g) => g.id === granularity)?.label})</span>
          </div>
        </div>
      </div>

      {/* Storage Usage Breakdown */}
      <StorageUsageCard />

      {/* Library Usage & Random Roll Rankings */}
      <LibraryUsageRankingsCard />
    </div>
  );
};
