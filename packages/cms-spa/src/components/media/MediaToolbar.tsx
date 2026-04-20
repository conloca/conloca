import { Search, Upload } from 'lucide-react';
import { Button, Input, Select } from '../ui';

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
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-grey-04 dark:text-grey-07 z-10" />
        <Input
          size="sm"
          type="text"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search files..."
          className="pl-9"
        />
      </div>

      {/* File type filter */}
      <Select size="sm" value={fileType} onChange={(e) => onFileTypeChange(e.target.value as FileTypeFilter)}>
        <option value="all">All types</option>
        <option value="images">Images</option>
        <option value="svg">SVG</option>
      </Select>

      {/* Sort dropdown */}
      <Select size="sm" value={sort} onChange={(e) => onSortChange(e.target.value as SortOption)}>
        <option value="date-newest">Date (newest)</option>
        <option value="date-oldest">Date (oldest)</option>
        <option value="name-asc">Name (A-Z)</option>
        <option value="name-desc">Name (Z-A)</option>
        <option value="size-largest">Size (largest)</option>
        <option value="size-smallest">Size (smallest)</option>
      </Select>

      {/* Select mode toggle */}
      {isSelectMode ? (
        <Button variant="primary" size="sm" onClick={onExitSelectMode}>
          Done
        </Button>
      ) : (
        onEnterSelectMode && (
          <Button variant="outline" size="sm" onClick={onEnterSelectMode}>
            Select
          </Button>
        )
      )}

      {/* Upload button */}
      {onUploadClick && (
        <Button variant="primary" size="sm" onClick={onUploadClick} className="flex items-center gap-2">
          <Upload className="w-4 h-4" />
          Upload
        </Button>
      )}
    </div>
  );
}
