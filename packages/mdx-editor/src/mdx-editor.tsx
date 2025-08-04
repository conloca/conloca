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

export interface MDXEditorProps {
  value: string;
  onChange: (value: string) => void;
  onSave?: (value: string) => void;
  readOnly?: boolean;
}

export const MDXEditor = React.forwardRef<MDXEditorMethods, MDXEditorProps>(
  ({ value, onChange, onSave, readOnly = false }, ref) => {
    // Handle keyboard shortcuts
    useEffect(() => {
      if (!onSave) return;

      const handleKeyDown = (e: KeyboardEvent) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 's') {
          e.preventDefault();
          onSave(value);
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
          imagePlugin(),
          tablePlugin(),
          thematicBreakPlugin(),
          frontmatterPlugin(),
          codeBlockPlugin({ defaultCodeBlockLanguage: 'typescript' }),
          codeMirrorPlugin({
            codeBlockLanguages: {
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
          toolbarPlugin({
            toolbarContents: () => (
              <>
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
              </>
            ),
          }),
        ]}
      />
    );
  },
);

MDXEditor.displayName = 'MDXEditor';

/**
 * DeferredMDXEditor - A wrapper component that defers MDXEditor initialization to avoid React 19 render-phase state updates
 *
 * ## Why This Wrapper Exists
 *
 * MDXEditor (v3.38.0) uses Lexical under the hood, which performs synchronous state updates during its initial render
 * when provided with markdown content. This violates React 19's stricter rules about state updates during render.
 *
 * ## The Specific React 19 Issue
 *
 * In React 19, the framework is more strict about preventing state updates during the render phase. When MDXEditor
 * initializes with the `markdown` prop, Lexical immediately:
 * 1. Parses the markdown content
 * 2. Converts it to Lexical's internal state representation
 * 3. Attempts to commit these changes via `$commitPendingUpdates`
 *
 * This happens synchronously during render, causing the error:
 * "Can't perform a React state update on a component that hasn't mounted yet"
 *
 * ## How This Wrapper Solves It
 *
 * By deferring the actual MDXEditor component render by 10ms using setTimeout, we ensure:
 * 1. React completes the current render cycle
 * 2. The component tree is fully mounted
 * 3. Only then does MDXEditor initialize with its content
 *
 * This prevents Lexical from trying to update state during the render phase.
 *
 * ## When This Issue Occurs
 *
 * This issue is particularly prevalent when:
 * - Using MDXEditor in a modal that mounts/unmounts frequently
 * - Dynamically loading content into the editor
 * - Using React 19 with its stricter concurrent rendering rules
 *
 * ## Technical Details
 *
 * The error stack trace shows the issue originates from:
 * - triggerListeners @ Lexical.dev.mjs:8156
 * - $commitPendingUpdates @ Lexical.dev.mjs:8116
 *
 * These Lexical internal methods are called during the initial render when markdown content is provided.
 *
 * ## Future Considerations
 *
 * This wrapper is a workaround for what should ideally be fixed in the MDXEditor/Lexical library itself.
 * The library should defer its own state initialization to a useEffect or similar to be React 19 compliant.
 *
 * Related issues:
 * - https://github.com/mdx-editor/editor/issues/494 (React 19 compatibility)
 * - Various modal-related issues (#584, #581, #758, #276)
 */
const DeferredMDXEditor: React.FC<MDXEditorProps> = ({ value, onChange, onSave, readOnly }) => {
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
      <MDXEditor ref={editorRef} value={value} onChange={onChange} onSave={onSave} readOnly={readOnly} />
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

export interface MDXEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  filePath?: string;
  initialContent: string;
  onSave: (content: string) => void;
}

export const MDXEditorModal: React.FC<MDXEditorModalProps> = ({
  isOpen,
  onClose,
  filePath,
  initialContent,
  onSave,
}) => {
  const [content, setContent] = useState(initialContent);
  const [isEditorReady, setIsEditorReady] = useState(false);

  useEffect(() => {
    setContent(initialContent);
  }, [initialContent]);

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

  const handleSave = () => {
    onSave(content);
    onClose();
  };

  // Only render the editor when the modal is actually open
  if (!isOpen) {
    return null;
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="w-[90vw] h-[90vh] flex flex-col" data-testid="mdx-editor-modal">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle>{filePath ? `Edit: ${filePath}` : 'New MDX File'}</DialogTitle>
            <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded" aria-label="Close">
              ✕
            </button>
          </div>
        </DialogHeader>
        <div className="flex-1 overflow-hidden">
          {isEditorReady ? (
            // Using DeferredMDXEditor to avoid React 19 render-phase state update errors
            // See DeferredMDXEditor documentation for detailed explanation
            <DeferredMDXEditor value={content} onChange={setContent} onSave={handleSave} />
          ) : (
            <div className="flex items-center justify-center h-full">
              <div className="text-gray-500" data-testid="modal-editor-loading">
                Loading editor...
              </div>
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} className="px-4 py-2 border border-gray-300 rounded hover:bg-gray-50">
            Cancel
          </button>
          <button onClick={handleSave} className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600">
            Save
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
