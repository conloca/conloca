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
import { ImagePickerDialog } from './ImagePickerDialog';

/**
 * Error Boundary for catching React errors in MDXEditor.
 * Prevents editor crashes from breaking the entire CMS.
 */
class MDXEditorErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error?: Error }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[CMSMDXEditor] Error boundary caught:', error, errorInfo);
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

export interface CMSMDXEditorProps {
  value: string;
  onChange: (value: string) => void;
  onSave?: (value: string) => void;
  readOnly?: boolean;
}

/**
 * CMS-integrated MDX Editor with Media Library image picker.
 * This component wraps MDXEditor with ImagePickerDialog and keyboard shortcuts.
 */
export const CMSMDXEditor = React.forwardRef<MDXEditorMethods, CMSMDXEditorProps>(
  ({ value, onChange, onSave, readOnly = false }, ref) => {
    // Handle keyboard shortcuts
    useEffect(() => {
      const handleKeyDown = (e: KeyboardEvent) => {
        // Save shortcut: Ctrl/Cmd+S
        if ((e.ctrlKey || e.metaKey) && e.key === 's') {
          e.preventDefault();
          if (onSave) {
            onSave(value);
          }
        }
        // Image picker shortcut: Ctrl/Cmd+Shift+I
        // Find and click the InsertImage button in the toolbar
        // The button has aria-label="Insert image" set by MDXEditor
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'i') {
          e.preventDefault();
          const insertImageButton = document.querySelector('[aria-label="Insert image"]') as HTMLButtonElement | null;
          insertImageButton?.click();
        }
      };

      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }, [value, onSave]);

    return (
      <MDXEditorLib
        ref={ref}
        markdown={value}
        onChange={onChange}
        readOnly={readOnly}
        contentEditableClassName="prose max-w-none"
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
          codeMirrorPlugin({
            codeBlockLanguages: {
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
            },
          }),
          diffSourcePlugin({ viewMode: 'rich-text' }),
          markdownShortcutPlugin(),
          jsxPlugin(),
          imagePlugin({
            ImageDialog: ImagePickerDialog,
            disableImageSettingsButton: true, // Per CONTEXT: no dimension prompts
          }),
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
                <InsertImage />
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

CMSMDXEditor.displayName = 'CMSMDXEditor';

/**
 * DeferredCMSMDXEditor - A wrapper component that defers CMSMDXEditor initialization
 * to avoid React 19 render-phase state updates.
 *
 * See the original DeferredMDXEditor in @conloca/mdx for detailed documentation.
 */
const DeferredCMSMDXEditor: React.FC<CMSMDXEditorProps> = ({ value, onChange, onSave, readOnly }) => {
  const editorRef = React.useRef<MDXEditorMethods>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    // Use setTimeout to defer initialization to the next tick of the event loop
    // This ensures React has completed the current render cycle before MDXEditor initializes
    const timer = setTimeout(() => {
      setIsReady(true);
    }, 10); // 10ms is sufficient to defer to the next tick

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
      <CMSMDXEditor ref={editorRef} value={value} onChange={onChange} onSave={onSave} readOnly={readOnly} />
    </div>
  );
};

// Dialog/Modal components (simplified for now, can be replaced with proper UI library)
interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}

const Dialog: React.FC<DialogProps> = ({ open, onOpenChange, children }) => {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50" onClick={() => onOpenChange(false)} />
      <div className="relative z-50 bg-white rounded-lg shadow-lg max-w-[90vw] max-h-[90vh] overflow-hidden">
        {children}
      </div>
    </div>
  );
};

const DialogContent: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => {
  return <div className={`p-6 ${className}`}>{children}</div>;
};

const DialogHeader: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return <div className="mb-4">{children}</div>;
};

const DialogTitle: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return <h2 className="text-xl font-semibold">{children}</h2>;
};

export interface CMSMDXEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  filePath?: string;
  initialContent: string;
  onSave: (content: string) => void | Promise<void>;
  headerExtra?: React.ReactNode;
  onBeforeClose?: () => boolean; // Return false to prevent closing
}

/**
 * Modal wrapper for CMSMDXEditor with integrated Media Library image picker.
 * Use this instead of MDXEditorModal from @conloca/mdx when you need the image picker.
 */
export const CMSMDXEditorModal: React.FC<CMSMDXEditorModalProps> = ({
  isOpen,
  onClose,
  filePath,
  initialContent,
  onSave,
  headerExtra,
  onBeforeClose,
}) => {
  const [content, setContent] = useState(initialContent);
  const [isEditorReady, setIsEditorReady] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setContent(initialContent);
  }, [initialContent]);

  const handleClose = () => {
    // Check if parent wants to prevent closing
    if (onBeforeClose && !onBeforeClose()) {
      return;
    }
    onClose();
  };

  // Defer editor initialization to avoid render-phase state updates
  useEffect(() => {
    if (isOpen) {
      // Use a small delay to ensure we're out of the render phase
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
      // Only close if onSave completes without error
      handleClose();
    } catch (error) {
      // If onSave throws, don't close the modal
      console.error('Save failed:', error);
    } finally {
      setIsSaving(false);
    }
  };

  // Only render the editor when the modal is actually open
  if (!isOpen) {
    return null;
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="w-[90vw] h-[90vh] flex flex-col" data-testid="mdx-editor-modal">
        <DialogHeader>
          <div className="flex items-center justify-between gap-4">
            <DialogTitle>{filePath ? `Edit: ${filePath}` : 'New MDX File'}</DialogTitle>
            {headerExtra && <div className="flex items-center gap-2">{headerExtra}</div>}
            <button onClick={handleClose} className="p-2 hover:bg-gray-100 rounded" aria-label="Close">
              ✕
            </button>
          </div>
        </DialogHeader>
        <div className="flex-1 overflow-hidden">
          {isEditorReady ? (
            <MDXEditorErrorBoundary>
              {/* Using DeferredCMSMDXEditor to avoid React 19 render-phase state update errors */}
              <DeferredCMSMDXEditor value={content} onChange={setContent} onSave={handleSave} />
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
            onClick={handleClose}
            className="px-4 py-2 border border-gray-300 rounded hover:bg-gray-50"
            disabled={isSaving}
          >
            Cancel
          </button>
          <button
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
};
