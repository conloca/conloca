import { Folder, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { type FolderTreeNode, useFolderTree } from '../../hooks';
import { cn } from '../../utils/cn';

interface MoveFolderDialogProps {
  isOpen: boolean;
  assetCount: number;
  currentFolder: string;
  onMove: (targetFolder: string) => void;
  onCancel: () => void;
  isMoving?: boolean;
}

interface FolderOptionProps {
  node: FolderTreeNode;
  depth: number;
  selectedFolder: string | null;
  currentFolder: string;
  onSelect: (path: string) => void;
}

function FolderOption({ node, depth, selectedFolder, currentFolder, onSelect }: FolderOptionProps) {
  const isSelected = node.path === selectedFolder;
  const isDisabled = node.path === currentFolder;

  return (
    <>
      <button
        type="button"
        onClick={() => !isDisabled && onSelect(node.path)}
        disabled={isDisabled}
        className={cn(
          'w-full flex items-center gap-2 py-2 px-3 rounded text-sm transition-colors text-left text-grey-01 dark:text-grey-12',
          {
            'bg-azure-11 dark:bg-azure-02 text-azure-01 dark:text-azure-11 ring-1 ring-azure-04': isSelected,
            'hover:bg-grey-11 dark:hover:bg-grey-03': !isSelected && !isDisabled,
            'opacity-50 cursor-not-allowed': isDisabled,
          },
        )}
        style={{ paddingLeft: `${depth * 16 + 12}px` }}
      >
        <Folder className="w-4 h-4 flex-shrink-0" />
        <span className="truncate flex-1">{node.name}</span>
        {isDisabled && <span className="text-xs text-grey-05 dark:text-grey-06">(current)</span>}
      </button>

      {node.children.map((child) => (
        <FolderOption
          key={child.path}
          node={child}
          depth={depth + 1}
          selectedFolder={selectedFolder}
          currentFolder={currentFolder}
          onSelect={onSelect}
        />
      ))}
    </>
  );
}

export function MoveFolderDialog({
  isOpen,
  assetCount,
  currentFolder,
  onMove,
  onCancel,
  isMoving = false,
}: MoveFolderDialogProps) {
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setSelectedFolder(null);
    }
  }, [isOpen]);

  const { data, isLoading } = useFolderTree();

  // Unwrap root node - we display "Root" separately, so show root's children directly
  const rawTree = data?.tree ?? [];
  const tree = rawTree.length === 1 && rawTree[0].path === '/' ? rawTree[0].children : rawTree;

  const handleMove = () => {
    if (selectedFolder) {
      onMove(selectedFolder);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onCancel();
    }
  };

  if (!isOpen) return null;

  const canMove = selectedFolder !== null && selectedFolder !== currentFolder;

  return (
    <div
      className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50"
      role="dialog"
      onKeyDown={handleKeyDown}
    >
      <div className="bg-white dark:bg-grey-03 rounded-lg w-full max-w-md shadow-xl" data-testid="move-folder-dialog">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-grey-09 dark:border-grey-03">
          <h2 className="text-lg font-semibold text-grey-01 dark:text-grey-12">
            Move {assetCount} asset{assetCount !== 1 ? 's' : ''}
          </h2>
          <button
            type="button"
            onClick={onCancel}
            className="p-1 rounded hover:bg-grey-11 dark:hover:bg-grey-03 transition-colors"
            disabled={isMoving}
          >
            <X className="w-5 h-5 text-grey-04 dark:text-grey-07" />
          </button>
        </div>

        {/* Folder list */}
        <div className="p-4 max-h-80 overflow-y-auto">
          {isLoading ? (
            <div className="text-sm text-grey-05 dark:text-grey-06 text-center py-4">Loading folders...</div>
          ) : (
            <div className="space-y-0.5">
              {/* Root folder option */}
              <button
                type="button"
                onClick={() => currentFolder !== '/' && setSelectedFolder('/')}
                disabled={currentFolder === '/'}
                className={cn(
                  'w-full flex items-center gap-2 py-2 px-3 rounded text-sm transition-colors text-left text-grey-01 dark:text-grey-12',
                  {
                    'bg-azure-11 dark:bg-azure-02 text-azure-01 dark:text-azure-11 ring-1 ring-azure-04':
                      selectedFolder === '/',
                    'hover:bg-grey-11 dark:hover:bg-grey-03': selectedFolder !== '/' && currentFolder !== '/',
                    'opacity-50 cursor-not-allowed': currentFolder === '/',
                  },
                )}
              >
                <Folder className="w-4 h-4 flex-shrink-0" />
                <span className="truncate flex-1">Root</span>
                {currentFolder === '/' && <span className="text-xs text-grey-05 dark:text-grey-06">(current)</span>}
              </button>

              {/* Folder tree */}
              {tree.map((node) => (
                <FolderOption
                  key={node.path}
                  node={node}
                  depth={1}
                  selectedFolder={selectedFolder}
                  currentFolder={currentFolder}
                  onSelect={setSelectedFolder}
                />
              ))}

              {tree.length === 0 && (
                <div className="text-sm text-grey-05 dark:text-grey-06 text-center py-4">
                  No folders available. Create a folder first.
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-grey-09 dark:border-grey-03">
          <button
            type="button"
            onClick={onCancel}
            disabled={isMoving}
            className="px-4 py-2 border border-grey-09 dark:border-grey-03 rounded text-grey-01 dark:text-grey-12 hover:bg-grey-11 dark:hover:bg-grey-03 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleMove}
            disabled={!canMove || isMoving}
            className={cn(
              'px-4 py-2 rounded transition-colors',
              'bg-azure-04 text-white hover:bg-azure-03',
              'disabled:opacity-50 disabled:cursor-not-allowed',
            )}
          >
            {isMoving ? 'Moving...' : 'Move'}
          </button>
        </div>
      </div>
    </div>
  );
}
