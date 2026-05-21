import { useUploadAsset } from '@conloca/content-api-client';
import { BaseMDXEditor, type BaseMDXEditorProps } from '@conloca/mdx';
import type { JsxComponentDescriptor, MDXEditorMethods, RealmPlugin } from '@mdxeditor/editor';
import { forwardRef, useCallback, useMemo, useRef } from 'react';
import { buildUploadFormData } from '../../hooks/useUpload';
import { isJsxDescriptor, toJsxComponentDescriptor, useMdxComponents } from '../../mdx-components';
import {
  type SiteStyles,
  useEditorStyles,
  useFetchedContentWrapper,
  useFetchedSiteStyles,
  useInjectHostStyles,
} from '../../site-styles';
import { hostWrapperPlugin } from './host-wrapper-plugin';
import { ImagePickerDialog } from './ImagePickerDialog';
import { InsertMdxComponentButton } from './insert-menu/InsertMdxComponentButton';
import { mdxComponentsPlugin } from './insert-menu/mdx-components-plugin';

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
  // Both inject into the `conloca-host-preview` layer (declared in
  // main.css after `cms-admin`) so host rules sit at a predictable spot
  // in the cascade — admin chrome wins on collisions via layer order.
  const fetchedStyles = useFetchedSiteStyles(previewRouteUrl);
  const staticEditorStyles = useEditorStyles();
  const activeStyles = fetchedStyles.length > 0 ? fetchedStyles : staticEditorStyles;
  // The editor mounts directly in the parent SPA's React tree (the
  // EditorFrame iframe was removed). Host CSS is injected globally
  // into the page document; chrome that visibly collides with the
  // host's Tailwind utilities uses the cms-admin semantic palette
  // (`bg-panel`, `text-foreground`, `border-line`, etc.) whose class
  // names the host's Tailwind can't generate. See main.css's `@theme`
  // and `@utility` blocks for the chrome token definitions.
  //
  // The host can also append raw CSS via the integration's `editorCSS`
  // option (see `ConlocaCMSOptions`) — concatenated AFTER auto-
  // discovered styles so it sits later in the same cascade layer and
  // wins on tie-breaks. Empty string when the host didn't set it; no
  // marker `<style>` is emitted for the no-op case.
  const editorCSS: string = import.meta.env.CONLOCA_EDITOR_CSS || '';
  const styleStack = useMemo<SiteStyles>(
    () => (editorCSS ? [...activeStyles, editorCSS] : activeStyles),
    [activeStyles, editorCSS],
  );
  useInjectHostStyles('conloca-host-preview', styleStack);
  // Discover the host page's content-root shape (eg `<article class="card">`
  // on Starlight). The editor wraps its contenteditable in a clone of that
  // element via `hostWrapperPlugin`, so host CSS paints the editor's
  // content surface naturally — no per-color JS bridging needed.
  const hostWrapper = useFetchedContentWrapper(previewRouteUrl);
  // Recompose the plugins list whenever the wrapper changes so the plugin
  // re-runs its `update` and the wrapper component refreshes inside the
  // editor. The hostWrapperPlugin's renderer also reads reactively from its
  // own Cell, so we DON'T need to remount the entire editor for this.
  const extraPlugins = useMemo<RealmPlugin[]>(
    () => [mdxComponentsPlugin(), hostWrapperPlugin({ wrapper: hostWrapper })],
    [hostWrapper],
  );
  const jsxComponentDescriptors = useMemo<JsxComponentDescriptor[]>(
    // Filter to JSX flavors before translating — snippets live in the same
    // registry but aren't valid input for @mdxeditor/editor's jsxPlugin, and
    // toJsxComponentDescriptor throws if handed one to surface the misuse.
    () => registeredMdxComponents.filter(isJsxDescriptor).map(toJsxComponentDescriptor),
    [registeredMdxComponents],
  );

  // Wire paste/drop image uploads to the same backend mutation that powers
  // the asset library's UploadModal. The library expects a Promise<string>
  // resolving to the image src; we hand back the canonical
  // `/assets/{folder}/{filename}` path so it round-trips identically to a
  // path picked from the asset browser.
  const imageUploadHandler = useCallback(
    async (file: File) => {
      const formData = await buildUploadFormData(file, undefined, '/');
      const asset = await uploadAsset.mutateAsync(formData);
      const folder = asset.folder && asset.folder !== '/' ? asset.folder : '';
      return `/assets${folder}/${asset.filename}`;
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
