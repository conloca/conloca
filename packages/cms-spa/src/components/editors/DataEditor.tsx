import { getContentAPIClient, useLocalizedContent, useUpdateLocalized } from '@conloca/content-api-client';
import { AlertCircle, Code2, Loader2, Save } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { z } from 'zod';
import { UnsavedChangesDialog } from '../dialogs/UnsavedChangesDialog';
import { LocaleSelector } from '../editor/LocaleSelector';
import { SchemaForm } from '../forms/SchemaForm';

interface DataEditorProps {
  id: string;
  collection: string;
  initialLocale: string;
  existingLocales: string[];
  name: string;
  schema: z.ZodObject<z.ZodRawShape> | null;
  onSave?: () => void;
  onCancel?: () => void;
}

/**
 * Editor for data entry content.
 * Uses collection-specific schema for form generation if available.
 * Supports locale switching similar to BlockEditor.
 */
export function DataEditor({
  id,
  collection,
  initialLocale,
  existingLocales,
  name,
  schema,
  onSave,
  onCancel,
}: DataEditorProps) {
  // Locale state
  const [currentLocale, setCurrentLocale] = useState(initialLocale);
  const [currentEtag, setCurrentEtag] = useState<string>('');
  const [pendingLocaleSwitch, setPendingLocaleSwitch] = useState<string | null>(null);
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);

  // Track saved values to detect changes
  const savedValuesRef = useRef<Record<string, unknown>>({});

  const { data: entry, isLoading, error } = useLocalizedContent(id, currentLocale);
  const updateLocalized = useUpdateLocalized();

  // Local state for form values
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [hasChanges, setHasChanges] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Initialize form values and etag when entry loads
  useEffect(() => {
    if (entry?.localized?.content?.data) {
      const data = entry.localized.content.data as Record<string, unknown>;
      setValues(data);
      savedValuesRef.current = data;
      setHasChanges(false);
    }
    if (entry?.localized?.etag) {
      setCurrentEtag(entry.localized.etag);
    }
  }, [entry]);

  // Track changes
  const handleChange = (newValues: Record<string, unknown>) => {
    setValues(newValues);
    setHasChanges(true);
  };

  // Save handler
  const handleSave = async () => {
    setSaveError(null);

    const result = await updateLocalized.mutateAsync({
      id,
      locale: currentLocale,
      data: {
        content: { data: values },
      },
      etag: currentEtag,
    });

    if (result.success) {
      setHasChanges(false);
      savedValuesRef.current = values;
      if (result.etag) {
        setCurrentEtag(result.etag);
      }
      onSave?.();
    } else {
      const errorMessage = result.error?.message || 'Failed to save data';
      setSaveError(errorMessage);
    }
  };

  // Locale switching handlers
  const handleLocaleChange = async (newLocale: string) => {
    if (newLocale === currentLocale) return;

    if (hasChanges) {
      // Show unsaved changes dialog
      setPendingLocaleSwitch(newLocale);
      setShowUnsavedDialog(true);
      return;
    }

    // Switch immediately if no unsaved changes
    await switchLocale(newLocale);
  };

  const switchLocale = async (newLocale: string) => {
    try {
      // Fetch the new locale content
      const client = getContentAPIClient();
      const newLocaleContent = await client.getLocalized(id, newLocale);

      if (newLocaleContent) {
        const newData = (newLocaleContent.localized.content?.data as Record<string, unknown>) || {};
        setValues(newData);
        savedValuesRef.current = newData;
        setCurrentEtag(newLocaleContent.localized.etag);
        setHasChanges(false);
        setCurrentLocale(newLocale);
      }

      setPendingLocaleSwitch(null);
    } catch (error) {
      console.error('Failed to switch locale:', error);
    }
  };

  const handleUnsavedDialogSave = async () => {
    if (!pendingLocaleSwitch) return;

    // Save current content first
    try {
      await handleSave();
      setShowUnsavedDialog(false);
      await switchLocale(pendingLocaleSwitch);
    } catch (error) {
      // Don't switch if save failed
      console.error('Failed to save before locale switch:', error);
    }
  };

  const handleUnsavedDialogDiscard = async () => {
    if (!pendingLocaleSwitch) return;

    setShowUnsavedDialog(false);
    setHasChanges(false);
    await switchLocale(pendingLocaleSwitch);
  };

  const handleUnsavedDialogCancel = () => {
    setShowUnsavedDialog(false);
    setPendingLocaleSwitch(null);
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-azure-04" />
      </div>
    );
  }

  // Error state - show if we have an error and no entry loaded
  if (error && !entry) {
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
        <Code2 className="h-12 w-12 text-grey-04 dark:text-grey-07 mx-auto mb-4" />
        <h3 className="text-lg font-medium text-grey-01 dark:text-grey-12 mb-2">No Schema Defined</h3>
        <p className="text-grey-04 dark:text-grey-07 mb-4">
          The "{collection}" collection doesn't have a schema defined.
        </p>
        <p className="text-xs text-grey-04 dark:text-grey-07">
          To enable form editing, add a schema for "{collection}" in your
          <br />
          <code className="bg-grey-11 dark:bg-grey-03 px-1 rounded-md">dataSchemas</code> config file and set{' '}
          <code className="bg-grey-11 dark:bg-grey-03 px-1 rounded-md">schemasPath</code> in astro.config.mjs
        </p>
      </div>
    );
  }

  // Schema exists - render form
  return (
    <>
      <div className="space-y-6">
        {/* Locale selector header - only show existing locales */}
        <div className="flex items-center gap-3 pb-4 border-b border-grey-09 dark:border-grey-03">
          <span className="text-sm text-grey-04 dark:text-grey-07">Locale:</span>
          <LocaleSelector
            currentLocale={currentLocale}
            availableLocales={existingLocales}
            onChange={handleLocaleChange}
          />
        </div>

        <SchemaForm schema={schema} values={values} onChange={handleChange} />

        {saveError && (
          <div className="flex items-center gap-2 p-3 bg-red-11 dark:bg-red-02 border border-red-08 dark:border-red-03 rounded-md text-red-04 dark:text-red-08 text-sm">
            <AlertCircle className="h-4 w-4 flex-shrink-0" />
            <span>{saveError}</span>
          </div>
        )}

        <div className="flex items-center justify-between pt-4 border-t border-grey-09 dark:border-grey-03">
          <div className="text-sm text-grey-04 dark:text-grey-07">
            {hasChanges ? (
              <span className="text-yellow-05 dark:text-yellow-07">Unsaved changes</span>
            ) : (
              <span>No changes</span>
            )}
          </div>

          <div className="flex gap-3">
            {onCancel && (
              <button
                type="button"
                onClick={onCancel}
                disabled={updateLocalized.isPending}
                className="px-4 py-2 border border-grey-09 dark:border-grey-03 rounded-md hover:bg-grey-11 dark:hover:bg-grey-03 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
            )}
            <button
              type="button"
              onClick={handleSave}
              disabled={!hasChanges || updateLocalized.isPending}
              className="px-4 py-2 bg-azure-04 text-white rounded-md hover:bg-azure-03 transition-colors disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
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

      {/* Unsaved changes dialog */}
      {showUnsavedDialog && (
        <UnsavedChangesDialog
          onSave={handleUnsavedDialogSave}
          onDiscard={handleUnsavedDialogDiscard}
          onCancel={handleUnsavedDialogCancel}
        />
      )}
    </>
  );
}
