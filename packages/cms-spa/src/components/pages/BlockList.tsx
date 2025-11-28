import {
  type ContentManifest,
  localesOf,
  useBlocks,
  useCreateContent,
  useDeleteContent,
  useUpdateLocalized,
} from '@conloca/content-api-client';
import { MDXEditorModal } from '@conloca/mdx';
import { AlertCircle, Edit2, FileEdit, Loader2, MoreVertical, Package, Plus, Settings, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useErrorModal } from '../../hooks';
import type { Block } from '../../types';
import { slugify } from '../../utils/slugify';
import { DeleteConfirmDialog } from '../dialogs/DeleteConfirmDialog';
import { ErrorModal } from '../dialogs/ErrorModal';

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

  const [renameDialog, setRenameDialog] = useState<{
    isOpen: boolean;
    blockId: string;
    currentName: string;
    etag: string;
  }>({ isOpen: false, blockId: '', currentName: '', etag: '' });
  const [newName, setNewName] = useState('');

  const [propertiesDialog, setPropertiesDialog] = useState<{
    isOpen: boolean;
    blockId: string;
    blockTitle: string;
    etag: string;
    currentMeta: {
      title: string;
      description?: string;
      tags?: string[];
    };
  }>({
    isOpen: false,
    blockId: '',
    blockTitle: '',
    etag: '',
    currentMeta: { title: '' },
  });
  const [editedTitle, setEditedTitle] = useState('');
  const [editedDescription, setEditedDescription] = useState('');
  const [editedCategory, setEditedCategory] = useState('');
  const [editedTags, setEditedTags] = useState('');

  // Dropdown menu state
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const { showError, errorModalProps } = useErrorModal();

  const navigate = useNavigate();
  const createContent = useCreateContent();
  const deleteContent = useDeleteContent();
  const updateLocalized = useUpdateLocalized();

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

      // Use category from metadata, or auto-detect from the block name/ID
      const category =
        firstLocale.meta?.category ||
        (entry.id.includes('hero')
          ? 'headers'
          : entry.id.includes('cta')
            ? 'cta'
            : entry.id.includes('footer')
              ? 'footers'
              : 'content');

      return {
        id: entry.id,
        title,
        preview: firstLocale.meta?.description || 'No preview available',
        category,
        locales: Array.from(localesOf(entry)).map((v) => v.locale),
        etag: firstLocale.etag,
        name: firstLocale.name, // Store the actual filename
        meta: firstLocale.meta
          ? {
              title: firstLocale.meta.title || title,
              description: firstLocale.meta.description,
              category: firstLocale.meta.category,
              tags: firstLocale.meta.tags,
            }
          : undefined,
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

  // Click outside handler to close menu
  useEffect(() => {
    if (!openMenuId) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpenMenuId(null);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [openMenuId]);

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
      name: slugify(newBlockName) || 'untitled',
      meta: {
        title: newBlockName, // Keep original title for display
      },
      locales: {
        en: {
          meta: {
            title: newBlockName, // Keep original title for display
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

  const handleRenameBlock = (blockId: string) => {
    const block = blocks.find((b) => b.id === blockId);
    if (!block) return;

    // Use the actual filename from the block data
    const currentName = block.name || block.id.split('/').pop() || block.id;

    setRenameDialog({
      isOpen: true,
      blockId,
      currentName,
      etag: block.etag,
    });
    setNewName(currentName);
  };

  const handleConfirmRename = async () => {
    if (!renameDialog.blockId || !newName.trim() || newName === renameDialog.currentName) return;

    const block = blocks.find((b) => b.id === renameDialog.blockId);
    const locale = block?.locales[0] || 'en';

    try {
      const result = await updateLocalized.mutateAsync({
        id: renameDialog.blockId,
        locale,
        data: {
          name: newName.trim(),
        },
        etag: renameDialog.etag,
      });

      if (result.success) {
        // Close dialog and show success
        setRenameDialog({ isOpen: false, blockId: '', currentName: '', etag: '' });
        setNewName('');
        // The list will refresh automatically due to query invalidation
      } else {
        // Handle rename failure
        const errorMessage = result.error?.message || 'Failed to rename block';
        console.error('Rename failed:', errorMessage);
        setRenameDialog({ isOpen: false, blockId: '', currentName: '', etag: '' });

        // Check if it's a stale write error
        if (errorMessage.includes('modified') || result.reason === 'stale_write') {
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
        } else if (errorMessage.includes('already taken')) {
          showError('A block with this name already exists. Please choose a different name.', result.error);
        } else {
          showError(errorMessage, result.error);
        }
      }
    } catch (error) {
      console.error('Failed to rename block:', error);
      setRenameDialog({ isOpen: false, blockId: '', currentName: '', etag: '' });
      showError('Failed to rename block. Please try again.', error);
    }
  };

  const handleEditProperties = (blockId: string) => {
    const block = blocks.find((b) => b.id === blockId);
    if (!block) return;

    // Initialize default meta if missing
    const meta = block.meta || { title: block.title };

    setPropertiesDialog({
      isOpen: true,
      blockId,
      blockTitle: block.title,
      etag: block.etag,
      currentMeta: meta,
    });
    setEditedTitle(meta.title);
    setEditedDescription(meta.description || '');
    setEditedCategory(meta.category || '');
    setEditedTags(meta.tags?.join(', ') || '');
  };

  const handleSaveProperties = async () => {
    if (!propertiesDialog.blockId || !editedTitle.trim()) return;

    const block = blocks.find((b) => b.id === propertiesDialog.blockId);
    const locale = block?.locales[0] || 'en';

    // Parse tags from comma-separated string
    const tags = editedTags
      .split(',')
      .map((tag) => tag.trim())
      .filter((tag) => tag.length > 0);

    try {
      const result = await updateLocalized.mutateAsync({
        id: propertiesDialog.blockId,
        locale,
        data: {
          meta: {
            title: editedTitle.trim(),
            description: editedDescription.trim() || undefined,
            category: editedCategory.trim() || undefined,
            tags: tags.length > 0 ? tags : undefined,
          },
        },
        etag: propertiesDialog.etag,
      });

      if (result.success) {
        // Close dialog and show success
        setPropertiesDialog({
          isOpen: false,
          blockId: '',
          blockTitle: '',
          etag: '',
          currentMeta: { title: '' },
        });
        setEditedTitle('');
        setEditedDescription('');
        setEditedCategory('');
        setEditedTags('');
        // The list will refresh automatically due to query invalidation
      } else {
        // Handle save failure
        const errorMessage = result.error?.message || 'Failed to save properties';
        console.error('Save failed:', errorMessage);
        setPropertiesDialog({
          isOpen: false,
          blockId: '',
          blockTitle: '',
          etag: '',
          currentMeta: { title: '' },
        });

        // Check if it's a stale write error
        if (errorMessage.includes('modified') || result.reason === 'stale_write') {
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
      console.error('Failed to save properties:', error);
      setPropertiesDialog({
        isOpen: false,
        blockId: '',
        blockTitle: '',
        etag: '',
        currentMeta: { title: '' },
      });
      setEditedTitle('');
      setEditedDescription('');
      setEditedCategory('');
      setEditedTags('');
      showError('Failed to save properties. Please try again.', error);
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

                <div className="flex gap-2 relative">
                  <button
                    onClick={() => handleEditBlock(block.id)}
                    className="p-1 hover:bg-grey-11 rounded transition-colors"
                    title="Edit block content"
                  >
                    <Edit2 className="h-4 w-4 text-azure-04" />
                  </button>
                  <button
                    onClick={() => setOpenMenuId(openMenuId === block.id ? null : block.id)}
                    className="p-1 hover:bg-grey-11 rounded transition-colors"
                    title="More actions"
                    aria-label="More actions"
                  >
                    <MoreVertical className="h-4 w-4 text-grey-04" />
                  </button>

                  {/* Dropdown Menu */}
                  {openMenuId === block.id && (
                    <div
                      ref={menuRef}
                      className="absolute right-0 top-8 w-48 bg-white border border-grey-09 rounded shadow-lg z-10"
                    >
                      <button
                        onClick={() => {
                          handleEditProperties(block.id);
                          setOpenMenuId(null);
                        }}
                        className="w-full px-4 py-2 text-left flex items-center gap-2 hover:bg-grey-11 transition-colors"
                      >
                        <Settings className="h-4 w-4 text-grey-04" />
                        <span>Properties</span>
                      </button>
                      <button
                        onClick={() => {
                          handleRenameBlock(block.id);
                          setOpenMenuId(null);
                        }}
                        className="w-full px-4 py-2 text-left flex items-center gap-2 hover:bg-grey-11 transition-colors"
                      >
                        <FileEdit className="h-4 w-4 text-grey-04" />
                        <span>Rename</span>
                      </button>
                      <div className="border-t border-grey-09 my-1" />
                      <button
                        onClick={() => {
                          handleDeleteBlock(block.id);
                          setOpenMenuId(null);
                        }}
                        className="w-full px-4 py-2 text-left flex items-center gap-2 hover:bg-red-50 transition-colors text-red-04"
                      >
                        <Trash2 className="h-4 w-4" />
                        <span>Delete</span>
                      </button>
                    </div>
                  )}
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

      {/* Rename Block Dialog */}
      {renameDialog.isOpen && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          role="dialog"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setRenameDialog({ isOpen: false, blockId: '', currentName: '', etag: '' });
              setNewName('');
            }
          }}
        >
          <div className="bg-white rounded-lg p-6 w-full max-w-md" data-testid="rename-block-dialog">
            <h2 className="text-xl font-semibold mb-4">Rename Block</h2>
            <div className="mb-4">
              <label htmlFor="block-name" className="block text-sm font-medium mb-2">
                Block Name (filename)
              </label>
              <input
                id="block-name"
                type="text"
                value={newName}
                onChange={(e) => setNewName(slugify(e.target.value))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleConfirmRename();
                  }
                }}
                placeholder="Enter new block name..."
                className="w-full px-3 py-2 border border-grey-09 rounded focus:outline-none focus:ring-2 focus:ring-azure-04"
                autoFocus
                data-testid="block-name-input"
              />
              <p className="mt-2 text-sm text-grey-04">Filename will be auto-formatted (lowercase, hyphens).</p>
            </div>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => {
                  setRenameDialog({ isOpen: false, blockId: '', currentName: '', etag: '' });
                  setNewName('');
                }}
                className="px-4 py-2 border border-grey-09 rounded hover:bg-grey-11 transition-colors"
                disabled={updateLocalized.isPending}
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmRename}
                disabled={!newName || newName === renameDialog.currentName || updateLocalized.isPending}
                className="px-4 py-2 bg-azure-04 text-white rounded hover:bg-azure-03 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                data-testid="rename-block-submit"
              >
                {updateLocalized.isPending ? 'Renaming...' : 'Rename'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Properties Dialog */}
      {propertiesDialog.isOpen && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          role="dialog"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setPropertiesDialog({
                isOpen: false,
                blockId: '',
                blockTitle: '',
                etag: '',
                currentMeta: { title: '' },
              });
              setEditedTitle('');
              setEditedDescription('');
              setEditedCategory('');
              setEditedTags('');
            }
          }}
        >
          <div className="bg-white rounded-lg p-6 w-full max-w-md" data-testid="properties-dialog">
            <h2 className="text-xl font-semibold mb-4">Edit Block Properties</h2>
            <div className="space-y-4 mb-4">
              <div>
                <label htmlFor="block-title" className="block text-sm font-medium mb-2">
                  Title <span className="text-red-500">*</span>
                </label>
                <input
                  id="block-title"
                  type="text"
                  value={editedTitle}
                  onChange={(e) => setEditedTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && e.ctrlKey) {
                      e.preventDefault();
                      handleSaveProperties();
                    }
                  }}
                  placeholder="Enter block title..."
                  className="w-full px-3 py-2 border border-grey-09 rounded focus:outline-none focus:ring-2 focus:ring-azure-04"
                  autoFocus
                  data-testid="block-title-input"
                />
                <p className="mt-1 text-sm text-grey-04">The display name shown in the UI</p>
              </div>

              <div>
                <label htmlFor="block-description" className="block text-sm font-medium mb-2">
                  Description
                </label>
                <textarea
                  id="block-description"
                  value={editedDescription}
                  onChange={(e) => setEditedDescription(e.target.value)}
                  placeholder="Enter block description..."
                  rows={3}
                  className="w-full px-3 py-2 border border-grey-09 rounded focus:outline-none focus:ring-2 focus:ring-azure-04"
                  data-testid="block-description-input"
                />
                <p className="mt-1 text-sm text-grey-04">Brief description of this block</p>
              </div>

              <div>
                <label htmlFor="block-category" className="block text-sm font-medium mb-2">
                  Category
                </label>
                <input
                  id="block-category"
                  type="text"
                  value={editedCategory}
                  onChange={(e) => setEditedCategory(e.target.value)}
                  placeholder="content, headers, cta, footers..."
                  className="w-full px-3 py-2 border border-grey-09 rounded focus:outline-none focus:ring-2 focus:ring-azure-04"
                  data-testid="block-category-input"
                />
                <p className="mt-1 text-sm text-grey-04">Category for organizing blocks</p>
              </div>

              <div>
                <label htmlFor="block-tags" className="block text-sm font-medium mb-2">
                  Tags
                </label>
                <input
                  id="block-tags"
                  type="text"
                  value={editedTags}
                  onChange={(e) => setEditedTags(e.target.value)}
                  placeholder="hero, cta, featured..."
                  className="w-full px-3 py-2 border border-grey-09 rounded focus:outline-none focus:ring-2 focus:ring-azure-04"
                  data-testid="block-tags-input"
                />
                <p className="mt-1 text-sm text-grey-04">Comma-separated tags for categorization</p>
              </div>
            </div>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => {
                  setPropertiesDialog({
                    isOpen: false,
                    blockId: '',
                    blockTitle: '',
                    etag: '',
                    currentMeta: { title: '' },
                  });
                  setEditedTitle('');
                  setEditedDescription('');
                  setEditedCategory('');
                  setEditedTags('');
                }}
                className="px-4 py-2 border border-grey-09 rounded hover:bg-grey-11 transition-colors"
                disabled={updateLocalized.isPending}
              >
                Cancel
              </button>
              <button
                onClick={handleSaveProperties}
                disabled={!editedTitle.trim() || updateLocalized.isPending}
                className="px-4 py-2 bg-azure-04 text-white rounded hover:bg-azure-03 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                data-testid="save-properties-submit"
              >
                {updateLocalized.isPending ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

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
