import {
  getContentAPIClient,
  type UpdateResult,
  useLocalizedContent,
  useSitesConfig,
  useUpdateLocalized,
} from '@conloca/content-api-client';
import { AlertTriangle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useEditorPref } from '../../hooks/useEditorPref';
import { useErrorModal } from '../../hooks/useErrorModal';
import { useTheme } from '../../hooks/useTheme';
import { useUnsavedChangesGuard } from '../../hooks/useUnsavedChangesGuard';
import { ConflictDialog } from '../dialogs/ConflictDialog';
import { ErrorModal } from '../dialogs/ErrorModal';
import { UnsavedChangesDialog } from '../dialogs/UnsavedChangesDialog';
import { EditorChromeToggles } from './EditorChromeToggles';
import { EditorFrame } from './EditorFrame';
import { LocaleSelector } from './LocaleSelector';
import { MDXLivePreview } from './MDXLivePreview';

type SaveState = 'idle' | 'saving' | 'saved' | 'error' | 'conflict';
type PersistStatus = 'saved' | 'conflict' | 'error';

/**
 * MDX block editor (kind:'block').
 *
 * Inline page layout (mirrors MdxPageEditor). Routed via /blocks/:id which
 * lives outside CMSLayout in App.tsx so the editor occupies the full viewport.
 */
export function BlockEditor() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const updateContent = useUpdateLocalized();
  const { resolvedTheme } = useTheme();

  // When the editor is opened from inside the Puck page editor (via the
  // "Open block editor" button on the page's right-hand panel), `?from=page`
  // signals we should surface a shared-content warning and offer an explicit
  // "Done" path back to the originating page rather than back to /blocks.
  const fromPage = searchParams.get('from') === 'page';
  const returnPageId = searchParams.get('pageId') || '';

  const [currentLocale, setCurrentLocale] = useState<string>('en');
  const [currentEtag, setCurrentEtag] = useState<string>('');
  const [pendingLocaleSwitch, setPendingLocaleSwitch] = useState<string | null>(null);
  const [showLocaleUnsavedDialog, setShowLocaleUnsavedDialog] = useState(false);

  const [conflict, setConflict] = useState<UpdateResult | null>(null);
  const { showError, errorModalProps } = useErrorModal();

  const [content, setContent] = useState<string>('');
  // MDXEditorLib only reads `markdown` once on mount, so defer rendering the
  // editor until the loaded value has been written into state.
  const [isContentLoaded, setIsContentLoaded] = useState(false);
  const savedContentRef = useRef<string>('');

  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [previewOpen, setPreviewOpen] = useEditorPref('conloca.mdxeditor.previewOpen');

  const { data: sitesConfig } = useSitesConfig();
  const availableLocales = sitesConfig?.globalLocales || ['en'];

  const { data: loadedContent, isLoading, error } = useLocalizedContent(id || '', currentLocale);

  useEffect(() => {
    // First-load gate: never re-seed from background refetches. TanStack
    // Query emits a new `loadedContent` ref on window-focus refetch, on
    // `useUpdateLocalized.onSuccess` (which calls `setQueryData`), and on
    // any cache invalidation — without this gate, the effect would call
    // `setContent(serverMdx)` and silently overwrite the user's typing.
    // Manual remote-reload remains available via the conflict dialog.
    if (!isContentLoaded && loadedContent?.localized?.etag) {
      setCurrentEtag(loadedContent.localized.etag);
      const data = loadedContent.localized.content as { mdx?: string } | undefined;
      const mdx = data?.mdx || '';
      savedContentRef.current = mdx;
      setContent(mdx);
      setIsContentLoaded(true);
    }
  }, [loadedContent, isContentLoaded]);

  const isDirty = isContentLoaded && content !== savedContentRef.current;
  const blocker = useUnsavedChangesGuard(isDirty);

  const editorClassName = resolvedTheme === 'dark' ? 'dark-theme' : undefined;
  const blockName = loadedContent?.localized?.name || id || 'block';
  const filePath = `blocks/${blockName}`;

  useEffect(() => {
    const prev = document.title;
    document.title = `Edit: ${filePath} · Conloca CMS`;
    return () => {
      document.title = prev;
    };
  }, [filePath]);

  useEffect(() => {
    if (saveState !== 'saved') return;
    const timer = setTimeout(() => setSaveState('idle'), 2000);
    return () => clearTimeout(timer);
  }, [saveState]);

  const persist = async (newContent: string, forceEtag?: string): Promise<PersistStatus> => {
    if (!id) return 'error';
    setSaveState('saving');

    try {
      const result = await updateContent.mutateAsync({
        id,
        locale: currentLocale,
        data: { content: { mdx: newContent } },
        etag: forceEtag ?? currentEtag,
      });

      if (result.success && result.etag) {
        setCurrentEtag(result.etag);
        savedContentRef.current = newContent;
        setSaveState('saved');
        return 'saved';
      }

      if (result.reason === 'stale_write') {
        setConflict(result);
        setSaveState('conflict');
        return 'conflict';
      }

      throw new Error(`Save failed: ${result.reason}`);
    } catch (err) {
      console.error('Failed to save block:', err);
      showError('Failed to save block', err);
      setSaveState('error');
      return 'error';
    }
  };

  const handleSaveClick = () => {
    void persist(content);
  };

  // Back-arrow + Cancel target. When entered via the Puck page panel,
  // returning to /pages/:pageId reopens the page editor; otherwise we go
  // back to the blocks list.
  const backTarget = fromPage && returnPageId ? `/pages/${returnPageId}` : '/blocks';

  const handleCancel = () => {
    navigate(backTarget);
  };

  // "Done" — present only when from=page. The unsaved-changes guard
  // (`useUnsavedChangesGuard`) automatically intercepts the navigation and
  // opens the dialog if the user has unsaved edits, so we don't need to
  // duplicate the check here.
  const handleDone = () => {
    navigate(backTarget);
  };

  const handleLocaleChange = async (newLocale: string) => {
    if (newLocale === currentLocale) return;
    if (isDirty) {
      setPendingLocaleSwitch(newLocale);
      setShowLocaleUnsavedDialog(true);
      return;
    }
    await switchLocale(newLocale);
  };

  const switchLocale = async (newLocale: string) => {
    if (!id) return;

    try {
      const client = getContentAPIClient();
      const newLocaleContent = await client.getLocalized(id, newLocale);

      if (!newLocaleContent) {
        setCurrentEtag('');
        savedContentRef.current = '';
        setContent('');
      } else {
        setCurrentEtag(newLocaleContent.localized.etag);
        const newData = newLocaleContent.localized.content as { mdx?: string } | undefined;
        const mdx = newData?.mdx || '';
        savedContentRef.current = mdx;
        setContent(mdx);
      }

      setCurrentLocale(newLocale);
      setPendingLocaleSwitch(null);
    } catch (err) {
      console.error('Failed to switch locale:', err);
    }
  };

  const handleLocaleUnsavedSave = async () => {
    if (!pendingLocaleSwitch) return;
    const status = await persist(content);
    if (status === 'saved') {
      setShowLocaleUnsavedDialog(false);
      await switchLocale(pendingLocaleSwitch);
    } else if (status === 'conflict') {
      // Conflict dialog has opened; back out of the locale-switch flow so
      // the two dialogs don't stack. User resolves the conflict first,
      // then can re-attempt the locale switch.
      setShowLocaleUnsavedDialog(false);
      setPendingLocaleSwitch(null);
    }
  };

  const handleLocaleUnsavedDiscard = async () => {
    if (!pendingLocaleSwitch) return;
    setShowLocaleUnsavedDialog(false);
    await switchLocale(pendingLocaleSwitch);
  };

  const handleLocaleUnsavedCancel = () => {
    setShowLocaleUnsavedDialog(false);
    setPendingLocaleSwitch(null);
  };

  // Render the loading splash until we have the initial markdown — MDXEditorLib
  // only reads `markdown` once on mount, so we can't safely render the editor
  // with a placeholder empty string and update it later.
  if (isLoading || !isContentLoaded) {
    return (
      <div className="flex items-center justify-center h-screen bg-grey-12 dark:bg-grey-01">
        <div className="flex items-center gap-3 text-grey-04 dark:text-grey-07">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-azure-04" />
          <span>Loading block…</span>
        </div>
      </div>
    );
  }

  if (error && !loadedContent && !savedContentRef.current) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-grey-12 dark:bg-grey-01 gap-4">
        <div className="text-red-04">Failed to load block: {error?.message || 'Not found'}</div>
        <button
          type="button"
          onClick={() => navigate('/blocks')}
          className="px-4 py-2 bg-azure-04 text-white rounded-md hover:bg-azure-03 transition-colors"
        >
          Back to Blocks
        </button>
      </div>
    );
  }

  const saveButtonLabel =
    saveState === 'saving'
      ? 'Saving…'
      : saveState === 'saved'
        ? '✓ Saved'
        : saveState === 'error'
          ? 'Retry save'
          : saveState === 'conflict'
            ? 'Conflict'
            : 'Save';

  return (
    <div className="h-screen flex flex-col bg-grey-12 dark:bg-grey-01">
      <header className="flex items-center justify-between gap-4 px-4 py-2 border-b border-grey-09 dark:border-grey-04 bg-white dark:bg-grey-03 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <button
            type="button"
            onClick={handleCancel}
            aria-label={fromPage ? 'Back to page' : 'Back to blocks'}
            className="p-2 rounded text-grey-04 dark:text-grey-07 hover:bg-grey-11 dark:hover:bg-grey-04"
          >
            ←
          </button>
          <h1 className="text-base font-medium text-grey-01 dark:text-grey-12 truncate">Edit: {filePath}</h1>
        </div>
        <div className="flex items-center gap-2">
          <LocaleSelector
            currentLocale={currentLocale}
            availableLocales={availableLocales}
            onChange={handleLocaleChange}
          />
          <EditorChromeToggles previewOpen={previewOpen} onTogglePreview={() => setPreviewOpen(!previewOpen)} />
          <button
            type="button"
            onClick={handleCancel}
            disabled={saveState === 'saving'}
            className="px-3 py-1.5 text-sm border border-grey-09 dark:border-grey-04 rounded text-grey-01 dark:text-grey-12 hover:bg-grey-11 dark:hover:bg-grey-04 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSaveClick}
            disabled={saveState === 'saving' || (!isDirty && saveState === 'idle')}
            className="px-3 py-1.5 text-sm bg-azure-04 text-white rounded hover:bg-azure-03 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saveButtonLabel}
          </button>
          {fromPage && (
            <button
              type="button"
              onClick={handleDone}
              disabled={saveState === 'saving'}
              className="px-3 py-1.5 text-sm border border-grey-09 dark:border-grey-04 rounded text-grey-01 dark:text-grey-12 hover:bg-grey-11 dark:hover:bg-grey-04 disabled:opacity-50"
              data-testid="block-editor-done"
            >
              Done
            </button>
          )}
        </div>
      </header>
      {fromPage && (
        <div
          className="flex items-start gap-2 px-4 py-2 border-b border-yellow-08 dark:border-yellow-03 bg-yellow-11 dark:bg-yellow-02 text-sm text-yellow-02 dark:text-yellow-09 shrink-0"
          role="status"
          data-testid="shared-block-banner"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>This is a shared block. Saving updates every page that uses it.</span>
        </div>
      )}
      <div className="flex-1 overflow-hidden flex flex-row min-h-0">
        <div className="flex-1 min-w-0 overflow-hidden">
          <EditorFrame
            // Re-mount on locale switch so the iframe-side editor
            // re-initializes with the new locale's markdown — `value` is
            // read once on first mount inside the iframe.
            key={`${id}-${currentLocale}`}
            value={content}
            // Block content has no canonical page route, so there's no
            // `previewRouteUrl` to drive per-page CSS discovery. The
            // editor falls back to the static editor stylesheet — the
            // iframe's document boundary still provides the cascade
            // isolation that the page editor relies on.
            previewRouteUrl={undefined}
            onChange={(next, initialNormalize) => {
              setContent(next);
              // See MdxPageEditor: the library's first onChange call after
              // parse round-trip-rewrites the markdown; rebaseline rather
              // than flag dirty.
              if (initialNormalize) {
                savedContentRef.current = next;
              }
            }}
            onSave={persist}
            className={editorClassName}
            autoFocus
            placeholder="Start writing your block…"
          />
        </div>
        {previewOpen && (
          <div className="w-1/2 min-w-0 overflow-auto border-l border-grey-09 dark:border-grey-04 bg-white dark:bg-grey-02">
            <MDXLivePreview markdown={content} />
          </div>
        )}
      </div>

      {blocker.state === 'blocked' && (
        <UnsavedChangesDialog
          onSave={async () => {
            const status = await persist(content);
            if (status === 'saved') {
              blocker.proceed?.();
            } else if (status === 'conflict') {
              // Conflict dialog took over; release the blocker so it
              // doesn't sit underneath the conflict modal.
              blocker.reset?.();
            }
          }}
          onDiscard={() => blocker.proceed?.()}
          onCancel={() => blocker.reset?.()}
        />
      )}

      {showLocaleUnsavedDialog && (
        <UnsavedChangesDialog
          onSave={handleLocaleUnsavedSave}
          onDiscard={handleLocaleUnsavedDiscard}
          onCancel={handleLocaleUnsavedCancel}
        />
      )}

      {conflict && conflict.reason === 'stale_write' && (
        <ConflictDialog
          conflict={conflict}
          onReload={() => {
            setConflict(null);
            window.location.reload();
          }}
          onForceSave={async (newEtag) => {
            setConflict(null);
            setCurrentEtag(newEtag);
            await persist(content, newEtag);
          }}
          onCancel={() => {
            setConflict(null);
            setSaveState('idle');
          }}
        />
      )}
      <ErrorModal {...errorModalProps} title="Save Failed" />
    </div>
  );
}
