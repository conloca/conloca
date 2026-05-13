import {
  type CodeBlockEditorDescriptor,
  type CodeBlockEditorProps,
  CodeMirrorEditor,
  useCodeBlockEditorContext,
} from '@mdxeditor/editor';
import { Check, Copy } from 'lucide-react';
import { type ChangeEvent, useCallback, useEffect, useMemo, useState } from 'react';

/**
 * Frame chrome around the editor's fenced code blocks — header bar with
 * filename, language tag, and a copy button — matched (via the shared
 * `--conloca-code-*` CSS tokens defined in the host's `code-blocks.css`)
 * to the frame ExpressiveCode draws on the published page.
 *
 * Host-agnostic: no Shiki / Starlight / ExpressiveCode imports. Behavior
 * toggles flow through the host's `codeBlockConfig` (`packages/cms-spa`).
 * Reads the config lazily inside the Editor component so HMR updates land
 * without remounting the descriptor.
 */

const TITLE_META_RE = /\btitle=(?:"([^"]*)"|'([^']*)'|(\S+))/;

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

// Subscribes to the cms-spa code-block config registry via the shared
// window cell — same `__CODE_BLOCK_CONFIG_STATE__` key + subscribers set
// `cms-spa`'s `useCodeBlockConfig` writes to. Reaching through the window
// avoids a hard `@conloca/mdx → @conloca/cms-spa` import (which would be
// circular: cms-spa already depends on mdx). Structural compatibility on
// the config shape is enough — extra fields the host sets get ignored,
// missing fields default to `true` at the call site.
interface CodeBlockConfigShape {
  showCopyButton?: boolean;
  showFilename?: boolean;
  showLanguageTag?: boolean;
}

interface SharedCodeBlockConfigCell {
  config: CodeBlockConfigShape;
  subscribers: Set<(config: CodeBlockConfigShape) => void>;
}

function getSharedCell(): SharedCodeBlockConfigCell | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as unknown as { __CODE_BLOCK_CONFIG_STATE__?: SharedCodeBlockConfigCell }).__CODE_BLOCK_CONFIG_STATE__;
}

function useCodeBlockConfig(): CodeBlockConfigShape {
  const [config, setConfig] = useState<CodeBlockConfigShape>(() => getSharedCell()?.config ?? {});

  useEffect(() => {
    const cell = getSharedCell();
    if (!cell) return;
    if (cell.config !== config) setConfig(cell.config);
    cell.subscribers.add(setConfig);
    return () => {
      cell.subscribers.delete(setConfig);
    };
  }, [config]);

  return config;
}

/**
 * Editable filename slot. Rewrites the code block's meta string via
 * `setMeta` from `useCodeBlockEditorContext` so authors can author the
 * frame title (`\`\`\`ts title="src/foo.ts"`) directly from the editor —
 * the meta string round-trips through MDXEditor's markdown serializer
 * and ExpressiveCode picks it up as the frame header on the published
 * page. Other meta fragments (ins/del/mark/wrap) are preserved.
 */
function FilenameInput({ meta }: { meta: string }) {
  const { setMeta } = useCodeBlockEditorContext();
  const parsed = useMemo(() => parseMeta(meta), [meta]);
  const [title, setTitle] = useState(parsed.title);

  // External meta changes (HMR, language change, etc.) win over local
  // input state. Comparing against `parsed.title` (not `meta`) avoids a
  // round-trip flicker when this component's own change just landed.
  useEffect(() => {
    setTitle(parsed.title);
  }, [parsed.title]);

  const commit = useCallback(
    (next: string) => {
      const nextMeta = buildMeta(next, parsed.rest);
      if (nextMeta !== meta.trim()) setMeta(nextMeta);
    },
    [meta, parsed.rest, setMeta],
  );

  const onChange = (e: ChangeEvent<HTMLInputElement>) => setTitle(e.target.value);
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
  const config = useCodeBlockConfig();
  const showCopyButton = config.showCopyButton ?? true;
  const showFilename = config.showFilename ?? true;
  const showLanguageTag = config.showLanguageTag ?? true;
  const showHeader = showFilename || showLanguageTag || showCopyButton;

  return (
    <div className="conloca-code-block">
      {showHeader ? (
        <div className="conloca-code-block__header">
          {showFilename ? <FilenameInput meta={props.meta} /> : <span />}
          <div className="conloca-code-block__header-right">
            {showLanguageTag && props.language ? (
              <span className="conloca-code-block__lang">{props.language}</span>
            ) : null}
            {showCopyButton ? <CopyButton code={props.code} /> : null}
          </div>
        </div>
      ) : null}
      <div className="conloca-code-block__body">
        <CodeMirrorEditor {...props} />
      </div>
    </div>
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
