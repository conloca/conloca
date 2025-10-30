import {
  type ContentManifest,
  localesOf,
  useBlocks,
  useCreateContent,
  useDeleteContent,
} from '@conloca/content-api-client';
import { MDXEditorModal } from '@conloca/mdx-editor';
import { AlertCircle, Edit2, Loader2, Package, Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useErrorModal } from '../hooks';
import type { Block } from '../types';
import { DeleteConfirmDialog } from './DeleteConfirmDialog';
import { ErrorModal } from './ErrorModal';

export function BlockList() {
  const [selectedCategory, setSelectedCategory] = useState<string | 'all'>('all');
  const [showMDXEditor, setShowMDXEditor] = useState(false);
  const [newBlockName, setNewBlockName] = useState('');
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [titleInput, setTitleInput] = useState('');
  const [deleteDialog, setDeleteDialog] = useState<{
    isOpen: boolean;
    blockId: string;
    blockTitle: string;
    etag: string;
  }>({ isOpen: false, blockId: '', blockTitle: '', etag: '' });

  const { showError, errorModalProps } = useErrorModal();

  const navigate = useNavigate();
  const createContent = useCreateContent();
  const deleteContent = useDeleteContent();

  // Fetch blocks entries
  const { data, isLoading, error } = useBlocks();

  // Transform entries into Block objects
  const blocks = useMemo<Block[]>(() => {
    if (!data?.items) return [];

    return data.items.map((entry: ContentManifest) => {
      // Get the first locale's content for preview
      const firstLocale = Array.from(localesOf(entry))[0];
      if (!firstLocale) {
        return {
          id: entry.id,
          title: entry.id,
          preview: 'No preview available',
          category: 'content',
          locales: [],
          etag: '',
        };
      }

      // Note: We don't have content in ContentManifest, only metadata
      // For blocks, we'll use the title from meta
      const title = firstLocale.meta?.title || firstLocale.name || entry.id;

      // Try to determine category from the block name or ID
      const category = entry.id.includes('hero')
        ? 'headers'
        : entry.id.includes('cta')
          ? 'cta'
          : entry.id.includes('footer')
            ? 'footers'
            : 'content';

      return {
        id: entry.id,
        title,
        preview: firstLocale.meta?.description || 'No preview available',
        category,
        locales: Array.from(localesOf(entry)).map((v) => v.locale),
        etag: firstLocale.etag,
      };
    });
  }, [data]);

  // Get unique categories
  const categories = useMemo(() => {
    const cats = new Set<string>();
    blocks.forEach((block) => cats.add(block.category));
    return ['all', ...Array.from(cats).sort()];
  }, [blocks]);

  // Filter blocks by category
  const filteredBlocks = useMemo(() => {
    if (selectedCategory === 'all') return blocks;
    return blocks.filter((block) => block.category === selectedCategory);
  }, [blocks, selectedCategory]);

  // Loading state
  if (isLoading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-azure-04 mx-auto mb-4" />
          <p className="text-grey-04">Loading blocks...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[400px]">
        <div className="text-center max-w-md">
          <AlertCircle className="h-12 w-12 text-red-04 mx-auto mb-4" />
          <h2 className="text-xl font-semibold mb-2">Failed to load blocks</h2>
          <p className="text-grey-04 mb-4">{error.message}</p>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-azure-04 text-white rounded hover:bg-azure-03 transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const handleNewBlock = () => {
    setTitleInput('');
    setShowCreateDialog(true);
  };

  const handleCreateBlock = () => {
    if (!titleInput.trim()) return;

    setNewBlockName(titleInput.trim());
    setShowCreateDialog(false);
    setShowMDXEditor(true);
  };

  const handleSaveBlock = async (content: string) => {
    const result = await createContent.mutateAsync({
      kind: 'block',
      collection: 'blocks',
      type: 'mdx',
      name: newBlockName,
      meta: {
        title: newBlockName,
      },
      locales: {
        en: {
          meta: {
            title: newBlockName,
          },
          content: {
            mdx: content,
          },
        },
      },
    });

    if (result.success) {
      setNewBlockName('');
      navigate('/blocks');
    } else {
      const errorMessage = result.error?.message || 'Failed to create block';
      showError(errorMessage, result.error);
      throw new Error(errorMessage);
    }
  };

  const handleEditBlock = (blockId: string) => {
    navigate(`/blocks/${blockId}`);
  };

  const handleDeleteBlock = (blockId: string) => {
    const block = blocks.find((b) => b.id === blockId);
    if (!block) return;

    setDeleteDialog({
      isOpen: true,
      blockId,
      blockTitle: block.title,
      etag: block.etag,
    });
  };

  const handleConfirmDelete = async () => {
    if (!deleteDialog.blockId) return;

    try {
      const result = await deleteContent.mutateAsync({
        id: deleteDialog.blockId,
        etag: deleteDialog.etag,
      });

      if (result.success) {
        // Close dialog and show success
        setDeleteDialog({ isOpen: false, blockId: '', blockTitle: '', etag: '' });
        // The list will refresh automatically due to query invalidation
      } else {
        // Handle delete failure
        const errorMessage = result.error?.message || 'Failed to delete block';
        console.error('Delete failed:', errorMessage);
        setDeleteDialog({ isOpen: false, blockId: '', blockTitle: '', etag: '' });

        // Check if it's a stale write error
        if (errorMessage.includes('modified')) {
          showError(
            'This block has been modified by someone else. Would you like to reload and try again?',
            result.error,
            [
              {
                label: 'Reload',
                onClick: () => window.location.reload(),
                variant: 'primary',
              },
              {
                label: 'Cancel',
                onClick: () => {},
                variant: 'secondary',
              },
            ],
          );
        } else {
          showError(errorMessage, result.error);
        }
      }
    } catch (error) {
      console.error('Failed to delete block:', error);
      setDeleteDialog({ isOpen: false, blockId: '', blockTitle: '', etag: '' });
      showError('Failed to delete block. Please try again.', error);
    }
  };

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-grey-01">Content Blocks</h1>
        <div className="flex items-center gap-4">
          {categories.length > 2 && (
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="px-3 py-2 border border-grey-09 rounded hover:bg-grey-11 transition-colors"
            >
              {categories.map((cat) => (
                <option key={cat} value={cat}>
                  {cat === 'all' ? 'All Categories' : cat}
                </option>
              ))}
            </select>
          )}
          <button
            onClick={handleNewBlock}
            className="px-4 py-2 bg-azure-04 text-white rounded hover:bg-azure-03 transition-colors flex items-center gap-2"
            data-testid="new-block-button"
          >
            <Plus className="h-4 w-4" />
            New Block
          </button>
        </div>
      </div>

      {/* Empty state */}
      {blocks.length === 0 ? (
        <div className="bg-white border border-grey-09 rounded p-12 text-center">
          <Package className="h-12 w-12 text-grey-04 mx-auto mb-4" />
          <h2 className="text-xl font-semibold mb-2" data-testid="no-blocks-message">
            No blocks yet
          </h2>
          <p className="text-grey-04 mb-4">Create reusable content blocks for your pages</p>
          <button
            onClick={handleNewBlock}
            className="px-4 py-2 bg-azure-04 text-white rounded hover:bg-azure-03 transition-colors"
          >
            Create Block
          </button>
        </div>
      ) : filteredBlocks.length === 0 ? (
        <div className="bg-white border border-grey-09 rounded p-12 text-center">
          <p className="text-grey-04" data-testid="no-blocks-category-message">
            No blocks found in category "{selectedCategory}"
          </p>
        </div>
      ) : (
        /* Card Grid */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredBlocks.map((block) => (
            <div
              key={block.id}
              className="bg-white border border-grey-09 rounded p-4 hover:border-azure-04 transition-colors"
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Package className="h-4 w-4 text-grey-04" />
                  <h3 className="font-medium" data-testid={`block-title-${block.id}`}>
                    {block.title}
                  </h3>
                </div>
                <span className="px-2 py-1 text-xs bg-grey-11 rounded">{block.category}</span>
              </div>

              <p className="text-sm text-grey-04 mb-3 line-clamp-3" data-testid={`block-description-${block.id}`}>
                {block.preview}
              </p>

              <div className="flex items-center justify-between">
                <div className="flex gap-1">
                  {block.locales.map((locale) => (
                    <span key={locale} data-testid="locale-indicator" className="px-2 py-1 text-xs bg-grey-11 rounded">
                      {locale}
                    </span>
                  ))}
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={() => handleEditBlock(block.id)}
                    className="p-1 hover:bg-grey-11 rounded transition-colors"
                    title="Edit block"
                  >
                    <Edit2 className="h-4 w-4 text-azure-04" />
                  </button>
                  <button
                    onClick={() => handleDeleteBlock(block.id)}
                    className="p-1 hover:bg-grey-11 rounded transition-colors"
                    title="Delete block"
                    aria-label="Delete"
                  >
                    <Trash2 className="h-4 w-4 text-red-04" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Block Dialog */}
      {showCreateDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" role="dialog">
          <div className="bg-white rounded-lg p-6 w-full max-w-md" data-testid="create-block-dialog">
            <h2 className="text-xl font-semibold mb-4">Create New Block</h2>
            <div className="mb-4">
              <label htmlFor="block-title" className="block text-sm font-medium mb-2">
                Block Title
              </label>
              <input
                id="block-title"
                type="text"
                value={titleInput}
                onChange={(e) => setTitleInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleCreateBlock();
                  }
                }}
                placeholder="Enter block title..."
                className="w-full px-3 py-2 border border-grey-09 rounded focus:outline-none focus:ring-2 focus:ring-azure-04"
                autoFocus
                data-testid="block-title-input"
              />
              <p className="mt-2 text-sm text-grey-04">This will be used as the display name for your block</p>
            </div>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowCreateDialog(false)}
                className="px-4 py-2 border border-grey-09 rounded hover:bg-grey-11 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateBlock}
                disabled={!titleInput.trim()}
                className="px-4 py-2 bg-azure-04 text-white rounded hover:bg-azure-03 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                data-testid="create-block-submit"
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MDX Editor Modal */}
      <MDXEditorModal
        isOpen={showMDXEditor}
        onClose={() => setShowMDXEditor(false)}
        filePath={newBlockName}
        initialContent={`# ${newBlockName}\n\nStart writing your block content here...\n`}
        onSave={handleSaveBlock}
      />

      {/* Delete Confirmation Dialog */}
      <DeleteConfirmDialog
        isOpen={deleteDialog.isOpen}
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteDialog({ isOpen: false, blockId: '', blockTitle: '', etag: '' })}
        title="Delete Block"
        message="Are you sure you want to delete this block?"
        itemName={deleteDialog.blockTitle}
        isDeleting={deleteContent.isPending}
      />

      {/* Error Modal */}
      <ErrorModal {...errorModalProps} />
    </div>
  );
}
