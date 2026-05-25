import { cn } from '../utils/cn';
import type { MediaIssue } from './types';

interface MediaIssueBadgeProps {
  issue: MediaIssue | null;
  /**
   * Visual size variant. `sm` is the AssetCard corner badge;
   * `md` is the AssetDetailSidebar inline block (with full reason
   * text). Defaults to `sm`.
   */
  size?: 'sm' | 'md';
  className?: string;
}

/**
 * Format an oversized issue's size delta into customer-facing copy
 * for the `md` variant. `sm` only uses the short label so the corner
 * badge stays scannable; this helper kicks in for the sidebar block.
 *
 * Rounds to one decimal MB for readability — promoting "5.4 MB"
 * over "5,400,000 bytes" matches the rest of cms-spa's file-size
 * vocabulary (`formatFileSize`).
 */
function formatOversizedDetail(sizeBytes: number, limitBytes: number): string {
  const mb = (bytes: number) => (bytes / 1_000_000).toFixed(1).replace(/\.0$/, '') + ' MB';
  return mb(sizeBytes) + ' exceeds the ' + mb(limitBytes) + ' inline limit. Move to media storage.';
}

/**
 * Badge rendering a hosted-only `MediaIssue` ("Oversized" /
 * "Blocked"). When `issue` is `null`, renders nothing — callers
 * can mount this unconditionally and let it disappear when the
 * host has no bridge or the asset is healthy.
 *
 * Colour vocabulary:
 *
 * - `blocked` → red (matches the destructive / fail palette —
 *   "this cannot ship").
 * - `oversized` → amber (matches the "work in flight / take
 *   action" idiom shared with `AssetScopePill`'s branch variant —
 *   "it ships, just slower than it should").
 *
 * `sm` paints a compact one-word badge for the AssetCard corner
 * (sits below the scope pill so the two stack cleanly). `md` paints
 * a wider block with the full reason / size detail for the
 * AssetDetailSidebar header.
 */
export function MediaIssueBadge({ issue, size = 'sm', className }: MediaIssueBadgeProps) {
  if (!issue) return null;

  const isBlocked = issue.kind === 'blocked';
  const shortLabel = isBlocked ? 'Blocked' : 'Oversized';
  const sizeClasses = size === 'sm' ? 'text-[10px] px-1.5 py-0.5 leading-tight' : 'text-xs px-2 py-1';

  const variantClasses = isBlocked
    ? 'bg-red-11 dark:bg-red-02 text-red-04 dark:text-red-08 border-red-08 dark:border-red-03'
    : 'bg-amber-11 dark:bg-amber-02 text-amber-04 dark:text-amber-08 border-amber-08 dark:border-amber-03';

  // `md` paints the full reason / size delta so the sidebar
  // surface reads as a self-contained explanation, not just a
  // label. `sm` stays at the short label so the AssetCard corner
  // doesn't get crowded.
  const detail =
    size === 'md'
      ? issue.kind === 'blocked'
        ? issue.reason
        : formatOversizedDetail(issue.sizeBytes, issue.limitBytes)
      : null;

  return (
    <span
      role="status"
      aria-label={'Media issue: ' + shortLabel + (detail ? ' — ' + detail : '')}
      className={cn(
        'inline-flex items-center font-medium rounded border',
        size === 'sm' ? 'uppercase tracking-wide' : 'gap-2',
        sizeClasses,
        variantClasses,
        className,
      )}
    >
      <span className={size === 'md' ? 'uppercase tracking-wide font-semibold' : undefined}>{shortLabel}</span>
      {detail ? <span className="font-normal normal-case tracking-normal">{detail}</span> : null}
    </span>
  );
}
