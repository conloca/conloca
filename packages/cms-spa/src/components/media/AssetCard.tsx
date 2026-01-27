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
  selected?: boolean;
  onSelect?: (asset: AssetEntry) => void;
  onDelete?: (asset: AssetEntry) => void;
  assetsBasePath?: string;
}

export function AssetCard({
  asset,
  selected,
  onSelect,
  onDelete,
  assetsBasePath = '/__conloca/assets',
}: AssetCardProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  const handleClick = () => {
    onSelect?.(asset);
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirmDelete) {
      onDelete?.(asset);
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
        'group relative rounded-lg border-2 overflow-hidden cursor-pointer transition-colors',
        'bg-white hover:border-blue-400',
        selected ? 'border-blue-500 ring-2 ring-blue-200' : 'border-gray-200',
      )}
    >
      {/* Thumbnail */}
      <div className="aspect-square bg-gray-100 flex items-center justify-center overflow-hidden">
        <img
          src={`${assetsBasePath}/${asset.filename}`}
          alt={asset.alt || asset.originalName}
          className="w-full h-full object-contain"
          loading="lazy"
        />
      </div>

      {/* Info */}
      <div className="p-2 text-xs">
        <p className="font-medium text-gray-900 truncate" title={asset.originalName}>
          {asset.originalName}
        </p>
        <p className="text-gray-500 mt-0.5">
          {formatFileSize(asset.size)}
          {dimensions && ` · ${dimensions}`}
        </p>
        {asset.alt && (
          <p className="text-gray-400 truncate mt-0.5" title={asset.alt}>
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
                onClick={handleDelete}
                className="px-2 py-1 bg-red-600 text-white text-xs rounded hover:bg-red-700"
              >
                Delete
              </button>
              <button
                type="button"
                onClick={handleCancelDelete}
                className="px-2 py-1 bg-gray-300 text-gray-700 text-xs rounded hover:bg-gray-400"
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={handleDelete}
              className="p-1 bg-black/50 text-white rounded hover:bg-black/70"
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
