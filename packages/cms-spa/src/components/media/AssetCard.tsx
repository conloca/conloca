import type { AssetEntry } from '../../hooks';
import { AssetScopePill } from '../../media/AssetScopePill';
import { MediaIssueBadge } from '../../media/MediaIssueBadge';
import { useAssetScope } from '../../media/use-asset-scope';
import { useMediaIssue } from '../../media/use-media-issue';
import { buildAssetServeUrl } from '../../utils/asset-url';
import { cn } from '../../utils/cn';

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
  // hosted-only: ask the host shell whether this asset is branch-only
  // or published. Returns null when no `mediaBridge` is installed —
  // the AssetScopePill skips rendering, so astro-cms / local dev see
  // the card unchanged.
  const scope = useAssetScope(asset.filename);
  // hosted-only: oversized / blocked status the passthrough scanner
  // or quota tracker flags. Returns null when the host has no
  // opinion — surfaces degrade exactly like the scope pill in
  // standalone mounts.
  const issue = useMediaIssue(asset.filename);

  const handleClick = () => {
    onClick?.();
  };

  const handleDoubleClick = () => {
    onDoubleClick?.();
  };

  return (
    <div
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleClick();
        }
      }}
      role="button"
      tabIndex={0}
      className={cn(
        'group relative rounded-md overflow-hidden cursor-pointer transition-colors',
        'bg-white dark:bg-grey-02 hover:border-azure-04',
        isSelected ? 'border-2 border-azure-04' : 'border border-grey-09 dark:border-grey-03',
      )}
    >
      {/* Thumbnail */}
      <div className="relative aspect-square bg-grey-11 dark:bg-grey-03 flex items-center justify-center overflow-hidden">
        <img
          src={buildAssetServeUrl(assetsBasePath, asset.folder, asset.filename)}
          alt={asset.alt || asset.originalName}
          className="w-full h-full object-contain"
          loading="lazy"
        />
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
    </div>
  );
}
