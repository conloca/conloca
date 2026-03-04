import type { DataEditable } from '@conloca/content-api-client';
import {
  type ContentManifest,
  localesOf,
  useCreateContent,
  useData,
  useDataCollections,
  useDeleteContent,
  useUpdateLocalized,
} from '@conloca/content-api-client';
import { AlertCircle, Code, Database, Loader2, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { DataSchemas } from '../../data-schemas';
import { useDialogState, useErrorModal } from '../../hooks';
import type { DataEntry } from '../../types';
import { getUIConfig } from '../../ui-config';
import { slugify } from '../../utils/slugify';
import { DataEntryCard } from '../cards/DataEntryCard';
import { CreateDataDialog } from '../dialogs/CreateDataDialog';
import { DataPropertiesDialog } from '../dialogs/DataPropertiesDialog';
import { DeleteConfirmDialog } from '../dialogs/DeleteConfirmDialog';
import { ErrorModal } from '../dialogs/ErrorModal';
import { DataEditor } from '../editors/DataEditor';

/**
 * Generates a VSCode URI to open the schemas file.
 */
function getSchemasEditorLink(projectRoot: string, schemasPath: string): string {
  // Convert relative path (./src/...) to absolute
  const relativePath = schemasPath.startsWith('./') ? schemasPath.slice(2) : schemasPath;
  return `vscode://file${projectRoot}/${relativePath}`;
}

interface DataListProps {
  dataSchemas: DataSchemas;
}

export function DataList({ dataSchemas }: DataListProps) {
  const [selectedCollection, setSelectedCollection] = useState<string | 'all'>('all');
  const [createDialog, openCreateDialog, closeCreateDialog] = useDialogState({});

  // Get config for editor links
  const config = getUIConfig();
  const schemasEditorLink =
    config.projectRoot && config.schemasPath ? getSchemasEditorLink(config.projectRoot, config.schemasPath) : null;
  const [deleteDialog, openDeleteDialog, closeDeleteDialog] = useDialogState({
    entryId: '',
    entryTitle: '',
    etag: '',
  });

  const [propertiesDialog, openPropertiesDialog, closePropertiesDialog] = useDialogState({
    entryId: '',
    locale: '',
    etag: '',
    currentMeta: { title: '' } as DataEditable,
  });

  const [editDataDialog, openEditDataDialog, closeEditDataDialog] = useDialogState({
    entryId: '',
    entryTitle: '',
    collection: '',
    locale: '',
    existingLocales: [] as string[],
    name: '',
  });

  const { showError, showStaleWriteError, errorModalProps } = useErrorModal();

  const createContent = useCreateContent();
  const deleteContent = useDeleteContent();
  const updateLocalized = useUpdateLocalized();

  // Fetch data entries
  const { data, isLoading, error } = useData(selectedCollection === 'all' ? undefined : selectedCollection);

  // Fetch available collections from filesystem and merge with schema-defined collections
  const { data: collectionsData } = useDataCollections();
  const collections = useMemo(() => {
    const filesystemCollections = collectionsData ?? [];
    const schemaCollections = Object.keys(dataSchemas);
    // Merge and dedupe - schema collections should appear even without data files
    return [...new Set([...filesystemCollections, ...schemaCollections])].sort();
  }, [collectionsData, dataSchemas]);

  // Transform entries into DataEntry objects
  const entries = useMemo<DataEntry[]>(() => {
    if (!data?.items) return [];

    return data.items.map((entry: ContentManifest) => {
      const firstLocale = Array.from(localesOf(entry))[0];
      if (!firstLocale) {
        return {
          id: entry.id,
          title: entry.id,
          collection: entry.collection || 'unknown',
          locales: [],
          etag: '',
        };
      }

      const title = firstLocale.meta?.title || firstLocale.name || entry.id;

      return {
        id: entry.id,
        title,
        description: firstLocale.meta?.description,
        collection: entry.collection || 'unknown',
        locales: Array.from(localesOf(entry)).map((v) => v.locale),
        etag: firstLocale.etag,
        name: firstLocale.name,
        meta: firstLocale.meta
          ? {
              title: firstLocale.meta.title || title,
              description: firstLocale.meta.description,
            }
          : undefined,
      };
    });
  }, [data]);

  // Filter entries by collection
  const filteredEntries = useMemo(() => {
    if (selectedCollection === 'all') return entries;
    return entries.filter((entry) => entry.collection === selectedCollection);
  }, [entries, selectedCollection]);

  // Loading state
  if (isLoading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-azure-04 mx-auto mb-4" />
          <p className="text-grey-04">Loading data entries...</p>
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
          <h2 className="text-xl font-semibold mb-2">Failed to load data entries</h2>
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

  const handleCreateEntry = async (collection: string, values: Record<string, unknown>) => {
    const title = ((values.title as string) || '').trim();
    if (!title || !collection) return;

    const name = slugify(title) || 'untitled';
    const description = ((values.description as string) || '').trim() || undefined;

    const result = await createContent.mutateAsync({
      kind: 'data',
      collection,
      type: 'json',
      name,
      meta: {
        title,
        description,
      },
      // Use 'en' as the default locale for new data entries
      locales: {
        en: {
          meta: {
            title,
            description,
          },
          content: {
            data: {},
          },
        },
      },
    });

    if (result.success && result.id) {
      closeCreateDialog();
      // Auto-open the editor so user can fill in schema fields
      openEditDataDialog({
        entryId: result.id,
        entryTitle: title,
        collection,
        locale: 'en',
        existingLocales: ['en'],
        name,
      });
    } else if (!result.success) {
      const errorMessage = result.error?.message || 'Failed to create data entry';
      showError(errorMessage, result.error);
    }
  };

  const handleDeleteEntry = (entryId: string) => {
    const entry = entries.find((e) => e.id === entryId);
    if (!entry) return;

    openDeleteDialog({
      entryId,
      entryTitle: entry.title,
      etag: entry.etag,
    });
  };

  const handleConfirmDelete = async () => {
    if (!deleteDialog.entryId) return;

    try {
      const result = await deleteContent.mutateAsync({
        id: deleteDialog.entryId,
        etag: deleteDialog.etag,
      });

      closeDeleteDialog();

      if (!result.success) {
        const errorMessage = result.error?.message || 'Failed to delete entry';
        if (errorMessage.includes('modified')) {
          showStaleWriteError(result.error);
        } else {
          showError(errorMessage, result.error);
        }
      }
    } catch (err) {
      closeDeleteDialog();
      showError('Failed to delete entry. Please try again.', err);
    }
  };

  const handleEditProperties = (entryId: string) => {
    const entry = entries.find((e) => e.id === entryId);
    if (!entry) return;

    openPropertiesDialog({
      entryId,
      locale: entry.locales[0] || 'en',
      etag: entry.etag,
      currentMeta: entry.meta || { title: entry.title },
    });
  };

  const handleSaveProperties = async (meta: DataEditable) => {
    if (!propertiesDialog.entryId || !meta.title.trim()) return;

    try {
      const result = await updateLocalized.mutateAsync({
        id: propertiesDialog.entryId,
        locale: propertiesDialog.locale,
        data: { meta },
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
    } catch (err) {
      closePropertiesDialog();
      showError('Failed to save properties. Please try again.', err);
    }
  };

  const handleEditData = (entryId: string) => {
    const entry = entries.find((e) => e.id === entryId);
    if (!entry) return;

    openEditDataDialog({
      entryId,
      entryTitle: entry.title,
      collection: entry.collection,
      locale: entry.locales[0] || 'en',
      existingLocales: entry.locales,
      name: entry.name || '',
    });
  };

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-grey-01">Data</h1>
        <div className="flex items-center gap-4">
          {schemasEditorLink && (
            <a
              href={schemasEditorLink}
              className="px-3 py-2 border border-grey-09 rounded hover:bg-grey-11 transition-colors flex items-center gap-2 text-grey-04 hover:text-grey-01"
              title="Open data schemas file in editor"
            >
              <Code className="h-4 w-4" />
              Edit Schemas
            </a>
          )}
          {collections.length > 0 && (
            <select
              value={selectedCollection}
              onChange={(e) => setSelectedCollection(e.target.value)}
              className="px-3 py-2 border border-grey-09 rounded hover:bg-grey-11 transition-colors"
            >
              <option value="all">All Collections</option>
              {collections.map((col) => (
                <option key={col} value={col}>
                  {col}
                </option>
              ))}
            </select>
          )}
          <button
            onClick={() => openCreateDialog({})}
            disabled={collections.length === 0}
            className="px-4 py-2 bg-azure-04 text-white rounded hover:bg-azure-03 transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            data-testid="new-data-button"
          >
            <Plus className="h-4 w-4" />
            New Entry
          </button>
        </div>
      </div>

      {/* Empty state */}
      {entries.length === 0 ? (
        <div className="bg-white border border-grey-09 rounded p-12 text-center">
          <Database className="h-12 w-12 text-grey-04 mx-auto mb-4" />
          <h2 className="text-xl font-semibold mb-2" data-testid="no-data-message">
            No data entries yet
          </h2>
          <p className="text-grey-04 mb-4">
            {collections.length === 0
              ? 'Create a data collection folder first (e.g., content/data/authors/)'
              : 'Create data entries to store structured content'}
          </p>
          {collections.length > 0 && (
            <button
              onClick={() => openCreateDialog({})}
              className="px-4 py-2 bg-azure-04 text-white rounded hover:bg-azure-03 transition-colors"
            >
              Create Entry
            </button>
          )}
        </div>
      ) : filteredEntries.length === 0 ? (
        <div className="bg-white border border-grey-09 rounded p-12 text-center">
          <p className="text-grey-04" data-testid="no-data-collection-message">
            No entries found in collection "{selectedCollection}"
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredEntries.map((entry) => (
            <DataEntryCard
              key={entry.id}
              id={entry.id}
              title={entry.title}
              description={entry.description}
              collection={entry.collection}
              name={entry.name}
              locales={entry.locales}
              onEditData={() => handleEditData(entry.id)}
              onEditProperties={() => handleEditProperties(entry.id)}
              onDelete={() => handleDeleteEntry(entry.id)}
            />
          ))}
        </div>
      )}

      {/* Create Entry Dialog */}
      {createDialog.isOpen && (
        <CreateDataDialog
          collections={collections}
          isPending={createContent.isPending}
          onClose={closeCreateDialog}
          onCreate={handleCreateEntry}
        />
      )}

      {/* Edit Properties Dialog */}
      {propertiesDialog.isOpen && (
        <DataPropertiesDialog
          initialMeta={propertiesDialog.currentMeta}
          isPending={updateLocalized.isPending}
          onClose={closePropertiesDialog}
          onSave={handleSaveProperties}
        />
      )}

      {/* Delete Confirmation Dialog */}
      <DeleteConfirmDialog
        isOpen={deleteDialog.isOpen}
        onConfirm={handleConfirmDelete}
        onCancel={closeDeleteDialog}
        title="Delete Data Entry"
        message="Are you sure you want to delete this data entry?"
        itemName={deleteDialog.entryTitle}
        isDeleting={deleteContent.isPending}
      />

      {/* Edit Data Dialog */}
      {editDataDialog.isOpen && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          role="dialog"
          onKeyDown={(e) => {
            if (e.key === 'Escape') closeEditDataDialog();
          }}
        >
          <div
            className="bg-white rounded-lg p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto"
            data-testid="edit-data-dialog"
          >
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-xl font-semibold">{editDataDialog.entryTitle}</h2>
                <p className="text-sm text-grey-04">
                  {editDataDialog.collection} · {editDataDialog.locale}
                </p>
              </div>
              <button
                onClick={closeEditDataDialog}
                className="p-2 hover:bg-grey-11 rounded transition-colors"
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <DataEditor
              id={editDataDialog.entryId}
              collection={editDataDialog.collection}
              initialLocale={editDataDialog.locale}
              existingLocales={editDataDialog.existingLocales}
              name={editDataDialog.name}
              schema={dataSchemas[editDataDialog.collection] ?? null}
              onSave={closeEditDataDialog}
              onCancel={closeEditDataDialog}
            />
          </div>
        </div>
      )}

      {/* Error Modal */}
      <ErrorModal {...errorModalProps} />
    </div>
  );
}
