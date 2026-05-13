import { readStringAttribute, writeStringAttribute } from '@conloca/astro-cms';
import type { JsxEditorProps } from '@mdxeditor/editor';
import { NestedLexicalEditor, useLexicalNodeRemove, useMdastNodeUpdater } from '@mdxeditor/editor';
import { Trash2 } from 'lucide-react';
import type * as Mdast from 'mdast';
import type { MdxJsxFlowElement } from 'mdast-util-mdx-jsx';

/**
 * Editor for Starlight `<Card>` — a titled, optionally-iconed box with a
 * rich-text body. Props sourced from
 * node_modules/@astrojs/starlight/user-components/Card.astro.
 */
export function CardEditor({ mdastNode }: JsxEditorProps) {
  const updater = useMdastNodeUpdater<MdxJsxFlowElement>();
  const removeNode = useLexicalNodeRemove();

  const node = mdastNode as MdxJsxFlowElement;
  const title = readStringAttribute(node, 'title');
  const icon = readStringAttribute(node, 'icon');

  const setTitle = (next: string) => {
    updater({ attributes: writeStringAttribute(node.attributes, 'title', next) });
  };
  const setIcon = (next: string) => {
    updater({ attributes: writeStringAttribute(node.attributes, 'icon', next) });
  };

  return (
    <div
      className="my-3 border border-grey-09 dark:border-grey-04 rounded-md"
      data-starlight-card-editor
      contentEditable={false}
    >
      <div className="flex items-center gap-2 px-3 pt-2 text-xs text-grey-04 dark:text-grey-07">
        <span className="font-semibold uppercase tracking-wide">Card</span>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title (required)"
          aria-label="Card title"
          className="flex-1 bg-transparent border border-grey-09 dark:border-grey-04 rounded px-1.5 py-0.5 text-xs"
        />
        <input
          type="text"
          value={icon}
          onChange={(e) => setIcon(e.target.value)}
          placeholder="Icon name (optional)"
          aria-label="Card icon"
          className="w-32 bg-transparent border border-grey-09 dark:border-grey-04 rounded px-1.5 py-0.5 text-xs"
        />
        <button
          type="button"
          onClick={removeNode}
          aria-label="Remove card"
          title="Remove card"
          className="p-1 rounded hover:bg-grey-10 dark:hover:bg-grey-04"
        >
          <Trash2 size={12} aria-hidden />
        </button>
      </div>
      <div className="px-4 py-2">
        <NestedLexicalEditor<MdxJsxFlowElement>
          getContent={(n) => n.children as Mdast.PhrasingContent[]}
          getUpdatedMdastNode={(n, children) => ({
            ...n,
            children: children as MdxJsxFlowElement['children'],
          })}
        />
      </div>
    </div>
  );
}
