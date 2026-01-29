import cn from 'clsx';
import { Folder, FolderPlus } from 'lucide-react';
import { useState } from 'react';
import { type FolderTreeNode, useCreateFolder, useFolderTree } from '../../hooks';
import { CreateFolderDialog } from '../dialogs/CreateFolderDialog';

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
        className={cn('w-full flex items-center gap-2 py-1.5 px-3 rounded text-sm transition-colors text-left', {
          'bg-azure-11 text-azure-01': isActive,
          'hover:bg-grey-11': !isActive,
          'ring-2 ring-azure-04': isDropTarget,
        })}
        style={{ paddingLeft: `${depth * 16 + 12}px` }}
      >
        <Folder className="w-4 h-4 flex-shrink-0" />
        <span className="truncate flex-1">{node.name}</span>
        <span className="text-grey-05 text-xs">({node.assetCount})</span>
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

  const tree = data?.tree ?? [];

  const handleCreateFolder = (name: string) => {
    // Create folder at root level
    const folderPath = `/${name}`;
    createFolder.mutate(folderPath, {
      onSuccess: () => {
        setShowCreateFolderDialog(false);
      },
    });
  };

  // Calculate total asset count at root level
  const rootAssetCount = tree.reduce((sum, node) => sum + node.assetCount, 0);

  return (
    <div className="w-56 flex-shrink-0 border-r border-grey-09 bg-white">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-grey-09">
        <h3 className="font-semibold text-grey-01">Folders</h3>
        <button
          type="button"
          onClick={() => setShowCreateFolderDialog(true)}
          className="p-1.5 rounded hover:bg-grey-11 transition-colors"
          title="New Folder"
        >
          <FolderPlus className="w-4 h-4 text-grey-04" />
        </button>
      </div>

      {/* Folder tree */}
      <div className="p-2 overflow-y-auto" style={{ maxHeight: 'calc(100vh - 200px)' }}>
        {isLoading ? (
          <div className="text-sm text-grey-05 px-3 py-2">Loading...</div>
        ) : (
          <>
            {/* Root folder option */}
            <button
              type="button"
              onClick={() => onFolderSelect('/')}
              className={cn('w-full flex items-center gap-2 py-1.5 px-3 rounded text-sm transition-colors text-left', {
                'bg-azure-11 text-azure-01': currentFolder === '/',
                'hover:bg-grey-11': currentFolder !== '/',
                'ring-2 ring-azure-04': dropTargetFolder === '/',
              })}
            >
              <Folder className="w-4 h-4 flex-shrink-0" />
              <span className="truncate flex-1">All Assets</span>
              <span className="text-grey-05 text-xs">({rootAssetCount})</span>
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
              <div className="text-sm text-grey-05 px-3 py-2">No folders yet</div>
            )}
          </>
        )}
      </div>

      {/* Create Folder Dialog */}
      <CreateFolderDialog
        open={showCreateFolderDialog}
        isPending={createFolder.isPending}
        onClose={() => setShowCreateFolderDialog(false)}
        onCreate={handleCreateFolder}
      />
    </div>
  );
}
