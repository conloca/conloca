import {
  getContentAPIClient,
  StaleWriteError,
  type UpdateResult,
  useLocalizedContent,
  useSitesConfig,
  useUpdateLocalized,
} from '@conloca/content-api-client';
import { AlertTriangle } from 'lucide-react';
import { type ElementType, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { parsePath, useHref, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { notifyEditorDirtyChanged, registerEditorFlushHandler } from '../../editor-flush.js';
import { useEditorPref } from '../../hooks/useEditorPref.js';
import { useErrorModal } from '../../hooks/useErrorModal.js';
import { useTheme } from '../../hooks/useTheme.js';
import { useUnsavedChangesGuard } from '../../hooks/useUnsavedChangesGuard.js';
import type { SaveState } from '../../types.js';
import { getUIConfig } from '../../ui-config.js';
import { ConflictDialog } from '../dialogs/ConflictDialog.js';
import { ErrorModal } from '../dialogs/ErrorModal.js';
import { UnsavedChangesDialog } from '../dialogs/UnsavedChangesDialog.js';
import { CMSMDXEditor, type CMSMDXEditorProps } from './CMSMDXEditor.js';
import { EditorChromeToggles } from './EditorChromeToggles.js';
import { FRAGMENT_STATUS_ID, FragmentEditorHeaderActions, fragmentStatusText } from './FragmentEditorHeaderActions.js';
import { LocaleSelector } from './LocaleSelector.js';
import { MDXLivePreview } from './MDXLivePreview.js';

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
  // back path to the originating page rather than back to /fragments.
  const { fromPage, backTarget, backLabel } = fragmentOrigin(searchParams);
  const backHref = useHref(backTarget);

  const localeConfig = getUIConfig().locales;
  const [currentLocale, setCurrentLocale] = useState<string>(
    () => localeConfig?.defaultLocale ?? localeConfig?.list[0] ?? '',
  );
  const currentEtagRef = useRef('');
  const [pendingLocaleSwitch, setPendingLocaleSwitch] = useState<string | null>(null);
  const [showLocaleUnsavedDialog, setShowLocaleUnsavedDialog] = useState(false);

  const [conflict, setConflict] = useState<UpdateResult | null>(null);
  const { showError, errorModalProps } = useErrorModal();
  const [errorOperation, setErrorOperation] = useState<'save' | 'locale'>('save');

  const [content, setContent] = useState<string>('');
  // MDXEditorLib only reads `markdown` once on mount, so defer rendering the
  // editor until the loaded value has been written into state.
  const [isContentLoaded, setIsContentLoaded] = useState(false);
  const savedContentRef = useRef<string>('');

  const [saveState, setSaveState] = useState<SaveState>('idle');
  // A save has landed since this fragment and locale were opened: lets the status line keep saying the draft
  // is saved (and not necessarily published) once the button has settled back from "Saved".
  const [savedSinceOpen, setSavedSinceOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useEditorPref('conloca.mdxeditor.previewOpen');

  const { defaultLocale, availableLocales } = useFragmentLocales();

  const { data: loadedContent, isLoading, error } = useLocalizedContent(id || '', currentLocale);
  const saveIdentityRef = useFragmentSaveIdentity(id, currentLocale);
  const fragmentIdentityRef = useRef(id);
  const routeIdentityChanged = fragmentIdentityRef.current !== id;

  useEffect(() => {
    if (!routeIdentityChanged) return;
    fragmentIdentityRef.current = id;
    setCurrentLocale(defaultLocale);
    currentEtagRef.current = '';
    setPendingLocaleSwitch(null);
    setShowLocaleUnsavedDialog(false);
    setConflict(null);
    setContent('');
    setIsContentLoaded(false);
    savedContentRef.current = '';
    setSavedSinceOpen(false);
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
      currentEtagRef.current = loadedContent.localized.etag;
      const data = loadedContent.localized.content;
      const mdx = data?.mdx || '';
      savedContentRef.current = mdx;
      setContent(mdx);
      setIsContentLoaded(true);
    }
  }, [id, loadedContent, isContentLoaded, routeIdentityChanged]);

  const isDirty = isContentLoaded && content !== savedContentRef.current;
  const {
    save: queueSave,
    pendingRef: pendingSaveRef,
    blocksExit,
  } = useFragmentSaveQueue(saveIdentityRef.current, saveState, isDirty);

  useEffect(() => {
    if (!isDirty && saveState === 'error') setSaveState('idle');
  }, [isDirty, saveState]);
  const blocker = useUnsavedChangesGuard(blocksExit);

  const editorClassName = resolvedTheme === 'dark' ? 'dark-theme' : undefined;
  const fragmentName = fragmentDisplayName(loadedContent, id);
  const filePath = `fragments/${fragmentName}`;

  useEffect(() => {
    const prev = document.title;
    document.title = `Edit: ${filePath} · Conloca CMS`;
    return () => {
      document.title = prev;
    };
  }, [filePath]);

  useEffect(() => {
    if (saveState !== 'saved') return undefined;
    const timer = setTimeout(() => setSaveState('idle'), 2000);
    return () => clearTimeout(timer);
  }, [saveState]);

  const writeContent = async (
    newContent: string,
    saveIdentity: typeof saveIdentityRef.current,
    forceEtag?: string,
  ): Promise<PersistStatus> => {
    if (!id) return 'error';
    setSaveState('saving');

    try {
      const result = await updateContent.mutateAsync({
        id,
        locale: currentLocale,
        data: { content: { mdx: newContent } },
        etag: forceEtag ?? currentEtagRef.current,
      });

      // A reply for another fragment or locale must not rebaseline this editor.
      if (saveIdentityRef.current !== saveIdentity) return 'error';

      if (result.success && result.etag) {
        currentEtagRef.current = result.etag;
        savedContentRef.current = newContent;
        setSavedSinceOpen(true);
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
      if (saveIdentityRef.current !== saveIdentity) return 'error';
      // HTTP clients throw stale writes; storage adapters may resolve the same conflict as a result.
      if (err instanceof StaleWriteError) {
        setConflict({ success: false, reason: 'stale_write', currentEtag: err.currentEtag });
        setSaveState('conflict');
        return 'conflict';
      }
      console.error('Failed to save fragment:', err);
      setErrorOperation('save');
      showError('Failed to save fragment', err);
      setSaveState('error');
      return 'error';
    }
  };

  const persist = (newContent: string, forceEtag?: string): Promise<PersistStatus> => {
    const identity = saveIdentityRef.current;
    return queueSave(
      identity,
      () => {
        if (!isContentLoaded || routeIdentityChanged || identity.id !== id || identity.locale !== currentLocale) {
          return Promise.resolve('error');
        }
        if (forceEtag === undefined && newContent === savedContentRef.current) return Promise.resolve('saved');
        return writeContent(newContent, identity, forceEtag);
      },
      () => saveIdentityRef.current === identity,
    );
  };

  const discardedBufferRef = useRef<{ identity: typeof saveIdentityRef.current; content: string } | null>(null);
  const flushRef = useRef({ content, isDirty, persist });
  useLayoutEffect(() => {
    // The host must read the committed buffer and request, never an abandoned route render.
    const discarded = discardedBufferRef.current;
    const bufferDiscarded = discarded?.identity === saveIdentityRef.current && discarded.content === content;
    const hostDirty = isDirty && !routeIdentityChanged && !bufferDiscarded;
    const dirtyChanged = flushRef.current.isDirty !== hostDirty;
    flushRef.current = { content, isDirty: hostDirty, persist };
    if (dirtyChanged) notifyEditorDirtyChanged();
  });

  useEffect(() => {
    return registerEditorFlushHandler(
      async () => {
        const identity = saveIdentityRef.current;
        let committed = flushRef.current;
        while (committed.isDirty || pendingSaveRef.current?.identity === identity) {
          // oxlint-disable-next-line no-await-in-loop -- Each write needs the ETag returned by the previous save.
          const status = await committed.persist(committed.content);
          if (status !== 'saved' || saveIdentityRef.current !== identity) {
            return { ok: false, message: 'Could not save editor changes.' };
          }
          // A completed write changes the baseline before React necessarily commits a new dirty flag.
          committed = flushRef.current;
          const discarded = discardedBufferRef.current;
          const bufferDiscarded = discarded?.identity === identity && discarded.content === committed.content;
          const needsSave = !bufferDiscarded && committed.content !== savedContentRef.current;
          if (!needsSave && pendingSaveRef.current?.identity !== identity) break;
          committed = { ...committed, isDirty: needsSave };
        }
        return { ok: true };
      },
      { isDirty: () => flushRef.current.isDirty },
    );
  }, [pendingSaveRef, saveIdentityRef]);

  const ui = getUIConfig();
  const hideSave = ui.hideEditorSave === true;
  // See MdxPageEditor: when `hosted` is set the host app owns Cmd/Ctrl+S, so
  // the editor drops its shortcut while keeping the visible Save button.
  const bindSaveShortcut = !hideSave && ui.hosted !== true;

  const handleSaveClick = () => {
    void saveDraft(content);
  };

  // Back leaves without saving or publishing. The unsaved-changes guard
  // (`useUnsavedChangesGuard`) intercepts the navigation and opens the
  // dialog if the user has unsaved edits, so we don't duplicate the check.
  const handleBack = () => {
    void navigate(backTarget);
  };

  const revokeLocaleIntent = () => {
    if (exitIntentRef.current?.kind !== 'locale') return;
    exitIntentRef.current = null;
    const discarded = discardedBufferRef.current;
    if (discarded?.identity !== saveIdentityRef.current || discarded.content !== flushRef.current.content) return;
    // Revoking a destination leaves this exact draft visible and owned by Save/Publish again.
    discardedBufferRef.current = null;
    flushRef.current = { ...flushRef.current, isDirty: flushRef.current.content !== savedContentRef.current };
    notifyEditorDirtyChanged();
  };

  const saveDraft = (newContent: string) => {
    // Explicit Save reclaims a discarded draft, but a clean shortcut must leave an ordinary locale read alone.
    const discarded = discardedBufferRef.current;
    if (discarded?.identity === saveIdentityRef.current && discarded.content === newContent) revokeLocaleIntent();
    return persist(newContent);
  };

  const handleLocaleChange = async (newLocale: string) => {
    if (newLocale === currentLocale || blocker.state !== 'unblocked' || routeIdentityChanged) return;
    if (isDirty) {
      revokeLocaleIntent();
      setPendingLocaleSwitch(newLocale);
      setShowLocaleUnsavedDialog(true);
      return;
    }
    await switchLocale(newLocale);
  };

  const switchLocale = async (newLocale: string) => {
    if (!id || routeIdentityChanged) return;
    const identity = saveIdentityRef.current;
    const intent: FragmentExitIntent = { kind: 'locale', locale: newLocale };
    exitIntentRef.current = intent;

    try {
      const client = getContentAPIClient();
      const newLocaleContent = await client.getLocalized(id, newLocale);
      if (exitIntentRef.current !== intent || saveIdentityRef.current !== identity) return;
      if (newLocaleContent && (newLocaleContent.id !== id || newLocaleContent.localized.locale !== newLocale)) {
        throw new Error('The locale reply does not match the requested fragment and locale.');
      }
      exitIntentRef.current = null;

      if (!newLocaleContent) {
        currentEtagRef.current = '';
        savedContentRef.current = '';
        setContent('');
      } else {
        currentEtagRef.current = newLocaleContent.localized.etag;
        const newData = newLocaleContent.localized.content;
        const mdx = newData?.mdx || '';
        savedContentRef.current = mdx;
        setContent(mdx);
      }

      setSavedSinceOpen(false);
      setSaveState('idle');
      setCurrentLocale(newLocale);
      setPendingLocaleSwitch(null);
    } catch (err) {
      if (exitIntentRef.current !== intent || saveIdentityRef.current !== identity) return;
      revokeLocaleIntent();
      setErrorOperation('locale');
      showError(localeSwitchErrorMessage(flushRef.current.isDirty), err);
      console.error('Failed to switch locale:', err);
    }
  };

  const handleUnsavedSave = async () => {
    if (exitIntentRef.current?.kind === 'proceeding' || exitIntentRef.current?.kind === 'cancelled') return;
    await persist(content);
  };

  const maskBufferFromHost = () => {
    // Mask this committed buffer before the locale read or router transition can yield to host Publish.
    discardedBufferRef.current = { identity: saveIdentityRef.current, content };
    flushRef.current = { ...flushRef.current, isDirty: false };
    notifyEditorDirtyChanged();
  };

  const continueLocaleSwitch = async () => {
    if (!pendingLocaleSwitch) return;
    setShowLocaleUnsavedDialog(false);
    setPendingLocaleSwitch(null);
    await switchLocale(pendingLocaleSwitch);
  };

  const handleLocaleUnsavedDiscard = async () => {
    if (!pendingLocaleSwitch) return;
    maskBufferFromHost();
    await continueLocaleSwitch();
  };

  const handleLocaleUnsavedCancel = () => {
    revokeLocaleIntent();
    setShowLocaleUnsavedDialog(false);
    setPendingLocaleSwitch(null);
  };

  const {
    intentRef: exitIntentRef,
    showNavigationDialog,
    continueNavigation,
    cancelNavigation,
  } = useFragmentExit({
    routeIdentityChanged,
    isDirty,
    saveState,
    blocker,
    onLocaleContinue: continueLocaleSwitch,
    onLocaleCancel: handleLocaleUnsavedCancel,
  });

  // The failure branch must come BEFORE the loading splash: a failed
  // load never produces content, so a splash-first ordering spins
  // forever and the user gets no error and no way back.
  // `getLocalized` resolves null (no error) for a missing entry, so a
  // settled query with nothing loaded is a failure too, not "loading".
  if (
    fragmentLoadFailed({
      routeIdentityChanged,
      currentLocale,
      error,
      isLoading,
      loadedContent,
      savedContent: savedContentRef.current,
    })
  ) {
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

  return (
    <div className="h-full flex flex-col bg-page">
      <header className="flex items-center justify-between gap-4 px-4 py-2 border-b border-line bg-overlay shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <button
            type="button"
            onClick={handleBack}
            aria-label={backLabel}
            className="p-2 rounded text-muted hover:bg-hover"
          >
            ←
          </button>
          <div className="min-w-0">
            <h1 className="text-base font-medium text-foreground truncate">Edit: {filePath}</h1>
            <p
              id={FRAGMENT_STATUS_ID}
              role="status"
              className="text-xs text-muted truncate"
              data-testid="fragment-editor-status"
            >
              {fragmentStatusText({ saveState, isDirty, savedSinceOpen })}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <LocaleSelector
            disabled={saveState === 'saving'}
            currentLocale={currentLocale}
            availableLocales={availableLocales}
            onChange={handleLocaleChange}
          />
          <EditorChromeToggles previewOpen={previewOpen} onTogglePreview={() => setPreviewOpen(!previewOpen)} />
          <FragmentEditorHeaderActions
            saveState={saveState}
            isDirty={isDirty}
            saveHidden={hideSave}
            onSave={handleSaveClick}
          />
        </div>
      </header>
      <SharedFragmentBanner fromPage={fromPage} />
      <FragmentEditorSurface
        EditorComponent={EditorComponent}
        editorKey={`${id}-${currentLocale}`}
        content={content}
        resolvedTheme={resolvedTheme}
        previewOpen={previewOpen}
        editorClassName={editorClassName}
        onChange={(next, initialNormalize) => {
          if (!initialNormalize && next !== content) discardedBufferRef.current = null;
          if (!initialNormalize && next !== content && exitIntentRef.current?.kind === 'locale') {
            exitIntentRef.current = null;
          }
          setContent(next);
          // Normalize the initial parse without making the fragment dirty.
          if (initialNormalize) savedContentRef.current = next;
        }}
        onSave={bindSaveShortcut ? saveDraft : undefined}
      />

      {showNavigationDialog && (
        <UnsavedChangesDialog
          backNavigation={isFragmentBackNavigation(blocker, backHref)}
          pending={saveState === 'saving'}
          onSave={handleUnsavedSave}
          onDiscard={() => {
            maskBufferFromHost();
            continueNavigation();
          }}
          onCancel={cancelNavigation}
        />
      )}

      {showLocaleUnsavedDialog && blocker.state === 'unblocked' && (
        <UnsavedChangesDialog
          pending={saveState === 'saving'}
          onSave={handleUnsavedSave}
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
            currentEtagRef.current = newEtag;
            await persist(content, newEtag);
          }}
          onCancel={() => {
            setConflict(null);
            setSaveState('idle');
          }}
        />
      )}
      <ErrorModal {...errorModalProps} title={errorOperation === 'locale' ? 'Locale Switch Failed' : 'Save Failed'} />
    </div>
  );
}

function localeSwitchErrorMessage(isDirty: boolean) {
  return isDirty
    ? 'Failed to switch locale. Your changes are still here.'
    : 'Failed to switch locale. Please try again.';
}

function useFragmentLocales() {
  const localeConfig = getUIConfig().locales;
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

  return { defaultLocale, availableLocales };
}

interface FragmentSaveIdentity {
  id: string | undefined;
  locale: string;
}

function useFragmentSaveIdentity(id: string | undefined, currentLocale: string) {
  const saveIdentityRef = useRef<FragmentSaveIdentity>({ id, locale: currentLocale });
  useLayoutEffect(() => {
    // Only committed identity changes invalidate pending replies; suspended renders can be abandoned.
    if (saveIdentityRef.current.id !== id || saveIdentityRef.current.locale !== currentLocale) {
      saveIdentityRef.current = { id, locale: currentLocale };
    }
  }, [id, currentLocale]);
  useEffect(() => {
    // Passive cleanup runs on unmount, while a Suspense hide only disconnects layout effects.
    return () => {
      saveIdentityRef.current = { ...saveIdentityRef.current };
    };
  }, []);

  return saveIdentityRef;
}

/** Serialize writes for the committed fragment/locale and share each result with concurrent save callers. */
function useFragmentSaveQueue(currentIdentity: FragmentSaveIdentity, saveState: SaveState, isDirty: boolean) {
  const pendingRef = useRef<{ identity: FragmentSaveIdentity; promise: Promise<PersistStatus> } | null>(null);
  const save = async (
    identity: FragmentSaveIdentity,
    write: () => Promise<PersistStatus>,
    isCurrent: () => boolean,
  ): Promise<PersistStatus> => {
    while (pendingRef.current?.identity === identity) {
      // oxlint-disable-next-line no-await-in-loop -- Wait for this identity's active write before enqueueing another.
      const status = await pendingRef.current.promise;
      if (!isCurrent()) return 'error';
      if (status !== 'saved') return status;
    }
    if (!isCurrent()) return 'error';
    const promise = write().finally(() => {
      if (pendingRef.current?.promise === promise) pendingRef.current = null;
    });
    pendingRef.current = { identity, promise };
    return promise;
  };
  return {
    save,
    pendingRef,
    // The previous baseline cannot make an exit safe while a write for this identity is still settling.
    blocksExit: isDirty || (saveState === 'saving' && pendingRef.current?.identity === currentIdentity),
  };
}

type FragmentExitIntent =
  | { kind: 'navigation' | 'proceeding' | 'cancelled'; blocker: ReturnType<typeof useUnsavedChangesGuard> }
  | { kind: 'locale'; locale: string }
  | null;

/** A save completes only the intent still owned by the committed UI; Cancel removes that intent. */
function useFragmentExit({
  routeIdentityChanged,
  isDirty,
  saveState,
  blocker,
  onLocaleContinue,
  onLocaleCancel,
}: {
  routeIdentityChanged: boolean;
  isDirty: boolean;
  saveState: SaveState;
  blocker: ReturnType<typeof useUnsavedChangesGuard>;
  onLocaleContinue: () => Promise<void>;
  onLocaleCancel: () => void;
}) {
  const intentRef = useRef<FragmentExitIntent>(null);
  const [dismissedBlocker, setDismissedBlocker] = useState<typeof blocker | null>(null);

  const navigationConsumed = useCallback(
    () =>
      intentRef.current?.kind !== 'locale' &&
      intentRef.current?.blocker === blocker &&
      (intentRef.current.kind === 'proceeding' || intentRef.current.kind === 'cancelled'),
    [blocker],
  );

  const continueNavigation = useCallback(() => {
    if (blocker.state !== 'blocked' || navigationConsumed()) return;
    intentRef.current = { kind: 'proceeding', blocker };
    setDismissedBlocker(blocker);
    onLocaleCancel();
    blocker.proceed();
  }, [blocker, navigationConsumed, onLocaleCancel]);

  const cancelNavigation = useCallback(() => {
    if (blocker.state !== 'blocked' || navigationConsumed()) return;
    // RouterProvider commits reset in a transition; revoke ownership before that render can suspend.
    intentRef.current = { kind: 'cancelled', blocker };
    setDismissedBlocker(blocker);
    blocker.reset();
  }, [blocker, navigationConsumed]);

  useEffect(() => {
    if (routeIdentityChanged || saveState === 'conflict') {
      // Conflict consumes a pending navigation through the same synchronous owner as Cancel.
      cancelNavigation();
      onLocaleCancel();
      return;
    }
    if (blocker.state !== 'unblocked') {
      onLocaleCancel();
      if (blocker.state !== 'blocked') return;
      if (navigationConsumed()) return;
      intentRef.current = { kind: 'navigation', blocker };
      if (isDirty || saveState === 'saving') return;
      continueNavigation();
      return;
    }
    if (intentRef.current?.kind !== 'locale') intentRef.current = null;
    if (!isDirty && saveState !== 'saving') void onLocaleContinue();
  }, [
    routeIdentityChanged,
    isDirty,
    saveState,
    blocker,
    onLocaleContinue,
    onLocaleCancel,
    navigationConsumed,
    continueNavigation,
    cancelNavigation,
  ]);
  return {
    intentRef,
    showNavigationDialog: blocker.state === 'blocked' && dismissedBlocker !== blocker,
    continueNavigation,
    cancelNavigation,
  };
}

type FragmentLoad = ReturnType<typeof useLocalizedContent>;

function fragmentLoadFailed({
  routeIdentityChanged,
  currentLocale,
  error,
  isLoading,
  loadedContent,
  savedContent,
}: {
  routeIdentityChanged: boolean;
  currentLocale: string;
  error: FragmentLoad['error'];
  isLoading: boolean;
  loadedContent: FragmentLoad['data'];
  savedContent: string;
}) {
  return !routeIdentityChanged && currentLocale && (error || !isLoading) && !loadedContent && !savedContent;
}

function fragmentDisplayName(loadedContent: FragmentLoad['data'], id: string | undefined) {
  return loadedContent?.localized?.name || id || 'fragment';
}

function SharedFragmentBanner({ fromPage }: { fromPage: boolean }) {
  return (
    fromPage && (
      <div
        className="flex items-start gap-2 px-4 py-2 border-b border-yellow-08 dark:border-yellow-03 bg-yellow-11 dark:bg-yellow-02 text-sm text-yellow-02 dark:text-yellow-09 shrink-0"
        role="status"
        data-testid="shared-fragment-banner"
      >
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <span>This is a shared fragment. Saving updates every page that uses it.</span>
      </div>
    )
  );
}

interface FragmentEditorSurfaceProps {
  EditorComponent: ElementType<CMSMDXEditorProps>;
  editorKey: string;
  content: string;
  resolvedTheme: ReturnType<typeof useTheme>['resolvedTheme'];
  previewOpen: boolean;
  editorClassName: string | undefined;
  onChange: CMSMDXEditorProps['onChange'];
  onSave: CMSMDXEditorProps['onSave'];
}

function FragmentEditorSurface({
  EditorComponent,
  editorKey,
  content,
  resolvedTheme,
  previewOpen,
  editorClassName,
  onChange,
  onSave,
}: FragmentEditorSurfaceProps) {
  return (
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
          key={editorKey}
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
          onChange={onChange}
          onSave={onSave}
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
  );
}

function isFragmentBackNavigation(blocker: ReturnType<typeof useUnsavedChangesGuard>, backHref: string) {
  const blockedPath = blocker.location?.pathname;
  const targetPath = parsePath(backHref).pathname;
  if (!blockedPath || !targetPath) return false;
  // Browser history percent-encodes Unicode; memory history may keep the same path literal.
  const pathBase = 'http://localhost';
  return new URL(blockedPath, pathBase).pathname === new URL(targetPath, pathBase).pathname;
}

function fragmentOrigin(searchParams: URLSearchParams) {
  const fromPage = searchParams.get('from') === 'page';
  const returnPageId = searchParams.get('pageId') || '';
  const returnsToPage = fromPage && returnPageId !== '';
  const backTarget = returnsToPage ? `/pages/${encodeURIComponent(returnPageId)}` : '/fragments';
  const backLabel = returnsToPage ? 'Back to page' : 'Back to fragments';
  return { fromPage, backTarget, backLabel };
}
