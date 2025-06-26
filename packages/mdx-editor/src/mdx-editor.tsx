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

  useEffect(() => {
    setContent(initialContent);
  }, [initialContent]);

  const handleSave = () => {
    onSave(content);
    onClose();
  };

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
          <MDXEditor value={content} onChange={setContent} onSave={handleSave} />
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
