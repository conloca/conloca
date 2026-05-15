import { readStringAttribute, writeStringAttribute } from '@conloca/astro-cms';
import type { JsxEditorProps } from '@mdxeditor/editor';
import { NestedLexicalEditor, useLexicalNodeRemove, useMdastNodeUpdater } from '@mdxeditor/editor';
import { Star, Trash2 } from 'lucide-react';
import type * as Mdast from 'mdast';
import type { MdxJsxFlowElement } from 'mdast-util-mdx-jsx';

/**
 * Editor for Starlight `<Card>` — a titled, optionally-iconed box with a
 * rich-text body. Markup mirrors the published `article.card` silhouette
 * (`.title` row → `.body` region) so the editor surface reads as the same
 * shape; tokens come from `starlight-components.css` on the host with
 * fallbacks in `@conloca/mdx/editor-styles.css` for the SPA admin doc.
 *
 * Props from node_modules/@astrojs/starlight/user-components/Card.astro.
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
    <div className="conloca-card conloca-card-editor" contentEditable={false}>
      <div className="conloca-card__title">
        <Star className="conloca-card__icon" aria-hidden focusable={false} />
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title (required)"
          aria-label="Card title"
          className="conloca-card__title-input"
        />
        <input
          type="text"
          value={icon}
          onChange={(e) => setIcon(e.target.value)}
          placeholder="Icon name"
          aria-label="Card icon"
          className="conloca-card__icon-input"
        />
        <button
          type="button"
          onClick={removeNode}
          aria-label="Remove card"
          title="Remove card"
          className="conloca-card__remove"
        >
          <Trash2 size={14} aria-hidden />
        </button>
      </div>
      <div className="conloca-card__body">
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
