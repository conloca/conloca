/**
 * Date display helpers shared by content lists and activity feeds.
 *
 * Content entries can carry a missing or unparseable `modified` value
 * (e.g. a manifest whose meta envelope was lost upstream). `new Date`
 * on such input yields an Invalid Date whose `toLocaleDateString()`
 * renders the literal string "Invalid Date" — never show that to users;
 * render an em dash instead.
 */

function isInvalid(date: Date): boolean {
  return Number.isNaN(date.getTime());
}

/** Locale date string, or an em dash for invalid dates. */
export function formatDate(date: Date): string {
  if (isInvalid(date)) return '—';
  return date.toLocaleDateString();
}

/** Compact "5m ago" / "3h ago" / "2d ago" relative label; locale date
 *  beyond a week, em dash for invalid dates. */
export function relativeTime(date: Date): string {
  if (isInvalid(date)) return '—';
  const diff = Date.now() - date.getTime();
  if (diff < 0) return 'just now';
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString();
}
