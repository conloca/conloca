import {
  BlockTypeSelect,
  BoldItalicUnderlineToggles,
  CreateLink,
  codeBlockPlugin,
  codeMirrorPlugin,
  DiffSourceToggleWrapper,
  diffSourcePlugin,
  frontmatterPlugin,
  headingsPlugin,
  InsertCodeBlock,
  InsertImage,
  InsertTable,
  InsertThematicBreak,
  imagePlugin,
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
  tablePlugin,
  thematicBreakPlugin,
  toolbarPlugin,
  UndoRedo,
} from '@mdxeditor/editor';
import React, { useEffect, useState } from 'react';
import '@mdxeditor/editor/style.css';

export interface BaseMDXEditorProps {
  value: string;
  onChange: (value: string) => void;
  onSave?: (value: string) => void;
  readOnly?: boolean;
  imageDialog?: React.FC | null;
  disableImageSettingsButton?: boolean;
  onImageShortcut?: () => void;
  imageButtonRef?: React.Ref<HTMLButtonElement>;
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
}

const codeBlockLanguages = {
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
        readOnly={readOnly}
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
          jsxPlugin(),
          imagePlugin(
            imageDialog
              ? {
                  ImageDialog: imageDialog,
                  disableImageSettingsButton,
                }
              : undefined,
          ),
          toolbarPlugin({
            toolbarContents: () => (
              <DiffSourceToggleWrapper>
                <UndoRedo />
                <Separator />
                <BoldItalicUnderlineToggles />
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
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsReady(true);
    }, 10);

    return () => clearTimeout(timer);
  }, []);

  if (!isReady) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500" data-testid="deferred-editor-loading">
        Initializing editor...
      </div>
    );
  }

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
      <div className="relative z-50 bg-white rounded-lg shadow-lg max-w-[90vw] max-h-[90vh] overflow-hidden">
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
  return <h2 className="text-xl font-semibold">{children}</h2>;
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
}: BaseMDXEditorModalProps) {
  const editorRef = React.useRef<MDXEditorMethods>(null);
  const [content, setContent] = useState(initialContent);
  const [isEditorReady, setIsEditorReady] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setContent(initialContent);
  }, [initialContent]);

  const handleClose = () => {
    if (onBeforeClose && !onBeforeClose()) {
      return;
    }

    onClose();
  };

  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => {
        setIsEditorReady(true);
      }, 0);

      return () => clearTimeout(timer);
    }

    setIsEditorReady(false);
    return undefined;
  }, [isOpen]);

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
            <button type="button" onClick={handleClose} className="p-2 hover:bg-gray-100 rounded" aria-label="Close">
              ✕
            </button>
          </div>
        </DialogHeader>
        <div className="flex-1 overflow-hidden">
          {isEditorReady ? (
            <MDXEditorErrorBoundary logPrefix="[MDXEditor]">
              <DeferredMDXEditor
                EditorComponent={EditorComponent}
                editorRef={editorRef}
                value={content}
                onChange={setContent}
                onSave={handleSave}
              />
            </MDXEditorErrorBoundary>
          ) : (
            <div className="flex items-center justify-center h-full">
              <div className="text-gray-500" data-testid="modal-editor-loading">
                Loading editor...
              </div>
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <button
            type="button"
            onClick={handleClose}
            className="px-4 py-2 border border-gray-300 rounded hover:bg-gray-50"
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
