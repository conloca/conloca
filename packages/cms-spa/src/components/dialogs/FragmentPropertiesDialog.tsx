import { type FragmentEditable, fragmentEditableSchema } from '@conloca/content-api-client';
import { useEffect, useMemo, useState } from 'react';
import { SchemaForm } from '../forms/SchemaForm.js';
import { Button } from '../ui/index.js';

interface FragmentPropertiesDialogProps {
  isOpen: boolean;
  fragmentTitle: string;
  currentMeta: FragmentEditable;
  onSave: (meta: FragmentEditable) => void;
  onCancel: () => void;
  isSaving?: boolean;
}

export function FragmentPropertiesDialog({
  isOpen,
  fragmentTitle,
  currentMeta,
  onSave,
  onCancel,
  isSaving,
}: FragmentPropertiesDialogProps) {
  // Convert FragmentMeta to form values
  const initialValues = useMemo(
    () => ({
      title: currentMeta.title || fragmentTitle,
      description: currentMeta.description || '',
      category: currentMeta.category || '',
      tags: currentMeta.tags || [],
    }),
    [currentMeta, fragmentTitle],
  );

  const [formValues, setFormValues] = useState<Record<string, unknown>>(initialValues);

  // Reset form when dialog opens with new data
  useEffect(() => {
    if (isOpen) {
      setFormValues(initialValues);
    }
  }, [isOpen, initialValues]);

  const handleSave = () => {
    // SchemaForm returns tags as array directly
    const tags = (formValues.tags as string[]) || [];
    const filteredTags = tags.filter((tag) => tag.trim().length > 0);

    const meta: FragmentEditable = {
      title: ((formValues.title as string) || '').trim(),
      description: ((formValues.description as string) || '').trim() || undefined,
      category: ((formValues.category as string) || '').trim() || undefined,
      tags: filteredTags.length > 0 ? filteredTags : undefined,
    };

    onSave(meta);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onCancel();
    }
  };

  if (!isOpen) return null;

  const canSave = ((formValues.title as string) || '').trim().length > 0;

  return (
    <div
      className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50"
      role="dialog"
      onKeyDown={handleKeyDown}
    >
      <div className="bg-overlay rounded-lg p-6 w-full max-w-md" data-testid="properties-dialog">
        <h2 className="text-xl font-semibold text-grey-01 dark:text-grey-12 mb-4">Edit Fragment Properties</h2>

        <div className="mb-4">
          <SchemaForm schema={fragmentEditableSchema} values={formValues} onChange={setFormValues} />
        </div>

        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={onCancel} disabled={isSaving}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleSave}
            disabled={!canSave || isSaving}
            data-testid="save-properties-submit"
          >
            {isSaving ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </div>
    </div>
  );
}
