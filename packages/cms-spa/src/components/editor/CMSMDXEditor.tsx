import { useUploadAsset } from '@conloca/content-api-client';
import { BaseMDXEditor, type BaseMDXEditorProps } from '@conloca/mdx';
import type { JsxComponentDescriptor, MDXEditorMethods, RealmPlugin } from '@mdxeditor/editor';
import type React from 'react';
import { forwardRef, useCallback, useMemo, useRef } from 'react';
import { buildUploadFormData } from '../../hooks/useUpload';
import { isJsxDescriptor, toJsxComponentDescriptor, useMdxComponents } from '../../mdx-components';
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
  > {}

export const CMSMDXEditor = forwardRef<MDXEditorMethods, CMSMDXEditorProps>((props, ref) => {
  const insertImageRef = useRef<HTMLButtonElement>(null);
  const uploadAsset = useUploadAsset();
  const registeredMdxComponents = useMdxComponents();
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
