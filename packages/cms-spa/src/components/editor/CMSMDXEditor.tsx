import { useUploadAsset } from '@conloca/content-api-client';
import { BaseMDXEditor, type BaseMDXEditorProps } from '@conloca/mdx';
import type { JsxComponentDescriptor, MDXEditorMethods, RealmPlugin } from '@mdxeditor/editor';
import type React from 'react';
import { forwardRef, useCallback, useMemo, useRef, useState } from 'react';
import { buildUploadFormData } from '../../hooks/useUpload';
import { toJsxComponentDescriptor, useMdxComponents } from '../../mdx-components';
import { Button, Select } from '../ui';
import { contentBlockSnippets, getContentBlockTemplate, renderContentBlockTemplate } from './content-block-templates';
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
    () => registeredMdxComponents.map(toJsxComponentDescriptor),
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

    // Always append snippets to the end of the body, after any leading YAML
    // frontmatter. Earlier this used `insertMarkdown` to preserve cursor
    // position, but that has a sharp edge: when the user clicks "Insert
    // Pattern" without first clicking into the editor, the cursor is at
    // offset 0 — which on a freshly-loaded block can land *above* the
    // frontmatter. The frontmatter's `---` markers then stop being parsed
    // as YAML and re-render as thematic breaks + a setext H2, silently
    // destroying the frontmatter on the next save. Splicing in
    // userland here (read + rewrite via setMarkdown) is the simplest way
    // to guarantee snippets always land in the body content.
    //
    // Trade-off: setMarkdown resets the cursor to document start. That's
    // acceptable for a deliberate "insert pattern" action — the user
    // expects content to appear, not to keep typing exactly where they
    // were.
    const ref = editorRef.current;
    if (!ref?.getMarkdown || !ref?.setMarkdown) return;

    const current = ref.getMarkdown();
    const frontmatterMatch = current.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
    const head = frontmatterMatch ? frontmatterMatch[0] : '';
    const body = current.slice(head.length).replace(/\s+$/, '');
    const headWithGap = head && !head.endsWith('\n\n') ? `${head.replace(/\n*$/, '')}\n\n` : head;
    const bodySep = body.length > 0 ? '\n\n' : '';
    const newContent = `${headWithGap}${body}${bodySep}${snippet.content}\n`;

    ref.setMarkdown(newContent);
    setContent(newContent);
  };

  return (
    <>
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
