import { type DataEditable, dataEditableSchema } from '@conloca/content-api-client';
import { useEffect, useMemo, useState } from 'react';
import { SchemaForm } from '../forms/SchemaForm';

interface DataPropertiesDialogProps {
  initialMeta: DataEditable;
  isPending: boolean;
  onClose: () => void;
  onSave: (meta: DataEditable) => void;
}

export function DataPropertiesDialog({ initialMeta, isPending, onClose, onSave }: DataPropertiesDialogProps) {
  // Convert DataMeta to form values
  const initialValues = useMemo(
    () => ({
      title: initialMeta.title || '',
      description: initialMeta.description || '',
      category: initialMeta.category || '',
      tags: initialMeta.tags || [],
    }),
    [initialMeta],
  );

  const [formValues, setFormValues] = useState<Record<string, unknown>>(initialValues);

  // Reset form when initialMeta changes (e.g., different entry selected)
  useEffect(() => {
    setFormValues(initialValues);
  }, [initialValues]);

  const handleSave = () => {
    // SchemaForm returns tags as array directly
    const tags = (formValues.tags as string[]) || [];
    const filteredTags = tags.filter((tag) => tag.trim().length > 0);

    const meta: DataEditable = {
      title: ((formValues.title as string) || '').trim(),
      description: ((formValues.description as string) || '').trim() || undefined,
      category: ((formValues.category as string) || '').trim() || undefined,
      tags: filteredTags.length > 0 ? filteredTags : undefined,
    };

    onSave(meta);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    }
  };

  const canSave = ((formValues.title as string) || '').trim().length > 0;

  return (
    <div
      className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50"
      role="dialog"
      onKeyDown={handleKeyDown}
    >
      <div className="bg-white dark:bg-grey-03 rounded-lg p-6 w-full max-w-md" data-testid="properties-dialog">
        <h2 className="text-xl font-semibold text-grey-01 dark:text-grey-12 mb-4">Edit Data Properties</h2>

        <div className="mb-4">
          <SchemaForm schema={dataEditableSchema} values={formValues} onChange={setFormValues} />
        </div>

        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-grey-09 dark:border-grey-03 rounded-md hover:bg-grey-11 dark:hover:bg-grey-03 transition-colors"
            disabled={isPending}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!canSave || isPending}
            className="px-4 py-2 bg-azure-04 text-white rounded-md hover:bg-azure-03 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            data-testid="save-properties-submit"
          >
            {isPending ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
