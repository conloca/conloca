import { readStringAttribute, writeStringAttribute } from '@conloca/astro-cms';
import type { JsxEditorProps } from '@mdxeditor/editor';
import { useLexicalNodeRemove, useMdastNodeUpdater } from '@mdxeditor/editor';
import {
  AlertOctagon,
  AlertTriangle,
  CircleHelp,
  ExternalLink,
  FileText,
  Folder,
  Info,
  type LucideIcon,
  Rocket,
  Settings,
  Sparkles,
  Star,
  Terminal,
  Trash2,
  X,
} from 'lucide-react';
import type { MdxJsxTextElement } from 'mdast-util-mdx-jsx';

/**
 * Editor for Starlight `<Icon>` — an inline SVG drawn from Starlight's
 * built-in icon registry.
 *
 * Pattern A drift: Starlight's `StarlightIcon` union is a few hundred
 * names (lucide subset, brand glyphs, the `seti:*` family, etc.). The
 * editor maps the most common ones to a lucide-react fallback and shows
 * a `CircleHelp` for anything outside the map. The published page still
 * renders the full registry — only the editor's chip preview is the
 * narrowed surface.
 *
 * Props from node_modules/@astrojs/starlight/user-components/Icon.astro.
 */
const NAME_ICON: Record<string, LucideIcon> = {
  star: Star,
  rocket: Rocket,
  information: Info,
  note: Info,
  tip: Rocket,
  warning: AlertTriangle,
  caution: AlertTriangle,
  danger: AlertOctagon,
  error: AlertOctagon,
  document: FileText,
  'seti:document': FileText,
  approve: Sparkles,
  external: ExternalLink,
  'external-link': ExternalLink,
  setting: Settings,
  cog: Settings,
  terminal: Terminal,
  'seti:powershell': Terminal,
  'seti:npm': Terminal,
  folder: Folder,
  close: X,
  cancel: X,
};

function iconFor(name: string): LucideIcon {
  if (NAME_ICON[name]) return NAME_ICON[name];
  return CircleHelp;
}

export function IconEditor({ mdastNode }: JsxEditorProps) {
  const updater = useMdastNodeUpdater<MdxJsxTextElement>();
  const removeNode = useLexicalNodeRemove();

  const node = mdastNode as MdxJsxTextElement;
  const name = readStringAttribute(node, 'name');
  const label = readStringAttribute(node, 'label');
  const Icon = iconFor(name);

  const setAttr = (attr: string, value: string) => {
    updater({ attributes: writeStringAttribute(node.attributes, attr, value) });
  };

  return (
    <span className="conloca-icon-editor" contentEditable={false}>
      <Icon className="conloca-icon-editor__glyph" size={14} aria-hidden focusable={false} />
      <input
        type="text"
        value={name}
        onChange={(e) => setAttr('name', e.target.value)}
        placeholder="icon name"
        aria-label="Icon name"
        className="conloca-icon-editor__name-input"
      />
      {label ? (
        <input
          type="text"
          value={label}
          onChange={(e) => setAttr('label', e.target.value)}
          placeholder="label"
          aria-label="Icon accessible label"
          className="conloca-icon-editor__label-input"
        />
      ) : null}
      <button
        type="button"
        onClick={removeNode}
        aria-label="Remove icon"
        title="Remove icon"
        className="conloca-icon-editor__remove"
      >
        <Trash2 size={12} aria-hidden />
      </button>
    </span>
  );
}
