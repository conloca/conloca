import {
  Cell,
  type CodeBlockEditorDescriptor,
  type CodeBlockEditorProps,
  CodeMirrorEditor,
  useCellValue,
  useCodeBlockEditorContext,
} from '@mdxeditor/editor';
import { Check, Copy } from 'lucide-react';
import { type ChangeEvent, createElement, type ReactElement, useCallback, useEffect, useMemo, useState } from 'react';

/**
 * Frame chrome around the editor's fenced code blocks — header bar with
 * filename, language tag, and a copy button. The outer wrapper picks up
 * the host's code-block classes (published via `codeBlockWrapperInfo$`
 * by the host-wrapper plugin in cms-spa), so the host's actual code-
 * block CSS (Starlight's expressive-code, Tailwind's pre styling, etc.)
 * reaches the editor's frame through the cascade — no shipped mirror.
 *
 * Host-agnostic: no Shiki / Starlight / ExpressiveCode imports. Class
 * names are discovered at runtime from the host's live HTML.
 */

/**
 * Realm-published cell carrying the host's code-block wrapper chain,
 * outermost first. For Starlight's expressive-code:
 *
 *   [
 *     { tagName: 'div',    className: 'expressive-code' },
 *     { tagName: 'figure', className: 'frame has-title not-content' },
 *   ]
 *
 * The cms-spa `hostWrapperPlugin` writes to this whenever the fetched
 * wrapper info changes; the code-block frame reads from it to render
 * each chain link as a nested element with the host's expected tag
 * name. Same publish-pattern as the content-wrapper plugin in cms-spa.
 *
 * Null when the host has no code-block chrome (or the fetch is in
 * flight). The frame then falls back to its base `.conloca-code-block`
 * wrapper with no host inheritance — "looks plain but not broken."
 */
export const codeBlockWrapperInfo$ = Cell<{ tagName: string; className: string }[] | null>(null);

const TITLE_META_RE = /\btitle=(?:"([^"]*)"|'([^']*)'|(\S+))/;
// First-line filename comment, the convention ExpressiveCode's frames
// plugin recognizes when no explicit `title=` is set on the fence —
// `// foo.ts`, `# foo.py`, `<!-- foo.html -->`, `/* foo.css */`,
// `; foo.ini`, `-- foo.sql`. Requires a dot-extension so plain prose
// comments don't get mistaken for filenames.
const FILENAME_COMMENT_RE = /^\s*(?:\/\/|#|;|--|<!--|\/\*)\s*([\w.\-/@]+\.[\w.-]+)\s*(?:-->|\*\/)?\s*$/;

interface MetaParts {
  /** The current title value (empty string when no title meta is set). */
  title: string;
  /** Everything else in the meta string, with the title slice removed. */
  rest: string;
}

function parseMeta(meta: string): MetaParts {
  const match = meta.match(TITLE_META_RE);
  if (!match) return { title: '', rest: meta.trim() };
  const value = match[1] ?? match[2] ?? match[3] ?? '';
  const rest = (meta.slice(0, match.index) + meta.slice(match.index! + match[0].length)).replace(/\s+/g, ' ').trim();
  return { title: value, rest };
}

/** Reassemble a meta string with `title` set (or stripped when empty). */
function buildMeta(title: string, rest: string): string {
  const trimmedTitle = title.trim();
  const titleFragment = trimmedTitle ? `title="${trimmedTitle.replace(/"/g, '\\"')}"` : '';
  if (titleFragment && rest) return `${titleFragment} ${rest}`;
  return titleFragment || rest;
}

/**
 * Detect a leading filename comment, the convention EC's frames plugin
 * uses on the published page when no explicit `title=` is set. Returns
 * the filename when line 1 of the code is a single-line comment ending
 * in a dot-extension; empty string otherwise.
 *
 * Used to pre-fill the editor's filename input on legacy fences so
 * authors see the same value the reader sees in the rendered tab. Pure
 * read — the underlying code/comment is never touched.
 */
function detectFilenameComment(code: string): string {
  const firstLine = code.split('\n', 1)[0] ?? '';
  const match = firstLine.match(FILENAME_COMMENT_RE);
  return match ? (match[1] ?? '') : '';
}

function CopyButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const onClick = useCallback(() => {
    void navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    });
  }, [code]);
  return (
    <button
      type="button"
      onClick={onClick}
      className="conloca-code-copy"
      aria-label={copied ? 'Copied' : 'Copy code'}
      title={copied ? 'Copied' : 'Copy code'}
    >
      {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
    </button>
  );
}

/**
 * Editable filename slot. Rewrites the code block's meta string via
 * `setMeta` from `useCodeBlockEditorContext` so authors can author the
 * frame title (`\`\`\`ts title="src/foo.ts"`) directly from the editor —
 * the meta string round-trips through MDXEditor's markdown serializer
 * and ExpressiveCode picks it up as the frame header on the published
 * page. Other meta fragments (ins/del/mark/wrap) are preserved.
 *
 * Legacy fences with a filename comment on line 1 (`// foo.ts`) — EC's
 * pre-meta convention for tab titles — are detected and pre-filled in
 * the input as a read-only display. Opening such a fence does NOT
 * mutate the source. Editing the field is an explicit author intent:
 * the new value is written as `title=` meta AND the original comment
 * line is stripped, so the editor's input becomes the single source of
 * truth without breaking the published render.
 */
function FilenameInput({ meta, code }: { meta: string; code: string }) {
  const { setMeta, setCode } = useCodeBlockEditorContext();
  const parsed = useMemo(() => parseMeta(meta), [meta]);
  const detectedFromComment = useMemo(() => (parsed.title ? '' : detectFilenameComment(code)), [parsed.title, code]);
  const displayed = parsed.title || detectedFromComment;
  const [title, setTitle] = useState(displayed);
  const [interacted, setInteracted] = useState(false);

  // External updates (HMR, language change, sibling code edits) reset
  // the local view to the canonical value and clear the "user edited"
  // flag — so the next blur after an external update doesn't write
  // anything until the author actively types again.
  useEffect(() => {
    setTitle(displayed);
    setInteracted(false);
  }, [displayed]);

  const commit = useCallback(
    (next: string) => {
      if (!interacted) return;
      if (next === parsed.title) return;
      setMeta(buildMeta(next, parsed.rest));
      // If the pre-fill came from a leading filename comment and the
      // author has now committed an explicit title, strip the comment
      // so EC doesn't render the title twice (once as the tab, once as
      // a stray code comment) on the published page.
      if (detectedFromComment) {
        const lines = code.split('\n');
        if (lines[0] && FILENAME_COMMENT_RE.test(lines[0])) {
          setCode(lines.slice(1).join('\n').replace(/^\n+/, ''));
        }
      }
    },
    [interacted, parsed.title, parsed.rest, detectedFromComment, code, setMeta, setCode],
  );

  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    setInteracted(true);
    setTitle(e.target.value);
  };
  const onBlur = () => commit(title);

  return (
    <input
      type="text"
      className="conloca-code-block__filename"
      value={title}
      placeholder="filename"
      spellCheck={false}
      onChange={onChange}
      onBlur={onBlur}
      aria-label="Code block filename"
    />
  );
}

function ConlocaCodeBlockEditor(props: CodeBlockEditorProps) {
  // Materialise the host's discovered code-block chain as nested
  // elements. The INNERMOST link in the chain becomes the "frame"
  // element that directly holds the filename header, the code body,
  // and the copy slot — matching ExpressiveCode's authoring shape:
  //
  //   <div class="expressive-code">                ← outer link
  //     <figure class="frame has-title …">         ← inner link (frame)
  //       <figcaption class="header">
  //         <span class="title"><FilenameInput /></span>
  //       </figcaption>
  //       <pre><CodeMirror /></pre>
  //       <div class="copy"><CopyButton /></div>
  //     </figure>
  //   </div>
  //
  // Rendering with the host's expected tags (figure / figcaption / pre)
  // and nesting depth lets descendant CSS selectors land — both single-
  // class (`.frame { ... }`) and descendant (`.expressive-code .frame
  // .header > .title { ... }`) rules paint without us shipping a
  // parallel copy.
  //
  // When chain is null/empty (host has no code-block chrome, or the
  // wrapper fetch hasn't resolved yet) we fall back to a bare
  // `<div class="conloca-code-block">` containing the same inner
  // shape — "looks plain but not broken."
  const chain = useCellValue(codeBlockWrapperInfo$) ?? [];
  const frameLink = chain.length > 0 ? chain[chain.length - 1] : null;
  const outerLinks = frameLink ? chain.slice(0, -1) : [];

  const frameInner = (
    <>
      <figcaption className="conloca-code-block__header header">
        <span className="title">
          <FilenameInput meta={props.meta} code={props.code} />
        </span>
      </figcaption>
      <pre className="conloca-code-block__pre">
        <CodeMirrorEditor {...props} />
      </pre>
      {/* `.copy` matches expressive-code's expected slot name so any
          `.frame .copy` styling from the host paints. We host only the
          copy button here — language selection lives in MDXEditor's
          own `_codeMirrorToolbar_*` (combobox), positioned via
          editor-styles.css so it doesn't overlap the code. */}
      <div className="conloca-code-block__copy copy">
        <CopyButton code={props.code} />
      </div>
    </>
  );

  // The frame element carries `conloca-code-block` (our own targeting
  // hook) alongside the host's discovered classes. When the host has
  // no chain, we still wrap in a plain `<div>` so the inner shape is
  // consistent for our utility selectors.
  const frame = frameLink ? (
    createElement(frameLink.tagName, { className: `conloca-code-block ${frameLink.className}` }, frameInner)
  ) : (
    <div className="conloca-code-block">{frameInner}</div>
  );

  // Wrap outer links from inside out. `reduceRight` so the first
  // chain link ends up as the outermost rendered element.
  return outerLinks.reduceRight<ReactElement>(
    (kids, link) => createElement(link.tagName, { className: link.className }, kids),
    frame,
  );
}

/**
 * Catch-all descriptor — `priority: 100`, `match: () => true` — registered
 * via `codeBlockPlugin({ codeBlockEditorDescriptors: [conlocaCodeBlockDescriptor] })`.
 * Wraps the upstream `CodeMirrorEditor` with the host-themed frame.
 */
export const conlocaCodeBlockDescriptor: CodeBlockEditorDescriptor = {
  priority: 100,
  match: () => true,
  Editor: ConlocaCodeBlockEditor,
};
