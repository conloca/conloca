import {
  getContentAPIClient,
  StaleWriteError,
  type UpdateResult,
  useLocalizedContent,
  useSitesConfig,
  useUpdateLocalized,
} from '@conloca/content-api-client';
import cn from 'clsx';
import { AlertTriangle } from 'lucide-react';
import { type ElementType, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { parsePath, useHref, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { notifyEditorDirtyChanged, registerEditorFlushHandler } from '../../editor-flush.js';
import { useEditorPref } from '../../hooks/useEditorPref.js';
import { useErrorModal } from '../../hooks/useErrorModal.js';
import { useTheme } from '../../hooks/useTheme.js';
import { useUnsavedChangesGuard } from '../../hooks/useUnsavedChangesGuard.js';
import { useDocChannel } from '../../live/doc-channel.js';
import { heldFragmentEdit, setHeldFragmentEdit, setNotAppliedFragmentEdit } from '../../live/held-fragment-edits.js';
import { markdownLivePlugin } from '../../live/markdown-live-plugin.js';
import { useLiveDoc } from '../../live/use-live.js';
import { setSelectedBlock } from '../../selected-block.js';
import { useSiteRender } from '../../site-render.js';
import type { SaveState } from '../../types.js';
import { getUIConfig } from '../../ui-config.js';
import { DraftNoticeStrip } from '../conflicts/EditorNoticeStrip.js';
import { PageDraftMenu } from '../conflicts/PageDraftMenu.js';
import { draftToolsPage } from '../conflicts/use-page-conflicts.js';
import { ConflictDialog } from '../dialogs/ConflictDialog.js';
import { ErrorModal } from '../dialogs/ErrorModal.js';
import { LiveLeaveGuard, UnsavedChangesDialog } from '../dialogs/UnsavedChangesDialog.js';
import { CMSMDXEditor, type CMSMDXEditorProps } from './CMSMDXEditor.js';
import { EditorChromeToggles } from './EditorChromeToggles.js';
import { FRAGMENT_STATUS_ID, FragmentEditorHeaderActions, fragmentStatusText } from './FragmentEditorHeaderActions.js';
import { checkFragmentSave } from './fragment-save-check.js';
import {
  pendingFragmentSave,
  trackFragmentSave,
  useFragmentContent,
  waitForFragmentSave,
} from './fragment-save-lifetime.js';
import { JsxPropsPanel } from './JsxPropsPanel.js';
import { LocaleSelector } from './LocaleSelector.js';
import { fragmentPreviewPathname, MDXLivePreview } from './MDXLivePreview.js';
import { usePeerBlockOutlines } from './MdxPageEditor.js';
import { useOfferedMdxComponents } from './offered-mdx-components.js';

type PersistStatus = 'saved' | 'conflict' | 'error';

/**
 * MDX fragment editor (kind:'fragment').
 *
 * Inline page layout (mirrors MdxPageEditor). Routed via /fragments/:id which
 * lives outside CMSLayout in App.tsx so the editor occupies the full viewport.
 * Inside a parent frame with a doc channel the body is co-edited live and there
 * is nothing to save.
 */
interface FragmentEditorProps {
  /** Editor surface override for parent-state tests of the Save editor; production uses CMSMDXEditor. */
  EditorComponent?: ElementType<CMSMDXEditorProps>;
}

export function FragmentEditor({ EditorComponent = CMSMDXEditor }: FragmentEditorProps = {}) {
  const { id } = useParams<{ id: string }>();
  // The guard sits above the loading, missing and failed screens too: a locale switch reopens, and the old doc may still owe work.
  return useDocChannel() ? (
    <>
      <LiveLeaveGuard />
      <LiveFragmentEditor key={id} />
    </>
  ) : (
    <SavedFragmentEditor EditorComponent={EditorComponent} />
  );
}

const NOT_MDX = 'This fragment is not MDX, so it cannot be edited here.';

/**
 * The co-editing branch: the body is bound to the fragment's shared doc, an MDX doc as on MDX pages. The site's save
 * check gates each write: an edit it refuses is held in the editor unsent, and the frame reports it held, so flushes
 * answer not ok and leaving asks.
 */
function LiveFragmentEditor() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { resolvedTheme } = useTheme();
  const { vocabulary } = useSiteRender();
  const descriptors = useOfferedMdxComponents();
  const { fromPage, backTarget, backLabel } = fragmentOrigin(searchParams);
  const { defaultLocale, availableLocales } = useFragmentLocales();
  const [chosenLocale, setChosenLocale] = useState<string | null>(null);
  const currentLocale = chosenLocale ?? defaultLocale;
  const [previewOpen, setPreviewOpen] = useEditorPref('conloca.mdxeditor.previewOpen');
  // The fragment as stored: its name and type; its body comes from the shared doc, opened only for an MDX row.
  const { data: loaded, isPending, error } = useLocalizedContent(id || '', currentLocale);
  const isMdx = loaded?.type === 'mdx';
  const liveDoc = useLiveDoc(id && isMdx ? { kind: 'mdx', id, locale: currentLocale } : null);
  const live = liveDoc.state === 'ready' ? liveDoc.live : undefined;
  const channel = useDocChannel();
  const [editorRoot, setEditorRoot] = useState<HTMLElement | null>(null);
  usePeerBlockOutlines(live?.docKey ?? '', editorRoot);
  const [preview, setPreview] = useState('');
  // The check reads the site's vocabulary as it is at each edit, without rebinding the editor.
  const checkInput = useRef({ vocabulary, descriptors });
  useLayoutEffect(() => {
    checkInput.current = { vocabulary, descriptors };
  });

  // The entry is the locale the doc was opened in: `live` changes only once a switched locale's doc is open, so a render
  // between the switch and that open must not tag the open editor's holds with the new locale.
  const entry = `${id}:${currentLocale}`;
  // biome-ignore lint/correctness/useExhaustiveDependencies: `entry` is read when `live` changes, see above.
  const bound = useMemo(() => {
    if (!live) return null;
    const text = live.doc.getText('body');
    const plugin = markdownLivePlugin({
      text,
      undoScope: [text],
      onSelectionBlock: (block) => channel?.setSelection(live.docKey, block === null ? null : `block:${block}`),
      onRootElement: setEditorRoot,
      held: channel
        ? {
            notice: () => (live.held ? channel.held() : null),
            content: () => channel.heldContent(live.docKey)?.mdx ?? '',
            subscribe: (onChange) => channel.on('status', onChange),
          }
        : undefined,
      check: (markdown) =>
        checkFragmentSave(markdown, checkInput.current.vocabulary, checkInput.current.descriptors)?.message ?? null,
      onHeld: (notice, markdown) => setHeldFragmentEdit(entry, live.docKey, notice, markdown),
    });
    return { text, value: text.toJSON(), plugins: [plugin] };
  }, [live, channel]);

  // A held edit from an earlier editor (a replaced doc, a locale switched back) is not put back: written over the body
  // now stored, it could undo a discard or restore or a teammate's change. It is offered to copy instead, still held;
  // a later one queues behind it, so none is dropped unseen.
  const [notAppliedQueue, setNotAppliedQueue] = useState<{ reason: string; markdown: string; docKey: string }[]>([]);
  const notApplied = notAppliedQueue[0];
  // Leaving asks until each text is copied or dismissed: it exists nowhere else.
  const closeNotApplied = () => {
    if (!notApplied) return;
    const rest = notAppliedQueue.slice(1);
    if (!rest.some((edit) => edit.docKey === notApplied.docKey)) setNotAppliedFragmentEdit(notApplied.docKey, null);
    setNotAppliedQueue(rest);
  };
  const boundEntry = useRef<string | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once per new editor; `entry` is its locale, see above.
  useEffect(() => {
    if (!live) return;
    const markdown = heldFragmentEdit(entry);
    const reason =
      boundEntry.current === entry ? 'the fragment was replaced (discarded or restored)' : 'the locale was switched';
    boundEntry.current = entry;
    if (markdown === undefined) return;
    setHeldFragmentEdit(entry, live.docKey, null, null);
    setNotAppliedFragmentEdit(live.docKey, 'Your unsent edit was not applied: copy it before you leave.');
    setNotAppliedQueue((queue) => [...queue, { reason, markdown, docKey: live.docKey }]);
  }, [live]);

  // The preview follows the shared body, teammates' changes included; the editor's own onChange adds a held edit.
  useEffect(() => {
    if (!bound) return undefined;
    const show = () => setPreview(bound.text.toJSON());
    show();
    bound.text.observe(show);
    return () => bound.text.unobserve(show);
  }, [bound]);

  const fragmentName = fragmentDisplayName(loaded, id);
  const filePath = `fragments/${fragmentName}`;
  useEffect(() => {
    const prev = document.title;
    document.title = `Edit: ${filePath} · Conloca CMS`;
    return () => {
      document.title = prev;
    };
  }, [filePath]);

  // A locale with no version is only "missing" after a switch; the locale the editor opens in must exist.
  const absent = !!currentLocale && !isPending && !loaded;
  const failure =
    error?.message ??
    (absent && chosenLocale === null ? 'Not found' : null) ??
    (loaded && !isMdx ? NOT_MDX : null) ??
    (liveDoc.state === 'failed' ? liveDoc.message : null);
  if (failure !== null) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-page gap-4">
        <div className="text-red-04 dark:text-red-08">Failed to load fragment: {failure}</div>
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

  const editing = !absent && live && bound ? { live, bound } : null;
  if (!absent && !editing) {
    return (
      <div className="flex items-center justify-center h-full bg-page">
        <div className="flex items-center gap-3 text-muted" role="status">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-azure-04" />
          <span>Loading fragment…</span>
        </div>
      </div>
    );
  }

  const draftPage = editing ? draftToolsPage(id, currentLocale) : null;
  return (
    <div className="h-full flex flex-col bg-page">
      <header className="flex items-center justify-between gap-4 px-4 py-2 border-b border-line bg-overlay shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <button
            type="button"
            onClick={() => navigate(backTarget)}
            aria-label={backLabel}
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
            onChange={setChosenLocale}
          />
          {editing && (
            <EditorChromeToggles previewOpen={previewOpen} onTogglePreview={() => setPreviewOpen(!previewOpen)} />
          )}
          {draftPage && <PageDraftMenu page={draftPage} label={fragmentName} />}
        </div>
      </header>
      {editing ? (
        <>
          <DraftNoticeStrip id={id} locale={currentLocale} docKey={editing.live.docKey} />
          <SharedFragmentBanner fromPage={fromPage} live />
          {notApplied && (
            <div
              role="alert"
              data-testid="held-edit-not-applied"
              className="flex items-center gap-3 px-4 py-2 bg-yellow-11 text-yellow-02 text-sm"
            >
              <span>
                Your unsent edit was not applied because {notApplied.reason}. This shows the fragment as stored now.
              </span>
              <button
                type="button"
                className="px-3 py-1 border border-line rounded"
                onClick={() => void navigator.clipboard.writeText(notApplied.markdown).then(closeNotApplied)}
              >
                Copy changes
              </button>
              <button type="button" className="px-3 py-1" onClick={closeNotApplied}>
                Dismiss
              </button>
            </div>
          )}
          <FragmentEditorSurface
            EditorComponent={CMSMDXEditor}
            editorKey={editing.live.docKey}
            content={editing.bound.value}
            // Live writes every change as made: the Diff view compares with the text opened, as the page editor's does.
            savedContent={editing.bound.value}
            preview={preview}
            resolvedTheme={resolvedTheme}
            previewOpen={previewOpen}
            editorClassName={resolvedTheme === 'dark' ? 'dark-theme' : undefined}
            // The live plugin writes every change; there is nothing to save.
            onChange={(next) => setPreview(next)}
            onSave={undefined}
            extraPlugins={editing.bound.plugins}
          />
        </>
      ) : (
        <p className="p-8 text-center text-muted">No {currentLocale} version of this fragment yet.</p>
      )}
    </div>
  );
}

function SavedFragmentEditor({ EditorComponent = CMSMDXEditor }: FragmentEditorProps) {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const contentClient = getContentAPIClient();
  const updateContent = useUpdateLocalized();
  const { resolvedTheme } = useTheme();
  const { vocabulary } = useSiteRender();
  const descriptors = useOfferedMdxComponents();
  // Why the last save was refused without writing, for the host flush to report.
  const refusalRef = useRef<string | undefined>(undefined);

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

  const {
    data: loadedContent,
    isLoading,
    error,
    waitingForSave,
    waitError,
    retrySaveWait,
    markLocaleLoaded,
  } = useFragmentContent(id || '', currentLocale);
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
      const result = await trackFragmentSave(
        contentClient,
        id,
        currentLocale,
        updateContent.mutateAsync({
          id,
          locale: currentLocale,
          data: { content: { mdx: newContent } },
          etag: forceEtag ?? currentEtagRef.current,
        }),
      );

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
        refusalRef.current = undefined;
        if (!isContentLoaded || routeIdentityChanged || identity.id !== id || identity.locale !== currentLocale) {
          return Promise.resolve('error');
        }
        if (forceEtag === undefined && newContent === savedContentRef.current) return Promise.resolve('saved');
        const committed = flushRef.current;
        const refusal = checkFragmentSave(newContent, committed.vocabulary, committed.descriptors);
        if (refusal) {
          setErrorOperation('save');
          showError(refusal.message);
          setSaveState('error');
          refusalRef.current = refusal.message;
          return Promise.resolve('error');
        }
        return writeContent(newContent, identity, forceEtag);
      },
      () => saveIdentityRef.current === identity,
    );
  };

  const discardedBufferRef = useRef<{ identity: typeof saveIdentityRef.current; content: string } | null>(null);
  const flushRef = useRef({ content, isDirty, persist, waitingForSave, contentClient, vocabulary, descriptors });
  useLayoutEffect(() => {
    // The host must read the committed buffer and request, never an abandoned route render.
    const discarded = discardedBufferRef.current;
    const bufferDiscarded = discarded?.identity === saveIdentityRef.current && discarded.content === content;
    const hostDirty = isDirty && !routeIdentityChanged && !bufferDiscarded;
    const dirtyChanged = flushRef.current.isDirty !== hostDirty;
    flushRef.current = {
      content,
      isDirty: hostDirty,
      persist,
      waitingForSave,
      contentClient,
      vocabulary,
      descriptors,
    };
    if (dirtyChanged) notifyEditorDirtyChanged();
  });

  useEffect(() => {
    return registerEditorFlushHandler(
      async () => {
        const identity = saveIdentityRef.current;
        let committed = flushRef.current;
        // A previous editor's write can be discovered before its queued waiting-state render commits.
        const previousEditorSave =
          pendingSaveRef.current?.identity !== identity &&
          pendingFragmentSave(committed.contentClient, identity.id || '', identity.locale);
        if (committed.waitingForSave || previousEditorSave) {
          return { ok: false, message: 'Fragment changes are still loading.' };
        }
        while (committed.isDirty || pendingSaveRef.current?.identity === identity) {
          // oxlint-disable-next-line no-await-in-loop -- Each write needs the ETag returned by the previous save.
          const status = await committed.persist(committed.content);
          if (status !== 'saved' || saveIdentityRef.current !== identity) {
            return { ok: false, message: refusalRef.current ?? 'Could not save editor changes.' };
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
    const ownsIntent = () => exitIntentRef.current === intent && saveIdentityRef.current === identity;

    try {
      await waitForFragmentSave(pendingFragmentSave(contentClient, id, newLocale));
      if (!ownsIntent()) return;
      const newLocaleContent = await contentClient.getLocalized(id, newLocale);
      if (!ownsIntent()) return;
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
      markLocaleLoaded(newLocale);
      setCurrentLocale(newLocale);
      setPendingLocaleSwitch(null);
    } catch (err) {
      if (!ownsIntent()) return;
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
      <FragmentLoading
        waitingForSave={waitingForSave}
        waitError={waitError}
        onRetry={retrySaveWait}
        backLabel={backLabel}
        onBack={handleBack}
      />
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
      <DraftNoticeStrip id={id} locale={currentLocale} />
      <SharedFragmentBanner fromPage={fromPage} />
      <FragmentEditorSurface
        EditorComponent={EditorComponent}
        editorKey={`${id}-${currentLocale}`}
        content={content}
        savedContent={savedContentRef.current}
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

function FragmentLoading({
  waitingForSave,
  waitError,
  onRetry,
  backLabel,
  onBack,
}: {
  waitingForSave: boolean;
  waitError: string | undefined;
  onRetry: () => void;
  backLabel: string;
  onBack: () => void;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center h-full bg-page gap-4')}>
      {waitError ? (
        <>
          <p className={cn('px-4 text-center text-muted')} role="alert">
            {waitError}
          </p>
          <button
            type="button"
            onClick={onRetry}
            className={cn('px-4 py-2 bg-azure-04 text-white rounded-md hover:bg-azure-03 transition-colors')}
          >
            Retry
          </button>
        </>
      ) : (
        <div className={cn('flex items-center gap-3 text-muted')} role="status">
          <div className={cn('animate-spin rounded-full h-6 w-6 border-b-2 border-azure-04')} />
          <span>{waitingForSave ? 'Finishing previous save…' : 'Loading fragment…'}</span>
        </div>
      )}
      {waitingForSave && (
        <button
          type="button"
          onClick={onBack}
          className={cn(
            'px-4 py-2 text-muted rounded-md hover:bg-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 transition-colors',
          )}
        >
          {backLabel}
        </button>
      )}
    </div>
  );
}

type FragmentLoad = ReturnType<typeof useFragmentContent>;

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

function SharedFragmentBanner({ fromPage, live = false }: { fromPage: boolean; live?: boolean }) {
  return (
    fromPage && (
      <div
        className="flex items-start gap-2 px-4 py-2 border-b border-yellow-08 dark:border-yellow-03 bg-yellow-11 dark:bg-yellow-02 text-sm text-yellow-02 dark:text-yellow-09 shrink-0"
        role="status"
        data-testid="shared-fragment-banner"
      >
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          {live
            ? 'This is a shared fragment. Your changes reach every page that uses it.'
            : 'This is a shared fragment. Saving updates every page that uses it.'}
        </span>
      </div>
    )
  );
}

interface FragmentEditorSurfaceProps {
  EditorComponent: ElementType<CMSMDXEditorProps>;
  editorKey: string;
  content: string;
  savedContent: string;
  resolvedTheme: ReturnType<typeof useTheme>['resolvedTheme'];
  previewOpen: boolean;
  editorClassName: string | undefined;
  onChange: CMSMDXEditorProps['onChange'];
  onSave: CMSMDXEditorProps['onSave'];
  /** What the live preview renders; `content` by default. */
  preview?: string;
  extraPlugins?: CMSMDXEditorProps['extraPlugins'];
}

function FragmentEditorSurface({
  EditorComponent,
  editorKey,
  content,
  savedContent,
  resolvedTheme,
  previewOpen,
  editorClassName,
  onChange,
  onSave,
  preview = content,
  extraPlugins,
}: FragmentEditorSurfaceProps) {
  // The props panel reads a selection shared across editors; a block from another or a disposed editor must not show.
  // biome-ignore lint/correctness/useExhaustiveDependencies: clear again when the editor remounts under a new key.
  useEffect(() => {
    setSelectedBlock(null);
    return () => setSelectedBlock(null);
  }, [editorKey]);
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
          fragment
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
          diffMarkdown={savedContent}
          previewRouteUrl={fragmentPreviewPathname()}
          onChange={onChange}
          onSave={onSave}
          extraPlugins={extraPlugins}
          className={editorClassName}
          autoFocus
          placeholder="Start writing your fragment…"
        />
      </div>
      <JsxPropsPanel />
      {previewOpen && (
        <div className="w-1/2 min-w-0 overflow-auto border-l border-line bg-panel">
          <MDXLivePreview markdown={preview} />
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
