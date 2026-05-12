import {
  getContentAPIClient,
  type UpdateResult,
  useLocalizedContent,
  useSitesConfig,
  useUpdateLocalized,
} from '@conloca/content-api-client';
import type { MDXEditorMethods } from '@mdxeditor/editor';
import { ExternalLink } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAutoSave } from '../../hooks/useAutoSave';
import { useErrorModal } from '../../hooks/useErrorModal';
import { useTheme } from '../../hooks/useTheme';
import { useUnsavedChangesGuard } from '../../hooks/useUnsavedChangesGuard';
import { ConflictDialog } from '../dialogs/ConflictDialog';
import { ErrorModal } from '../dialogs/ErrorModal';
import { UnsavedChangesDialog } from '../dialogs/UnsavedChangesDialog';
import { CMSMDXEditor, CMSMDXHeaderTools } from './CMSMDXEditor';
import { LocaleSelector } from './LocaleSelector';

type SaveState = 'idle' | 'saving' | 'saved' | 'error' | 'conflict';
type PersistStatus = 'saved' | 'conflict' | 'error';

/**
 * Page editor for kind:'page' + type:'mdx' entries.
 *
 * Inline page layout. Routed via /pages/:id which lives outside CMSLayout,
 * so the editor occupies the full viewport. The sister flow for blocks
 * lives in BlockEditor.tsx — same shape, different back target and
 * filePath label.
 */
export function MdxPageEditor() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const updateContent = useUpdateLocalized();
  const { resolvedTheme } = useTheme();

  const [currentLocale, setCurrentLocale] = useState<string>('en');
  const [currentEtag, setCurrentEtag] = useState<string>('');
  const [pendingLocaleSwitch, setPendingLocaleSwitch] = useState<string | null>(null);
  const [showLocaleUnsavedDialog, setShowLocaleUnsavedDialog] = useState(false);

  const [conflict, setConflict] = useState<UpdateResult | null>(null);
  const { showError, errorModalProps } = useErrorModal();

  // Live editor content. Hoisted up here (vs. inside the modal) so Cmd+S in
  // BaseMDXEditor and the click-Save button both read the latest value — the
  // ref-only pattern would silently save stale content because BaseMDXEditor's
  // keydown effect closes over the `value` prop.
  const [content, setContent] = useState<string>('');
  // We can't safely render <CMSMDXEditor value=""> until the loaded content
  // has been written into state — MDXEditorLib only consumes its `markdown`
  // prop on first mount, so a placeholder empty value would never update.
  const [isContentLoaded, setIsContentLoaded] = useState(false);
  // Mirror of the saved-on-disk content; used as the dirty-check anchor and
  // to seed the conflict dialog's force-save payload.
  const savedContentRef = useRef<string>('');
  const editorRef = useRef<MDXEditorMethods>(null);

  const [saveState, setSaveState] = useState<SaveState>('idle');
  // Live preview is intentionally omitted for pages: page-level MDX often
  // imports JSX components scoped by the host site's MDX provider, which
  // the in-browser compiler used by the preview pane can't resolve.
  // Block-level editing keeps its preview. See ../MDXLivePreview.tsx and
  // BlockEditor.tsx.

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
  const publishedPathname = loadedContent?.localized?.pathname;
  const pagePathname = publishedPathname || id || 'page';

  useEffect(() => {
    const prev = document.title;
    document.title = `Edit: ${pagePathname} · Conloca CMS`;
    return () => {
      document.title = prev;
    };
  }, [pagePathname]);

  // Auto-fade the "Saved" pill back to idle.
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
        // Don't throw here — the conflict dialog handles recovery and the
        // editor stays mounted on the same route. Throwing would also flip
        // saveState to 'error' which fights the conflict pill.
        return 'conflict';
      }

      throw new Error(`Save failed: ${result.reason}`);
    } catch (err) {
      console.error('Failed to save mdx page:', err);
      showError('Failed to save page', err);
      setSaveState('error');
      return 'error';
    }
  };

  const handleSaveClick = () => {
    void persist(content);
  };

  // Debounced auto-save. Driven by the editor's existing `persist` function
  // so the save-state machine, conflict dialog, and "✓ Saved" pill all
  // light up exactly as they do for a manual Cmd+S press.
  useAutoSave({
    enabled: true,
    content,
    isDirty,
    isSaving: saveState === 'saving',
    persist: (value) => persist(value),
  });

  const handleCancel = () => {
    if (isDirty) {
      // Trigger the same blocker dialog the navigation guard uses by trying
      // to navigate — useBlocker intercepts and opens the dialog.
      navigate('/pages');
      return;
    }
    navigate('/pages');
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
        // Missing locale → clear so the dirty-check doesn't misfire and the
        // unsaved-changes dialog can't write OLD content under the NEW locale.
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
          <span>Loading page…</span>
        </div>
      </div>
    );
  }

  if (error && !loadedContent && !savedContentRef.current) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-grey-12 dark:bg-grey-01 gap-4">
        <div className="text-red-04">Failed to load page: {error?.message || 'Not found'}</div>
        <button
          type="button"
          onClick={() => navigate('/pages')}
          className="px-4 py-2 bg-azure-04 text-white rounded-md hover:bg-azure-03 transition-colors"
        >
          Back to Pages
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
            aria-label="Back to pages"
            className="p-2 rounded text-grey-04 dark:text-grey-07 hover:bg-grey-11 dark:hover:bg-grey-04"
          >
            ←
          </button>
          <h1 className="text-base font-medium text-grey-01 dark:text-grey-12 truncate">Edit: {pagePathname}</h1>
        </div>
        <div className="flex items-center gap-2">
          <CMSMDXHeaderTools setContent={setContent} editorRef={editorRef} filePath={pagePathname} />
          <LocaleSelector
            currentLocale={currentLocale}
            availableLocales={availableLocales}
            onChange={handleLocaleChange}
          />
          {publishedPathname && (
            <a
              href={publishedPathname}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Open published page in a new tab"
              title="Open published page"
              className="p-2 rounded text-grey-04 dark:text-grey-07 hover:bg-grey-11 dark:hover:bg-grey-04"
            >
              <ExternalLink size={16} aria-hidden />
            </a>
          )}
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
        </div>
      </header>
      {/* `min-h-0` is required on flex children that themselves overflow —
          without it the editor pane can't shrink past its content height
          and the page-level scrollbar takes over instead of the editor's. */}
      <div className="flex-1 overflow-hidden flex flex-row min-h-0">
        <div className="flex-1 min-w-0 overflow-hidden">
          <CMSMDXEditor
            // Re-mount on locale switch so the editor re-initializes with the
            // new locale's markdown — `markdown` prop changes are otherwise
            // ignored after first mount.
            key={`${id}-${currentLocale}`}
            ref={editorRef}
            value={content}
            onChange={(next, initialNormalize) => {
              setContent(next);
              // First parse pass round-trips the on-disk markdown through the
              // library's mdast→lexical→markdown pipeline (e.g. bullet style
              // and trailing-newline normalization). Treat that as the new
              // saved baseline rather than a user edit, otherwise isDirty
              // flips true the moment the editor mounts.
              if (initialNormalize) {
                savedContentRef.current = next;
              }
            }}
            onSave={persist}
            className={editorClassName}
            autoFocus
            placeholder="Start writing your page…"
          />
        </div>
      </div>

      {/* In-app navigation guard (sidebar click, back button, programmatic
          navigate). beforeunload handles reload / tab close inside the hook. */}
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

      {/* Locale-switch dirty dialog (separate flow — the user's still on the
          page after dismissing). */}
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
