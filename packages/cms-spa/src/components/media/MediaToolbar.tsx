import { Search, Upload } from 'lucide-react';

export type FileTypeFilter = 'all' | 'images' | 'svg';
export type SortOption = 'date-newest' | 'date-oldest' | 'name-asc' | 'name-desc' | 'size-largest' | 'size-smallest';

interface MediaToolbarProps {
  search: string;
  onSearchChange: (value: string) => void;
  fileType: FileTypeFilter;
  onFileTypeChange: (value: FileTypeFilter) => void;
  sort: SortOption;
  onSortChange: (value: SortOption) => void;
  /** Whether in multi-select mode */
  isSelectMode?: boolean;
  /** Called to enter select mode */
  onEnterSelectMode?: () => void;
  /** Called to exit select mode */
  onExitSelectMode?: () => void;
  /** Called when Upload button is clicked */
  onUploadClick?: () => void;
}

export function MediaToolbar({
  search,
  onSearchChange,
  fileType,
  onFileTypeChange,
  sort,
  onSortChange,
  isSelectMode,
  onEnterSelectMode,
  onExitSelectMode,
  onUploadClick,
}: MediaToolbarProps) {
  return (
    <div className="flex items-center gap-3 flex-wrap">
      {/* Search input */}
      <div className="relative flex-1 min-w-[200px]">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-grey-04 dark:text-grey-07" />
        <input
          type="text"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search files..."
          className="w-full pl-9 pr-3 py-2 border border-grey-09 dark:border-grey-03 dark:bg-grey-03 dark:text-grey-12 rounded text-sm focus:outline-none focus:ring-2 focus:ring-azure-04 focus:border-azure-04"
        />
      </div>

      {/* File type filter */}
      <select
        value={fileType}
        onChange={(e) => onFileTypeChange(e.target.value as FileTypeFilter)}
        className="px-3 py-2 border border-grey-09 dark:border-grey-03 rounded text-sm bg-white dark:bg-grey-03 dark:text-grey-12 hover:bg-grey-11 dark:hover:bg-grey-03 transition-colors"
      >
        <option value="all">All types</option>
        <option value="images">Images</option>
        <option value="svg">SVG</option>
      </select>

      {/* Sort dropdown */}
      <select
        value={sort}
        onChange={(e) => onSortChange(e.target.value as SortOption)}
        className="px-3 py-2 border border-grey-09 dark:border-grey-03 rounded text-sm bg-white dark:bg-grey-03 dark:text-grey-12 hover:bg-grey-11 dark:hover:bg-grey-03 transition-colors"
      >
        <option value="date-newest">Date (newest)</option>
        <option value="date-oldest">Date (oldest)</option>
        <option value="name-asc">Name (A-Z)</option>
        <option value="name-desc">Name (Z-A)</option>
        <option value="size-largest">Size (largest)</option>
        <option value="size-smallest">Size (smallest)</option>
      </select>

      {/* Select mode toggle */}
      {isSelectMode ? (
        <button
          type="button"
          onClick={onExitSelectMode}
          className="px-3 py-2 bg-azure-04 text-white rounded text-sm hover:bg-azure-03 transition-colors"
        >
          Done
        </button>
      ) : (
        onEnterSelectMode && (
          <button
            type="button"
            onClick={onEnterSelectMode}
            className="px-3 py-2 border border-grey-09 dark:border-grey-03 rounded text-sm bg-white dark:bg-grey-03 dark:text-grey-12 hover:bg-grey-11 dark:hover:bg-grey-03 transition-colors"
          >
            Select
          </button>
        )
      )}

      {/* Upload button */}
      {onUploadClick && (
        <button
          type="button"
          onClick={onUploadClick}
          className="flex items-center gap-2 px-3 py-2 bg-azure-04 text-white rounded text-sm hover:bg-azure-03 transition-colors"
        >
          <Upload className="w-4 h-4" />
          Upload
        </button>
      )}
    </div>
  );
}
