import type { JsxEditorProps } from '@mdxeditor/editor';
import { NestedLexicalEditor, useLexicalNodeRemove, useMdastNodeUpdater } from '@mdxeditor/editor';
import { Trash2 } from 'lucide-react';
import type * as Mdast from 'mdast';
import type { MdxJsxAttribute, MdxJsxFlowElement } from 'mdast-util-mdx-jsx';

type AsideType = 'note' | 'tip' | 'caution' | 'danger';
const ASIDE_TYPES: AsideType[] = ['note', 'tip', 'caution', 'danger'];

const TYPE_STYLES: Record<AsideType, { label: string; bar: string; bg: string }> = {
  note: { label: 'Note', bar: 'border-azure-04', bg: 'bg-azure-11 dark:bg-azure-02' },
  tip: { label: 'Tip', bar: 'border-green-05', bg: 'bg-green-11 dark:bg-green-02' },
  caution: { label: 'Caution', bar: 'border-yellow-05', bg: 'bg-yellow-11 dark:bg-yellow-02' },
  danger: { label: 'Danger', bar: 'border-red-04', bg: 'bg-red-11 dark:bg-red-02' },
};

function readStringAttribute(node: MdxJsxFlowElement, name: string): string {
  const attr = node.attributes.find((a): a is MdxJsxAttribute => a.type === 'mdxJsxAttribute' && a.name === name);
  if (!attr || typeof attr.value !== 'string') return '';
  return attr.value;
}

function writeStringAttribute(attributes: MdxJsxFlowElement['attributes'], name: string, value: string) {
  const next = attributes.filter((a) => !(a.type === 'mdxJsxAttribute' && a.name === name));
  if (value.length > 0) {
    next.push({ type: 'mdxJsxAttribute', name, value });
  }
  return next;
}

/**
 * Editor surface for `<Aside>` JSX callouts.
 *
 * Renders a framed box with a type dropdown + title input on top and a
 * nested rich-text editor for the body. The descriptor is registered
 * against `name: 'Aside'`, so this only activates for `<Aside>` tags —
 * unknown JSX falls through to the wildcard GenericJsxEditor in
 * editor-core.tsx.
 *
 * The four type values (`note | tip | caution | danger`) are the
 * conventional callout vocabulary used by most MDX docs systems
 * (Starlight, Docusaurus, VitePress, etc.). Anything outside that set is
 * normalized down to `note` on first edit so the dropdown always reflects
 * a real option. Once a consumer-supplied descriptor registry lands, this
 * type list should move into the descriptor config so sites can ship
 * their own callout vocabulary.
 */
export function AsideEditor({ mdastNode }: JsxEditorProps) {
  const updater = useMdastNodeUpdater<MdxJsxFlowElement>();
  const removeNode = useLexicalNodeRemove();

  const node = mdastNode as MdxJsxFlowElement;
  const rawType = readStringAttribute(node, 'type');
  const type: AsideType = (ASIDE_TYPES as string[]).includes(rawType) ? (rawType as AsideType) : 'note';
  const title = readStringAttribute(node, 'title');
  const styles = TYPE_STYLES[type];

  const setType = (nextType: AsideType) => {
    updater({ attributes: writeStringAttribute(node.attributes, 'type', nextType) });
  };
  const setTitle = (nextTitle: string) => {
    updater({ attributes: writeStringAttribute(node.attributes, 'title', nextTitle) });
  };

  return (
    <div
      className={`my-3 border-l-4 ${styles.bar} ${styles.bg} rounded-r-md`}
      data-aside-editor
      contentEditable={false}
    >
      <div className="flex items-center gap-2 px-3 pt-2 text-xs text-grey-04 dark:text-grey-07">
        <span className="font-semibold uppercase tracking-wide">{styles.label}</span>
        <select
          value={type}
          onChange={(event) => setType(event.target.value as AsideType)}
          aria-label="Aside type"
          className="bg-transparent border border-grey-09 dark:border-grey-04 rounded px-1.5 py-0.5 text-xs"
        >
          {ASIDE_TYPES.map((option) => (
            <option key={option} value={option}>
              {TYPE_STYLES[option].label}
            </option>
          ))}
        </select>
        <input
          type="text"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Optional title"
          aria-label="Aside title"
          className="flex-1 bg-transparent border border-grey-09 dark:border-grey-04 rounded px-1.5 py-0.5 text-xs"
        />
        <button
          type="button"
          onClick={removeNode}
          aria-label="Remove aside"
          title="Remove aside"
          className="p-1 rounded hover:bg-grey-10 dark:hover:bg-grey-04"
        >
          <Trash2 size={12} aria-hidden />
        </button>
      </div>
      <div className="px-4 py-2">
        <NestedLexicalEditor<MdxJsxFlowElement>
          getContent={(n) => n.children as Mdast.PhrasingContent[]}
          getUpdatedMdastNode={(n, children) => ({ ...n, children: children as MdxJsxFlowElement['children'] })}
        />
      </div>
    </div>
  );
}
