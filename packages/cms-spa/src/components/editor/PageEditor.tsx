import type { DataContext, LocalizedEntry, UpdateResult } from '@conloca/content-api-client';
import { type Config, createUsePuck } from '@puckeditor/core';
import { Monitor, Smartphone, Tablet } from 'lucide-react';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { notifyEditorDirtyChanged, registerEditorFlushHandler } from '../../editor-flush.js';
import { useSiteBaseUrl } from '../../hooks/index.js';
import { useCanvasTheme } from '../../hooks/useCanvasTheme.js';
import { useUnsavedChangesGuard } from '../../hooks/useUnsavedChangesGuard.js';
import { wrapSiteCSS } from '../../site-css-layer.js';
import { useSiteStyles } from '../../site-styles.js';
import type { SaveState } from '../../types.js';
import { getUIConfig, setPreviewCapability } from '../../ui-config.js';
import { ConflictDialog } from '../dialogs/ConflictDialog.js';
import { UnsavedChangesDialog } from '../dialogs/UnsavedChangesDialog.js';
import { ImageFieldRender } from '../fields/ImageField.js';
import { toast } from '../toast.js';
import { DrawerItemOverride, PUCK_ROOT_DROP_ZONE } from './DrawerItemOverride.js';
import { withDraftMediaRendering } from './draft-media-config.js';
import { PageEditorHeaderActions } from './PageEditorHeaderActions.js';
import { PuckWithUntouchedMetadata } from './PuckWithUntouchedMetadata.js';
import {
  FieldsWithPageSettingsHint,
  PageSettingTargetsProvider,
  usePageSettingTargets,
} from './page-setting-targets.js';
import { PREVIEW_UNAVAILABLE_DETAIL, PREVIEW_UNAVAILABLE_TITLE } from './preview-availability.js';

interface PageEditorProps {
  entry: LocalizedEntry; // The full localized entry
  config: Config; // Puck config
  metadata?: DataContext; // The page's data context, for every block's resolveData and render
  availableLocales: string[];
  onSave: (data: any, forceEtag?: string) => Promise<UpdateResult>;
  onBack: () => void;
  /** Opens Page settings; `field` is a page setting a block showed on the canvas, to open the dialog at. */
  onOpenMetadata: (field?: string) => void;
  onLocaleChange?: (locale: string) => void;
  onReload?: () => void;
  onPublish?: () => void;
}

const viewports = [
  { width: 375, height: 'auto' as const, label: 'Mobile', icon: <Smartphone size={16} /> },
  { width: 768, height: 'auto' as const, label: 'Tablet', icon: <Tablet size={16} /> },
  { width: 1280, height: 'auto' as const, label: 'Desktop', icon: <Monitor size={16} /> },
];

/**
 * The canvas options, a module constant on purpose. `<Puck>` re-runs its canvas viewport effect whenever `iframe`
 * changes identity (https://github.com/puckeditor/puck/pull/1864, open against 0.23), and while the undo history
 * still holds only its first entry that effect overwrites the entry with the page as it is by then. This editor
 * re-renders on every edit, so an inline object would replace the loaded page in the history with the result of the
 * first edit before Puck records that edit: Undo would then flip the history buttons and leave the edit on the canvas.
 *
 * The canvas shows the SITE, so it gets the site's stylesheets and nothing else. Puck's default mirrors this admin
 * document's head into the iframe, which for a consumer whose editor and site are separate apps means the CMS
 * chrome's own CSS lands on top of the page being edited — Tailwind's preflight there flattens headings the site
 * styles by element rather than by utility class.
 */
const CANVAS_IFRAME = { syncHostStyles: false };

/**
 * Stable field type overrides for Puck.
 * Defined at module level to maintain referential stability across renders.
 * This prevents Puck from re-creating field components on every render,
 * which would cause input focus loss on each keystroke.
 */
const fieldTypeOverrides = {
  image: ({ onChange, value }: { onChange: (val: string) => void; value: string }) => (
    <ImageFieldRender value={value || ''} onChange={onChange} />
  ),
  text: ({
    value,
    onChange,
    children,
    field,
  }: {
    value: string;
    onChange: (val: string) => void;
    children: React.ReactNode;
    field: { metadata?: { fieldKind?: string } };
  }) => {
    if (field?.metadata?.fieldKind === 'image') {
      return <ImageFieldRender value={value || ''} onChange={onChange} />;
    }
    // Non-image text fields: render default Puck field
    return <>{children}</>;
  },
};

const drawerItemOverride = ({ children, name }: { children: React.ReactNode; name: string }) => (
  <DrawerItemOverride name={name}>{children}</DrawerItemOverride>
);

/** On the canvas's scaled-down view (about half size) this still reads at a normal text size. */
const EMPTY_PAGE_HINT_FONT_SIZE = '24px';

const EMPTY_PAGE_HINT = 'Drag a block here, or double-click one in the list';

const EMPTY_PAGE_HINT_DECLARATIONS = [
  `content: ${JSON.stringify(EMPTY_PAGE_HINT)}`,
  'display: flex',
  'align-items: center',
  'justify-content: center',
  'box-sizing: border-box',
  'height: 100%',
  'min-height: inherit',
  'padding: 16px',
  'text-align: center',
  'font-family: var(--puck-font-family)',
  `font-size: ${EMPTY_PAGE_HINT_FONT_SIZE}`,
  'color: var(--puck-color-grey-05)',
].join('; ');

const CAN_INSERT_ATTRIBUTE = 'data-conloca-can-insert';
const CAN_INSERT_SELECTOR = `html[${CAN_INSERT_ATTRIBUTE}]`;

/**
 * An editing rule the preview canvas gets from the CMS. The <Puck> below
 * opts out of Puck's host-style mirror, so main.css never reaches the canvas;
 * IframeBridge injects this instead.
 *
 * Puck paints an empty drop area with its selection tint so it reads as a drop
 * target. On a new page the empty root area fills the canvas, so that tint
 * reads as a blue page background. An empty area keeps only Puck's dashed
 * outline, in grey. The colours are set through Puck's slot theming tokens,
 * which Puck's own drop-area rules read, and only on `:empty` areas: an area
 * holding blocks, or one showing a drop preview (Puck inserts the preview as
 * a child), keeps Puck's highlight. `[data-puck-dropzone]` is the attribute
 * Puck puts on every drop area; matching class names would also catch Puck's
 * drop-position line and hide it.
 *
 * A page with no blocks also says how to add one: the empty root area is the
 * whole canvas, so a line of text centred in it is where an author looks first.
 * It is the area's `::before`, so it goes as soon as the area holds a block or
 * a drop preview, and it never becomes content that can be saved. It is sized
 * for the canvas's scaled-down view, where it must stay readable. It shows in
 * edit mode only (the interactive preview renders the published page) and only
 * while the editor marks the canvas as one that can take a block, because both
 * ways the hint names do nothing when no block may be inserted.
 */
const EMPTY_DROP_AREA_CSS = [
  '[data-puck-dropzone]:empty { --puck-slot-color-bg: transparent; --puck-slot-color-border: var(--puck-color-grey-07); }',
  `${CAN_INSERT_SELECTOR} [data-puck-entry][data-puck-preview-mode="edit"] [data-puck-dropzone="${PUCK_ROOT_DROP_ZONE}"]:empty::before { ${EMPTY_PAGE_HINT_DECLARATIONS} }`,
].join('\n');

const usePuck = createUsePuck();

/** Whether any block may be added to the page: the hint's two ways of adding one both need it. */
function usePageCanTakeAnInsert(): boolean {
  return usePuck((state) => Object.keys(state.config.components).some((type) => state.getPermissions({ type }).insert));
}

/**
 * Bridges CMS editor state into Puck's preview iframe.
 *
 * 1. Propagates the author's canvas theme (light/dark) onto the iframe's
 *    `<html>` via the `.dark` class + `color-scheme` — the iframe has its
 *    own document so the host theme does not cascade in automatically.
 *
 * 2. Injects host-site CSS (registered via `useSiteStyles`) directly into
 *    the iframe `<head>` as `<style data-conloca-site-styles>` tags. This
 *    keeps the site's CSS out of the CMS admin's parent document, so host
 *    rules (e.g. `body { color: var(...) }`) cannot cascade into Puck's
 *    chrome — the iframe is the only intended consumer.
 *
 *    The `<Puck>` below turns off Puck's host-style mirror (`CANVAS_IFRAME`),
 *    so the iframe head holds only Puck's own interaction CSS, the
 *    empty-drop-area rule (point 3), the page-setting cursor rule (point 4)
 *    and these tags. Nothing else touches them, so they are appended on
 *    every `siteStyles` change and removed on cleanup.
 *
 * 3. Injects `EMPTY_DROP_AREA_CSS` once per iframe document.
 *
 * 4. Makes the parts blocks mark with pageSettingAttributes clickable in edit
 *    mode: Puck overlay portals with a pointer cursor; a click opens Page
 *    settings at that field (for example `publishAt` for a printed post date).
 *
 * Defined at module scope so `overrides` keeps a stable reference (see
 * the `useMemo` below); state flows in via React context / subscribers,
 * not via closures — this keeps field components from remounting on
 * every keystroke.
 */
export function IframeBridge({ children, document: iframeDoc }: { children: React.ReactNode; document?: Document }) {
  const { canvasTheme } = useCanvasTheme();
  const siteStyles = useSiteStyles();
  usePageSettingTargets(iframeDoc);

  React.useEffect(() => {
    if (!iframeDoc?.documentElement) return;
    const html = iframeDoc.documentElement;
    html.classList.toggle('dark', canvasTheme === 'dark');
    // Many Astro sites key dark tokens off `[data-theme="dark"]` (Starlight,
    // shadcn patterns, custom theme setups). Set both so the preview matches
    // the site's active scheme regardless of which convention it uses.
    html.setAttribute('data-theme', canvasTheme);
    // Signals the browser to pick a sensible default canvas color when the
    // site's Layout (which usually applies `body { background: ... }`) isn't
    // wrapping the Puck content. Sites that want an exact match should set
    // body background-color via their own CSS.
    html.style.colorScheme = canvasTheme;
  }, [iframeDoc, canvasTheme]);

  React.useEffect(() => {
    if (!iframeDoc?.head) return undefined;
    const head = iframeDoc.head;

    // Site CSS is re-homed into one top-level `conloca-site` layer. Puck's
    // tokens live in `@layer puck-tokens` and its overlay and selection
    // rules are unlayered, so a site wrapped in one layer can never override
    // the editing controls. The site's own layers keep their internal order
    // as `conloca-site.*`.
    //
    // The hoisting rules live in `wrapSiteCSS` — see that module for why
    // `@import` and `@property` must escape the layer block. Extracted so
    // they can be unit-tested: both were silently dropping real declarations
    // here, which made a correctly served stylesheet look inert.
    const tags = siteStyles.map((css) => {
      const tag = iframeDoc.createElement('style');
      tag.setAttribute('data-conloca-site-styles', '');
      tag.textContent = wrapSiteCSS(css);
      head.appendChild(tag);
      return tag;
    });

    return () => {
      for (const tag of tags) tag.remove();
    };
  }, [iframeDoc, siteStyles]);

  // Its own tag, not a site-styles one: this is the editor's rule, present
  // whether or not the site registers styles. It stays unlayered, so no site
  // rule in `conloca-site` can override it.
  React.useEffect(() => {
    if (!iframeDoc?.head) return undefined;
    const tag = iframeDoc.createElement('style');
    tag.setAttribute('data-conloca-empty-drop-area', '');
    tag.textContent = EMPTY_DROP_AREA_CSS;
    iframeDoc.head.appendChild(tag);
    return () => tag.remove();
  }, [iframeDoc]);

  return <>{children}</>;
}

/**
 * `IframeBridge` for the canvas inside <Puck>: also marks the canvas document while the page can take a block, which
 * the empty-page hint in `EMPTY_DROP_AREA_CSS` waits for. Separate because the marker reads Puck's state, so it only
 * works inside <Puck>, while the bridge also renders on its own.
 */
function IframeWithInsertMarker({ children, document: iframeDoc }: { children: React.ReactNode; document?: Document }) {
  const canTakeAnInsert = usePageCanTakeAnInsert();
  React.useEffect(() => {
    const html = iframeDoc?.documentElement;
    if (!html) return undefined;
    html.toggleAttribute(CAN_INSERT_ATTRIBUTE, canTakeAnInsert);
    return () => html.removeAttribute(CAN_INSERT_ATTRIBUTE);
  }, [iframeDoc, canTakeAnInsert]);

  return <IframeBridge document={iframeDoc}>{children}</IframeBridge>;
}

export function PageEditor({
  entry,
  config,
  metadata,
  availableLocales,
  onSave,
  onBack,
  onOpenMetadata,
  onLocaleChange,
  onReload,
  onPublish,
}: PageEditorProps) {
  const draftAssetsBasePath = getUIConfig().draftAssetsBasePath;
  const renderConfig = useMemo(
    () => withDraftMediaRendering(config, draftAssetsBasePath),
    [config, draftAssetsBasePath],
  );
  const [data, setData] = useState(entry.localized.content.puckData);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [isDirty, setIsDirty] = useState(false);
  const [conflict, setConflict] = useState<UpdateResult | null>(null);

  // Use ref for data in handleSave to keep handleSave referentially stable.
  // Without this, handleSave would depend on `data` (which changes every keystroke),
  // causing the memoized overrides to invalidate and Puck to remount field components.
  const dataRef = useRef(data);
  dataRef.current = data;
  const isDirtyRef = useRef(isDirty);
  isDirtyRef.current = isDirty;

  // Returns a status so the unsaved-changes blocker can decide whether to
  // proceed (only on 'saved') or hand off to the conflict dialog without
  // sitting underneath it. Mirrors the PersistStatus pattern in FragmentEditor /
  // MdxPageEditor. Existing callers that ignore the return value are
  // unaffected.
  type PersistStatus = 'saved' | 'conflict' | 'error';
  const activeSaveRef = useRef<Promise<PersistStatus> | null>(null);

  const handleSave = useCallback(
    (forceEtag?: string): Promise<PersistStatus> => {
      // Coalescing only holds while nothing new has been asked for. A forced
      // save carries an etag the in-flight one does not, so handing back that
      // promise would silently drop the override; queue behind it instead.
      const inFlight = activeSaveRef.current;
      if (inFlight) {
        if (!forceEtag) return inFlight;
        return inFlight.then(() => handleSaveRef.current(forceEtag));
      }

      setSaveState('saving');
      const savePromise = Promise.resolve().then(async (): Promise<PersistStatus> => {
        try {
          // Snapshot the payload we send. Later keystrokes must not be marked saved when this response lands.
          const sent = dataRef.current;
          const result = await onSave(sent, forceEtag);
          if (result.success) {
            setConflict(null);
            if (dataRef.current === sent) {
              setSaveState('saved');
              setIsDirty(false);
              isDirtyRef.current = false;
              return 'saved';
            }
            // Edited mid-flight: still dirty, and the caller must not treat
            // this as a completed save. 'idle' matches what the keystroke's
            // handleDataChange set — flipping to 'saved' here painted a green
            // check over keystrokes that were never sent.
            setSaveState('idle');
            setIsDirty(true);
            isDirtyRef.current = true;
            return 'error';
          }
          if (result.reason === 'stale_write') {
            setSaveState('conflict');
            setConflict(result);
            return 'conflict';
          }
          setSaveState('error');
          return 'error';
        } catch (error: unknown) {
          console.error('[PageEditor] Save failed:', error);
          setSaveState('error');
          return 'error';
        }
      });
      activeSaveRef.current = savePromise;
      void savePromise.then(() => {
        if (activeSaveRef.current === savePromise) activeSaveRef.current = null;
      });
      return savePromise;
    },
    [onSave],
  );
  const handleSaveRef = useRef(handleSave);
  handleSaveRef.current = handleSave;
  // Host Save calls flushOpenEditor → this handler. Keep stable via refs so
  // re-registering does not thrash on every keystroke dirty flip.
  React.useEffect(() => {
    return registerEditorFlushHandler(
      async () => {
        const activeSave = activeSaveRef.current;
        if (!activeSave && !isDirtyRef.current) return { ok: true };
        const status = await (activeSave ?? handleSave());
        if (status === 'error' || status === 'conflict') {
          return { ok: false, message: 'Could not save editor changes.' };
        }
        return { ok: true };
      },
      { isDirty: () => isDirtyRef.current },
    );
  }, [handleSave]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: The dependency change is the event; handlers read current state through refs.
  React.useEffect(() => {
    notifyEditorDirtyChanged();
  }, [isDirty]);

  const handleDataChange = useCallback((newData: any) => {
    setData(newData);
    setIsDirty(true);
    setSaveState('idle');
  }, []);

  // Block in-app navigations (sidebar click, "Open fragment editor" from
  // MDXEditField, programmatic navigate) and warn on browser-level
  // unloads when the page has unsaved Puck edits. Same hook used by
  // FragmentEditor / MdxPageEditor — keeps unsaved-protection consistent
  // across the editor surface.
  const blocker = useUnsavedChangesGuard(isDirty);

  const { buildUrl } = useSiteBaseUrl();

  // Why the site cannot show a preview, or null when it can (or
  // when nobody has established otherwise). Seeded from `previewCapability`,
  // and then LEARNED from `openPreview`: its answer is the authority, so a
  // definitive "not deployed" disables the
  // control for the rest of the session instead of making the user rediscover
  // it one click at a time.
  const [previewBlockedReason, setPreviewBlockedReason] = useState<string | null>(() =>
    getUIConfig().previewCapability === 'unavailable' ? PREVIEW_UNAVAILABLE_DETAIL : null,
  );

  const handlePreview = useCallback(() => {
    const pathname = entry.localized.pathname || '/';
    const openPreview = getUIConfig().openPreview;
    if (openPreview) {
      // Already known to be impossible: explain it without flashing a blank
      // tab open and shut, which reads as a bug even when it is correct.
      if (previewBlockedReason !== null) {
        toast.error(PREVIEW_UNAVAILABLE_TITLE, { description: previewBlockedReason, duration: 10_000 });
        return;
      }
      // Popup blockers only allow window creation during the click itself.
      // `openPreview` answers asynchronously, so reserve a blank tab now and
      // navigate it once the preview URL arrives.
      const previewTab = window.open('', '_blank');
      if (!previewTab) {
        console.error('[PageEditor] openPreview failed:', new Error('Preview popup was blocked.'));
        return;
      }
      previewTab.opener = null;
      void openPreview({ path: pathname })
        .then((result) => {
          if (result.ok) {
            previewTab.location.href = result.url;
            return;
          }
          // The site does not serve draft preview, so no URL exists that could
          // work. Say so where the user is looking instead of navigating the
          // tab to a 404 on their own domain, and remember it so the control
          // goes disabled rather than staying a trap.
          previewTab.close();
          const detail = result.message !== '' ? result.message : PREVIEW_UNAVAILABLE_DETAIL;
          setPreviewBlockedReason(detail);
          setPreviewCapability('unavailable');
          toast.error(PREVIEW_UNAVAILABLE_TITLE, { description: detail, duration: 10_000 });
        })
        .catch((error: unknown) => {
          // A genuine failure, which is a DIFFERENT situation and must not
          // read as though the site is misconfigured. Not latched:
          // a transient fault must not disable a working button.
          previewTab.close();
          toast.error('Could not open preview', {
            description: 'Something went wrong creating the preview link. Please try again.',
          });
          console.error('[PageEditor] openPreview failed:', error);
        });
      return;
    }
    const previewUrl = buildUrl(pathname);
    const cacheBustedUrl = `${previewUrl}${previewUrl.includes('?') ? '&' : '?'}_t=${Date.now()}`;
    window.open(cacheBustedUrl, '_blank');
  }, [entry.localized.pathname, buildUrl, previewBlockedReason]);

  // Store headerActions props in a ref so the overrides object can remain referentially stable.
  // Puck's internals use the overrides reference as a useMemo dependency for field component selection.
  // If overrides changes, ALL field components unmount/remount, causing input focus loss.
  // By using a ref, headerActions always renders with current props without changing the overrides reference.
  const headerActionsPropsRef = useRef({
    onPublish,
    handlePreview,
    locale: entry.localized.locale,
    availableLocales,
    onLocaleChange,
    saveState,
    isDirty,
    handleSave,
    onOpenMetadata,
    onBack,
    previewBlockedReason,
  });
  headerActionsPropsRef.current = {
    onPublish,
    handlePreview,
    locale: entry.localized.locale,
    availableLocales,
    onLocaleChange,
    saveState,
    isDirty,
    handleSave,
    onOpenMetadata,
    onBack,
    previewBlockedReason,
  };

  // Memoize overrides with NO dependencies so the reference never changes.
  // This prevents Puck from re-creating field components on every render.
  // Without this, each keystroke triggers: onChange -> setData -> re-render -> new overrides ref ->
  // Puck store update -> field component unmount/remount -> focus loss.
  const overrides = useMemo(
    () => ({
      fieldTypes: fieldTypeOverrides,
      headerActions: () => {
        const p = headerActionsPropsRef.current;
        return (
          <PageEditorHeaderActions
            onPublish={p.onPublish}
            onPreview={p.handlePreview}
            currentLocale={p.locale}
            availableLocales={p.availableLocales}
            onLocaleChange={p.onLocaleChange}
            saveState={p.saveState}
            isDirty={p.isDirty}
            onSave={() => p.handleSave()}
            // Called with no field: the button's click event would otherwise arrive as one.
            onOpenMetadata={() => p.onOpenMetadata()}
            onBack={p.onBack}
            previewDisabledReason={p.previewBlockedReason ?? undefined}
          />
        );
      },
      drawerItem: drawerItemOverride,
      fields: FieldsWithPageSettingsHint,
      iframe: IframeWithInsertMarker,
    }),
    [],
  );

  // Handle keyboard shortcuts. When `hosted` is set, Cmd/Ctrl+S belongs to the
  // host app (which calls flushOpenEditor first); hideEditorSave suppresses editor
  // save UI entirely. Either way the editor must not double-handle the combo.
  React.useEffect(() => {
    const ui = getUIConfig();
    if (ui.hosted || ui.hideEditorSave) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleSave]);

  return (
    <div className="h-full min-h-0 overflow-y-auto flex flex-col bg-grey-11 dark:bg-grey-03">
      {/* Keep a usable canvas on very short screens; this region scrolls instead of crushing Puck's iframe. */}
      <div className="flex-1 min-h-[400px] overflow-hidden">
        <PageSettingTargetsProvider onOpen={onOpenMetadata}>
          {/* Not <Puck> itself: on the canvas Puck rewrites the page data it hands blocks; see PuckWithUntouchedMetadata.tsx. */}
          <PuckWithUntouchedMetadata
            config={renderConfig}
            data={data}
            metadata={metadata}
            onChange={handleDataChange}
            headerTitle={entry.localized.meta.title || 'Untitled Page'}
            viewports={viewports}
            overrides={overrides}
            iframe={CANVAS_IFRAME}
          />
        </PageSettingTargetsProvider>
      </div>

      {/* In-app navigation guard. beforeunload handles reload / tab close
          inside useUnsavedChangesGuard. */}
      {blocker.state === 'blocked' && (
        <UnsavedChangesDialog
          onSave={async () => {
            const status = await handleSave();
            if (status === 'saved') {
              blocker.proceed?.();
            } else if (status === 'conflict') {
              // Conflict dialog took over; release the blocker so it
              // doesn't sit underneath the conflict modal.
              blocker.reset?.();
            }
            // 'error' → keep the blocker so the user can retry or cancel;
            // matches FragmentEditor's behavior.
          }}
          onDiscard={() => blocker.proceed?.()}
          onCancel={() => blocker.reset?.()}
        />
      )}

      {/* Conflict Dialog */}
      {conflict && conflict.reason === 'stale_write' && (
        <ConflictDialog
          conflict={conflict}
          onReload={() => {
            setConflict(null);
            setSaveState('idle');
            onReload?.();
          }}
          onForceSave={async (etag) => {
            setConflict(null);
            // Force save with the current etag from the conflict
            await handleSave(etag);
          }}
          onCancel={() => {
            setConflict(null);
            setSaveState('idle');
          }}
        />
      )}
    </div>
  );
}
