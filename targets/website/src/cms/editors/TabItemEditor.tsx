import { readStringAttribute, writeStringAttribute } from '@conloca/astro-cms';
import type { JsxEditorProps } from '@mdxeditor/editor';
import { NestedLexicalEditor, useLexicalNodeRemove, useMdastNodeUpdater } from '@mdxeditor/editor';
import { Trash2 } from 'lucide-react';
import type * as Mdast from 'mdast';
import type { MdxJsxFlowElement } from 'mdast-util-mdx-jsx';

/**
 * Editor for Starlight `<TabItem>` — a single tab inside a `<Tabs>` group.
 * Props from node_modules/@astrojs/starlight/user-components/TabItem.astro.
 */
export function TabItemEditor({ mdastNode }: JsxEditorProps) {
  const updater = useMdastNodeUpdater<MdxJsxFlowElement>();
  const removeNode = useLexicalNodeRemove();

  const node = mdastNode as MdxJsxFlowElement;
  const label = readStringAttribute(node, 'label');
  const icon = readStringAttribute(node, 'icon');

  const setAttr = (name: string, value: string) => {
    updater({ attributes: writeStringAttribute(node.attributes, name, value) });
  };

  return (
    <div
      className="my-2 border border-grey-09 dark:border-grey-04 rounded-md"
      data-starlight-tabitem-editor
      contentEditable={false}
    >
      <div className="flex items-center gap-2 px-3 pt-2 text-xs text-grey-04 dark:text-grey-07">
        <span className="font-semibold uppercase tracking-wide whitespace-nowrap">Tab</span>
        <input
          type="text"
          value={label}
          onChange={(e) => setAttr('label', e.target.value)}
          placeholder="Label (required)"
          aria-label="Tab label"
          className="flex-1 bg-transparent border border-grey-09 dark:border-grey-04 rounded px-1.5 py-0.5 text-xs"
        />
        <input
          type="text"
          value={icon}
          onChange={(e) => setAttr('icon', e.target.value)}
          placeholder="Icon (optional)"
          aria-label="Tab icon"
          className="w-32 bg-transparent border border-grey-09 dark:border-grey-04 rounded px-1.5 py-0.5 text-xs"
        />
        <button
          type="button"
          onClick={removeNode}
          aria-label="Remove tab"
          title="Remove tab"
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
