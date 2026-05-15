import type { JsxEditorProps } from '@mdxeditor/editor';
import { NestedLexicalEditor, useLexicalNodeRemove, useMdastNodeUpdater } from '@mdxeditor/editor';
import { LayoutGrid, Trash2 } from 'lucide-react';
import type * as Mdast from 'mdast';
import type { MdxJsxAttribute, MdxJsxFlowElement } from 'mdast-util-mdx-jsx';

/**
 * Editor for Starlight `<CardGrid>` — a responsive grid wrapping `<Card>`
 * children, with an optional `stagger` boolean offsetting alternating
 * columns on wide viewports.
 *
 * Markup mirrors the published `.card-grid` silhouette so the editor reads
 * the same `--conloca-card-grid-*` tokens declared in
 * `targets/website/src/styles/starlight-components.css` (and re-declared
 * as fallbacks in `@conloca/mdx/editor-styles.css` for the SPA admin doc).
 *
 * Props from node_modules/@astrojs/starlight/user-components/CardGrid.astro.
 *
 * Pattern A drift: Starlight's stagger uses
 * `.stagger > :global(*):nth-child(2n) { transform: translateY(5rem) }`
 * which only kicks in at min-width: 50rem. The editor mirrors the class
 * (so the rule paints when the editor surface is wide enough) but the
 * MDXEditor nestedEditor wraps each card in an extra `<div>`, so the
 * `:nth-child(2n)` selector doesn't reach the inner `<article>` siblings
 * the same way it does on the published page. Accepted as drift.
 */
function readBooleanAttribute(node: MdxJsxFlowElement, name: string): boolean {
  return node.attributes.some(
    (a) =>
      a.type === 'mdxJsxAttribute' &&
      a.name === name &&
      (a.value === null || a.value === undefined || a.value === 'true'),
  );
}

function writeBooleanAttribute(
  attributes: MdxJsxFlowElement['attributes'],
  name: string,
  value: boolean,
): MdxJsxFlowElement['attributes'] {
  const next = attributes.filter((a) => !(a.type === 'mdxJsxAttribute' && a.name === name));
  if (value) {
    const attr: MdxJsxAttribute = { type: 'mdxJsxAttribute', name, value: null };
    next.push(attr);
  }
  return next;
}

export function CardGridEditor({ mdastNode }: JsxEditorProps) {
  const updater = useMdastNodeUpdater<MdxJsxFlowElement>();
  const removeNode = useLexicalNodeRemove();

  const node = mdastNode as MdxJsxFlowElement;
  const stagger = readBooleanAttribute(node, 'stagger');

  const setStagger = (next: boolean) => {
    updater({ attributes: writeBooleanAttribute(node.attributes, 'stagger', next) });
  };

  return (
    <div
      className={`conloca-card-grid-editor${stagger ? ' conloca-card-grid-editor--stagger' : ''}`}
      contentEditable={false}
    >
      <div className="conloca-card-grid__chip">
        <LayoutGrid className="conloca-card-grid__chip-icon" size={14} aria-hidden focusable={false} />
        <span className="conloca-card-grid__chip-label">CardGrid</span>
        <label className="conloca-card-grid__stagger">
          <input type="checkbox" checked={stagger} onChange={(e) => setStagger(e.target.checked)} />
          stagger
        </label>
        <button
          type="button"
          onClick={removeNode}
          aria-label="Remove card grid"
          title="Remove card grid"
          className="conloca-card-grid__remove"
        >
          <Trash2 size={14} aria-hidden />
        </button>
      </div>
      <div className={`conloca-card-grid${stagger ? ' stagger' : ''}`}>
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
