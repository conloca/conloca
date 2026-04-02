import { BaseMDXEditor, BaseMDXEditorModal, type BaseMDXEditorModalProps, type BaseMDXEditorProps } from '@conloca/mdx';
import type { MDXEditorMethods } from '@mdxeditor/editor';
import React, { useMemo, useRef, useState } from 'react';
import { contentBlockSnippets, getContentBlockTemplate, renderContentBlockTemplate } from './content-block-templates';
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

function CMSMDXHeaderTools({
  setContent,
  filePath,
  initialTemplateId,
}: {
  setContent: React.Dispatch<React.SetStateAction<string>>;
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
      return trimmed ? `${trimmed}\n\n${snippet.content}` : snippet.content;
    });
  };

  return (
    <>
      <span className="hidden text-xs text-grey-04 xl:inline">Cmd/Ctrl+S to save</span>
      <select
        value={selectedSnippetId}
        onChange={(event) => setSelectedSnippetId(event.target.value)}
        className="rounded border border-grey-09 bg-white px-3 py-2 text-sm"
      >
        {contentBlockSnippets.map((snippet) => (
          <option key={snippet.id} value={snippet.id}>
            {snippet.label}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={handleInsertSnippet}
        className="rounded border border-grey-09 bg-white px-3 py-2 text-sm font-medium hover:bg-grey-11"
      >
        Insert Pattern
      </button>
      {selectedTemplate ? (
        <button
          type="button"
          onClick={() => setContent(renderContentBlockTemplate(initialTemplateId, filePath || 'Untitled Block'))}
          className="rounded border border-grey-09 bg-white px-3 py-2 text-sm font-medium hover:bg-grey-11"
        >
          Reset Template
        </button>
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
      headerTools={({ setContent }) => (
        <CMSMDXHeaderTools
          setContent={setContent}
          filePath={modalProps.filePath}
          initialTemplateId={initialTemplateId}
        />
      )}
    />
  );
}
