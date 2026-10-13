import { Folder, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { type FolderTreeNode, useFolderTree } from '../../hooks/index.js';
import { cn } from '../../utils/cn.js';
import { contentFailureMessage } from '../../utils/content-failure.js';
import { Button, IconButton } from '../ui/index.js';

interface MoveFolderDialogProps {
  isOpen: boolean;
  assetCount: number;
  currentFolder: string;
  /** Rejects with the reason the move was refused; the dialog shows it. */
  onMove: (targetFolder: string) => Promise<void>;
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
          'w-full flex items-center gap-2 py-2 px-3 rounded-md text-sm transition-colors text-left text-grey-01 dark:text-grey-12',
          {
            'bg-azure-11 dark:bg-azure-02 text-azure-01 dark:text-azure-11 ring-1 ring-azure-04': isSelected,
            'hover:bg-hover': !isSelected && !isDisabled,
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
  const [moveError, setMoveError] = useState<string | null>(null);
  // Bumped on open, close and every change of folder: a refusal that arrives
  // after one of those answers a move the dialog no longer shows, so it is dropped.
  const view = useRef(0);

  useEffect(() => {
    view.current++;
    if (isOpen) {
      setSelectedFolder(null);
      setMoveError(null);
    }
  }, [isOpen]);

  const { data, isLoading } = useFolderTree();

  // Unwrap root node - we display "Root" separately, so show root's children directly
  const rawTree = data?.tree ?? [];
  const tree = rawTree.length === 1 && rawTree[0].path === '/' ? rawTree[0].children : rawTree;

  const selectFolder = (path: string) => {
    if (path === selectedFolder) return;
    view.current++;
    setSelectedFolder(path);
    setMoveError(null);
  };

  const handleMove = async () => {
    if (!selectedFolder) return;
    const attempt = ++view.current;
    setMoveError(null);
    try {
      await onMove(selectedFolder);
    } catch (error) {
      const fallback = assetCount === 1 ? 'Could not move the asset.' : 'Could not move the assets.';
      if (view.current === attempt) setMoveError(contentFailureMessage({ error }, fallback));
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
      <div className="bg-overlay rounded-lg w-full max-w-md shadow-xl" data-testid="move-folder-dialog">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-line">
          <h2 className="text-lg font-semibold text-grey-01 dark:text-grey-12">
            Move {assetCount} asset{assetCount !== 1 ? 's' : ''}
          </h2>
          <IconButton icon={X} ariaLabel="Cancel" onClick={onCancel} variant="ghost" />
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
                onClick={() => currentFolder !== '/' && selectFolder('/')}
                disabled={currentFolder === '/'}
                className={cn(
                  'w-full flex items-center gap-2 py-2 px-3 rounded-md text-sm transition-colors text-left text-grey-01 dark:text-grey-12',
                  {
                    'bg-azure-11 dark:bg-azure-02 text-azure-01 dark:text-azure-11 ring-1 ring-azure-04':
                      selectedFolder === '/',
                    'hover:bg-hover': selectedFolder !== '/' && currentFolder !== '/',
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
                  onSelect={selectFolder}
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

        {moveError && (
          <p
            role="alert"
            className="max-h-32 overflow-y-auto px-6 pb-4 text-sm wrap-break-word text-red-04 dark:text-red-08"
          >
            {moveError}
          </p>
        )}

        {/* Footer */}
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-line">
          <Button variant="outline" onClick={onCancel} disabled={isMoving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleMove} disabled={!canMove || isMoving}>
            {isMoving ? 'Moving...' : 'Move'}
          </Button>
        </div>
      </div>
    </div>
  );
}
