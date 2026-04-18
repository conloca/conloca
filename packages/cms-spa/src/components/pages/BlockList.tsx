import type { BlockEditable } from '@conloca/content-api-client';
import {
  type ContentManifest,
  localesOf,
  useBlocks,
  useCreateContent,
  useDeleteContent,
  useUpdateLocalized,
} from '@conloca/content-api-client';
import { AlertCircle, Edit2, FileEdit, Loader2, MoreVertical, Package, Plus, Settings, Trash2 } from 'lucide-react';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useClickOutside, useDialogState, useErrorModal } from '../../hooks';
import type { Block } from '../../types';
import { slugify } from '../../utils/slugify';
import { BlockPropertiesDialog } from '../dialogs/BlockPropertiesDialog';
import { DeleteConfirmDialog } from '../dialogs/DeleteConfirmDialog';
import { ErrorModal } from '../dialogs/ErrorModal';
import { CMSMDXEditorModal } from '../editor/CMSMDXEditor';
import {
  contentBlockTemplates,
  getContentBlockTemplate,
  renderContentBlockTemplate,
} from '../editor/content-block-templates';

export function BlockList() {
  const [selectedCategory, setSelectedCategory] = useState<string | 'all'>('all');
  const [showMDXEditor, setShowMDXEditor] = useState(false);
  const [newBlockName, setNewBlockName] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState(contentBlockTemplates[0]?.id || '');
  const [createDialog, openCreateDialog, closeCreateDialog] = useDialogState({});
  const [titleInput, setTitleInput] = useState('');
  const [deleteDialog, openDeleteDialog, closeDeleteDialog] = useDialogState({
    blockId: '',
    blockTitle: '',
    etag: '',
  });

  const [renameDialog, openRenameDialog, closeRenameDialog] = useDialogState({
    blockId: '',
    currentName: '',
    etag: '',
  });
  const [newName, setNewName] = useState('');

  const [propertiesDialog, openPropertiesDialog, closePropertiesDialog] = useDialogState({
    blockId: '',
    blockTitle: '',
    etag: '',
    currentMeta: { title: '' } as BlockEditable,
  });

  // Dropdown menu state
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const { showError, showStaleWriteError, errorModalProps } = useErrorModal();

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
  const closeMenu = useCallback(() => setOpenMenuId(null), []);
  useClickOutside(menuRef, closeMenu, !!openMenuId);

  // Loading state
  if (isLoading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-azure-04 mx-auto mb-4" />
          <p className="text-grey-04 dark:text-grey-07">Loading blocks...</p>
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
          <h2 className="text-xl font-semibold text-grey-01 dark:text-grey-12 mb-2">Failed to load blocks</h2>
          <p className="text-grey-04 dark:text-grey-07 mb-4">{error.message}</p>
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
    setSelectedTemplateId(contentBlockTemplates[0]?.id || '');
    openCreateDialog({});
  };

  const handleCreateBlock = () => {
    if (!titleInput.trim()) return;

    setNewBlockName(titleInput.trim());
    closeCreateDialog();
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
        category: getContentBlockTemplate(selectedTemplateId)?.category,
      },
      locales: {
        en: {
          meta: {
            title: newBlockName, // Keep original title for display
            category: getContentBlockTemplate(selectedTemplateId)?.category,
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

    openDeleteDialog({
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

      closeDeleteDialog();

      if (!result.success) {
        const errorMessage = result.error?.message || 'Failed to delete block';
        if (errorMessage.includes('modified')) {
          showStaleWriteError(result.error);
        } else {
          showError(errorMessage, result.error);
        }
      }
    } catch (error) {
      closeDeleteDialog();
      showError('Failed to delete block. Please try again.', error);
    }
  };

  const handleRenameBlock = (blockId: string) => {
    const block = blocks.find((b) => b.id === blockId);
    if (!block) return;

    // Use the actual filename from the block data
    const currentName = block.name || block.id.split('/').pop() || block.id;

    openRenameDialog({
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

      closeRenameDialog();
      setNewName('');

      if (!result.success) {
        const errorMessage = result.error?.message || 'Failed to rename block';
        if (errorMessage.includes('modified') || result.reason === 'stale_write') {
          showStaleWriteError(result.error);
        } else if (errorMessage.includes('already taken')) {
          showError('A block with this name already exists. Please choose a different name.', result.error);
        } else {
          showError(errorMessage, result.error);
        }
      }
    } catch (error) {
      closeRenameDialog();
      showError('Failed to rename block. Please try again.', error);
    }
  };

  const handleEditProperties = (blockId: string) => {
    const block = blocks.find((b) => b.id === blockId);
    if (!block) return;

    // Initialize default meta if missing
    const meta = block.meta || { title: block.title };

    openPropertiesDialog({
      blockId,
      blockTitle: block.title,
      etag: block.etag,
      currentMeta: meta,
    });
  };

  const handleSaveProperties = async (meta: {
    title: string;
    description?: string;
    category?: string;
    tags?: string[];
  }) => {
    if (!propertiesDialog.blockId || !meta.title.trim()) return;

    const block = blocks.find((b) => b.id === propertiesDialog.blockId);
    const locale = block?.locales[0] || 'en';

    try {
      const result = await updateLocalized.mutateAsync({
        id: propertiesDialog.blockId,
        locale,
        data: {
          meta: {
            title: meta.title,
            description: meta.description,
            category: meta.category,
            tags: meta.tags,
          },
        },
        etag: propertiesDialog.etag,
      });

      closePropertiesDialog();

      if (!result.success) {
        const errorMessage = result.error?.message || 'Failed to save properties';
        if (errorMessage.includes('modified') || result.reason === 'stale_write') {
          showStaleWriteError(result.error);
        } else {
          showError(errorMessage, result.error);
        }
      }
    } catch (error) {
      closePropertiesDialog();
      showError('Failed to save properties. Please try again.', error);
    }
  };

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-grey-01 dark:text-grey-12">Blocks</h1>
        <div className="flex items-center gap-4">
          {categories.length > 2 && (
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="px-3 py-2 border border-grey-09 dark:border-grey-03 rounded bg-white dark:bg-grey-03 dark:text-grey-12 hover:bg-grey-11 dark:hover:bg-grey-04 transition-colors"
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
        <div className="bg-white dark:bg-grey-02 border border-grey-09 dark:border-grey-03 rounded p-12 text-center">
          <Package className="h-12 w-12 text-grey-04 dark:text-grey-07 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-grey-01 dark:text-grey-12 mb-2" data-testid="no-blocks-message">
            No blocks yet
          </h2>
          <p className="text-grey-04 dark:text-grey-07 mb-4">Create reusable content blocks for your pages</p>
          <button
            onClick={handleNewBlock}
            className="px-4 py-2 bg-azure-04 text-white rounded hover:bg-azure-03 transition-colors"
          >
            Create Block
          </button>
        </div>
      ) : filteredBlocks.length === 0 ? (
        <div className="bg-white dark:bg-grey-02 border border-grey-09 dark:border-grey-03 rounded p-12 text-center">
          <p className="text-grey-04 dark:text-grey-07" data-testid="no-blocks-category-message">
            No blocks found in category "{selectedCategory}"
          </p>
        </div>
      ) : (
        /* Card Grid */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredBlocks.map((block) => (
            <div
              key={block.id}
              className="bg-white dark:bg-grey-02 border border-grey-09 dark:border-grey-03 rounded p-4 hover:border-azure-04 transition-colors"
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Package className="h-4 w-4 text-grey-04 dark:text-grey-07" />
                  <h3 className="font-medium text-grey-01 dark:text-grey-12" data-testid={`block-title-${block.id}`}>
                    {block.title}
                  </h3>
                </div>
                <span className="px-2 py-1 text-xs bg-grey-11 dark:bg-grey-03 rounded">{block.category}</span>
              </div>

              <p
                className="text-sm text-grey-04 dark:text-grey-07 mb-3 line-clamp-3"
                data-testid={`block-description-${block.id}`}
              >
                {block.preview}
              </p>

              <div className="flex items-center justify-between">
                <div className="flex gap-1">
                  {block.locales.map((locale) => (
                    <span
                      key={locale}
                      data-testid="locale-indicator"
                      className="px-2 py-1 text-xs bg-grey-11 dark:bg-grey-03 rounded"
                    >
                      {locale}
                    </span>
                  ))}
                </div>

                <div className="flex gap-2 relative">
                  <button
                    onClick={() => handleEditBlock(block.id)}
                    className="p-1 hover:bg-grey-11 dark:hover:bg-grey-03 rounded transition-colors"
                    title="Edit block content"
                  >
                    <Edit2 className="h-4 w-4 text-azure-04" />
                  </button>
                  <button
                    onClick={() => setOpenMenuId(openMenuId === block.id ? null : block.id)}
                    className="p-1 hover:bg-grey-11 dark:hover:bg-grey-03 rounded transition-colors"
                    title="More actions"
                    aria-label="More actions"
                  >
                    <MoreVertical className="h-4 w-4 text-grey-04 dark:text-grey-07" />
                  </button>

                  {/* Dropdown Menu */}
                  {openMenuId === block.id && (
                    <div
                      ref={menuRef}
                      className="absolute right-0 top-8 w-48 bg-white dark:bg-grey-03 border border-grey-09 dark:border-grey-03 rounded shadow-lg z-10"
                    >
                      <button
                        onClick={() => {
                          handleEditProperties(block.id);
                          setOpenMenuId(null);
                        }}
                        className="w-full px-4 py-2 text-left flex items-center gap-2 hover:bg-grey-11 dark:hover:bg-grey-03 transition-colors"
                      >
                        <Settings className="h-4 w-4 text-grey-04 dark:text-grey-07" />
                        <span>Properties</span>
                      </button>
                      <button
                        onClick={() => {
                          handleRenameBlock(block.id);
                          setOpenMenuId(null);
                        }}
                        className="w-full px-4 py-2 text-left flex items-center gap-2 hover:bg-grey-11 dark:hover:bg-grey-03 transition-colors"
                      >
                        <FileEdit className="h-4 w-4 text-grey-04 dark:text-grey-07" />
                        <span>Rename</span>
                      </button>
                      <div className="border-t border-grey-09 dark:border-grey-03 my-1" />
                      <button
                        onClick={() => {
                          handleDeleteBlock(block.id);
                          setOpenMenuId(null);
                        }}
                        className="w-full px-4 py-2 text-left flex items-center gap-2 hover:bg-red-11 dark:hover:bg-red-02 transition-colors text-red-04"
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
      {createDialog.isOpen && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50"
          role="dialog"
          aria-modal="true"
          aria-labelledby="create-block-dialog-title"
        >
          <div className="bg-white dark:bg-grey-03 rounded-lg p-6 w-full max-w-md" data-testid="create-block-dialog">
            <h2 id="create-block-dialog-title" className="text-xl font-semibold text-grey-01 dark:text-grey-12 mb-4">
              Create New Block
            </h2>
            <div className="mb-4">
              <label htmlFor="block-title" className="block text-sm font-medium mb-2 text-grey-01 dark:text-grey-12">
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
                className="w-full px-3 py-2 border border-grey-09 dark:border-grey-03 dark:bg-grey-03 dark:text-grey-12 rounded focus:outline-none focus:ring-2 focus:ring-azure-04"
                autoFocus
                data-testid="block-title-input"
              />
              <p className="mt-2 text-sm text-grey-04 dark:text-grey-07">
                This will be used as the display name for your block
              </p>
            </div>
            <div className="mb-4">
              <label htmlFor="block-template" className="block text-sm font-medium mb-2 text-grey-01 dark:text-grey-12">
                Starter Template
              </label>
              <select
                id="block-template"
                value={selectedTemplateId}
                onChange={(e) => setSelectedTemplateId(e.target.value)}
                className="w-full px-3 py-2 border border-grey-09 dark:border-grey-03 bg-white dark:bg-grey-03 dark:text-grey-12 rounded focus:outline-none focus:ring-2 focus:ring-azure-04"
              >
                {contentBlockTemplates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.label}
                  </option>
                ))}
              </select>
              <p className="mt-2 text-sm text-grey-04 dark:text-grey-07">
                {getContentBlockTemplate(selectedTemplateId)?.description}
              </p>
            </div>
            <div className="flex justify-end gap-3">
              <button
                onClick={closeCreateDialog}
                className="px-4 py-2 border border-grey-09 dark:border-grey-03 rounded hover:bg-grey-11 dark:hover:bg-grey-03 transition-colors"
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
      <CMSMDXEditorModal
        isOpen={showMDXEditor}
        onClose={() => setShowMDXEditor(false)}
        filePath={newBlockName}
        initialTemplateId={selectedTemplateId}
        initialContent={renderContentBlockTemplate(selectedTemplateId, newBlockName)}
        onSave={handleSaveBlock}
      />

      {/* Rename Block Dialog */}
      {renameDialog.isOpen && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50"
          role="dialog"
          aria-modal="true"
          aria-labelledby="rename-block-dialog-title"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              closeRenameDialog();
              setNewName('');
            }
          }}
        >
          <div className="bg-white dark:bg-grey-03 rounded-lg p-6 w-full max-w-md" data-testid="rename-block-dialog">
            <h2 id="rename-block-dialog-title" className="text-xl font-semibold text-grey-01 dark:text-grey-12 mb-4">
              Rename Block
            </h2>
            <div className="mb-4">
              <label htmlFor="block-name" className="block text-sm font-medium mb-2 text-grey-01 dark:text-grey-12">
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
                className="w-full px-3 py-2 border border-grey-09 dark:border-grey-03 dark:bg-grey-03 dark:text-grey-12 rounded focus:outline-none focus:ring-2 focus:ring-azure-04"
                autoFocus
                data-testid="block-name-input"
              />
              <p className="mt-2 text-sm text-grey-04 dark:text-grey-07">
                Filename will be auto-formatted (lowercase, hyphens).
              </p>
            </div>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => {
                  closeRenameDialog();
                  setNewName('');
                }}
                className="px-4 py-2 border border-grey-09 dark:border-grey-03 rounded hover:bg-grey-11 dark:hover:bg-grey-03 transition-colors"
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
      <BlockPropertiesDialog
        isOpen={propertiesDialog.isOpen}
        blockTitle={propertiesDialog.blockTitle}
        currentMeta={propertiesDialog.currentMeta}
        onSave={handleSaveProperties}
        onCancel={closePropertiesDialog}
        isSaving={updateLocalized.isPending}
      />

      {/* Delete Confirmation Dialog */}
      <DeleteConfirmDialog
        isOpen={deleteDialog.isOpen}
        onConfirm={handleConfirmDelete}
        onCancel={closeDeleteDialog}
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
