import { readStringAttribute, writeStringAttribute } from '@conloca/astro-cms';
import type { JsxEditorProps } from '@mdxeditor/editor';
import { NestedLexicalEditor, useLexicalNodeRemove, useMdastNodeUpdater } from '@mdxeditor/editor';
import { AlertOctagon, AlertTriangle, Info, type LucideIcon, Rocket, Trash2 } from 'lucide-react';
import type * as Mdast from 'mdast';
import type { MdxJsxFlowElement } from 'mdast-util-mdx-jsx';

type AsideType = 'note' | 'tip' | 'caution' | 'danger';
const ASIDE_TYPES: AsideType[] = ['note', 'tip', 'caution', 'danger'];

/**
 * Lucide icons chosen to read close to Starlight's built-in aside icons
 * (pen / rocket / triangle / shield) without pulling Starlight's SVG
 * sprite into the editor bundle. The icon colour inherits `currentColor`
 * so it picks up `--conloca-aside-active-accent` via the title rule in
 * `@conloca/mdx/editor-styles.css`.
 */
const TYPE_ICON: Record<AsideType, LucideIcon> = {
  note: Info,
  tip: Rocket,
  caution: AlertTriangle,
  danger: AlertOctagon,
};

const TYPE_LABEL: Record<AsideType, string> = {
  note: 'Note',
  tip: 'Tip',
  caution: 'Caution',
  danger: 'Danger',
};

/**
 * Editor surface for `<Aside>` JSX callouts.
 *
 * Markup mirrors the directive-lowered `.conloca-aside` shape and the
 * Starlight `<aside class="starlight-aside">` shape so all three surfaces
 * read the same `--conloca-aside-*` tokens declared in
 * `targets/website/src/styles/asides.css` (host) and re-declared as
 * fallbacks in `@conloca/mdx/editor-styles.css` for the CMS SPA admin doc.
 *
 * The `.conloca-aside-editor` modifier adds the interactive title row
 * (icon + type select + optional title + remove button) on top of the
 * shared chrome. The descriptor is registered against `name: 'Aside'`, so
 * unknown JSX still falls through to the wildcard GenericJsxEditor.
 *
 * The four type values (`note | tip | caution | danger`) match the
 * Starlight Aside vocabulary; anything outside that set is normalised to
 * `note` on first edit so the dropdown always reflects a real option.
 */
export function AsideEditor({ mdastNode }: JsxEditorProps) {
  const updater = useMdastNodeUpdater<MdxJsxFlowElement>();
  const removeNode = useLexicalNodeRemove();

  const node = mdastNode as MdxJsxFlowElement;
  const rawType = readStringAttribute(node, 'type');
  const type: AsideType = (ASIDE_TYPES as string[]).includes(rawType) ? (rawType as AsideType) : 'note';
  const title = readStringAttribute(node, 'title');
  const Icon = TYPE_ICON[type];

  const setType = (nextType: AsideType) => {
    updater({ attributes: writeStringAttribute(node.attributes, 'type', nextType) });
  };
  const setTitle = (nextTitle: string) => {
    updater({ attributes: writeStringAttribute(node.attributes, 'title', nextTitle) });
  };

  return (
    <div className={`conloca-aside conloca-aside-${type} conloca-aside-editor`} contentEditable={false}>
      <div className="conloca-aside-title">
        <Icon className="conloca-aside-title__icon" aria-hidden focusable={false} />
        <select
          value={type}
          onChange={(event) => setType(event.target.value as AsideType)}
          aria-label="Aside type"
          className="conloca-aside-title__select"
        >
          {ASIDE_TYPES.map((option) => (
            <option key={option} value={option}>
              {TYPE_LABEL[option]}
            </option>
          ))}
        </select>
        <input
          type="text"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Optional title"
          aria-label="Aside title"
          className="conloca-aside-title__input"
        />
        <button
          type="button"
          onClick={removeNode}
          aria-label="Remove aside"
          title="Remove aside"
          className="conloca-aside-title__remove"
        >
          <Trash2 size={14} aria-hidden />
        </button>
      </div>
      <NestedLexicalEditor<MdxJsxFlowElement>
        getContent={(n) => n.children as Mdast.PhrasingContent[]}
        getUpdatedMdastNode={(n, children) => ({ ...n, children: children as MdxJsxFlowElement['children'] })}
      />
    </div>
  );
}
