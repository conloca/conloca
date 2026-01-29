import { FolderPlus, Search } from 'lucide-react';

export type FileTypeFilter = 'all' | 'images' | 'svg';
export type SortOption = 'date-newest' | 'date-oldest' | 'name-asc' | 'name-desc' | 'size-largest' | 'size-smallest';

interface MediaToolbarProps {
  search: string;
  onSearchChange: (value: string) => void;
  fileType: FileTypeFilter;
  onFileTypeChange: (value: FileTypeFilter) => void;
  sort: SortOption;
  onSortChange: (value: SortOption) => void;
  onCreateFolder: () => void;
}

export function MediaToolbar({
  search,
  onSearchChange,
  fileType,
  onFileTypeChange,
  sort,
  onSortChange,
  onCreateFolder,
}: MediaToolbarProps) {
  return (
    <div className="flex items-center gap-3 flex-wrap">
      {/* Search input */}
      <div className="relative flex-1 min-w-[200px]">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-grey-04" />
        <input
          type="text"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search files..."
          className="w-full pl-9 pr-3 py-2 border border-grey-09 rounded text-sm focus:outline-none focus:ring-2 focus:ring-azure-04 focus:border-azure-04"
        />
      </div>

      {/* File type filter */}
      <select
        value={fileType}
        onChange={(e) => onFileTypeChange(e.target.value as FileTypeFilter)}
        className="px-3 py-2 border border-grey-09 rounded text-sm bg-white hover:bg-grey-11 transition-colors"
      >
        <option value="all">All types</option>
        <option value="images">Images</option>
        <option value="svg">SVG</option>
      </select>

      {/* Sort dropdown */}
      <select
        value={sort}
        onChange={(e) => onSortChange(e.target.value as SortOption)}
        className="px-3 py-2 border border-grey-09 rounded text-sm bg-white hover:bg-grey-11 transition-colors"
      >
        <option value="date-newest">Date (newest)</option>
        <option value="date-oldest">Date (oldest)</option>
        <option value="name-asc">Name (A-Z)</option>
        <option value="name-desc">Name (Z-A)</option>
        <option value="size-largest">Size (largest)</option>
        <option value="size-smallest">Size (smallest)</option>
      </select>

      {/* Create folder button */}
      <button
        type="button"
        onClick={onCreateFolder}
        className="flex items-center gap-2 px-4 py-2 bg-azure-04 text-white rounded text-sm hover:bg-azure-03 transition-colors"
      >
        <FolderPlus className="w-4 h-4" />
        <span>New Folder</span>
      </button>
    </div>
  );
}
