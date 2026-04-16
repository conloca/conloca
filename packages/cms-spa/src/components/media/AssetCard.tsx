import type { AssetEntry } from '../../hooks';
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
        'group relative rounded overflow-hidden cursor-pointer transition-colors',
        'bg-white dark:bg-grey-02 hover:border-azure-04',
        isSelected ? 'border-2 border-azure-04' : 'border border-grey-09 dark:border-grey-04',
      )}
    >
      {/* Thumbnail */}
      <div className="aspect-square bg-grey-11 dark:bg-grey-03 flex items-center justify-center overflow-hidden">
        <img
          src={buildAssetServeUrl(assetsBasePath, asset.folder, asset.filename)}
          alt={asset.alt || asset.originalName}
          className="w-full h-full object-contain"
          loading="lazy"
        />
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
