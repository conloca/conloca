import { useUploadAsset } from '@conloca/content-api-client';
import { BaseMDXEditor, type BaseMDXEditorProps } from '@conloca/mdx';
import type { JsxComponentDescriptor, MDXEditorMethods, RealmPlugin } from '@mdxeditor/editor';
import { forwardRef, useCallback, useMemo, useRef } from 'react';
import { buildUploadFormData } from '../../hooks/useUpload';
import { isJsxDescriptor, toJsxComponentDescriptor, useMdxComponents } from '../../mdx-components';
import { useEditorStyles, useFetchedSiteStyles, useInjectHostStyles } from '../../site-styles';
import { ImagePickerDialog } from './ImagePickerDialog';
import { InsertMdxComponentButton } from './insert-menu/InsertMdxComponentButton';
import { mdxComponentsPlugin } from './insert-menu/mdx-components-plugin';

const mdxComponentsExtraPlugins: RealmPlugin[] = [mdxComponentsPlugin()];

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
  const usingFetched = fetchedStyles.length > 0;
  const activeStyles = usingFetched ? fetchedStyles : staticEditorStyles;
  // Fetched CSS is broad (Tailwind utilities, :root tokens, * preflight).
  // Scope it to `.mdxeditor` so it can't leak into admin chrome (top bar,
  // sidebars, modals). The narrow static path doesn't need scoping —
  // those rules target host-component classes only.
  useInjectHostStyles('conloca-host-preview', activeStyles, usingFetched ? '.mdxeditor' : undefined);
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
      extraPlugins={mdxComponentsExtraPlugins}
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
