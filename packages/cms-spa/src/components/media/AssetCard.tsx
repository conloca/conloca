import cn from 'clsx';
import { useState } from 'react';
import type { AssetEntry } from '../../hooks';

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface AssetCardProps {
  asset: AssetEntry;
  /** Whether this card is selected */
  selected?: boolean;
  /** Called when card is clicked (for selection) */
  onClick?: () => void;
  /** Called when delete is confirmed */
  onDelete?: () => void;
  assetsBasePath?: string;
}

export function AssetCard({
  asset,
  selected,
  onClick,
  onDelete,
  assetsBasePath = '/__cms/api/assets/serve',
}: AssetCardProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  const handleClick = () => {
    onClick?.();
  };

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirmDelete) {
      onDelete?.();
      setConfirmDelete(false);
    } else {
      setConfirmDelete(true);
    }
  };

  const handleCancelDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmDelete(false);
  };

  const dimensions = asset.width && asset.height ? `${asset.width} x ${asset.height}` : null;

  return (
    <div
      onClick={handleClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleClick();
        }
      }}
      role="button"
      tabIndex={0}
      className={cn(
        'group relative rounded border overflow-hidden cursor-pointer transition-colors',
        'bg-white hover:border-azure-04',
        selected ? 'border-azure-04 ring-2 ring-azure-11' : 'border-grey-09',
      )}
    >
      {/* Thumbnail */}
      <div className="aspect-square bg-grey-11 flex items-center justify-center overflow-hidden">
        <img
          src={`${assetsBasePath}/${asset.filename}`}
          alt={asset.alt || asset.originalName}
          className="w-full h-full object-contain"
          loading="lazy"
        />
      </div>

      {/* Info */}
      <div className="p-2 text-xs border-t border-grey-09">
        <p className="font-medium text-grey-01 truncate" title={asset.originalName}>
          {asset.originalName}
        </p>
        <p className="text-grey-04 mt-0.5">
          {formatFileSize(asset.size)}
          {dimensions && ` \u00B7 ${dimensions}`}
        </p>
        {asset.alt && (
          <p className="text-grey-07 truncate mt-0.5" title={asset.alt}>
            {asset.alt}
          </p>
        )}
      </div>

      {/* Delete button */}
      {onDelete && (
        <div
          className={cn(
            'absolute top-1 right-1 flex gap-1',
            confirmDelete ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
            'transition-opacity',
          )}
        >
          {confirmDelete ? (
            <>
              <button
                type="button"
                onClick={handleDeleteClick}
                className="px-2 py-1 bg-red-04 text-white text-xs rounded hover:bg-red-03 transition-colors"
              >
                Delete
              </button>
              <button
                type="button"
                onClick={handleCancelDelete}
                className="px-2 py-1 bg-white border border-grey-09 text-grey-04 text-xs rounded hover:bg-grey-11 transition-colors"
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={handleDeleteClick}
              className="p-1 bg-black/50 text-white rounded hover:bg-black/70 transition-colors"
              title="Delete asset"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M3 6h18" />
                <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
              </svg>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
