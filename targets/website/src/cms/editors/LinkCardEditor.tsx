import { readStringAttribute, writeStringAttribute } from '@conloca/astro-cms';
import type { JsxEditorProps } from '@mdxeditor/editor';
import { useLexicalNodeRemove, useMdastNodeUpdater } from '@mdxeditor/editor';
import { Trash2 } from 'lucide-react';
import type { MdxJsxFlowElement } from 'mdast-util-mdx-jsx';

/**
 * Editor for Starlight `<LinkCard>` — self-closing card linking to a URL.
 * Props from node_modules/@astrojs/starlight/user-components/LinkCard.astro.
 * Inherits HTMLAttributes<'a'>; we surface title/href/description as the
 * editable set and leave the rest to authors via Source mode.
 */
export function LinkCardEditor({ mdastNode }: JsxEditorProps) {
  const updater = useMdastNodeUpdater<MdxJsxFlowElement>();
  const removeNode = useLexicalNodeRemove();

  const node = mdastNode as MdxJsxFlowElement;
  const title = readStringAttribute(node, 'title');
  const href = readStringAttribute(node, 'href');
  const description = readStringAttribute(node, 'description');

  const setAttr = (name: string, value: string) => {
    updater({ attributes: writeStringAttribute(node.attributes, name, value) });
  };

  return (
    <div
      className="my-3 border border-grey-09 dark:border-grey-04 rounded-md p-3 space-y-2"
      data-starlight-linkcard-editor
      contentEditable={false}
    >
      <div className="flex items-center gap-2 text-xs text-grey-04 dark:text-grey-07">
        <span className="font-semibold uppercase tracking-wide">LinkCard</span>
        <button
          type="button"
          onClick={removeNode}
          aria-label="Remove link card"
          title="Remove link card"
          className="ml-auto p-1 rounded hover:bg-grey-10 dark:hover:bg-grey-04"
        >
          <Trash2 size={12} aria-hidden />
        </button>
      </div>
      <input
        type="text"
        value={title}
        onChange={(e) => setAttr('title', e.target.value)}
        placeholder="Title (required)"
        aria-label="Link card title"
        className="w-full bg-transparent border border-grey-09 dark:border-grey-04 rounded px-2 py-1 text-sm"
      />
      <input
        type="text"
        value={href}
        onChange={(e) => setAttr('href', e.target.value)}
        placeholder="https://… or /relative-path (required)"
        aria-label="Link card href"
        className="w-full bg-transparent border border-grey-09 dark:border-grey-04 rounded px-2 py-1 text-sm font-mono"
      />
      <input
        type="text"
        value={description}
        onChange={(e) => setAttr('description', e.target.value)}
        placeholder="Description (optional)"
        aria-label="Link card description"
        className="w-full bg-transparent border border-grey-09 dark:border-grey-04 rounded px-2 py-1 text-sm"
      />
    </div>
  );
}
