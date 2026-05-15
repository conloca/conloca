import { readStringAttribute, writeStringAttribute } from '@conloca/astro-cms';
import type { JsxEditorProps } from '@mdxeditor/editor';
import { NestedLexicalEditor, useLexicalNodeRemove, useMdastNodeUpdater } from '@mdxeditor/editor';
import { LayoutPanelTop, Trash2 } from 'lucide-react';
import type * as Mdast from 'mdast';
import type { MdxJsxFlowElement } from 'mdast-util-mdx-jsx';

/**
 * Editor for Starlight `<Tabs>` — the wrapper that draws the chip row
 * above its `<TabItem>` panels.
 *
 * Published markup: `<starlight-tabs>` → `.tablist-wrapper > ul[role=tablist]`
 * with one `<li class="tab">` per panel, then one `[role=tabpanel]` per
 * panel hidden except the active one.
 *
 * Pattern A drift: the editor stacks every `<TabItem>` panel rather than
 * switching between them. Authors edit each panel inline; switching is a
 * runtime concern of the published page, not the authoring surface.
 *
 * Props from node_modules/@astrojs/starlight/user-components/Tabs.astro
 * — `{ syncKey?: string }`.
 */
export function TabsEditor({ mdastNode }: JsxEditorProps) {
  const updater = useMdastNodeUpdater<MdxJsxFlowElement>();
  const removeNode = useLexicalNodeRemove();

  const node = mdastNode as MdxJsxFlowElement;
  const syncKey = readStringAttribute(node, 'syncKey');

  const setSyncKey = (next: string) => {
    updater({ attributes: writeStringAttribute(node.attributes, 'syncKey', next) });
  };

  return (
    <div className="conloca-tabs-editor" contentEditable={false}>
      <div className="conloca-tabs__chip">
        <LayoutPanelTop className="conloca-tabs__chip-icon" size={14} aria-hidden focusable={false} />
        <span className="conloca-tabs__chip-label">Tabs</span>
        <input
          type="text"
          value={syncKey}
          onChange={(e) => setSyncKey(e.target.value)}
          placeholder="syncKey (optional)"
          aria-label="Tabs sync key"
          className="conloca-tabs__synckey-input"
        />
        <button
          type="button"
          onClick={removeNode}
          aria-label="Remove tabs"
          title="Remove tabs"
          className="conloca-tabs__remove"
        >
          <Trash2 size={14} aria-hidden />
        </button>
      </div>
      <div className="conloca-tabs__panels">
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
