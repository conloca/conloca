import {
  BlockTypeSelect,
  BoldItalicUnderlineToggles,
  ButtonWithTooltip,
  ChangeCodeMirrorLanguage,
  ConditionalContents,
  CreateLink,
  codeBlockPlugin,
  codeMirrorPlugin,
  DiffSourceToggleWrapper,
  diffSourcePlugin,
  GenericJsxEditor,
  HighlightToggle,
  headingsPlugin,
  InsertCodeBlock,
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
  type RealmPlugin,
  Separator,
  StrikeThroughSupSubToggles,
  tablePlugin,
  thematicBreakPlugin,
  toolbarPlugin,
  UndoRedo,
} from '@mdxeditor/editor';
import { Maximize2, Minimize2 } from 'lucide-react';
import React, { useCallback, useEffect, useSyncExternalStore } from 'react';
import '@mdxeditor/editor/style.css';
import './editor-styles.css';
import { conlocaCodeBlockDescriptor } from './code-block-frame';
import { TO_MARKDOWN_OPTIONS } from './markdown-options';

const FOCUS_MODE_STORAGE_KEY = 'conloca.mdxeditor.focusMode';
const FOCUS_MODE_BODY_CLASS = 'mdxeditor-focus-mode';

/**
 * Toggle focus-mode by writing the class on `document.body`. Direct DOM
 * mutation (vs. piping a boolean through React state into the editor's
 * `className` prop) avoids re-rendering Lexical on every toggle — the
 * editor's prop is the only entry point and changing it forces a parse
 * round-trip. Persisted in localStorage so the preference survives reloads.
 */
function readFocusMode(): boolean {
  if (typeof document === 'undefined') return false;
  return document.body.classList.contains(FOCUS_MODE_BODY_CLASS);
}

function subscribeFocusMode(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const handler = () => callback();
  window.addEventListener('conloca:focusModeChange', handler);
  return () => window.removeEventListener('conloca:focusModeChange', handler);
}

function setFocusMode(next: boolean): void {
  if (typeof document === 'undefined') return;
  document.body.classList.toggle(FOCUS_MODE_BODY_CLASS, next);
  try {
    if (next) {
      window.localStorage.setItem(FOCUS_MODE_STORAGE_KEY, '1');
    } else {
      window.localStorage.removeItem(FOCUS_MODE_STORAGE_KEY);
    }
  } catch {
    // localStorage may be unavailable (private mode, SSR) — ignore.
  }
  window.dispatchEvent(new Event('conloca:focusModeChange'));
}

function FocusModeToggle() {
  const focusMode = useSyncExternalStore(subscribeFocusMode, readFocusMode, () => false);
  const onClick = useCallback(() => setFocusMode(!focusMode), [focusMode]);
  const Icon = focusMode ? Minimize2 : Maximize2;
  return (
    <ButtonWithTooltip
      title={focusMode ? 'Exit focus mode (wider column)' : 'Enter focus mode (narrow column)'}
      onClick={onClick}
    >
      <Icon size={16} aria-hidden />
    </ButtonWithTooltip>
  );
}

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
  /**
   * Upload handler for images pasted or dropped directly into the editor. When
   * provided, the underlying imagePlugin will route those events through this
   * function and insert the returned URL as the image src. Independent of the
   * library/picker `imageDialog` flow — both can be active simultaneously.
   */
  imageUploadHandler?: (file: File) => Promise<string>;
  jsxComponentDescriptors?: JsxComponentDescriptor[];
  /**
   * Additional @mdxeditor/editor RealmPlugins appended to the built-in
   * plugin list. Used by the SPA shell to register the MDX components
   * registry-driven slash menu without coupling @conloca/mdx to
   * @conloca/cms-spa.
   */
  extraPlugins?: RealmPlugin[];
  /**
   * Extra toolbar buttons inserted between `<InsertAdmonition />` and the
   * separator preceding focus mode. Pass `null` (default) to keep the
   * stock toolbar.
   */
  extraToolbarItems?: React.ReactNode;
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

/**
 * Restore the persisted focus-mode preference on first import. Runs once at
 * module load so the class is in place before any editor mounts — avoids a
 * flash of wide column when the user previously selected focus mode.
 */
if (typeof window !== 'undefined') {
  try {
    if (window.localStorage.getItem(FOCUS_MODE_STORAGE_KEY) === '1') {
      document.body.classList.add(FOCUS_MODE_BODY_CLASS);
    }
  } catch {
    // ignore
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
      imageUploadHandler,
      jsxComponentDescriptors,
      extraPlugins,
      extraToolbarItems,
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
        toMarkdownOptions={TO_MARKDOWN_OPTIONS}
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
        contentEditableClassName="conloca-prose conloca-prose--editor"
        plugins={[
          headingsPlugin(),
          listsPlugin(),
          quotePlugin(),
          linkPlugin(),
          linkDialogPlugin(),
          tablePlugin(),
          thematicBreakPlugin(),
          // frontmatterPlugin intentionally omitted: metadata (title,
          // description, id, created, modified) is server-owned and stripped
          // from `content.mdx` on load. Re-introducing the plugin would let
          // the editor round-trip a YAML block as body text, corrupting the
          // file when content is inserted above it.
          codeBlockPlugin({
            defaultCodeBlockLanguage: 'ts',
            codeBlockEditorDescriptors: [conlocaCodeBlockDescriptor],
          }),
          codeMirrorPlugin({ codeBlockLanguages }),
          diffSourcePlugin({ viewMode: 'rich-text' }),
          markdownShortcutPlugin(),
          jsxPlugin({
            jsxComponentDescriptors: [...(jsxComponentDescriptors ?? []), ...wildcardJsxDescriptors],
          }),
          imagePlugin({
            ...(imageDialog ? { ImageDialog: imageDialog, disableImageSettingsButton } : {}),
            ...(imageUploadHandler ? { imageUploadHandler } : {}),
          }),
          ...(extraPlugins ?? []),
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
                          {extraToolbarItems}
                          <Separator />
                          <FocusModeToggle />
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
