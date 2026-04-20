import { BaseMDXEditor, BaseMDXEditorModal, type BaseMDXEditorModalProps, type BaseMDXEditorProps } from '@conloca/mdx';
import type { MDXEditorMethods } from '@mdxeditor/editor';
import type React from 'react';
import { forwardRef, useMemo, useRef, useState } from 'react';
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

function CMSMDXHeaderTools({
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

  return (
    <BaseMDXEditorModal
      {...modalProps}
      EditorComponent={CMSMDXEditor}
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
