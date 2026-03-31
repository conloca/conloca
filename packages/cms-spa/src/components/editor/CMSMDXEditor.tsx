import { BaseMDXEditor, BaseMDXEditorModal, type BaseMDXEditorModalProps, type BaseMDXEditorProps } from '@conloca/mdx';
import type { MDXEditorMethods } from '@mdxeditor/editor';
import React, { useRef } from 'react';
import { ImagePickerDialog } from './ImagePickerDialog';

export interface CMSMDXEditorProps
  extends Omit<
    BaseMDXEditorProps,
    'disableImageSettingsButton' | 'imageButtonRef' | 'imageDialog' | 'onImageShortcut'
  > {}

export const CMSMDXEditor = React.forwardRef<MDXEditorMethods, CMSMDXEditorProps>((props, ref) => {
  const insertImageRef = useRef<HTMLButtonElement>(null);

  return (
    <BaseMDXEditor
      ref={ref}
      {...props}
      imageDialog={ImagePickerDialog}
      disableImageSettingsButton={true}
      imageButtonRef={insertImageRef}
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

export interface CMSMDXEditorModalProps extends Omit<BaseMDXEditorModalProps, 'EditorComponent'> {}

export function CMSMDXEditorModal(props: CMSMDXEditorModalProps) {
  return <BaseMDXEditorModal {...props} EditorComponent={CMSMDXEditor} />;
}
