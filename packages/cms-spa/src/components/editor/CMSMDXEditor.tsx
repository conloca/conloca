import { BaseMDXEditor, BaseMDXEditorModal, type BaseMDXEditorModalProps, type BaseMDXEditorProps } from '@conloca/mdx';
import type { MDXEditorMethods } from '@mdxeditor/editor';
import type React from 'react';
import { forwardRef, useMemo, useRef, useState } from 'react';
import { useTheme } from '../../hooks/useTheme';
import { Button, Select } from '../ui';
import { contentBlockSnippets, getContentBlockTemplate, renderContentBlockTemplate } from './content-block-templates';
import { ImagePickerDialog } from './ImagePickerDialog';

export interface CMSMDXEditorProps
  extends Omit<
    BaseMDXEditorProps,
    'disableImageSettingsButton' | 'imageButtonRef' | 'imageDialog' | 'onImageShortcut'
  > {}

export const CMSMDXEditor = forwardRef<MDXEditorMethods, CMSMDXEditorProps>((props, ref) => {
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

export function CMSMDXHeaderTools({
  setContent,
  editorRef,
  filePath,
  initialTemplateId,
}: {
  setContent: React.Dispatch<React.SetStateAction<string>>;
  editorRef: React.RefObject<MDXEditorMethods | null>;
  filePath?: string;
  initialTemplateId?: string;
}) {
  const [selectedSnippetId, setSelectedSnippetId] = useState(contentBlockSnippets[0]?.id || '');
  const selectedTemplate = useMemo(() => getContentBlockTemplate(initialTemplateId), [initialTemplateId]);

  const handleInsertSnippet = () => {
    const snippet = contentBlockSnippets.find((item) => item.id === selectedSnippetId);
    if (!snippet) {
      return;
    }

    // insertMarkdown preserves cursor position (vs setMarkdown which resets it
    // to document start — a documented MDXEditor limitation). The library will
    // splice the snippet at the current selection and emit onChange, which
    // updates our content state via the editor's existing wiring.
    if (editorRef.current?.insertMarkdown) {
      editorRef.current.insertMarkdown(`\n\n${snippet.content}\n`);
      return;
    }

    // Fallback (no insertMarkdown method) — append to end via setMarkdown.
    setContent((current) => {
      const trimmed = current.trimEnd();
      const newContent = trimmed ? `${trimmed}\n\n${snippet.content}` : snippet.content;
      editorRef.current?.setMarkdown(newContent);
      return newContent;
    });
  };

  return (
    <>
      <span className="hidden text-xs text-grey-04 xl:inline">Cmd/Ctrl+S to save</span>
      <Select
        size="sm"
        value={selectedSnippetId}
        onChange={(event) => setSelectedSnippetId(event.target.value)}
        className="w-auto"
      >
        {contentBlockSnippets.map((snippet) => (
          <option key={snippet.id} value={snippet.id}>
            {snippet.label}
          </option>
        ))}
      </Select>
      <Button variant="outline" size="sm" onClick={handleInsertSnippet}>
        Insert Pattern
      </Button>
      {selectedTemplate ? (
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            const newContent = renderContentBlockTemplate(initialTemplateId, filePath || 'Untitled Block');
            setContent(newContent);
            editorRef.current?.setMarkdown(newContent);
          }}
        >
          Reset Template
        </Button>
      ) : null}
    </>
  );
}

export interface CMSMDXEditorModalProps extends Omit<BaseMDXEditorModalProps, 'EditorComponent'> {
  initialTemplateId?: string;
}

export function CMSMDXEditorModal(props: CMSMDXEditorModalProps) {
  const { initialTemplateId, ...modalProps } = props;

  // Apply the MDXEditor library's documented `dark-theme` class when our app is
  // in dark mode. The library ships a Radix-backed color palette that only
  // flips inside a `.dark, .dark-theme` scope on the editor element itself —
  // setting `.dark` on <html> alone doesn't propagate because a separate
  // CSS-Modules `:root` rule in the library CSS re-sets slate-* to light after
  // the `.dark` rule in source order. See https://mdxeditor.dev/editor/docs/theming.
  const { resolvedTheme } = useTheme();

  return (
    <BaseMDXEditorModal
      {...modalProps}
      EditorComponent={CMSMDXEditor}
      editorClassName={resolvedTheme === 'dark' ? 'dark-theme' : undefined}
      headerTools={({ setContent, editorRef }) => (
        <CMSMDXHeaderTools
          setContent={setContent}
          editorRef={editorRef}
          filePath={modalProps.filePath}
          initialTemplateId={initialTemplateId}
        />
      )}
    />
  );
}
