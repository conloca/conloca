import {
  getContentAPIClient,
  type UpdateResult,
  useLocalizedContent,
  useSitesConfig,
  useUpdateLocalized,
} from '@conloca/content-api-client';
import { AlertTriangle } from 'lucide-react';
import { type ElementType, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { notifyEditorDirtyChanged, registerEditorFlushHandler } from '../../editor-flush.js';
import { useEditorPref } from '../../hooks/useEditorPref.js';
import { useErrorModal } from '../../hooks/useErrorModal.js';
import { useTheme } from '../../hooks/useTheme.js';
import { useUnsavedChangesGuard } from '../../hooks/useUnsavedChangesGuard.js';
import { getUIConfig } from '../../ui-config.js';
import { ConflictDialog } from '../dialogs/ConflictDialog.js';
import { ErrorModal } from '../dialogs/ErrorModal.js';
import { UnsavedChangesDialog } from '../dialogs/UnsavedChangesDialog.js';
import { CMSMDXEditor, type CMSMDXEditorProps } from './CMSMDXEditor.js';
import { EditorChromeToggles } from './EditorChromeToggles.js';
import { LocaleSelector } from './LocaleSelector.js';
import { MDXLivePreview } from './MDXLivePreview.js';

type SaveState = 'idle' | 'saving' | 'saved' | 'error' | 'conflict';
type PersistStatus = 'saved' | 'conflict' | 'error';

/**
 * MDX fragment editor (kind:'fragment').
 *
 * Inline page layout (mirrors MdxPageEditor). Routed via /fragments/:id which
 * lives outside CMSLayout in App.tsx so the editor occupies the full viewport.
 */
interface FragmentEditorProps {
  /** Editor surface override for parent-state tests; production uses CMSMDXEditor. */
  EditorComponent?: ElementType<CMSMDXEditorProps>;
}

export function FragmentEditor({ EditorComponent = CMSMDXEditor }: FragmentEditorProps = {}) {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const updateContent = useUpdateLocalized();
  const { resolvedTheme } = useTheme();

  // When the editor is opened from inside the Puck page editor (via the
  // "Open fragment editor" button on the page's right-hand panel), `?from=page`
  // signals we should surface a shared-content warning and offer an explicit
  // "Done" path back to the originating page rather than back to /fragments.
  const fromPage = searchParams.get('from') === 'page';
  const returnPageId = searchParams.get('pageId') || '';

  const localeConfig = getUIConfig().locales;
  const [currentLocale, setCurrentLocale] = useState<string>(
    () => localeConfig?.defaultLocale ?? localeConfig?.list[0] ?? '',
  );
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
  const siteDefaultLocale = Object.values(sitesConfig?.sites ?? {})[0]?.defaultLocale;
  const defaultLocale =
    localeConfig?.defaultLocale ?? siteDefaultLocale ?? sitesConfig?.globalLocales[0] ?? (sitesConfig ? 'en' : '');
  const availableLocales = localeConfig?.list?.length
    ? localeConfig.list
    : sitesConfig?.globalLocales.length
      ? sitesConfig.globalLocales
      : defaultLocale
        ? [defaultLocale]
        : [];

  const { data: loadedContent, isLoading, error } = useLocalizedContent(id || '', currentLocale);
  const fragmentIdentityRef = useRef(id);
  const routeIdentityChanged = fragmentIdentityRef.current !== id;

  useEffect(() => {
    if (!routeIdentityChanged) return;
    fragmentIdentityRef.current = id;
    setCurrentLocale(defaultLocale);
    setCurrentEtag('');
    setPendingLocaleSwitch(null);
    setShowLocaleUnsavedDialog(false);
    setConflict(null);
    setContent('');
    setIsContentLoaded(false);
    savedContentRef.current = '';
    setSaveState('idle');
  }, [id, routeIdentityChanged, defaultLocale]);

  useEffect(() => {
    if (!currentLocale && defaultLocale) setCurrentLocale(defaultLocale);
  }, [currentLocale, defaultLocale]);

  useEffect(() => {
    // First-load gate: never re-seed from background refetches. TanStack
    // Query emits a new `loadedContent` ref on window-focus refetch, on
    // `useUpdateLocalized.onSuccess` (which calls `setQueryData`), and on
    // any cache invalidation — without this gate, the effect would call
    // `setContent(serverMdx)` and silently overwrite the user's typing.
    // Manual remote-reload remains available via the conflict dialog.
    // Same arrival predicate as MdxPageEditor: an etag is not proof the
    // content arrived — an index that parses only the first 4 KB of each
    // file defers it for anything larger, so a fragment can carry
    // `etag: ''`. The payload itself is the proof. Gating on `localized`
    // alone opens the editor over an envelope whose content has not
    // arrived, seeding an empty buffer that then overwrites the document
    // on the next save.
    if (!routeIdentityChanged && !isContentLoaded && loadedContent?.localized?.content && loadedContent.id === id) {
      setCurrentEtag(loadedContent.localized.etag);
      const data = loadedContent.localized.content as { mdx?: string } | undefined;
      const mdx = data?.mdx || '';
      savedContentRef.current = mdx;
      setContent(mdx);
      setIsContentLoaded(true);
    }
  }, [id, loadedContent, isContentLoaded, routeIdentityChanged]);

  const isDirty = isContentLoaded && content !== savedContentRef.current;
  const blocker = useUnsavedChangesGuard(isDirty);

  const editorClassName = resolvedTheme === 'dark' ? 'dark-theme' : undefined;
  const fragmentName = loadedContent?.localized?.name || id || 'fragment';
  const filePath = `fragments/${fragmentName}`;

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
      console.error('Failed to save fragment:', err);
      showError('Failed to save fragment', err);
      setSaveState('error');
      return 'error';
    }
  };

  const contentRef = useRef(content);
  contentRef.current = content;
  const isDirtyRef = useRef(isDirty);
  isDirtyRef.current = isDirty;
  const persistRef = useRef(persist);
  // persist is recreated each render; keep the latest for the flush bridge.
  persistRef.current = persist;

  useEffect(() => {
    return registerEditorFlushHandler(
      async () => {
        if (!isDirtyRef.current) return { ok: true };
        const status = await persistRef.current(contentRef.current);
        if (status === 'error' || status === 'conflict') {
          return { ok: false, message: 'Could not save editor changes.' };
        }
        return { ok: true };
      },
      { isDirty: () => isDirtyRef.current },
    );
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: The dependency change is the event; handlers read current state through refs.
  useEffect(() => {
    notifyEditorDirtyChanged();
  }, [isDirty]);

  const ui = getUIConfig();
  const hideSave = ui.hideEditorSave === true;
  // See MdxPageEditor: when `hosted` is set the host app owns Cmd/Ctrl+S, so
  // the editor drops its shortcut while keeping the visible Save button.
  const bindSaveShortcut = !hideSave && ui.hosted !== true;

  const handleSaveClick = () => {
    void persist(content);
  };

  // Back-arrow + Cancel target. When entered via the Puck page panel,
  // returning to /pages/:pageId reopens the page editor; otherwise we go
  // back to the fragments list.
  const backTarget = fromPage && returnPageId ? `/pages/${returnPageId}` : '/fragments';

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

  // The failure branch must come BEFORE the loading splash: a failed
  // load never produces content, so a splash-first ordering spins
  // forever and the user gets no error and no way back.
  // `getLocalized` resolves null (no error) for a missing entry, so a
  // settled query with nothing loaded is a failure too, not "loading".
  if (!routeIdentityChanged && currentLocale && (error || !isLoading) && !loadedContent && !savedContentRef.current) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-page gap-4">
        <div className="text-red-04 dark:text-red-08">Failed to load fragment: {error?.message || 'Not found'}</div>
        <button
          type="button"
          onClick={() => navigate('/fragments')}
          className="px-4 py-2 bg-azure-04 text-white rounded-md hover:bg-azure-03 transition-colors"
        >
          Back to Fragments
        </button>
      </div>
    );
  }

  // Render the loading splash until we have the initial markdown — MDXEditorLib
  // only reads `markdown` once on mount, so we can't safely render the editor
  // with a placeholder empty string and update it later.
  if (routeIdentityChanged || !currentLocale || isLoading || !isContentLoaded) {
    return (
      <div className="flex items-center justify-center h-full bg-page">
        <div className="flex items-center gap-3 text-muted">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-azure-04" />
          <span>Loading fragment…</span>
        </div>
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
    <div className="h-full flex flex-col bg-page">
      <header className="flex items-center justify-between gap-4 px-4 py-2 border-b border-line bg-overlay shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <button
            type="button"
            onClick={handleCancel}
            aria-label={fromPage ? 'Back to page' : 'Back to fragments'}
            className="p-2 rounded text-muted hover:bg-hover"
          >
            ←
          </button>
          <h1 className="text-base font-medium text-foreground truncate">Edit: {filePath}</h1>
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
            className="px-3 py-1.5 text-sm border border-line rounded text-foreground hover:bg-hover disabled:opacity-50"
          >
            Cancel
          </button>
          {!hideSave && (
            <button
              type="button"
              onClick={handleSaveClick}
              disabled={saveState === 'saving' || (!isDirty && saveState === 'idle')}
              className="px-3 py-1.5 text-sm bg-accent text-accent-foreground rounded hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saveButtonLabel}
            </button>
          )}
          {fromPage && (
            <button
              type="button"
              onClick={handleDone}
              disabled={saveState === 'saving'}
              className="px-3 py-1.5 text-sm border border-line rounded text-foreground hover:bg-hover disabled:opacity-50"
              data-testid="fragment-editor-done"
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
          data-testid="shared-fragment-banner"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>This is a shared fragment. Saving updates every page that uses it.</span>
        </div>
      )}
      <div className="flex-1 overflow-hidden flex flex-row min-h-0">
        {/* `conloca-mdx-editor-surround` paints the area around the
            prose card with the host site's body bg (via the
            `--conloca-host-body-bg` bridge in site-styles). Same class
            MdxPageEditor uses — the two surfaces now share the
            surround treatment so a fragment visually matches the page
            it'll ultimately appear in. */}
        <div
          className={`flex-1 min-w-0 overflow-hidden conloca-mdx-editor-surround${resolvedTheme === 'dark' ? ' dark' : ''}`}
          data-theme={resolvedTheme}
        >
          <EditorComponent
            // Re-mount on locale switch so the editor re-initializes with
            // the new locale's markdown — `value` is read once on first
            // mount (the underlying BaseMDXEditor seeds its Lexical state
            // from the initial prop and doesn't reactively swap it).
            key={`${id}-${currentLocale}`}
            value={content}
            // Fragment content has no canonical page route, so we
            // synthesize one from the integration's
            // `fragmentPreviewRoute` option (defaults to `/` — see
            // `ConlocaCMSOptions` in `plugin-spa.ts`). The editor
            // then fetches that route's CSS and content-root wrapper
            // the same way it does for pages, so authoring a fragment
            // visually matches the host site instead of falling back
            // to the editor's bare chrome. Per-fragment overrides via
            // frontmatter (`previewRoute`) are on the roadmap for the
            // case where one fragment is tied to a specific layout.
            previewRouteUrl={import.meta.env.CONLOCA_FRAGMENT_PREVIEW_ROUTE || '/'}
            onChange={(next, initialNormalize) => {
              setContent(next);
              // See MdxPageEditor: the library's first onChange call after
              // parse round-trip-rewrites the markdown; rebaseline rather
              // than flag dirty.
              if (initialNormalize) {
                savedContentRef.current = next;
              }
            }}
            onSave={bindSaveShortcut ? persist : undefined}
            className={editorClassName}
            autoFocus
            placeholder="Start writing your fragment…"
          />
        </div>
        {previewOpen && (
          <div className="w-1/2 min-w-0 overflow-auto border-l border-line bg-panel">
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
