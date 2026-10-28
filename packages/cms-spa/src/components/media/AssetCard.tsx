import { useAssetServeSrc } from '../../frame/media-cache.js';
import type { AssetEntry } from '../../hooks/index.js';
import { AssetScopePill } from '../../media/AssetScopePill.js';
import { MediaIssueBadge } from '../../media/MediaIssueBadge.js';
import { useAssetScope } from '../../media/use-asset-scope.js';
import { useMediaIssue } from '../../media/use-media-issue.js';
import { cn } from '../../utils/cn.js';

interface AssetCardProps {
  asset: AssetEntry;
  /** Whether this card is selected (multi-select) */
  isSelected?: boolean;
  /** Called when card is clicked (for toggle selection) */
  onClick?: () => void;
  /** Called when card is double-clicked (for detail view) */
  onDoubleClick?: () => void;
  assetsBasePath?: string;
}

export function AssetCard({
  asset,
  isSelected,
  onClick,
  onDoubleClick,
  assetsBasePath = '/__cms/api/assets/serve',
}: AssetCardProps) {
  // Only with a host bridge: ask the host app whether this asset is
  // branch-only or published. Returns null when no `mediaBridge` is
  // installed — the AssetScopePill skips rendering, so astro-cms /
  // local dev see the card unchanged.
  const scope = useAssetScope(asset.filename, asset.folder);
  // Only with a host bridge: oversized / blocked status the host
  // reports. Returns null when the host has no opinion — surfaces
  // degrade exactly like the scope pill in standalone mounts.
  const issue = useMediaIssue(asset.filename, asset.folder);
  const src = useAssetServeSrc(assetsBasePath, asset.folder, asset.filename);

  const handleClick = () => {
    onClick?.();
  };

  const handleDoubleClick = () => {
    onDoubleClick?.();
  };

  return (
    <button
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      type="button"
      className={cn(
        'group relative rounded-md overflow-hidden cursor-pointer transition-colors',
        'bg-white dark:bg-grey-02 hover:border-azure-04',
        isSelected ? 'border-2 border-azure-04' : 'border border-grey-09 dark:border-grey-03',
      )}
    >
      {/* Thumbnail */}
      <div className="relative aspect-square bg-grey-11 dark:bg-grey-03 flex items-center justify-center overflow-hidden">
        {src ? (
          <img
            src={src}
            alt={asset.alt || asset.originalName}
            className="w-full h-full object-contain"
            loading="lazy"
          />
        ) : null}
        {/* Scope pill — renders only when a host bridge supplied a
            non-null scope. Top-left corner so it sits above the
            asset's own visual focus point without clipping the
            filename caption below. */}
        {scope ? <AssetScopePill scope={scope} size="sm" className="absolute top-1.5 left-1.5" /> : null}
        {/* Issue badge — top-right corner so it doesn't collide
            with the scope pill. Red blocked / amber oversized so
            scanning a library at a glance separates "scope" (left)
            from "health" (right). Hidden when null. */}
        {issue ? <MediaIssueBadge issue={issue} size="sm" className="absolute top-1.5 right-1.5" /> : null}
      </div>

      {/* Info - filename only */}
      <div className="px-2 py-1.5">
        <p className="text-xs text-grey-01 dark:text-grey-12 truncate" title={asset.originalName}>
          {asset.originalName}
        </p>
      </div>
    </button>
  );
}
