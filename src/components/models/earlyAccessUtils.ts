/**
 * Helpers for formatting Civitai Early Access unlock timestamps and default scheduling buffers.
 */

export function getSuggestedScheduledIso(
  earlyAccessEndsAt?: string | null,
  bufferSeconds = 60
): string {
  const now = Date.now();
  const parsed = earlyAccessEndsAt ? Date.parse(earlyAccessEndsAt) : NaN;
  const targetMs = Number.isFinite(parsed)
    ? Math.max(parsed + bufferSeconds * 1000, now + bufferSeconds * 1000)
    : now + 60 * 60 * 1000;
  return new Date(targetMs).toISOString();
}

export function toLocalDateTimeInputValue(isoString?: string | null): string {
  const ms = isoString ? Date.parse(isoString) : NaN;
  const d = Number.isFinite(ms) ? new Date(ms) : new Date(Date.now() + 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

export function formatUnlockLocalTime(isoString?: string | null): string {
  if (!isoString) return 'Pending unlock';
  const ms = Date.parse(isoString);
  if (!Number.isFinite(ms)) return 'Pending unlock';
  return new Date(ms).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function formatUnlockCountdown(isoString?: string | null): string {
  if (!isoString) return 'time unknown';
  const ms = Date.parse(isoString);
  if (!Number.isFinite(ms)) return 'time unknown';
  const diffMs = ms - Date.now();
  if (diffMs <= 60_000) return 'shortly';
  const totalMins = Math.round(diffMs / 60_000);
  const days = Math.floor(totalMins / (60 * 24));
  const hours = Math.floor((totalMins % (60 * 24)) / 60);
  const mins = totalMins % 60;
  if (days > 0) return `in ${days}d ${hours}h`;
  if (hours > 0) return `in ${hours}h ${mins}m`;
  return `in ${mins}m`;
}
