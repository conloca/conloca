import {
  BlockTypeSelect,
  BoldItalicUnderlineToggles,
  ChangeCodeMirrorLanguage,
  ConditionalContents,
  CreateLink,
  codeBlockPlugin,
  codeMirrorPlugin,
  DiffSourceToggleWrapper,
  diffSourcePlugin,
  frontmatterPlugin,
  GenericJsxEditor,
  HighlightToggle,
  headingsPlugin,
  InsertCodeBlock,
  InsertFrontmatter,
  InsertImage,
  InsertTable,
  InsertThematicBreak,
  imagePlugin,
  type JsxComponentDescriptor,
  jsxPlugin,
  ListsToggle,
  linkDialogPlugin,
  linkPlugin,
  listsPlugin,
  MDXEditor as MDXEditorLib,
  type MDXEditorMethods,
  markdownShortcutPlugin,
  quotePlugin,
  Separator,
  StrikeThroughSupSubToggles,
  tablePlugin,
  thematicBreakPlugin,
  toolbarPlugin,
  UndoRedo,
} from '@mdxeditor/editor';
import React, { useEffect } from 'react';
import '@mdxeditor/editor/style.css';

export interface BaseMDXEditorProps {
  value: string;
  /**
   * Called whenever the editor content changes. The second argument is `true`
   * the first time the library normalizes the parsed markdown back to its
   * canonical form (bullet style, trailing newline, etc.) — consumers tracking
   * dirty state should treat that call as a re-baseline rather than a user
   * edit, otherwise the editor looks dirty the moment the page loads.
   */
  onChange: (value: string, initialMarkdownNormalize?: boolean) => void;
  onSave?: (value: string) => void;
  readOnly?: boolean;
  imageDialog?: React.FC | null;
  disableImageSettingsButton?: boolean;
  onImageShortcut?: () => void;
  imageButtonRef?: React.Ref<HTMLButtonElement>;
  jsxComponentDescriptors?: JsxComponentDescriptor[];
  /**
   * Class applied to the MDXEditor root element (library forwards it to the
   * toolbar and portaled popups too). Pass `"dark-theme"` to activate the
   * library's built-in Radix dark palette.
   * See https://mdxeditor.dev/editor/docs/theming
   */
  className?: string;
  /** Placeholder shown when the editor is empty. Forwarded to MDXEditorLib. */
  placeholder?: React.ReactNode;
  /** Auto-focus the editor on mount. Forwarded to MDXEditorLib. */
  autoFocus?: boolean | { defaultSelection?: 'rootStart' | 'rootEnd'; preventScroll?: boolean };
}

export interface BaseMDXEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  filePath?: string;
  initialContent: string;
  onSave: (content: string) => void | Promise<void>;
  headerExtra?: React.ReactNode;
  headerTools?: (tools: {
    content: string;
    setContent: React.Dispatch<React.SetStateAction<string>>;
    editorRef: React.RefObject<MDXEditorMethods | null>;
  }) => React.ReactNode;
  onBeforeClose?: () => boolean;
  EditorComponent: React.ForwardRefExoticComponent<BaseMDXEditorProps & React.RefAttributes<MDXEditorMethods>>;
  /**
   * Forwarded to the MDXEditor root. Typically `"dark-theme"` when the host
   * app is in dark mode — see BaseMDXEditorProps.className.
   */
  editorClassName?: string;
  /**
   * Optional typed descriptors merged ahead of the wildcard fallback. Pass
   * project-specific component shapes (e.g. Starlight's `<Aside type=...>`,
   * `<Tabs>`, `<TabItem label=...>`) for richer rich-text editing; tags not
   * declared here are still accepted through the wildcard.
   */
  jsxComponentDescriptors?: JsxComponentDescriptor[];
}

// The empty-string entry is the documented escape hatch for code blocks
// authored without a language hint. Without it, fences like ```\nfoo\n``` (which
// the parser tags as language `null` / meta `'N/A'`) trip a hard error in
// older versions and emit a noisy warning even on v3.55+. See mdx-editor/editor
// issues #370, #423, #463, #885, #886, #901.
const codeBlockLanguages: Record<string, string> = {
  '': 'Plain text',
  text: 'Plain Text',
  js: 'JavaScript',
  jsx: 'JavaScript (React)',
  ts: 'TypeScript',
  tsx: 'TypeScript (React)',
  css: 'CSS',
  html: 'HTML',
  json: 'JSON',
  md: 'Markdown',
  mdx: 'MDX',
  bash: 'Bash',
  python: 'Python',
};

/**
 * Wildcard fallback so any unknown JSX tag round-trips through GenericJsxEditor
 * instead of crashing the importer with "Parsing of the following markdown
 * structure failed". Two entries because the upstream visitor dispatches by
 * `kind` (block vs inline JSX) — without the inline one, an inline `<Badge>`
 * mid-paragraph would be matched by the flow wildcard and lifted out of its
 * paragraph in Lexical. Consumers passing typed descriptors win via the
 * exact-name match in the visitor; the wildcard only handles the leftovers.
 */
const wildcardJsxDescriptors: JsxComponentDescriptor[] = [
  { name: '*', kind: 'flow', props: [], hasChildren: true, Editor: GenericJsxEditor },
  { name: '*', kind: 'text', props: [], hasChildren: true, Editor: GenericJsxEditor },
];

function renderInsertImageButton(imageButtonRef?: React.Ref<HTMLButtonElement>) {
  if (!imageButtonRef) {
    return <InsertImage />;
  }

  return React.createElement(InsertImage as unknown as React.FC<{ ref: React.Ref<HTMLButtonElement> }>, {
    ref: imageButtonRef,
  });
}

class MDXEditorErrorBoundary extends React.Component<
  { children: React.ReactNode; logPrefix: string },
  { hasError: boolean; error?: Error }
> {
  constructor(props: { children: React.ReactNode; logPrefix: string }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error(`${this.props.logPrefix} Error boundary caught:`, error, errorInfo);
  }

  override render() {
    if (this.state.hasError) {
      return (
        <div className="p-4 bg-red-50 border border-red-200 rounded text-red-600">
          <p className="font-semibold mb-2">MDXEditor Error</p>
          <p className="text-sm mb-2">{this.state.error?.message || 'Unknown error occurred'}</p>
          <details className="text-xs">
            <summary className="cursor-pointer font-medium">Stack Trace</summary>
            <pre className="mt-2 p-2 bg-red-100 rounded overflow-auto whitespace-pre-wrap">
              {this.state.error?.stack}
            </pre>
          </details>
        </div>
      );
    }

    return this.props.children;
  }
}

export const BaseMDXEditor = React.forwardRef<MDXEditorMethods, BaseMDXEditorProps>(
  (
    {
      value,
      onChange,
      onSave,
      readOnly = false,
      imageDialog,
      disableImageSettingsButton = false,
      onImageShortcut,
      imageButtonRef,
      jsxComponentDescriptors,
      className,
      placeholder,
      autoFocus,
    },
    ref,
  ) => {
    useEffect(() => {
      const handleKeyDown = (event: KeyboardEvent) => {
        if ((event.ctrlKey || event.metaKey) && event.key === 's') {
          event.preventDefault();
          onSave?.(value);
        }

        if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'i') {
          if (!onImageShortcut) {
            return;
          }

          event.preventDefault();
          onImageShortcut();
        }
      };

      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }, [onImageShortcut, onSave, value]);

    return (
      <MDXEditorLib
        ref={ref}
        markdown={value}
        onChange={onChange}
        onError={({ error, source }) => {
          // Library invokes this synchronously inside a gurx signal, so don't
          // setState here — that triggers a render-phase warning (#872).
          // Logging only is enough; the React error boundary still catches
          // anything that escapes from rendering.
          console.error('[MDXEditor] parse error:', error, '\nsource:', source);
        }}
        readOnly={readOnly}
        className={className}
        placeholder={placeholder}
        autoFocus={autoFocus}
        contentEditableClassName="conloca-prose conloca-prose--editor max-w-none"
        plugins={[
          headingsPlugin(),
          listsPlugin(),
          quotePlugin(),
          linkPlugin(),
          linkDialogPlugin(),
          tablePlugin(),
          thematicBreakPlugin(),
          frontmatterPlugin(),
          codeBlockPlugin({ defaultCodeBlockLanguage: 'ts' }),
          codeMirrorPlugin({ codeBlockLanguages }),
          diffSourcePlugin({ viewMode: 'rich-text' }),
          markdownShortcutPlugin(),
          jsxPlugin({
            jsxComponentDescriptors: [...(jsxComponentDescriptors ?? []), ...wildcardJsxDescriptors],
          }),
          imagePlugin(
            imageDialog
              ? {
                  ImageDialog: imageDialog,
                  disableImageSettingsButton,
                }
              : undefined,
          ),
          toolbarPlugin({
            // flex-wrap so the toolbar reflows on narrow viewports instead of
            // overflowing horizontally — workaround documented in
            // mdx-editor/editor#908.
            toolbarClassName: 'mdxeditor-toolbar-wrap',
            toolbarContents: () => (
              <DiffSourceToggleWrapper>
                <ConditionalContents
                  options={[
                    {
                      // When the user clicks into a code block, swap most of
                      // the rich-text toolbar for the language picker — those
                      // controls are no-ops inside CodeMirror anyway.
                      when: (editor) => editor?.editorType === 'codeblock',
                      contents: () => <ChangeCodeMirrorLanguage />,
                    },
                    {
                      fallback: () => (
                        <>
                          <UndoRedo />
                          <Separator />
                          <BoldItalicUnderlineToggles />
                          <StrikeThroughSupSubToggles />
                          <HighlightToggle />
                          <Separator />
                          <ListsToggle />
                          <Separator />
                          <BlockTypeSelect />
                          <Separator />
                          <CreateLink />
                          {renderInsertImageButton(imageButtonRef)}
                          <InsertTable />
                          <InsertThematicBreak />
                          <Separator />
                          <InsertCodeBlock />
                          <InsertFrontmatter />
                        </>
                      ),
                    },
                  ]}
                />
              </DiffSourceToggleWrapper>
            ),
          }),
        ]}
      />
    );
  },
);

BaseMDXEditor.displayName = 'BaseMDXEditor';

function DeferredMDXEditor({
  EditorComponent,
  editorRef,
  ...props
}: BaseMDXEditorProps & {
  EditorComponent: React.ForwardRefExoticComponent<BaseMDXEditorProps & React.RefAttributes<MDXEditorMethods>>;
  editorRef: React.RefObject<MDXEditorMethods | null>;
}) {
  return (
    <div data-testid="deferred-editor-ready">
      <EditorComponent ref={editorRef} {...props} />
    </div>
  );
}

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}

function Dialog({ open, onOpenChange, children }: DialogProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div role="presentation" className="fixed inset-0 bg-black/50" onClick={() => onOpenChange(false)} />
      <div className="relative z-50 bg-white dark:bg-grey-03 rounded-lg shadow-lg max-w-[90vw] max-h-[90vh] overflow-hidden">
        {children}
      </div>
    </div>
  );
}

function DialogContent({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`p-6 ${className}`}>{children}</div>;
}

function DialogHeader({ children }: { children: React.ReactNode }) {
  return <div className="mb-4">{children}</div>;
}

function DialogTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-xl font-semibold text-grey-01 dark:text-grey-12">{children}</h2>;
}

export function BaseMDXEditorModal({
  isOpen,
  onClose,
  filePath,
  initialContent,
  onSave,
  headerExtra,
  headerTools,
  onBeforeClose,
  EditorComponent,
  editorClassName,
  jsxComponentDescriptors,
}: BaseMDXEditorModalProps) {
  const editorRef = React.useRef<MDXEditorMethods>(null);
  const [content, setContent] = React.useState(initialContent);
  const [isSaving, setIsSaving] = React.useState(false);

  useEffect(() => {
    setContent(initialContent);
  }, [initialContent]);

  const handleClose = () => {
    if (onBeforeClose && !onBeforeClose()) {
      return;
    }

    onClose();
  };

  const handleSave = async () => {
    setIsSaving(true);

    try {
      await onSave(content);
      handleClose();
    } catch (error) {
      console.error('Save failed:', error);
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) {
    return null;
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="w-[90vw] h-[90vh] flex flex-col" data-testid="mdx-editor-modal">
        <DialogHeader>
          <div className="flex items-center justify-between gap-4">
            <DialogTitle>{filePath ? `Edit: ${filePath}` : 'New MDX File'}</DialogTitle>
            {(headerExtra || headerTools) && (
              <div className="flex items-center gap-2">
                {headerExtra}
                {headerTools?.({ content, setContent, editorRef })}
              </div>
            )}
            <button
              type="button"
              onClick={handleClose}
              className="p-2 rounded text-grey-04 dark:text-grey-07 hover:bg-gray-100 dark:hover:bg-grey-04 hover:text-grey-01 dark:hover:text-grey-12"
              aria-label="Close"
            >
              ✕
            </button>
          </div>
        </DialogHeader>
        <div className="flex-1 overflow-hidden">
          <MDXEditorErrorBoundary logPrefix="[MDXEditor]">
            <DeferredMDXEditor
              EditorComponent={EditorComponent}
              editorRef={editorRef}
              value={content}
              onChange={setContent}
              onSave={handleSave}
              className={editorClassName}
              jsxComponentDescriptors={jsxComponentDescriptors}
            />
          </MDXEditorErrorBoundary>
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <button
            type="button"
            onClick={handleClose}
            className="px-4 py-2 border border-gray-300 dark:border-grey-04 rounded text-grey-01 dark:text-grey-12 hover:bg-gray-50 dark:hover:bg-grey-04"
            disabled={isSaving}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={isSaving}
          >
            {isSaving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
