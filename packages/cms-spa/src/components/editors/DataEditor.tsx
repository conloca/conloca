import {
  type DataCollectionEntry,
  getContentAPIClient,
  useLocalizedContent,
  useUpdateLocalized,
} from '@conloca/content-api-client';
import { AlertCircle, Code2, Loader2, Save } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { notifyEditorDirtyChanged, registerEditorFlushHandler } from '../../editor-flush.js';
import { useUnsavedChangesGuard } from '../../hooks/useUnsavedChangesGuard.js';
import { type HostSchema, isHostSchema } from '../../host-schema.js';
import { dropHeldDataValues, heldDataKeys, useLiveDataValues } from '../../live/data-binding.js';
import { type FrameLiveDoc, useDocChannel } from '../../live/doc-channel.js';
import { useLiveDoc } from '../../live/use-live.js';
import { contentFailureMessage } from '../../utils/content-failure.js';
import { validateEntryData } from '../../utils/data-entry-validation.js';
import { DraftNoticeStrip } from '../conflicts/EditorNoticeStrip.js';
import { UnsavedChangesDialog } from '../dialogs/UnsavedChangesDialog.js';
import { LocaleSelector } from '../editor/LocaleSelector.js';
import { SchemaForm } from '../forms/SchemaForm.js';

interface DataEditorProps {
  /** The entry's id, or '' for a new entry, which `create` writes on the first Save. */
  id: string;
  collection: string;
  initialLocale: string;
  existingLocales: string[];
  schema: HostSchema | null;
  /** Writes a new entry holding `data`; resolves its id and etag once created, null when refused. */
  create?: (data: DataCollectionEntry['data']) => Promise<{ id?: string; etag?: string } | null>;
  onSave?: () => void;
  onCancel?: () => void;
}

/**
 * Editor for data entry content.
 * Uses collection-specific schema for form generation if available.
 * Supports locale switching similar to FragmentEditor.
 */
export function DataEditor({
  id: entryId,
  collection,
  initialLocale,
  existingLocales,
  schema,
  create,
  onSave,
  onCancel,
}: DataEditorProps) {
  // The entry's id: a new entry gets one once created, so a save after typing during the create updates it.
  const [id, setId] = useState(entryId);
  // Locale state
  const [currentLocale, setCurrentLocale] = useState(initialLocale);
  // null: the version is not known (nothing loaded, or a create that returned no tag); '' is a real, loaded tag.
  const [currentEtag, setCurrentEtag] = useState<string | null>(null);
  const [pendingLocaleSwitch, setPendingLocaleSwitch] = useState<string | null>(null);
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);

  // Track saved values to detect changes
  const savedValuesRef = useRef<Record<string, unknown>>({});
  // The values as typed, current even inside a save's await (state is only current after the next render).
  const latestValuesRef = useRef(savedValuesRef.current);

  const { data: entry, isLoading, error } = useLocalizedContent(id, currentLocale);
  const updateLocalized = useUpdateLocalized();

  // Local state for form values
  // The same object the refs hold, so a save of untouched values is not taken for typing during it.
  const [values, setValues] = useState(savedValuesRef.current);
  const [hasChanges, setHasChanges] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const isNew = id === '';
  // Bound to the entry's shared doc, each valid change is written as it is typed; a new entry has no doc until created,
  // and one created in this editor stays unbound so the typing it holds is not dropped.
  const channel = useDocChannel();
  const bound = channel !== null && entryId !== '';
  const liveDoc = useLiveDoc(bound ? { kind: 'data', id, locale: currentLocale } : null);
  const [dropSwitch, setDropSwitch] = useState<{ locale: string; keys: string[] } | null>(null);

  // Initialize form values and etag when entry loads. A save's cache update or a refetch also emits a
  // new entry; an edit not yet stored is kept, and so is the etag it was based on, so its save conflicts
  // with a newer server version instead of overwriting it.
  useEffect(() => {
    if (entry?.localized && latestValuesRef.current === savedValuesRef.current) {
      // An entry stored with no data still loads, so its etag is taken and its first save is checked.
      const data = entry.localized.content?.data ?? {};
      setValues(data);
      savedValuesRef.current = data;
      latestValuesRef.current = data;
      setHasChanges(false);
      setCurrentEtag(entry.localized.etag ?? null);
    }
  }, [entry]);

  // Track changes
  const handleChange = (newValues: Record<string, unknown>) => {
    latestValuesRef.current = newValues;
    setValues(newValues);
    setHasChanges(true);
  };

  /**
   * Writes the form once it passes the schema, as the build validates the entry; resolves whether it
   * was written.
   */
  const handleSave = async (): Promise<boolean> => {
    if (saving || !isHostSchema(schema)) return false;
    const invalid = validateEntryData(schema, values);
    setSaveError(invalid);
    if (invalid) return false;

    setSaving(true);
    try {
      if (isNew) {
        const created = (await create?.(values)) ?? null;
        if (!created) return false;
        savedValuesRef.current = values;
        // Typing during the create is not stored yet: keep it open and unsaved; the next save updates the entry.
        if (latestValuesRef.current !== values && created.id) {
          setCurrentEtag(created.etag ?? null);
          setId(created.id);
        } else {
          setHasChanges(false);
          onSave?.();
        }
        return true;
      }

      // Never write unchecked: a tag fetched now would match a teammate's later save and overwrite it.
      if (currentEtag === null) {
        setSaveError("Could not confirm this entry's version. Close it, reopen it and enter your changes again.");
        return false;
      }
      const result = await updateLocalized.mutateAsync({
        id,
        locale: currentLocale,
        data: {
          content: { data: values },
        },
        etag: currentEtag,
      });

      if (!result.success) {
        setSaveError(contentFailureMessage(result, 'Failed to save data'));
        return false;
      }
      savedValuesRef.current = values;
      if (result.etag) {
        setCurrentEtag(result.etag);
      }
      // Typing during the write is not stored yet: the edit stays unsaved and the editor stays open.
      if (latestValuesRef.current === values) {
        setHasChanges(false);
        onSave?.();
      }
      return true;
    } finally {
      setSaving(false);
    }
  };

  // The host's Save, Cmd+S and status pill read and flush this edit; bound, the shared doc is already synced.
  const hasChangesRef = useRef(hasChanges);
  hasChangesRef.current = hasChanges;
  // One save at a time: the button, the locale dialog and the host's flush all join the save already running.
  const activeSaveRef = useRef<Promise<boolean> | null>(null);
  const save = (): Promise<boolean> => {
    if (activeSaveRef.current) return activeSaveRef.current;
    const running = handleSave().finally(() => {
      activeSaveRef.current = null;
    });
    activeSaveRef.current = running;
    return running;
  };
  // save is recreated each render; the flush runs the latest.
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    if (bound) return undefined;
    return registerEditorFlushHandler(
      async () => {
        const active = activeSaveRef.current;
        if (!active && !hasChangesRef.current) return { ok: true };
        const saved = await (active ?? saveRef.current()).catch(() => false);
        // A joined save wrote older values; the edit typed since is not stored, so this flush did not save it.
        if (saved && latestValuesRef.current !== savedValuesRef.current) {
          return { ok: false, message: 'The editor changed while saving; save again.' };
        }
        return saved ? { ok: true } : { ok: false, message: 'Could not save editor changes.' };
      },
      { isDirty: () => hasChangesRef.current },
    );
  }, [bound]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: The dependency change is the event; handlers read current state through refs.
  useEffect(() => {
    notifyEditorDirtyChanged();
  }, [hasChanges]);

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
        latestValuesRef.current = newData;
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

    // Save current content first; a refused save keeps the locale and the edits, with the reason shown.
    try {
      const saved = await save();
      setShowUnsavedDialog(false);
      if (saved) await switchLocale(pendingLocaleSwitch);
      else setPendingLocaleSwitch(null);
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

  // Loading state; an entry just created here keeps its unsaved form while it loads.
  if (isLoading && !hasChanges) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-azure-04 dark:text-azure-08" />
      </div>
    );
  }

  // Error state - show if we have an error and no entry loaded
  if (error && !entry) {
    return (
      <div className="text-center py-8 text-red-04 dark:text-red-08">
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

  if (bound) {
    // The doc is already synced, so a locale switch saves nothing first; it only asks before dropping held values.
    const switchLiveLocale = (locale: string) => {
      if (locale === currentLocale) return;
      const keys = heldDataKeys(`${id}:${currentLocale}`);
      if (keys.length > 0) setDropSwitch({ locale, keys });
      else setCurrentLocale(locale);
    };
    return (
      <div className="space-y-6">
        <DraftNoticeStrip
          id={id}
          locale={currentLocale}
          docKey={liveDoc.state === 'ready' ? liveDoc.live.docKey : undefined}
        />
        <div className="flex items-center gap-3 pb-4 border-b border-grey-09 dark:border-grey-03">
          <span className="text-sm text-grey-04 dark:text-grey-07">Locale:</span>
          <LocaleSelector
            currentLocale={currentLocale}
            availableLocales={existingLocales}
            onChange={switchLiveLocale}
          />
        </div>
        {liveDoc.state === 'ready' ? (
          <LiveDataForm
            key={liveDoc.live.docKey}
            live={liveDoc.live}
            schema={schema}
            entry={`${id}:${currentLocale}`}
          />
        ) : liveDoc.state === 'failed' ? (
          <p className="text-red-04 dark:text-red-08">{liveDoc.message}</p>
        ) : (
          <Loader2 className="h-6 w-6 animate-spin text-azure-04 dark:text-azure-08" />
        )}
        {onCancel && (
          <div className="flex justify-end pt-4 border-t border-grey-09 dark:border-grey-03">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 border border-grey-09 dark:border-grey-03 rounded-md hover:bg-grey-11 dark:hover:bg-grey-03 transition-colors"
            >
              Close
            </button>
          </div>
        )}
        {dropSwitch && (
          <div role="alertdialog" aria-label="Values not saved" className="p-3 border border-yellow-08 rounded-md">
            <p className="text-sm">
              These values are not valid, so they were never saved, and switching locale drops them:{' '}
              {dropSwitch.keys.join(', ')}
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setDropSwitch(null)} className="px-3 py-1 border rounded-md">
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  dropHeldDataValues(`${id}:${currentLocale}`);
                  setDropSwitch(null);
                  setCurrentLocale(dropSwitch.locale);
                }}
                className="px-3 py-1 bg-red-04 text-white rounded-md"
              >
                Drop them and switch
              </button>
            </div>
          </div>
        )}
        <LiveLeaveGuard />
      </div>
    );
  }

  // Schema exists - render form
  return (
    <>
      <div className="space-y-6">
        {!isNew && <DraftNoticeStrip id={id} locale={currentLocale} />}
        {/* Locale selector header - only show existing locales; a new entry has one, the one it is created in */}
        {!isNew && (
          <div className="flex items-center gap-3 pb-4 border-b border-grey-09 dark:border-grey-03">
            <span className="text-sm text-grey-04 dark:text-grey-07">Locale:</span>
            <LocaleSelector
              currentLocale={currentLocale}
              availableLocales={existingLocales}
              onChange={handleLocaleChange}
            />
          </div>
        )}

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
              <span>{isNew ? 'Not saved yet' : 'No changes'}</span>
            )}
          </div>

          <div className="flex gap-3">
            {onCancel && (
              <button
                type="button"
                onClick={onCancel}
                disabled={saving}
                className="px-4 py-2 border border-grey-09 dark:border-grey-03 rounded-md hover:bg-grey-11 dark:hover:bg-grey-03 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
            )}
            <button
              type="button"
              onClick={save}
              disabled={(!hasChanges && !isNew) || saving || !isHostSchema(schema)}
              className="px-4 py-2 bg-azure-04 text-white rounded-md hover:bg-azure-03 transition-colors disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
            >
              {saving ? (
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

/**
 * Asks before a route change leaves live work unsynced. Saving with Save, the editor asks on its own
 * (showUnsavedDialog), so only the live editor mounts this, and only it needs the data router `useBlocker` requires.
 */
function LiveLeaveGuard() {
  const blocker = useUnsavedChangesGuard(false, true);
  if (blocker.state !== 'blocked') return null;
  return (
    <UnsavedChangesDialog
      live
      onSave={() => blocker.proceed()}
      onDiscard={() => blocker.proceed()}
      onCancel={() => blocker.reset()}
    />
  );
}

/** The form over the entry's replica: what it shows is the doc's data, with the values the schema rejected held. */
function LiveDataForm({ live, schema, entry }: { live: FrameLiveDoc; schema: HostSchema; entry: string }) {
  const { values, change, errors } = useLiveDataValues(
    live,
    (next) => (isHostSchema(schema) ? validateEntryData(schema, next) : null),
    entry,
  );
  const messages = [...new Set(Object.values(errors))];
  return (
    <>
      <SchemaForm schema={schema} values={values} onChange={change} />
      {messages.length > 0 && (
        <div className="flex items-center gap-2 p-3 bg-red-11 dark:bg-red-02 border border-red-08 dark:border-red-03 rounded-md text-red-04 dark:text-red-08 text-sm">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          <span>Not saved until fixed. {messages.join(' ')}</span>
        </div>
      )}
    </>
  );
}
