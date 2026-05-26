import {
  getContentAPIClient,
  type UpdateResult,
  useLocalizedContent,
  useSitesConfig,
  useUpdateLocalized,
} from '@conloca/content-api-client';
import { ExternalLink, Settings } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useErrorModal } from '../../hooks/useErrorModal';
import { useTheme } from '../../hooks/useTheme';
import { useUnsavedChangesGuard } from '../../hooks/useUnsavedChangesGuard';
import type { PageMetadata } from '../../types';
import { buildMetadataUpdate, extractPageMetadata } from '../../utils/pageMetadata';
import { ConflictDialog } from '../dialogs/ConflictDialog';
import { ErrorModal } from '../dialogs/ErrorModal';
import { PageMetadataDialog } from '../dialogs/PageMetadataDialog';
import { UnsavedChangesDialog } from '../dialogs/UnsavedChangesDialog';
import { CMSMDXEditor } from './CMSMDXEditor';
import { JsxPropsPanel } from './JsxPropsPanel';
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

  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [metadataDialogOpen, setMetadataDialogOpen] = useState(false);
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

  // Snapshot of the page's frontmatter for the metadata dialog. Recomputes
  // whenever the loaded entry changes — including after a successful
  // metadata save, when TanStack Query refetches.
  const pageMetadata = useMemo(
    () => (loadedContent?.localized ? extractPageMetadata(loadedContent) : null),
    [loadedContent],
  );

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

  // Metadata save uses the same etag the body save does — server-side, both
  // save paths reconcile against a single per-locale version, so a successful
  // metadata save bumps the etag we'd hand to the next body save. We don't
  // touch `content`/`savedContentRef` here: this write only updates the
  // YAML head, body is rebuilt from the existing on-disk file.
  const handleSaveMetadata = async (metadata: PageMetadata) => {
    if (!id) return;
    try {
      const result = await updateContent.mutateAsync({
        id,
        locale: currentLocale,
        data: buildMetadataUpdate(metadata),
        etag: currentEtag,
      });

      if (result.success && result.etag) {
        setCurrentEtag(result.etag);
        return;
      }

      // Surface failures the dialog can't show on its own — it auto-closes
      // on submit, so a silent console.error would look like a successful
      // save to the user.
      showError('Failed to save page settings', new Error(`Save failed: ${result.reason ?? 'unknown'}`));
    } catch (err) {
      console.error('Failed to save page metadata:', err);
      showError('Failed to save page settings', err);
    }
  };

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
      <div className="flex items-center justify-center h-screen bg-page">
        <div className="flex items-center gap-3 text-muted">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-azure-04" />
          <span>Loading page…</span>
        </div>
      </div>
    );
  }

  if (error && !loadedContent && !savedContentRef.current) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-page gap-4">
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
    <div className="h-screen flex flex-col bg-page">
      <header className="flex items-center justify-between gap-4 px-4 py-2 border-b border-line bg-overlay shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <button
            type="button"
            onClick={handleCancel}
            aria-label="Back to pages"
            className="p-2 rounded text-muted hover:bg-hover"
          >
            ←
          </button>
          <h1 className="text-base font-medium text-foreground truncate">Edit: {pagePathname}</h1>
        </div>
        <div className="flex items-center gap-2">
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
              className="p-2 rounded text-muted hover:bg-hover"
            >
              <ExternalLink size={16} aria-hidden />
            </a>
          )}
          <button
            type="button"
            onClick={() => setMetadataDialogOpen(true)}
            aria-label="Page settings"
            title="Page settings"
            className="p-2 rounded text-muted hover:bg-hover"
            data-testid="mdx-page-settings"
          >
            <Settings size={16} aria-hidden />
          </button>
          <button
            type="button"
            onClick={handleCancel}
            disabled={saveState === 'saving'}
            className="px-3 py-1.5 text-sm border border-line rounded text-foreground hover:bg-hover disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSaveClick}
            disabled={saveState === 'saving' || (!isDirty && saveState === 'idle')}
            className="px-3 py-1.5 text-sm bg-accent text-accent-foreground rounded hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saveButtonLabel}
          </button>
        </div>
      </header>
      {/* `min-h-0` is required on flex children that themselves overflow —
          without it the editor pane can't shrink past its content height
          and the page-level scrollbar takes over instead of the editor's. */}
      <div className="flex-1 overflow-hidden flex flex-row min-h-0">
        {/* `conloca-mdx-editor-surround` — paints the area around the
            prose card with the host body bg (set by the
            useInjectHostStyles bridge after auto-discovered host CSS
            loads). Inside this surround, `hostWrapperPlugin` mirrors
            the host's content-root element (eg `<main>`) around the
            contenteditable. Result: when the host paints the wrapper
            (eg a card surface), the wrapper paints; when the host's
            wrapper is transparent (Starlight's `<main>`), the
            surround's body bg shows through. */}
        <div className="flex-1 min-w-0 overflow-hidden conloca-mdx-editor-surround">
          <CMSMDXEditor
            // Re-mount on locale switch so the editor re-initializes with
            // the new locale's markdown — `value` is read once on first
            // mount (the underlying BaseMDXEditor seeds its Lexical state
            // from the initial prop and doesn't reactively swap it).
            key={`${id}-${currentLocale}`}
            value={content}
            // Pull the host's real CSS for this page's published route.
            // The id (`vx-…`) is Conloca's storage key, not a URL — the
            // host renders the page at `loadedContent.localized.pathname`
            // (frontmatter `pathname`), which may differ from the id
            // entirely. Using the id here used to feed the content-wrapper
            // endpoint a 404 URL, making it discover the 404 page's
            // wrapper instead of the real one.
            previewRouteUrl={publishedPathname || undefined}
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
        {/* Right-side panel showing prop fields for the currently-selected
            MDX JSX block. Reads from the shared registry that GenericBlock
            publishes to on selection. Renders nothing visible-but-empty
            when no block is selected. */}
        <JsxPropsPanel />
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
      {pageMetadata && (
        <PageMetadataDialog
          open={metadataDialogOpen}
          onOpenChange={setMetadataDialogOpen}
          page={pageMetadata}
          onSave={handleSaveMetadata}
        />
      )}

      <ErrorModal {...errorModalProps} title="Save Failed" />
    </div>
  );
}
