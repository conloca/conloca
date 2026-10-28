import { useUploadAsset } from '@conloca/content-api-client';
import { BaseMDXEditor, type BaseMDXEditorProps } from '@conloca/mdx';
// The editor stylesheet; it pulls MDXEditor's own sheet in first. Position
// would not decide the cascade anyway: MDXEditor injects its CSS-module
// styles when it mounts, so they land later in the document either way.
// `editor-styles.css` wins by specificity instead — it chains
// `.conloca-prose` for (0,2,0) against MDXEditor's (0,1,0).
import '@conloca/mdx/style.css';
import type { JsxComponentDescriptor, MDXEditorMethods, RealmPlugin } from '@mdxeditor/editor';
import { forwardRef, useCallback, useMemo, useRef } from 'react';
import { useTheme } from '../../hooks/useTheme.js';
import { buildUploadFormData } from '../../hooks/useUpload.js';
import { useProbedHostStyles } from '../../host-style-probe.js';
import { isJsxDescriptor, toJsxComponentDescriptor, useMdxComponents } from '../../mdx-components.js';
import { deriveProseSurfaceStyles } from '../../prose-surface-css.js';
import {
  type SiteStyles,
  useEditorStyles,
  useFetchedHostWrappers,
  useFetchedSiteStyles,
  useInjectHostStyles,
  useSiteStyles,
} from '../../site-styles.js';
import { getUIConfig, inEditorFrame } from '../../ui-config.js';
import { buildAssetRef } from '../../utils/asset-url.js';
import { draftImagePreview } from './draft-media-config.js';
import { GenericBlock } from './GenericBlock.js';
import { hostWrapperPlugin } from './host-wrapper-plugin.js';
import { ImagePickerDialog } from './ImagePickerDialog.js';
import { InsertMdxComponentButton } from './insert-menu/InsertMdxComponentButton.js';
import { mdxComponentsPlugin } from './insert-menu/mdx-components-plugin.js';

const EDITOR_CSS: string = import.meta.env.CONLOCA_EDITOR_CSS || '';

export interface CMSMDXEditorProps
  extends Omit<
    BaseMDXEditorProps,
    | 'disableImageSettingsButton'
    | 'extraPlugins'
    | 'extraToolbarItems'
    | 'imageButtonRef'
    | 'imageDialog'
    | 'imageUploadHandler'
    | 'jsxComponentDescriptors'
    | 'onImageShortcut'
  > {
  /**
   * Route URL whose styles should be applied in the editor (eg `/getting-started/`).
   * When set, the editor fetches the host's real CSS for that route from
   * the CMS integration's `/api/styles` endpoint and injects it. Falls back
   * to the static `editorStyles` registry if unset or the fetch fails.
   */
  previewRouteUrl?: string;
}

export const CMSMDXEditor = forwardRef<MDXEditorMethods, CMSMDXEditorProps>(({ previewRouteUrl, ...props }, ref) => {
  const insertImageRef = useRef<HTMLButtonElement>(null);
  const uploadAsset = useUploadAsset();
  const registeredMdxComponents = useMdxComponents();
  // Style injection has two paths:
  //
  // 1. `useFetchedSiteStyles(previewRouteUrl)` — auto-discovery. When a
  //    route URL is provided, ask the integration for that route's full
  //    effective CSS (Tailwind, theme, scoped styles) so the editor
  //    matches the published page without the host curating a list.
  // 2. `useEditorStyles()` — the original, manually-configured narrow path.
  //    Fallback when no route URL is available or the fetch fails.
  //
  // Full host CSS must stay inside the editor surface. Site styles often
  // contain bare `h1`, `button`, and Tailwind reset rules that would otherwise
  // restyle the admin header and any host app around it.
  //
  // Inside a parent frame the dev-server endpoints do not exist, so the
  // probe's load of the real page stands in for them (see `routeStyles`).
  const inFrame = inEditorFrame();
  const devServerRouteUrl = inFrame ? undefined : previewRouteUrl;
  const fetchedStyles = useFetchedSiteStyles(devServerRouteUrl);
  const staticEditorStyles = useEditorStyles();
  // Probe the host's computed styles for each prose tag from the
  // actual live page and synthesize a stylesheet scoped to the
  // editor's contenteditable. This catches what the wrapper auto-
  // copy misses: utility-class-styled elements (Tailwind utility-
  // first), inline `style` attributes, and any other styling that
  // resolves to computed values but isn't reachable via a wrapper-
  // and-descendant cascade. The probe takes the discovered wrapper
  // class so it queries the same element inside the iframe — avoids
  // duplicate find-wrapper logic. `css` is empty while the probe is in
  // flight AND when the page has nothing probable; gate fallbacks on
  // `settled`, not on the empty string alone, or the derived tier
  // paints first and flips when the probe lands.
  // Discover the host page's content-root shape (eg `<article class="card">`
  // on Starlight) AND its code-block chrome wrapper (eg `<div class=
  // "expressive-code">`). The editor wraps its contenteditable in a clone
  // of `content` via `hostWrapperPlugin`, so host CSS paints the prose
  // surface naturally. It also threads `codeBlock` through to the
  // code-block frame component (in @conloca/mdx) so it can carry the host's
  // code-block classes and inherit the host's code-block CSS the same way.
  const fetchedWrappers = useFetchedHostWrappers(devServerRouteUrl);
  // Editor and published page maintain independent theme preferences
  // (CMS SPA → `conloca-theme`; Starlight → `starlight-theme`). The
  // probe needs to capture styles in the EDITOR's current scheme, not
  // the published page's, so we pass our resolved theme through. When
  // the user toggles theme inside the editor, the hook's dep on
  // `theme` re-runs the probe and the new computed values land.
  const { resolvedTheme } = useTheme();
  const probe = useProbedHostStyles(previewRouteUrl, fetchedWrappers.content?.className ?? null, {
    theme: resolvedTheme,
    discover: inFrame,
  });
  const { css: probedStyles, settled: probeSettled } = probe;
  // The route's own CSS and wrappers: from the dev endpoints locally, from the
  // page the probe loaded in a frame.
  const routeStyles = inFrame ? probe.styles : fetchedStyles;
  const hostWrappers = inFrame ? probe.wrappers : fetchedWrappers;
  // First tier with content wins: live discovery, then the manually-configured
  // path.
  const activeStyles = routeStyles.length > 0 ? routeStyles : staticEditorStyles;
  // The editor mounts directly in the parent SPA's React tree, so the broad
  // stylesheet is confined to `.conloca-mdx-editor-surround` below. The
  // content still receives the site's complete cascade while adjacent admin
  // chrome keeps its own tokens and utilities.
  //
  // The host can also append raw CSS via the integration's `editorCSS`
  // option (see `ConlocaCMSOptions`) — concatenated AFTER auto-
  // discovered styles so it sits later in the same cascade layer and
  // wins on tie-breaks. Empty string when the host didn't set it; no
  // marker `<style>` is emitted for the no-op case.
  const editorCss = getUIConfig().editorCss ?? EDITOR_CSS;
  const styleStack = useMemo<SiteStyles>(
    () => (editorCss ? [...activeStyles, editorCss] : activeStyles),
    [activeStyles, editorCss],
  );
  const probedStack = useMemo<SiteStyles>(() => (probedStyles ? [probedStyles] : []), [probedStyles]);
  // Injected here, AFTER the probe has been read, so the bridge inside this
  // hook can be gated on it. Head order is unchanged: this tier still lands
  // before `conloca-host-defaults` below, and the two never compete anyway —
  // this one is layered, that one deliberately is not.
  //
  // `bridgeHostVars` is the gate. Both this bridge and the probe publish the
  // same `--conloca-host-*` typography contract, and this one writes inline
  // properties on `<html>` while the probe emits a `:root` rule — so without
  // the gate the bridge would outrank the probe purely because inline beats a
  // stylesheet. The probe reads the REAL rendered page; it must win wherever
  // it works, which is every editor served by the site's dev server. The bridge
  // is the fallback where the probe cannot run at all (a site on a different
  // origin from the editor, or a production build with no dev server).
  useInjectHostStyles('conloca-host-preview', styleStack, {
    scopeSelector: '.conloca-mdx-editor-surround',
    // Fallback bridge only after the probe has settled empty. While the
    // probe is in flight, leave the contract unset rather than publishing
    // derived vars that the probe will immediately overwrite.
    bridgeHostVars: probeSettled && probedStyles === '',
  });
  useInjectHostStyles('conloca-host-defaults', probedStack, { layered: false });
  // Production styles tier: prose-safe rules derived from the siteStyles
  // registry (the siteStyles option's CSS) plus a paper base. Fallback ONLY —
  // when the discovery endpoint delivered (dev server), this stays empty so
  // discovery-styled surfaces keep their host-painted look, paper included.
  // Unlayered for the same reason as the probe stack: the editor's default
  // prose scale is unlayered and would beat any layered override.
  const siteStyles = useSiteStyles();
  const proseSurface = useMemo<SiteStyles>(
    // Derived from the siteStyles registry, the host CSS the surface shows.
    //
    // It must run ALONGSIDE the layered host CSS, not instead of it. That CSS is
    // injected into a cascade LAYER, the editor's default prose scale is
    // unlayered, and layered always loses to unlayered — so the layered tier
    // alone cannot restore heading metrics. This tier is the prose-scoped subset that is safe to
    // inject unlayered, which is what actually beats the defaults. Live
    // discovery is the exception: it ships the computed-style probe, itself
    // unlayered and better at the same job.
    //
    // The discovered wrapper class goes in as a second scope root. Host themes
    // scope prose to their OWN wrapper class (`.sl-markdown-content`), never to
    // `.conloca-prose`, so filtering on the Conloca class alone yielded an
    // empty tier on every real site. `hostWrapperPlugin` renders a clone of
    // that wrapper around the contenteditable, so those selectors match here.
    // Gated on the probe as well as on live discovery. Both this tier and the
    // probe inject UNLAYERED, and for a heading they land on equal specificity
    // — `.conloca-prose--editor h2` (0,1,1) against
    // `.sl-markdown-content h2:not(:where(…))` (0,1,1), since `:not(:where())`
    // contributes nothing — so whichever is later in head order wins, and that
    // is this tier. Without this gate a working probe would be a measurable
    // no-op wherever a host sets siteStyles.
    //
    // `probeSettled` is the load-bearing half of the gate. `probedStyles === ''`
    // alone is true on the initial render (probe still in flight) AND after a
    // definitive empty failure, so gating only on the string paints this tier
    // first, then tears it down when the probe lands — a visible flash on
    // every editor open that relies on siteStyles. Hold the tier
    // until the probe has resolved once; only then, if it settled empty, fill in
    // with derived rules.
    () =>
      routeStyles.length === 0 && probeSettled && probedStyles === ''
        ? deriveProseSurfaceStyles(siteStyles, hostWrappers.content?.className)
        : [],
    [routeStyles, probeSettled, probedStyles, siteStyles, hostWrappers],
  );
  useInjectHostStyles('conloca-prose-surface', proseSurface, { layered: false });
  // Recompose the plugins list whenever the wrappers change so the plugin
  // re-runs its `update` and the wrapper component refreshes inside the
  // editor. The hostWrapperPlugin's renderers read reactively from their
  // own Cells, so we DON'T need to remount the entire editor for this.
  const extraPlugins = useMemo<RealmPlugin[]>(
    () => [
      mdxComponentsPlugin(),
      hostWrapperPlugin({ wrapper: hostWrappers.content, codeBlockWrapper: hostWrappers.codeBlock }),
    ],
    [hostWrappers],
  );
  const jsxComponentDescriptors = useMemo<JsxComponentDescriptor[]>(
    // Filter to JSX flavors before translating — snippets live in the same
    // registry but aren't valid input for @mdxeditor/editor's jsxPlugin, and
    // toJsxComponentDescriptor throws if handed one to surface the misuse.
    () =>
      registeredMdxComponents
        .filter(isJsxDescriptor)
        .map((descriptor) => toJsxComponentDescriptor(descriptor, GenericBlock)),
    [registeredMdxComponents],
  );

  // Wire paste/drop image uploads to the same backend mutation that powers
  // the asset library's UploadModal. The library expects a Promise<string>
  // resolving to the image src; we hand back the stored reference
  // buildAssetRef builds, so it round-trips identically to a path picked
  // from the asset browser.
  const imageUploadHandler = useCallback(
    async (file: File) => {
      const formData = buildUploadFormData(file, undefined, '/');
      const asset = await uploadAsset.mutateAsync(formData);
      return buildAssetRef(asset.folder, asset.filename);
    },
    [uploadAsset],
  );

  return (
    <BaseMDXEditor
      ref={ref}
      {...props}
      imageDialog={ImagePickerDialog}
      disableImageSettingsButton={true}
      imageButtonRef={insertImageRef}
      imageUploadHandler={imageUploadHandler}
      // The site does not serve branch drafts; with a loader, draft images show their loaded bytes.
      imagePreviewHandler={getUIConfig().loadMedia ? draftImagePreview : undefined}
      jsxComponentDescriptors={jsxComponentDescriptors}
      extraPlugins={extraPlugins}
      extraToolbarItems={<InsertMdxComponentButton />}
      onImageShortcut={() => {
        if (insertImageRef.current) {
          insertImageRef.current.click();
          return;
        }

        console.warn('[CMSMDXEditor] InsertImage ref not attached - toolbar may not be rendered');
      }}
    />
  );
});

CMSMDXEditor.displayName = 'CMSMDXEditor';
