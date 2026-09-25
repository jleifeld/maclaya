const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
const integer = new Intl.NumberFormat('en');

export function formatCount(value: number): string {
  return value >= 10_000 ? compact.format(value) : integer.format(value);
}

export function formatMs(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  if (value >= 10_000) return `${(value / 1000).toFixed(1)} s`;
  if (value >= 1000) return `${(value / 1000).toFixed(2)} s`;
  if (value >= 100 || value === 0) return `${Math.round(value)} ms`;
  return `${value.toFixed(1)} ms`;
}

export function formatPercent(value: number, digits = 1): string {
  return `${(value * 100).toFixed(digits)}%`;
}

export function formatProbability(value: number): string {
  return value.toFixed(value >= 0.995 || value <= 0.005 ? 3 : 2);
}

export function formatRelative(ts: number, now: number = Date.now()): string {
  const seconds = Math.round((now - ts) / 1000);
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function formatClock(ts: number, withSeconds = false): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', ...(withSeconds ? { second: '2-digit' } : {}) });
}

export function formatBucketLabel(ts: number, bucketMs: number): string {
  const date = new Date(ts);
  if (bucketMs >= 60 * 60_000) return date.toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });
  return formatClock(ts, bucketMs < 60_000);
}

export function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  return `${Math.floor(seconds / 86_400)}d ${Math.floor((seconds % 86_400) / 3600)}h`;
}
