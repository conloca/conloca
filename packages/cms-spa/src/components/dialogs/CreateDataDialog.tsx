import { dataEditableSchema } from '@conloca/content-api-client';
import { useState } from 'react';
import { SchemaForm } from '../forms/SchemaForm';
import { Button, Select } from '../ui';

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
      <div className="bg-overlay rounded-lg p-6 w-full max-w-md" data-testid="create-data-dialog">
        <h2 className="text-xl font-semibold text-grey-01 dark:text-grey-12 mb-4">Create New Data Entry</h2>
        <div className="mb-4">
          <label htmlFor="data-collection" className="block text-sm font-medium mb-2 text-grey-01 dark:text-grey-12">
            Collection
          </label>
          <Select
            id="data-collection"
            value={selectedCollection}
            onChange={(e) => setSelectedCollection(e.target.value)}
          >
            {collections.map((col) => (
              <option key={col} value={col}>
                {col}
              </option>
            ))}
          </Select>
        </div>
        <div className="mb-4">
          <SchemaForm schema={dataEditableSchema} values={formValues} onChange={setFormValues} />
        </div>
        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleCreate}
            disabled={!isValid || isPending}
            data-testid="create-data-submit"
          >
            {isPending ? 'Creating...' : 'Create'}
          </Button>
        </div>
      </div>
    </div>
  );
}
