import type { DataEditable } from '@conloca/content-api-client';
import { useEffect, useMemo, useState } from 'react';
import { dataEditableFields } from '../../content-form-fields.js';
import { ApplyClashError, withTheirs } from '../../utils/apply-clash.js';
import { SchemaForm } from '../forms/SchemaForm.js';
import { Button } from '../ui/index.js';

interface DataPropertiesDialogProps {
  initialMeta: DataEditable;
  isPending: boolean;
  onClose: () => void;
  /** Rejects with an {@link ApplyClashError} when the same fields changed meanwhile; the dialog loads theirs. */
  onSave: (meta: DataEditable) => void | Promise<void>;
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
  const [saveError, setSaveError] = useState<string | null>(null);

  // Reset form when initialMeta changes (e.g., different entry selected)
  useEffect(() => {
    setFormValues(initialValues);
  }, [initialValues]);

  const handleSave = async () => {
    // SchemaForm returns tags as array directly
    const tags = (formValues.tags as string[]) || [];
    const filteredTags = tags.filter((tag) => tag.trim().length > 0);

    const meta: DataEditable = {
      title: ((formValues.title as string) || '').trim(),
      description: ((formValues.description as string) || '').trim() || undefined,
      category: ((formValues.category as string) || '').trim() || undefined,
      tags: filteredTags.length > 0 ? filteredTags : undefined,
    };

    setSaveError(null);
    try {
      await onSave(meta);
    } catch (error) {
      // A clash loads the other value of each clashing field, so the next Save starts from it.
      if (error instanceof ApplyClashError) {
        setFormValues((values) => withTheirs(values, error.fields));
      }
      setSaveError(error instanceof Error ? error.message : 'Saving failed. Try again.');
    }
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
      <div className="bg-overlay rounded-lg p-6 w-full max-w-md" data-testid="properties-dialog">
        <h2 className="text-xl font-semibold text-grey-01 dark:text-grey-12 mb-4">Edit Data Properties</h2>

        <div className="mb-4">
          <SchemaForm fields={dataEditableFields} values={formValues} onChange={setFormValues} />
        </div>

        {saveError && (
          <p role="alert" className="mb-4 text-sm text-red-04 dark:text-red-08">
            {saveError}
          </p>
        )}

        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => void handleSave()}
            disabled={!canSave || isPending}
            data-testid="save-properties-submit"
          >
            {isPending ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </div>
    </div>
  );
}
