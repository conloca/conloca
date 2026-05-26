import { cn } from '../utils/cn';
import type { AssetScope } from './types';

interface AssetScopePillProps {
  scope: AssetScope | null;
  /**
   * Visual size variant. `sm` is the AssetCard corner badge;
   * `md` is the AssetDetailSidebar inline label. Defaults to `sm`.
   */
  size?: 'sm' | 'md';
  className?: string;
}

/**
 * Pill rendering the hosted-mode `AssetScope` ("Branch only" /
 * "Published"). When `scope` is `null`, renders nothing — callers
 * can safely render this unconditionally and let it disappear when
 * no bridge is installed (the local-Astro case).
 *
 * Colour vocabulary mirrors the broader cms-spa palette:
 *
 * - `published` → green (matches the deploy "live" indicator —
 *   "this is what your site is serving").
 * - `branch` → amber (matches the "work in flight" idiom from
 *   git-status / divergence banners — "yours alone for now,
 *   needs promotion before anyone else sees it").
 *
 * The pill itself is purely presentational; the bridge wiring and
 * promotion gate live in the host shell.
 */
export function AssetScopePill({ scope, size = 'sm', className }: AssetScopePillProps) {
  if (!scope) return null;

  const isBranch = scope === 'branch';
  const label = isBranch ? 'Branch only' : 'Published';
  const sizeClasses = size === 'sm' ? 'text-[10px] px-1.5 py-0.5 leading-tight' : 'text-xs px-2 py-0.5';

  const variantClasses = isBranch
    ? 'bg-yellow-11 dark:bg-yellow-02 text-yellow-04 dark:text-yellow-09 border-yellow-08 dark:border-yellow-03'
    : 'bg-green-11 dark:bg-green-02 text-green-04 dark:text-green-08 border-green-08 dark:border-green-03';

  return (
    <span
      role="status"
      aria-label={'Asset scope: ' + label}
      className={cn(
        'inline-flex items-center font-medium rounded border uppercase tracking-wide',
        sizeClasses,
        variantClasses,
        className,
      )}
    >
      {label}
    </span>
  );
}
