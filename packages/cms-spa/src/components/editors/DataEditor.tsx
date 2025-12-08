import { useLocalizedContent, useUpdateLocalized } from '@conloca/content-api-client';
import { AlertCircle, Code2, Loader2, Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useDataSchema } from '../../hooks/useDataSchema';
import { SchemaForm } from '../forms/SchemaForm';

interface DataEditorProps {
  id: string;
  collection: string;
  locale: string;
  name: string;
  onSave?: () => void;
  onCancel?: () => void;
}

/**
 * Editor for data entry content.
 * Uses collection-specific schema for form generation if available.
 */
export function DataEditor({ id, collection, locale, name, onSave, onCancel }: DataEditorProps) {
  const schema = useDataSchema(collection);
  const { data: entry, isLoading, error } = useLocalizedContent(id, locale);
  const updateLocalized = useUpdateLocalized();

  // Local state for form values
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [hasChanges, setHasChanges] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Initialize form values when entry loads
  useEffect(() => {
    if (entry?.localized?.content?.data) {
      setValues(entry.localized.content.data as Record<string, unknown>);
      setHasChanges(false);
    }
  }, [entry]);

  // Track changes
  const handleChange = (newValues: Record<string, unknown>) => {
    setValues(newValues);
    setHasChanges(true);
  };

  // Save handler
  const handleSave = async () => {
    if (!entry) return;

    setSaveError(null);

    const result = await updateLocalized.mutateAsync({
      id,
      locale,
      data: {
        content: { data: values },
      },
      etag: entry.localized.etag,
    });

    if (result.success) {
      setHasChanges(false);
      onSave?.();
    } else {
      const errorMessage = result.error?.message || 'Failed to save data';
      setSaveError(errorMessage);
    }
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-azure-04" />
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="text-center py-8 text-red-04">
        <p>Failed to load entry: {error.message}</p>
      </div>
    );
  }

  // No schema - show fallback message
  if (!schema) {
    return (
      <div className="text-center py-8">
        <Code2 className="h-12 w-12 text-grey-04 mx-auto mb-4" />
        <h3 className="text-lg font-medium mb-2">No Schema Defined</h3>
        <p className="text-grey-04 mb-4">The "{collection}" collection doesn't have a schema defined.</p>
        <p className="text-xs text-grey-04">
          To enable form editing, add a schema for "{collection}" in your
          <br />
          <code className="bg-grey-11 px-1 rounded">dataSchemas</code> config file and set{' '}
          <code className="bg-grey-11 px-1 rounded">dataSchemasPath</code> in astro.config.mjs
        </p>
      </div>
    );
  }

  // Schema exists - render form
  return (
    <div className="space-y-6">
      <SchemaForm schema={schema} values={values} onChange={handleChange} />

      {saveError && (
        <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          <span>{saveError}</span>
        </div>
      )}

      <div className="flex items-center justify-between pt-4 border-t border-grey-09">
        <div className="text-sm text-grey-04">
          {hasChanges ? <span className="text-orange-04">Unsaved changes</span> : <span>No changes</span>}
        </div>

        <div className="flex gap-3">
          {onCancel && (
            <button
              onClick={onCancel}
              disabled={updateLocalized.isPending}
              className="px-4 py-2 border border-grey-09 rounded hover:bg-grey-11 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
          )}
          <button
            onClick={handleSave}
            disabled={!hasChanges || updateLocalized.isPending}
            className="px-4 py-2 bg-azure-04 text-white rounded hover:bg-azure-03 transition-colors disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
          >
            {updateLocalized.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="h-4 w-4" />
                Save
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
