import type { LocalizedEntry, UpdateResult } from '@conloca/content-api-client';
import type { Config } from '@puckeditor/core';
import { Puck } from '@puckeditor/core';
import { Monitor, Smartphone, Tablet } from 'lucide-react';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useSiteBaseUrl } from '../../hooks';
import { useCanvasTheme } from '../../hooks/useCanvasTheme';
import { useSiteStyles } from '../../site-styles';
import type { SaveState } from '../../types';
import { ConflictDialog } from '../dialogs/ConflictDialog';
import { ImageFieldRender } from '../fields/ImageField';
import { DrawerItemOverride } from './DrawerItemOverride';
import { PageEditorHeaderActions } from './PageEditorHeaderActions';

interface PageEditorProps {
  pageId: string;
  entry: LocalizedEntry; // The full localized entry
  config: Config; // Puck config
  metadata?: Record<string, unknown>; // DataContext for data-bound components (passed to Puck resolveData)
  availableLocales: string[];
  onSave: (data: any, forceEtag?: string) => Promise<UpdateResult>;
  onBack: () => void;
  onOpenMetadata: () => void;
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
 *    Puck's internal `CopyHostStyles` runs `doc.head.innerHTML = ''` once
 *    on mount inside an async `Promise.all().then(...)`. Because React
 *    fires child effects before parent effects, that wipe lands AFTER
 *    this component's initial append. A `MutationObserver` re-injects
 *    the tags when it sees them removed, so the injection survives the
 *    wipe (and any future host-head mirrors). The observer re-fires on
 *    our own re-appends too, but it short-circuits when nothing of ours
 *    was removed, so there is no loop.
 *
 * Defined at module scope so `overrides` keeps a stable reference (see
 * the `useMemo` below); state flows in via React context / subscribers,
 * not via closures — this keeps field components from remounting on
 * every keystroke.
 */
function IframeBridge({ children, document: iframeDoc }: { children: React.ReactNode; document?: Document }) {
  const { canvasTheme } = useCanvasTheme();
  const siteStyles = useSiteStyles();

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
    if (!iframeDoc?.head) return;
    const head = iframeDoc.head;
    let tags: HTMLStyleElement[] = [];

    // Unlayered reset that re-asserts the site's font over cms-spa's
    // `main.css` rule `html, body { font-family: var(--puck-font-family) }`
    // (which Puck's CopyHostStyles mirrors into this iframe). main.css's rule
    // is unlayered and therefore beats site `@layer base { body { ... } }`
    // declarations at equal specificity. We win back by using `:root` (one
    // specificity class higher than `html`) while falling back to the cms-spa
    // default if the site did not define `--font-sans`, so consumers without
    // a font token keep the previous behavior.
    const bridgeReset = ':root, body { font-family: var(--font-sans, var(--puck-font-family, system-ui)); }';

    // Wrap site CSS in a top-level `conloca-site` layer declared AFTER
    // `cms-admin` (main.css declares top-level order `base, …, cms-admin`).
    // Without this, cms-spa's mirrored `main.css` includes Tailwind's `*`
    // preflight inside `@layer cms-admin.base` — which outranks any rule
    // the site places in `@layer utilities` (utility padding, margin, border,
    // etc. all collapse to the `* { padding: 0 }` reset). Re-homing site CSS
    // in `conloca-site` (the new highest top-level layer) restores the
    // expected cascade so site utilities beat the preflight reset.
    //
    // The site's own `@import url(...)` statements must stay at the top of
    // the stylesheet — hoist them out of the wrapping block. `url(...)` is
    // the only import shape Tailwind v4 emits, and its URL may contain `;`
    // (Google Fonts query strings), so the regex closes on `)` before `;`
    // to avoid truncating the import mid-URL.
    const wrapSiteCSS = (css: string): string => {
      const imports: string[] = [];
      const cleaned = css.replace(/@import\s+url\([^)]*\)[^;]*;/g, (m) => {
        imports.push(m.trim());
        return '';
      });
      return `${imports.join('\n')}\n@layer conloca-site;\n@layer conloca-site {\n${cleaned}\n}`;
    };

    const inject = () => {
      tags = siteStyles.map((css) => {
        const tag = iframeDoc.createElement('style');
        tag.setAttribute('data-conloca-site-styles', '');
        tag.textContent = wrapSiteCSS(css);
        head.appendChild(tag);
        return tag;
      });
      if (siteStyles.length > 0) {
        const resetTag = iframeDoc.createElement('style');
        resetTag.setAttribute('data-conloca-site-styles', 'bridge-reset');
        resetTag.textContent = bridgeReset;
        head.appendChild(resetTag);
        tags.push(resetTag);
      }
    };

    inject();

    const observer = new MutationObserver((mutations) => {
      // Use `nodeType === 1` (Node.ELEMENT_NODE) + duck-typing instead of
      // `instanceof HTMLElement`: the removed nodes belong to the iframe's
      // realm, and its `HTMLElement` class is not the same identity as the
      // parent frame's `HTMLElement`, so `instanceof` returns false here.
      const lostOurs = mutations.some((m) =>
        Array.from(m.removedNodes).some(
          (n) => n.nodeType === 1 && (n as Element).getAttribute?.('data-conloca-site-styles') !== null,
        ),
      );
      if (!lostOurs) return;
      inject();
    });
    observer.observe(head, { childList: true });

    return () => {
      observer.disconnect();
      for (const tag of tags) tag.remove();
    };
  }, [iframeDoc, siteStyles]);

  return <>{children}</>;
}

export function PageEditor({
  pageId,
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
  const [data, setData] = useState(entry.localized.content.puckData);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [isDirty, setIsDirty] = useState(false);
  const [conflict, setConflict] = useState<UpdateResult | null>(null);

  // Use ref for data in handleSave to keep handleSave referentially stable.
  // Without this, handleSave would depend on `data` (which changes every keystroke),
  // causing the memoized overrides to invalidate and Puck to remount field components.
  const dataRef = useRef(data);
  dataRef.current = data;

  const isSavingRef = useRef(false);

  const handleSave = useCallback(
    async (forceEtag?: string) => {
      if (isSavingRef.current) return;
      isSavingRef.current = true;
      setSaveState('saving');
      try {
        const result = await onSave(dataRef.current, forceEtag);
        if (result.success) {
          setSaveState('saved');
          setIsDirty(false);
          setConflict(null);
        } else if (result.reason === 'stale_write') {
          setSaveState('conflict');
          setConflict(result);
        } else {
          setSaveState('error');
        }
      } catch (error: unknown) {
        console.error('[PageEditor] Save failed:', error);
        setSaveState('error');
      } finally {
        isSavingRef.current = false;
      }
    },
    [onSave],
  );

  const handleDataChange = useCallback((newData: any) => {
    setData(newData);
    setIsDirty(true);
    setSaveState('idle');
  }, []);

  const { buildUrl } = useSiteBaseUrl();

  const handlePreview = useCallback(() => {
    const pathname = entry.localized.pathname || '/';
    const previewUrl = buildUrl(pathname);
    const cacheBustedUrl = `${previewUrl}${previewUrl.includes('?') ? '&' : '?'}_t=${Date.now()}`;
    window.open(cacheBustedUrl, '_blank');
  }, [entry.localized.pathname, buildUrl]);

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
            onOpenMetadata={p.onOpenMetadata}
            onBack={p.onBack}
          />
        );
      },
      drawerItem: drawerItemOverride,
      iframe: IframeBridge,
    }),
    [],
  );

  // Handle keyboard shortcuts
  React.useEffect(() => {
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
    <div className="h-screen flex flex-col bg-grey-11 dark:bg-grey-03">
      {/* Puck Editor with custom header */}
      <div className="flex-1 overflow-auto min-h-0">
        <Puck
          config={config}
          data={data}
          metadata={metadata}
          onChange={handleDataChange}
          headerTitle={entry.localized.meta.title || 'Untitled Page'}
          viewports={viewports}
          overrides={overrides}
        />
      </div>

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
