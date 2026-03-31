import type { MDXEditorMethods } from '@mdxeditor/editor';
import React from 'react';
import {
  BaseMDXEditor,
  BaseMDXEditorModal,
  type BaseMDXEditorModalProps,
  type BaseMDXEditorProps,
} from './editor-core.js';

export interface MDXEditorProps
  extends Omit<
    BaseMDXEditorProps,
    'disableImageSettingsButton' | 'imageButtonRef' | 'imageDialog' | 'onImageShortcut'
  > {}

export const MDXEditor = React.forwardRef<MDXEditorMethods, MDXEditorProps>((props, ref) => {
  return <BaseMDXEditor ref={ref} {...props} />;
});

MDXEditor.displayName = 'MDXEditor';

export interface MDXEditorModalProps extends Omit<BaseMDXEditorModalProps, 'EditorComponent'> {}

export function MDXEditorModal(props: MDXEditorModalProps) {
  return <BaseMDXEditorModal {...props} EditorComponent={MDXEditor} />;
}
