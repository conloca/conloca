import { type CodeBlockEditorDescriptor, type CodeBlockEditorProps, CodeMirrorEditor } from '@mdxeditor/editor';
import { Check, Copy } from 'lucide-react';
import { useCallback, useState } from 'react';

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

const TITLE_META_RE = /title=(?:"([^"]*)"|'([^']*)'|([^\s]+))/;

function parseFilename(meta: string): string | undefined {
  const trimmed = meta.trim();
  if (!trimmed) return undefined;
  const match = trimmed.match(TITLE_META_RE);
  if (match) return match[1] ?? match[2] ?? match[3];
  // Bare-meta fallback: `\`\`\`ts foo.ts` — treat the whole meta as the title
  // when it doesn't include `=`, the convention EC and rehype-pretty-code share.
  if (!trimmed.includes('=')) return trimmed;
  return undefined;
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

// Reads the config at render time from the cms-spa registry without
// importing the registry directly (would create a hard dep from @conloca/mdx
// → @conloca/cms-spa). The registry mounts itself on `window` under a
// documented key; absent host registration, every chrome bit defaults to on.
interface CodeBlockConfigShape {
  showCopyButton?: boolean;
  showFilename?: boolean;
  showLanguageTag?: boolean;
}

function readCodeBlockConfig(): CodeBlockConfigShape {
  if (typeof window === 'undefined') return {};
  const state = (window as unknown as { __CODE_BLOCK_CONFIG_STATE__?: { config: CodeBlockConfigShape } })
    .__CODE_BLOCK_CONFIG_STATE__;
  return state?.config ?? {};
}

function ConlocaCodeBlockEditor(props: CodeBlockEditorProps) {
  const config = readCodeBlockConfig();
  const showCopyButton = config.showCopyButton ?? true;
  const showFilename = config.showFilename ?? true;
  const showLanguageTag = config.showLanguageTag ?? true;

  const filename = showFilename ? parseFilename(props.meta) : undefined;
  const showHeader = Boolean(filename) || showLanguageTag || showCopyButton;

  return (
    <div className="conloca-code-block">
      {showHeader ? (
        <div className="conloca-code-block__header">
          <span className="conloca-code-block__filename">{filename ?? ''}</span>
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
