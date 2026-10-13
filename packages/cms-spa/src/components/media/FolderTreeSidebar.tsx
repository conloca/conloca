import { Folder, FolderPlus } from 'lucide-react';
import { useState } from 'react';
import { type FolderTreeNode, useCreateFolder, useFolderTree } from '../../hooks/index.js';
import { cn } from '../../utils/cn.js';
import { CreateFolderDialog } from '../dialogs/CreateFolderDialog.js';

interface FolderTreeSidebarProps {
  currentFolder: string;
  onFolderSelect: (path: string) => void;
  /** For drag-and-drop: highlight target when dragging */
  dropTargetFolder?: string | null;
}

interface FolderNodeProps {
  node: FolderTreeNode;
  depth: number;
  currentFolder: string;
  dropTargetFolder?: string | null;
  onFolderSelect: (path: string) => void;
}

function FolderNode({ node, depth, currentFolder, dropTargetFolder, onFolderSelect }: FolderNodeProps) {
  const isActive = node.path === currentFolder;
  const isDropTarget = node.path === dropTargetFolder;

  return (
    <>
      <button
        type="button"
        onClick={() => onFolderSelect(node.path)}
        aria-label={`Folder: ${node.name}`}
        title={node.name}
        className={cn(
          'w-full flex items-center justify-center sm:justify-start gap-0 sm:gap-2 py-1.5 px-2 sm:px-3 rounded-md text-sm transition-colors text-left',
          {
            'bg-azure-11 dark:bg-azure-03 text-azure-01 dark:text-azure-11': isActive,
            'hover:bg-grey-11 dark:hover:bg-grey-03': !isActive,
            'ring-2 ring-azure-04': isDropTarget,
          },
        )}
      >
        <span className="hidden sm:block flex-shrink-0" style={{ width: `${depth * 16}px` }} aria-hidden />
        <Folder className="w-4 h-4 flex-shrink-0" />
        <span className="hidden sm:block truncate flex-1">{node.name}</span>
        <span className={cn('hidden sm:block text-xs', { 'text-grey-04 dark:text-grey-07': !isActive })}>
          ({node.assetCount})
        </span>
      </button>

      {node.children.map((child) => (
        <FolderNode
          key={child.path}
          node={child}
          depth={depth + 1}
          currentFolder={currentFolder}
          dropTargetFolder={dropTargetFolder}
          onFolderSelect={onFolderSelect}
        />
      ))}
    </>
  );
}

export function FolderTreeSidebar({ currentFolder, onFolderSelect, dropTargetFolder }: FolderTreeSidebarProps) {
  const [showCreateFolderDialog, setShowCreateFolderDialog] = useState(false);
  const { data, isLoading } = useFolderTree();
  const createFolder = useCreateFolder();

  // Unwrap root node - we display "Root" separately, so show root's children directly
  const rawTree = data?.tree ?? [];
  const tree = rawTree.length === 1 && rawTree[0].path === '/' ? rawTree[0].children : rawTree;

  const handleCreateFolder = (name: string) => {
    // Create folder at root level
    const folderPath = `/${name}`;
    createFolder.mutate(folderPath, {
      onSuccess: () => {
        setShowCreateFolderDialog(false);
      },
    });
  };

  // Root shows the Root node's own count, the files directly in Root like every other folder's count;
  // a tree without a Root node falls back to the sum of its top-level folders
  const rootAssetCount =
    rawTree.length === 1 && rawTree[0].path === '/'
      ? rawTree[0].assetCount
      : tree.reduce((sum, node) => sum + node.assetCount, 0);

  return (
    <div
      className="w-14 sm:w-56 flex-shrink-0 flex flex-col h-full min-h-0 border-r border-grey-09 dark:border-grey-03 bg-white dark:bg-grey-02"
      data-testid="folder-tree-sidebar"
    >
      {/* Keep folders reachable on phones without spending almost half of
          the viewport on labels. Icons retain names through aria-label/title. */}
      <div className="flex items-center justify-center sm:justify-between px-2 sm:px-4 py-3 border-b border-grey-09 dark:border-grey-03">
        <h3 className="hidden sm:block font-semibold text-grey-01 dark:text-grey-12">Folders</h3>
        <button
          type="button"
          onClick={() => {
            createFolder.reset();
            setShowCreateFolderDialog(true);
          }}
          className="p-1.5 rounded-md hover:bg-grey-11 dark:hover:bg-grey-03 transition-colors"
          title="New Folder"
        >
          <FolderPlus className="w-4 h-4 text-grey-04 dark:text-grey-07" />
        </button>
      </div>

      {/* Folder tree */}
      <div className="flex-1 min-h-0 p-2 overflow-y-auto">
        {isLoading ? (
          <div className="text-sm text-grey-05 dark:text-grey-06 px-3 py-2">Loading...</div>
        ) : (
          <>
            {/* Root folder option */}
            <button
              type="button"
              onClick={() => onFolderSelect('/')}
              aria-label="Folder: Root"
              title="Root"
              className={cn(
                'w-full flex items-center justify-center sm:justify-start gap-0 sm:gap-2 py-1.5 px-2 sm:px-3 rounded-md text-sm transition-colors text-left',
                {
                  'bg-azure-11 dark:bg-azure-03 text-azure-01 dark:text-azure-11': currentFolder === '/',
                  'hover:bg-grey-11 dark:hover:bg-grey-03': currentFolder !== '/',
                  'ring-2 ring-azure-04': dropTargetFolder === '/',
                },
              )}
            >
              <Folder className="w-4 h-4 flex-shrink-0" />
              <span className="hidden sm:block truncate flex-1">Root</span>
              <span
                className={cn('hidden sm:block text-xs', { 'text-grey-04 dark:text-grey-07': currentFolder !== '/' })}
              >
                ({rootAssetCount})
              </span>
            </button>

            {/* Folder tree nodes */}
            {tree.length > 0 ? (
              tree.map((node) => (
                <FolderNode
                  key={node.path}
                  node={node}
                  depth={1}
                  currentFolder={currentFolder}
                  dropTargetFolder={dropTargetFolder}
                  onFolderSelect={onFolderSelect}
                />
              ))
            ) : (
              <div className="hidden sm:block text-sm text-grey-05 dark:text-grey-06 px-3 py-2">No folders yet</div>
            )}
          </>
        )}
      </div>

      {/* Create Folder Dialog */}
      <CreateFolderDialog
        open={showCreateFolderDialog}
        isPending={createFolder.isPending}
        error={createFolder.error?.message}
        onClose={() => setShowCreateFolderDialog(false)}
        onCreate={handleCreateFolder}
      />
    </div>
  );
}
