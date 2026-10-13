import type { FragmentEditable } from '@conloca/content-api-client';
import {
  APIClientError,
  type ContentManifest,
  localesOf,
  metaString,
  useDeleteContent,
  useFragments,
  useUpdateLocalized,
} from '@conloca/content-api-client';
import { AlertCircle, Edit2, FileEdit, Loader2, MoreVertical, Package, Plus, Settings, Trash2 } from 'lucide-react';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useClickOutside, useDialogState, useErrorModal } from '../../hooks/index.js';
import type { Fragment } from '../../types.js';
import { cn } from '../../utils/cn.js';
import { contentFailureMessage, isStaleWrite } from '../../utils/content-failure.js';
import { editableEntryMeta, entryMetaPatch } from '../../utils/entry-meta.js';
import { menuOpensUp } from '../../utils/menu-placement.js';
import { slugify } from '../../utils/slugify.js';
import { DeleteConfirmDialog } from '../dialogs/DeleteConfirmDialog.js';
import { ErrorModal } from '../dialogs/ErrorModal.js';
import { FragmentPropertiesDialog } from '../dialogs/FragmentPropertiesDialog.js';
import { CreateFragmentDialog } from '../editor/CreateFragmentDialog.js';
import { Button, Input, Select } from '../ui/index.js';

export function FragmentList() {
  const [selectedCategory, setSelectedCategory] = useState<string | 'all'>('all');
  const [createDialog, openCreateDialog, closeCreateDialog] = useDialogState({});
  const [deleteDialog, openDeleteDialog, closeDeleteDialog] = useDialogState({
    fragmentId: '',
    fragmentTitle: '',
    etag: '',
  });

  const [renameDialog, openRenameDialog, closeRenameDialog] = useDialogState({
    fragmentId: '',
    currentName: '',
    etag: '',
  });
  const [newName, setNewName] = useState('');

  const [propertiesDialog, openPropertiesDialog, closePropertiesDialog] = useDialogState({
    fragmentId: '',
    fragmentTitle: '',
    etag: '',
    currentMeta: { title: '' } as FragmentEditable,
  });

  // Dropdown menu state
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [menuUp, setMenuUp] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const { showError, showStaleWriteError, errorModalProps } = useErrorModal();

  const navigate = useNavigate();
  const deleteContent = useDeleteContent();
  const updateLocalized = useUpdateLocalized();

  // Fetch fragments entries
  const { data, isLoading, error } = useFragments();

  // Transform entries into Fragment objects
  const fragments = useMemo<Fragment[]>(() => {
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
      // For fragments, we'll use the title from meta
      const title = firstLocale.meta?.title || firstLocale.name || entry.id;

      const storedCategory = metaString(firstLocale.meta?.category);

      // Use category from metadata, or auto-detect from the fragment name/ID
      const category =
        storedCategory ||
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
        meta: editableEntryMeta(firstLocale.meta, title),
      };
    });
  }, [data]);

  // Get unique categories
  const categories = useMemo(() => {
    const cats = new Set<string>();
    fragments.forEach((fragment) => {
      cats.add(fragment.category);
    });
    return ['all', ...Array.from(cats).sort()];
  }, [fragments]);

  // Filter fragments by category
  const filteredFragments = useMemo(() => {
    if (selectedCategory === 'all') return fragments;
    return fragments.filter((fragment) => fragment.category === selectedCategory);
  }, [fragments, selectedCategory]);

  // Click outside handler to close menu
  const closeMenu = useCallback(() => setOpenMenuId(null), []);
  useClickOutside(menuRef, closeMenu, !!openMenuId);

  // Loading state
  if (isLoading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-azure-04 dark:text-azure-08 mx-auto mb-4" />
          <p className="text-grey-04 dark:text-grey-07">Loading fragments...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[400px]">
        <div className="text-center max-w-md">
          <AlertCircle className="h-12 w-12 text-red-04 dark:text-red-08 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-grey-01 dark:text-grey-12 mb-2">Failed to load fragments</h2>
          <p className="text-grey-04 dark:text-grey-07 mb-4">{error.message}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-azure-04 text-white rounded-md hover:bg-azure-03 transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const handleNewFragment = () => {
    openCreateDialog({});
  };

  // Fragment created server-side with template MDX as initial content; navigate
  // straight into the full page editor (`/fragments/:id`) where the user gets
  // unsaved-changes guarding, conflict recovery, and locale switching.
  const handleFragmentCreated = ({ id: newId }: { id: string }) => {
    closeCreateDialog();
    navigate(`/fragments/${newId}`);
  };

  const handleEditFragment = (fragmentId: string) => {
    navigate(`/fragments/${fragmentId}`);
  };

  const handleDeleteFragment = (fragmentId: string) => {
    const fragment = fragments.find((f) => f.id === fragmentId);
    if (!fragment) return;

    openDeleteDialog({
      fragmentId,
      fragmentTitle: fragment.title,
      etag: fragment.etag,
    });
  };

  const handleConfirmDelete = async () => {
    if (!deleteDialog.fragmentId) return;

    try {
      const result = await deleteContent.mutateAsync({
        id: deleteDialog.fragmentId,
        etag: deleteDialog.etag,
      });

      closeDeleteDialog();

      if (!result.success) {
        if (isStaleWrite(result)) {
          showStaleWriteError(result.error);
        } else {
          showError(contentFailureMessage(result, 'Failed to delete fragment'), result.error);
        }
      }
    } catch (error) {
      closeDeleteDialog();
      showError('Failed to delete fragment. Please try again.', error);
    }
  };

  const handleRenameFragment = (fragmentId: string) => {
    const fragment = fragments.find((f) => f.id === fragmentId);
    if (!fragment) return;

    // Use the actual filename from the fragment data
    const currentName = fragment.name || fragment.id.split('/').pop() || fragment.id;

    openRenameDialog({
      fragmentId,
      currentName,
      etag: fragment.etag,
    });
    setNewName(currentName);
  };

  // The field keeps the text as the author types it; the file name is made from it to show and to save.
  const newFileName = slugify(newName);
  const renameUnchanged = newName === renameDialog.currentName || newFileName === renameDialog.currentName;

  const handleConfirmRename = async () => {
    if (!renameDialog.fragmentId || !newFileName || renameUnchanged) return;

    const fragment = fragments.find((f) => f.id === renameDialog.fragmentId);
    const locale = fragment?.locales[0] || 'en';

    try {
      const result = await updateLocalized.mutateAsync({
        id: renameDialog.fragmentId,
        locale,
        data: {
          name: newFileName,
        },
        etag: renameDialog.etag,
      });

      closeRenameDialog();
      setNewName('');

      if (!result.success) {
        if (isStaleWrite(result)) {
          showStaleWriteError(result.error);
        } else {
          showError(contentFailureMessage(result, 'Failed to rename fragment'), result.error);
        }
      }
    } catch (error) {
      closeRenameDialog();
      // The content-API router answers a refusal, such as a name another fragment has, with an
      // error status, which the client throws. Trying the same name again never works: say why.
      showError(
        error instanceof APIClientError ? error.message : 'Failed to rename fragment. Please try again.',
        error,
      );
    }
  };

  const handleEditProperties = (fragmentId: string) => {
    const fragment = fragments.find((f) => f.id === fragmentId);
    if (!fragment) return;

    // Initialize default meta if missing
    const meta = fragment.meta || { title: fragment.title };

    openPropertiesDialog({
      fragmentId,
      fragmentTitle: fragment.title,
      etag: fragment.etag,
      currentMeta: meta,
    });
  };

  const handleSaveProperties = async (meta: {
    title: string;
    description?: string;
    category?: string;
    tags?: string[];
  }) => {
    if (!propertiesDialog.fragmentId || !meta.title.trim()) return;

    const fragment = fragments.find((f) => f.id === propertiesDialog.fragmentId);
    const locale = fragment?.locales[0] || 'en';

    try {
      const result = await updateLocalized.mutateAsync({
        id: propertiesDialog.fragmentId,
        locale,
        // Cleared fields go over the wire as null: undefined is dropped by
        // JSON.stringify and the server merge would keep the old value.
        data: { meta: entryMetaPatch(meta) },
        etag: propertiesDialog.etag,
      });

      closePropertiesDialog();

      if (!result.success) {
        if (isStaleWrite(result)) {
          showStaleWriteError(result.error);
        } else {
          showError(contentFailureMessage(result, 'Failed to save properties'), result.error);
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
        <h1 className="text-2xl font-semibold text-grey-01 dark:text-grey-12">Fragments</h1>
        <div className="flex items-center gap-4">
          {categories.length > 2 && (
            <Select value={selectedCategory} onChange={(e) => setSelectedCategory(e.target.value)} className="w-auto">
              {categories.map((cat) => (
                <option key={cat} value={cat}>
                  {cat === 'all' ? 'All Categories' : cat}
                </option>
              ))}
            </Select>
          )}
          <button
            type="button"
            onClick={handleNewFragment}
            className="px-4 py-2 rounded-md bg-grey-01 text-grey-12 hover:bg-azure-04 hover:text-white dark:bg-grey-12 dark:text-grey-01 dark:hover:bg-azure-06 dark:hover:text-white transition-colors flex items-center gap-2"
            data-testid="new-fragment-button"
          >
            <Plus className="h-4 w-4" />
            New Fragment
          </button>
        </div>
      </div>

      {/* Empty state */}
      {fragments.length === 0 ? (
        <div className="flex flex-col items-center justify-center min-h-[50vh] text-center">
          <Package className="h-12 w-12 text-grey-06 dark:text-grey-05 mb-4" />
          <h2 className="text-xl font-semibold text-grey-01 dark:text-grey-12 mb-2" data-testid="no-fragments-message">
            No fragments yet
          </h2>
          <p className="text-grey-04 dark:text-grey-07 mb-4">Create reusable content fragments for your pages</p>
          <button
            type="button"
            onClick={handleNewFragment}
            className="px-4 py-2 rounded-md bg-grey-01 text-grey-12 hover:bg-azure-04 hover:text-white dark:bg-grey-12 dark:text-grey-01 dark:hover:bg-azure-06 dark:hover:text-white transition-colors"
          >
            Create Fragment
          </button>
        </div>
      ) : filteredFragments.length === 0 ? (
        <div className="flex items-center justify-center min-h-[40vh] text-center">
          <p className="text-grey-04 dark:text-grey-07" data-testid="no-fragments-category-message">
            No fragments found in category "{selectedCategory}"
          </p>
        </div>
      ) : (
        /* Card Grid */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredFragments.map((fragment) => (
            <div
              key={fragment.id}
              className="bg-white dark:bg-grey-02 border border-line rounded-md p-4 hover:border-azure-04 transition-colors"
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Package className="h-4 w-4 text-grey-04 dark:text-grey-07" />
                  <h3
                    className="font-medium text-grey-01 dark:text-grey-12"
                    data-testid={`fragment-title-${fragment.id}`}
                  >
                    {fragment.title}
                  </h3>
                </div>
                <span className="px-2 py-1 text-xs bg-grey-11 dark:bg-grey-03 rounded-md">{fragment.category}</span>
              </div>

              <p
                className="text-sm text-grey-04 dark:text-grey-07 mb-3 line-clamp-3"
                data-testid={`fragment-description-${fragment.id}`}
              >
                {fragment.preview}
              </p>

              <div className="flex items-center justify-between">
                <div className="flex gap-1">
                  {fragment.locales.map((locale) => (
                    <span
                      key={locale}
                      data-testid="locale-indicator"
                      className="px-2 py-1 text-xs bg-grey-11 dark:bg-grey-03 rounded-md"
                    >
                      {locale}
                    </span>
                  ))}
                </div>

                <div className="flex gap-2 relative">
                  <button
                    type="button"
                    onClick={() => handleEditFragment(fragment.id)}
                    className="p-1 hover:bg-hover rounded-md transition-colors"
                    title="Edit fragment content"
                  >
                    <Edit2 className="h-4 w-4 text-azure-04 dark:text-azure-08" />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      setMenuUp(menuOpensUp(e.currentTarget.getBoundingClientRect(), window.innerHeight));
                      setOpenMenuId(openMenuId === fragment.id ? null : fragment.id);
                    }}
                    className="p-1 hover:bg-hover rounded-md transition-colors"
                    title="More actions"
                    aria-label="More actions"
                  >
                    <MoreVertical className="h-4 w-4 text-grey-04 dark:text-grey-07" />
                  </button>

                  {/* Dropdown Menu */}
                  {openMenuId === fragment.id && (
                    <div
                      ref={menuRef}
                      className={cn(
                        'absolute right-0 w-48 bg-overlay border border-line rounded-md shadow-lg z-10',
                        menuUp ? 'bottom-8' : 'top-8',
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          handleEditProperties(fragment.id);
                          setOpenMenuId(null);
                        }}
                        className="w-full px-4 py-2 text-left flex items-center gap-2 hover:bg-hover transition-colors"
                      >
                        <Settings className="h-4 w-4 text-grey-04 dark:text-grey-07" />
                        <span>Properties</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          handleRenameFragment(fragment.id);
                          setOpenMenuId(null);
                        }}
                        className="w-full px-4 py-2 text-left flex items-center gap-2 hover:bg-hover transition-colors"
                      >
                        <FileEdit className="h-4 w-4 text-grey-04 dark:text-grey-07" />
                        <span>Rename</span>
                      </button>
                      <div className="border-t border-line my-1" />
                      <button
                        type="button"
                        onClick={() => {
                          handleDeleteFragment(fragment.id);
                          setOpenMenuId(null);
                        }}
                        className="w-full px-4 py-2 text-left flex items-center gap-2 hover:bg-red-11 dark:hover:bg-red-02 transition-colors text-red-04 dark:text-red-08"
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

      {/* Create Fragment Dialog (metadata-first; navigates to /fragments/:id on success) */}
      <CreateFragmentDialog
        isOpen={createDialog.isOpen}
        onClose={closeCreateDialog}
        onCreated={handleFragmentCreated}
      />

      {/* Rename Fragment Dialog */}
      {renameDialog.isOpen && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50"
          role="dialog"
          aria-modal="true"
          aria-labelledby="rename-fragment-dialog-title"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              closeRenameDialog();
              setNewName('');
            }
          }}
        >
          <div className="bg-overlay rounded-lg p-6 w-full max-w-md" data-testid="rename-fragment-dialog">
            <h2 id="rename-fragment-dialog-title" className="text-xl font-semibold text-grey-01 dark:text-grey-12 mb-4">
              Rename Fragment
            </h2>
            <div className="mb-4">
              <label htmlFor="fragment-name" className="block text-sm font-medium mb-2 text-grey-01 dark:text-grey-12">
                Fragment Name (filename)
              </label>
              <Input
                id="fragment-name"
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleConfirmRename();
                  }
                }}
                placeholder="Enter new fragment name..."
                autoFocus
                data-testid="fragment-name-input"
              />
              {newName && !newFileName ? (
                <p className="mt-2 text-sm text-red-04 dark:text-red-08">
                  The name needs letters a–z or digits: it is the fragment's file name.
                </p>
              ) : (
                <p className="mt-2 text-sm text-grey-04 dark:text-grey-07">
                  {renameUnchanged
                    ? `The file name is already ${renameDialog.currentName}.`
                    : newFileName
                      ? `Will be saved as ${newFileName}`
                      : 'Filename will be auto-formatted (lowercase, hyphens).'}
                </p>
              )}
            </div>
            <div className="flex justify-end gap-3">
              <Button
                variant="outline"
                onClick={() => {
                  closeRenameDialog();
                  setNewName('');
                }}
                disabled={updateLocalized.isPending}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={handleConfirmRename}
                disabled={!newFileName || renameUnchanged || updateLocalized.isPending}
                data-testid="rename-fragment-submit"
              >
                {updateLocalized.isPending ? 'Renaming...' : 'Rename'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Properties Dialog */}
      <FragmentPropertiesDialog
        isOpen={propertiesDialog.isOpen}
        fragmentTitle={propertiesDialog.fragmentTitle}
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
        title="Delete Fragment"
        message="Are you sure you want to delete this fragment?"
        itemName={deleteDialog.fragmentTitle}
        isDeleting={deleteContent.isPending}
      />

      {/* Error Modal */}
      <ErrorModal {...errorModalProps} />
    </div>
  );
}
