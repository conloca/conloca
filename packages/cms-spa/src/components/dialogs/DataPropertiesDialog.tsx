import { type DataEditable, dataEditableSchema } from '@conloca/content-api';
import { useState } from 'react';
import { SchemaForm } from '../forms/SchemaForm';

interface DataPropertiesDialogProps {
  initialMeta: DataEditable;
  isPending: boolean;
  onClose: () => void;
  onSave: (meta: DataEditable) => void;
}

export function DataPropertiesDialog({ initialMeta, isPending, onClose, onSave }: DataPropertiesDialogProps) {
  const [meta, setMeta] = useState<DataEditable>(initialMeta);

  const handleChange = (values: Record<string, unknown>) => {
    setMeta({
      title: (values.title as string) || '',
      description: (values.description as string) || undefined,
    });
  };

  const isValid = meta.title.trim();

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      role="dialog"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <div className="bg-white rounded-lg p-6 w-full max-w-md" data-testid="properties-dialog">
        <h2 className="text-xl font-semibold mb-4">Edit Data Properties</h2>

        <div className="mb-4">
          <SchemaForm
            schema={dataEditableSchema}
            values={{
              title: meta.title,
              description: meta.description || '',
            }}
            onChange={handleChange}
          />
        </div>

        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-grey-09 rounded hover:bg-grey-11 transition-colors"
            disabled={isPending}
          >
            Cancel
          </button>
          <button
            onClick={() => onSave(meta)}
            disabled={!isValid || isPending}
            className="px-4 py-2 bg-azure-04 text-white rounded hover:bg-azure-03 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            data-testid="save-properties-submit"
          >
            {isPending ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
