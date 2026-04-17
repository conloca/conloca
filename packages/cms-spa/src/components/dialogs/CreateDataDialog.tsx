import { dataEditableSchema } from '@conloca/content-api-client';
import { useState } from 'react';
import { SchemaForm } from '../forms/SchemaForm';

interface CreateDataDialogProps {
  collections: string[];
  isPending: boolean;
  onClose: () => void;
  onCreate: (collection: string, values: Record<string, unknown>) => void;
}

export function CreateDataDialog({ collections, isPending, onClose, onCreate }: CreateDataDialogProps) {
  const [selectedCollection, setSelectedCollection] = useState(collections[0] || '');
  const [formValues, setFormValues] = useState<Record<string, unknown>>({ title: '' });

  const handleCreate = () => {
    const title = ((formValues.title as string) || '').trim();
    if (!title || !selectedCollection) return;
    onCreate(selectedCollection, formValues);
  };

  const isValid = ((formValues.title as string) || '').trim() && selectedCollection;

  return (
    <div
      className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50"
      role="dialog"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <div className="bg-white dark:bg-grey-03 rounded-lg p-6 w-full max-w-md" data-testid="create-data-dialog">
        <h2 className="text-xl font-semibold text-grey-01 dark:text-grey-12 mb-4">Create New Data Entry</h2>
        <div className="mb-4">
          <label htmlFor="data-collection" className="block text-sm font-medium mb-2 text-grey-01 dark:text-grey-12">
            Collection
          </label>
          <select
            id="data-collection"
            value={selectedCollection}
            onChange={(e) => setSelectedCollection(e.target.value)}
            className="w-full px-3 py-2 border border-grey-09 dark:border-grey-04 dark:bg-grey-03 dark:text-grey-12 rounded focus:outline-none focus:ring-2 focus:ring-azure-04"
          >
            {collections.map((col) => (
              <option key={col} value={col}>
                {col}
              </option>
            ))}
          </select>
        </div>
        <div className="mb-4">
          <SchemaForm schema={dataEditableSchema} values={formValues} onChange={setFormValues} />
        </div>
        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-grey-09 dark:border-grey-04 rounded hover:bg-grey-11 dark:hover:bg-grey-03 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={!isValid || isPending}
            className="px-4 py-2 bg-azure-04 text-white rounded hover:bg-azure-03 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            data-testid="create-data-submit"
          >
            {isPending ? 'Creating...' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}
