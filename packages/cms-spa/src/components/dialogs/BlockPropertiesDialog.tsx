import { type BlockEditable, blockEditableSchema } from '@conloca/content-api-client';
import { useEffect, useMemo, useState } from 'react';
import { SchemaForm } from '../forms/SchemaForm';
import { Button } from '../ui';

interface BlockPropertiesDialogProps {
  isOpen: boolean;
  blockTitle: string;
  currentMeta: BlockEditable;
  onSave: (meta: BlockEditable) => void;
  onCancel: () => void;
  isSaving?: boolean;
}

export function BlockPropertiesDialog({
  isOpen,
  blockTitle,
  currentMeta,
  onSave,
  onCancel,
  isSaving,
}: BlockPropertiesDialogProps) {
  // Convert BlockMeta to form values
  const initialValues = useMemo(
    () => ({
      title: currentMeta.title || blockTitle,
      description: currentMeta.description || '',
      category: currentMeta.category || '',
      tags: currentMeta.tags || [],
    }),
    [currentMeta, blockTitle],
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

    const meta: BlockEditable = {
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
        <h2 className="text-xl font-semibold text-grey-01 dark:text-grey-12 mb-4">Edit Block Properties</h2>

        <div className="mb-4">
          <SchemaForm schema={blockEditableSchema} values={formValues} onChange={setFormValues} />
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
