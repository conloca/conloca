import { readStringAttribute, writeStringAttribute } from '@conloca/astro-cms';
import type { JsxEditorProps } from '@mdxeditor/editor';
import { NestedLexicalEditor, useLexicalNodeRemove, useMdastNodeUpdater } from '@mdxeditor/editor';
import { Square, Trash2 } from 'lucide-react';
import type * as Mdast from 'mdast';
import type { MdxJsxFlowElement } from 'mdast-util-mdx-jsx';

/**
 * Editor for Starlight `<TabItem>` — a single tab inside a `<Tabs>` group.
 *
 * Published `<Tabs>` renders one `[role="tabpanel"]` at a time with a chip
 * row above. The editor flattens that: each TabItem renders as its own
 * stacked block — a chip-shaped header row with the label/icon controls
 * and a panel area below for the rich body content. Visual chrome lines up
 * with the active-tab look on the published page (accent underline, white
 * text, 600 weight).
 *
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
    <div className="conloca-tab-item-editor" contentEditable={false}>
      <div className="conloca-tab__chip">
        <Square className="conloca-tab__chip-icon" size={16} aria-hidden focusable={false} />
        <input
          type="text"
          value={label}
          onChange={(e) => setAttr('label', e.target.value)}
          placeholder="Tab label"
          aria-label="Tab label"
          className="conloca-tab__label-input"
        />
        <input
          type="text"
          value={icon}
          onChange={(e) => setAttr('icon', e.target.value)}
          placeholder="Icon (optional)"
          aria-label="Tab icon"
          className="conloca-tab__icon-input"
        />
        <button
          type="button"
          onClick={removeNode}
          aria-label="Remove tab"
          title="Remove tab"
          className="conloca-tab__remove"
        >
          <Trash2 size={14} aria-hidden />
        </button>
      </div>
      <div className="conloca-tab__panel">
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
