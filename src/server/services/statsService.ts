import { db } from '../db.ts';
import type {
  GenerationStatsBucket,
  GenerationStatsResponse,
  StatsGranularity,
  StatsPeriod,
} from '../../shared/types.ts';

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const VALID_GRANULARITIES: Record<StatsPeriod, StatsGranularity[]> = {
  day: ['hour', 'half_hour', 'quarter_hour'],
  week: ['day', 'half_day', '6_hour'],
  month: ['day', 'week'],
  year: ['month', 'week'],
};

const DEFAULT_GRANULARITY: Record<StatsPeriod, StatsGranularity> = {
  day: 'hour',
  week: 'day',
  month: 'day',
  year: 'month',
};

export function normalizeStatsPeriod(value?: string | null): StatsPeriod {
  if (value === 'day' || value === 'week' || value === 'month' || value === 'year') {
    return value;
  }
  return 'day';
}

export function normalizeStatsGranularity(
  period: StatsPeriod,
  value?: string | null
): StatsGranularity {
  const allowed = VALID_GRANULARITIES[period];
  if (value && allowed.includes(value as StatsGranularity)) {
    return value as StatsGranularity;
  }
  return DEFAULT_GRANULARITY[period];
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function formatYmd(year: number, monthIndex: number, day: number): string {
  return `${year}-${pad2(monthIndex + 1)}-${pad2(day)}`;
}

function formatTime12(hour24: number, minute: number): string {
  const suffix = hour24 >= 12 ? 'PM' : 'AM';
  const h12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${h12}:${pad2(minute)} ${suffix}`;
}

function formatHourShort(hour24: number): string {
  const suffix = hour24 >= 12 ? 'p' : 'a';
  const h12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${h12}${suffix}`;
}

/**
 * Parses YYYY-MM-DD into UTC year/monthIndex/day, falling back to current shifted local date.
 */
function parseAnchorYmd(anchorDate: string | undefined, tzOffsetMinutes: number): {
  year: number;
  month: number;
  day: number;
} {
  if (anchorDate && /^\d{4}-\d{2}-\d{2}$/.test(anchorDate)) {
    const [y, m, d] = anchorDate.split('-').map(Number);
    const probe = new Date(Date.UTC(y, m - 1, d));
    if (
      probe.getUTCFullYear() === y &&
      probe.getUTCMonth() === m - 1 &&
      probe.getUTCDate() === d
    ) {
      return { year: y, month: m - 1, day: d };
    }
  }
  const shiftedNow = new Date(Date.now() + tzOffsetMinutes * MS_PER_MINUTE);
  return {
    year: shiftedNow.getUTCFullYear(),
    month: shiftedNow.getUTCMonth(),
    day: shiftedNow.getUTCDate(),
  };
}

interface InternalBucket {
  key: string;
  label: string;
  shortLabel: string;
  rangeLabel: string;
  dayParity: 0 | 1;
  startMs: number;
  endMs: number;
  count: number;
}

/**
 * Builds deterministic time buckets across a calendar day, week, month, or year
 * using the client's signed UTC offset (e.g. -480 for UTC-8) for wall-clock alignment.
 */
function buildBuckets(
  period: StatsPeriod,
  granularity: StatsGranularity,
  anchor: { year: number; month: number; day: number },
  tzOffsetMinutes: number
): { buckets: InternalBucket[]; rangeLabel: string; rangeStartMs: number; rangeEndMs: number } {
  const offsetMs = tzOffsetMinutes * MS_PER_MINUTE;
  const toUtcMs = (shiftedMs: number) => shiftedMs - offsetMs;
  const dayParityFromShifted = (shiftedDayStartMs: number): 0 | 1 =>
    (Math.abs(Math.floor(shiftedDayStartMs / MS_PER_DAY)) % 2) as 0 | 1;

  const buckets: InternalBucket[] = [];

  if (period === 'day') {
    const dayStartShifted = Date.UTC(anchor.year, anchor.month, anchor.day, 0, 0, 0);
    const dayEndShifted = dayStartShifted + MS_PER_DAY;
    const stepMinutes = granularity === 'quarter_hour' ? 15 : granularity === 'half_hour' ? 30 : 60;
    const totalSteps = Math.floor(1440 / stepMinutes);
    const parity = dayParityFromShifted(dayStartShifted);

    for (let i = 0; i < totalSteps; i++) {
      const startMin = i * stepMinutes;
      const endMin = startMin + stepMinutes;
      const startShifted = dayStartShifted + startMin * MS_PER_MINUTE;
      const endShifted = dayStartShifted + endMin * MS_PER_MINUTE;
      const h = Math.floor(startMin / 60);
      const m = startMin % 60;
      const endH = Math.floor(endMin / 60) % 24;
      const endM = endMin % 60;

      const label = formatTime12(h, m);
      const endLabel = endMin === 1440 ? '12:00 AM' : formatTime12(endH, endM);
      const shortLabel = m === 0 ? formatHourShort(h) : `${h}:${pad2(m)}`;

      buckets.push({
        key: `${pad2(h)}:${pad2(m)}`,
        label,
        shortLabel,
        rangeLabel: `${label} - ${endLabel}`,
        dayParity: parity,
        startMs: toUtcMs(startShifted),
        endMs: toUtcMs(endShifted),
        count: 0,
      });
    }

    const weekday = WEEKDAY_SHORT[new Date(dayStartShifted).getUTCDay()];
    const rangeLabel = `${weekday}, ${MONTH_SHORT[anchor.month]} ${anchor.day}, ${anchor.year}`;
    return {
      buckets,
      rangeLabel,
      rangeStartMs: toUtcMs(dayStartShifted),
      rangeEndMs: toUtcMs(dayEndShifted),
    };
  }

  if (period === 'week') {
    // Align week Sunday..Saturday around the anchor date
    const anchorShifted = Date.UTC(anchor.year, anchor.month, anchor.day, 0, 0, 0);
    const dow = new Date(anchorShifted).getUTCDay();
    const weekStartShifted = anchorShifted - dow * MS_PER_DAY;
    const weekEndShifted = weekStartShifted + 7 * MS_PER_DAY;

    const divisionsPerDay = granularity === '6_hour' ? 4 : granularity === 'half_day' ? 2 : 1;
    const hoursPerDivision = 24 / divisionsPerDay;

    for (let d = 0; d < 7; d++) {
      const dayStartShifted = weekStartShifted + d * MS_PER_DAY;
      const dt = new Date(dayStartShifted);
      const dayName = WEEKDAY_SHORT[dt.getUTCDay()];
      const dayNum = dt.getUTCDate();
      const monName = MONTH_SHORT[dt.getUTCMonth()];
      const parity = dayParityFromShifted(dayStartShifted);

      for (let slot = 0; slot < divisionsPerDay; slot++) {
        const startHour = slot * hoursPerDivision;
        const endHour = startHour + hoursPerDivision;
        const startShifted = dayStartShifted + startHour * MS_PER_HOUR;
        const endShifted = dayStartShifted + endHour * MS_PER_HOUR;

        let label = `${dayName} ${monName} ${dayNum}`;
        let shortLabel = `${dayName} ${dayNum}`;
        let rangeLabel = `${dayName}, ${monName} ${dayNum}`;

        if (divisionsPerDay === 2) {
          const half = slot === 0 ? 'AM' : 'PM';
          label = `${dayName} ${dayNum} ${half}`;
          shortLabel = slot === 0 ? `${dayName} ${dayNum}` : 'PM';
          rangeLabel = `${dayName}, ${monName} ${dayNum} (${slot === 0 ? '12:00 AM - 12:00 PM' : '12:00 PM - 12:00 AM'})`;
        } else if (divisionsPerDay === 4) {
          const endHourDisp = endHour === 24 ? '12:00 AM' : formatTime12(endHour, 0);
          label = `${dayName} ${dayNum} ${formatHourShort(startHour)}`;
          shortLabel = slot === 0 ? `${dayName} ${dayNum}` : formatHourShort(startHour);
          rangeLabel = `${dayName}, ${monName} ${dayNum} (${formatTime12(startHour, 0)} - ${endHourDisp})`;
        }

        buckets.push({
          key: `${formatYmd(dt.getUTCFullYear(), dt.getUTCMonth(), dayNum)}-${slot}`,
          label,
          shortLabel,
          rangeLabel,
          dayParity: parity,
          startMs: toUtcMs(startShifted),
          endMs: toUtcMs(endShifted),
          count: 0,
        });
      }
    }

    const startDt = new Date(weekStartShifted);
    const endDt = new Date(weekEndShifted - MS_PER_DAY);
    const rangeLabel = `${MONTH_SHORT[startDt.getUTCMonth()]} ${startDt.getUTCDate()} - ${MONTH_SHORT[endDt.getUTCMonth()]} ${endDt.getUTCDate()}, ${endDt.getUTCFullYear()}`;
    return {
      buckets,
      rangeLabel,
      rangeStartMs: toUtcMs(weekStartShifted),
      rangeEndMs: toUtcMs(weekEndShifted),
    };
  }

  if (period === 'month') {
    const monthStartShifted = Date.UTC(anchor.year, anchor.month, 1, 0, 0, 0);
    const monthEndShifted = Date.UTC(anchor.year, anchor.month + 1, 1, 0, 0, 0);
    const daysInMonth = Math.round((monthEndShifted - monthStartShifted) / MS_PER_DAY);

    if (granularity === 'week') {
      let weekIdx = 0;
      for (let dayStart = 1; dayStart <= daysInMonth; dayStart += 7) {
        const dayEnd = Math.min(daysInMonth, dayStart + 6);
        const startShifted = Date.UTC(anchor.year, anchor.month, dayStart, 0, 0, 0);
        const endShifted = Date.UTC(anchor.year, anchor.month, dayEnd + 1, 0, 0, 0);
        const mon = MONTH_SHORT[anchor.month];

        buckets.push({
          key: `${anchor.year}-${pad2(anchor.month + 1)}-w${weekIdx + 1}`,
          label: `${mon} ${dayStart}-${dayEnd}`,
          shortLabel: `${dayStart}-${dayEnd}`,
          rangeLabel: `${MONTH_LONG[anchor.month]} ${dayStart} - ${dayEnd}, ${anchor.year}`,
          dayParity: (weekIdx % 2) as 0 | 1,
          startMs: toUtcMs(startShifted),
          endMs: toUtcMs(endShifted),
          count: 0,
        });
        weekIdx += 1;
      }
    } else {
      for (let d = 1; d <= daysInMonth; d++) {
        const startShifted = Date.UTC(anchor.year, anchor.month, d, 0, 0, 0);
        const endShifted = startShifted + MS_PER_DAY;
        const weekday = WEEKDAY_SHORT[new Date(startShifted).getUTCDay()];
        buckets.push({
          key: formatYmd(anchor.year, anchor.month, d),
          label: `${MONTH_SHORT[anchor.month]} ${d}`,
          shortLabel: String(d),
          rangeLabel: `${weekday}, ${MONTH_SHORT[anchor.month]} ${d}, ${anchor.year}`,
          dayParity: dayParityFromShifted(startShifted),
          startMs: toUtcMs(startShifted),
          endMs: toUtcMs(endShifted),
          count: 0,
        });
      }
    }

    return {
      buckets,
      rangeLabel: `${MONTH_LONG[anchor.month]} ${anchor.year}`,
      rangeStartMs: toUtcMs(monthStartShifted),
      rangeEndMs: toUtcMs(monthEndShifted),
    };
  }

  // period === 'year'
  const yearStartShifted = Date.UTC(anchor.year, 0, 1, 0, 0, 0);
  const yearEndShifted = Date.UTC(anchor.year + 1, 0, 1, 0, 0, 0);

  if (granularity === 'week') {
    let cursor = yearStartShifted;
    let weekNum = 1;
    while (cursor < yearEndShifted) {
      const next = Math.min(yearEndShifted, cursor + 7 * MS_PER_DAY);
      const sDt = new Date(cursor);
      const eDt = new Date(next - MS_PER_DAY);
      const label = `W${weekNum}`;
      buckets.push({
        key: `${anchor.year}-w${pad2(weekNum)}`,
        label,
        shortLabel: weekNum === 1 || weekNum % 4 === 0 ? label : '',
        rangeLabel: `${MONTH_SHORT[sDt.getUTCMonth()]} ${sDt.getUTCDate()} - ${MONTH_SHORT[eDt.getUTCMonth()]} ${eDt.getUTCDate()}, ${anchor.year}`,
        dayParity: ((weekNum - 1) % 2) as 0 | 1,
        startMs: toUtcMs(cursor),
        endMs: toUtcMs(next),
        count: 0,
      });
      cursor = next;
      weekNum += 1;
    }
  } else {
    for (let m = 0; m < 12; m++) {
      const startShifted = Date.UTC(anchor.year, m, 1, 0, 0, 0);
      const endShifted = Date.UTC(anchor.year, m + 1, 1, 0, 0, 0);
      buckets.push({
        key: `${anchor.year}-${pad2(m + 1)}`,
        label: `${MONTH_LONG[m]} ${anchor.year}`,
        shortLabel: MONTH_SHORT[m],
        rangeLabel: `${MONTH_LONG[m]} ${anchor.year}`,
        dayParity: (m % 2) as 0 | 1,
        startMs: toUtcMs(startShifted),
        endMs: toUtcMs(endShifted),
        count: 0,
      });
    }
  }

  return {
    buckets,
    rangeLabel: String(anchor.year),
    rangeStartMs: toUtcMs(yearStartShifted),
    rangeEndMs: toUtcMs(yearEndShifted),
  };
}

/**
 * Aggregates generation counts across all non-missing images (including rejected & archived)
 * for the requested period, breakdown granularity, and client local timezone offset.
 */
export function getGenerationStats(params: {
  period?: string | null;
  granularity?: string | null;
  anchorDate?: string | null;
  tzOffsetMinutes?: number;
}): GenerationStatsResponse {
  const period = normalizeStatsPeriod(params.period);
  const granularity = normalizeStatsGranularity(period, params.granularity);
  const tzOffsetMinutes = Number.isFinite(params.tzOffsetMinutes)
    ? Math.max(-840, Math.min(840, Math.trunc(params.tzOffsetMinutes as number)))
    : 0;

  const anchor = parseAnchorYmd(params.anchorDate || undefined, tzOffsetMinutes);
  const { buckets, rangeLabel, rangeStartMs, rangeEndMs } = buildBuckets(
    period,
    granularity,
    anchor,
    tzOffsetMinutes
  );

  const rangeStartIso = new Date(rangeStartMs).toISOString();
  const rangeEndIso = new Date(rangeEndMs).toISOString();

  // Include all non-missing images (both rejected and archived) since all represent real generations
  const rows = db
    .prepare(
      `SELECT file_mtime
       FROM images
       WHERE is_missing = 0
         AND file_mtime >= ?
         AND file_mtime < ?
       ORDER BY file_mtime ASC`
    )
    .all(rangeStartIso, rangeEndIso) as Array<{ file_mtime: string }>;

  const totalsRow = db
    .prepare(
      `SELECT COUNT(*) AS totalAllTime, MAX(file_mtime) AS latestGenerationIso
       FROM images
       WHERE is_missing = 0`
    )
    .get() as { totalAllTime: number; latestGenerationIso: string | null } | undefined;

  let bucketIdx = 0;
  let totalCount = 0;

  for (const row of rows) {
    const ms = Date.parse(row.file_mtime);
    if (!Number.isFinite(ms)) continue;
    while (bucketIdx < buckets.length && ms >= buckets[bucketIdx].endMs) {
      bucketIdx += 1;
    }
    if (bucketIdx < buckets.length && ms >= buckets[bucketIdx].startMs && ms < buckets[bucketIdx].endMs) {
      buckets[bucketIdx].count += 1;
      totalCount += 1;
    }
  }

  let peakBucket: GenerationStatsResponse['peakBucket'] = null;
  for (const b of buckets) {
    if (b.count > 0 && (!peakBucket || b.count > peakBucket.count)) {
      peakBucket = { label: b.label, rangeLabel: b.rangeLabel, count: b.count };
    }
  }

  const outputBuckets: GenerationStatsBucket[] = buckets.map((b) => ({
    key: b.key,
    label: b.label,
    shortLabel: b.shortLabel,
    rangeLabel: b.rangeLabel,
    count: b.count,
    dayParity: b.dayParity,
    startIso: new Date(b.startMs).toISOString(),
    endIso: new Date(b.endMs).toISOString(),
  }));

  return {
    period,
    granularity,
    anchorDate: formatYmd(anchor.year, anchor.month, anchor.day),
    rangeLabel,
    rangeStartIso,
    rangeEndIso,
    totalCount,
    totalAllTime: totalsRow?.totalAllTime || 0,
    latestGenerationIso: totalsRow?.latestGenerationIso || null,
    peakBucket,
    averagePerBucket: buckets.length > 0 ? Number((totalCount / buckets.length).toFixed(2)) : 0,
    buckets: outputBuckets,
  };
}
