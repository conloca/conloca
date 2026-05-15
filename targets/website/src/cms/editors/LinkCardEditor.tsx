import { readStringAttribute, writeStringAttribute } from '@conloca/astro-cms';
import type { JsxEditorProps } from '@mdxeditor/editor';
import { useLexicalNodeRemove, useMdastNodeUpdater } from '@mdxeditor/editor';
import { ChevronRight, Trash2 } from 'lucide-react';
import type { MdxJsxFlowElement } from 'mdast-util-mdx-jsx';

/**
 * Editor for Starlight `<LinkCard>` — self-closing card linking to a URL.
 * Markup mirrors the published `.sl-link-card` grid silhouette (stacked
 * title + description on the left, arrow icon on the right). Tokens come
 * from `starlight-components.css` on the host with fallbacks in
 * `@conloca/mdx/editor-styles.css` for the SPA admin doc.
 *
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
    <div className="conloca-link-card conloca-link-card-editor" contentEditable={false}>
      <div className="conloca-link-card__stack">
        <input
          type="text"
          value={title}
          onChange={(e) => setAttr('title', e.target.value)}
          placeholder="Title (required)"
          aria-label="Link card title"
          className="conloca-link-card__title-input"
        />
        <input
          type="text"
          value={description}
          onChange={(e) => setAttr('description', e.target.value)}
          placeholder="Description (optional)"
          aria-label="Link card description"
          className="conloca-link-card__description-input"
        />
        <input
          type="text"
          value={href}
          onChange={(e) => setAttr('href', e.target.value)}
          placeholder="https://… or /relative-path"
          aria-label="Link card href"
          className="conloca-link-card__href-input"
        />
      </div>
      <ChevronRight className="conloca-link-card__icon" aria-hidden focusable={false} />
      <button
        type="button"
        onClick={removeNode}
        aria-label="Remove link card"
        title="Remove link card"
        className="conloca-link-card__remove"
        style={{ position: 'absolute', top: 4, right: 4 }}
      >
        <Trash2 size={14} aria-hidden />
      </button>
    </div>
  );
}
