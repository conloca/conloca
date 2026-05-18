import type { JsxEditorProps } from '@mdxeditor/editor';
import { NestedLexicalEditor, useLexicalNodeRemove, useMdastNodeUpdater } from '@mdxeditor/editor';
import { Trash2 } from 'lucide-react';
import type * as Mdast from 'mdast';
import type { MdxJsxFlowElement } from 'mdast-util-mdx-jsx';
import {
  isJsxDescriptor,
  type MdxComponentDescriptor,
  useMdxComponents,
  writeStringAttribute,
} from '../../mdx-components';

/**
 * One editor component for any MDX JSX block. Replaces the per-component
 * `AsideEditor` / `CardEditor` / ... files in the host project.
 *
 * Renders the block as the same HTML shape the host framework would emit
 * at render time (eg `<aside class="starlight-aside starlight-aside--tip">`
 * for Starlight). The fetched site CSS already in the editor document
 * styles it without any lookalike sheet.
 *
 * Editing affordances (prop fields + delete) live in a small overlay row
 * above the block. The body is a `NestedLexicalEditor` so authors type
 * into it inline, matching the position of the rendered content slot.
 *
 * Templates live in a per-name registry keyed by JSX tag name. Unknown
 * tags fall through to a plain `<div data-mdx-block>` wrapper — author
 * still gets editable body, just no framework-specific markup. Future
 * library presets (`@conloca/astro-cms-starlight` etc.) can extend the
 * registry from outside instead of editing this file.
 */

interface BlockTemplate {
  /** Markup wrapper. Receives current attribute map and the slot children. */
  render: (attrs: Record<string, string>, slot: React.ReactNode) => React.ReactNode;
}

/**
 * Astro scoped-style hashes. Astro appends a `astro-<hash>` class to every
 * element rendered by a `.astro` component file and scopes the file's CSS
 * by that hash (eg `.card.astro-e3flfouy { ... }`). The hashes are
 * file-stable but version-specific to Starlight; if Starlight bumps and a
 * component starts looking off in the editor, re-capture the hash from
 * the published page's DOM and update here. Future work moves these into
 * a `@conloca/astro-cms-starlight` preset so hosts opt in by version
 * instead of GenericBlock holding the knowledge.
 */
const STARLIGHT_SCOPE = {
  card: 'astro-e3flfouy',
  cardGrid: 'astro-j3wxc5cd',
  linkCard: 'astro-2dfusmpi',
  tabs: 'astro-pfofihih',
  fileTree: 'astro-mbvz7br7',
} as const;

const TEMPLATES: Record<string, BlockTemplate> = {
  Aside: {
    render: (attrs, slot) => {
      const raw = attrs.type;
      const type: AsideType = isAsideType(raw) ? raw : 'note';
      const title = attrs.title?.trim() || ASIDE_TYPE_LABEL[type];
      return (
        <aside className={`starlight-aside starlight-aside--${type}`}>
          <p className="starlight-aside__title">{title}</p>
          <div className="starlight-aside__content">{slot}</div>
        </aside>
      );
    },
  },
  Card: {
    render: (attrs, slot) => (
      <article className={`card sl-flex ${STARLIGHT_SCOPE.card}`}>
        <p className={`title sl-flex ${STARLIGHT_SCOPE.card}`}>{attrs.title?.trim() || 'Card title'}</p>
        <div>{slot}</div>
      </article>
    ),
  },
  CardGrid: {
    render: (_attrs, slot) => <div className={`card-grid ${STARLIGHT_SCOPE.cardGrid}`}>{slot}</div>,
  },
  LinkCard: {
    // LinkCard has no children — render title + description from attrs only.
    render: (attrs) => (
      <div className={`sl-link-card ${STARLIGHT_SCOPE.linkCard}`}>
        <span className={`sl-flex stack ${STARLIGHT_SCOPE.linkCard}`}>
          <span className={`title ${STARLIGHT_SCOPE.linkCard}`}>{attrs.title?.trim() || 'Link title'}</span>
          {attrs.description?.trim() && (
            <span className={`description ${STARLIGHT_SCOPE.linkCard}`}>{attrs.description}</span>
          )}
        </span>
      </div>
    ),
  },
  Steps: {
    // Author already writes `1. … 2. …` markdown inside; the slot renders the
    // ordered list. We add Starlight's `sl-steps` class so the list gets the
    // step-marker chrome.
    render: (_attrs, slot) => <div className="sl-steps">{slot}</div>,
  },
  FileTree: {
    render: (_attrs, slot) => (
      <div className={`not-content ${STARLIGHT_SCOPE.fileTree}`} data-conloca-file-tree>
        {slot}
      </div>
    ),
  },
  Tabs: {
    // Editor renders all panels stacked — Starlight's runtime tablist is
    // interactive and switches panels via JS, which we don't want in an
    // editing surface. Authors see every TabItem inline and edit each.
    render: (_attrs, slot) => <div className={`conloca-tabs-editor ${STARLIGHT_SCOPE.tabs}`}>{slot}</div>,
  },
  TabItem: {
    render: (attrs, slot) => (
      <section className="conloca-tab-item-editor" aria-label={attrs.label?.trim() || 'Tab'}>
        <header className="conloca-tab-item-editor__label">{attrs.label?.trim() || 'Tab'}</header>
        <div>{slot}</div>
      </section>
    ),
  },
};

const ASIDE_TYPES = ['note', 'tip', 'caution', 'danger'] as const;
type AsideType = (typeof ASIDE_TYPES)[number];
const ASIDE_TYPE_LABEL: Record<AsideType, string> = {
  note: 'Note',
  tip: 'Tip',
  caution: 'Caution',
  danger: 'Danger',
};
function isAsideType(v: string | undefined): v is AsideType {
  return v != null && (ASIDE_TYPES as readonly string[]).includes(v);
}

function readAttrs(node: MdxJsxFlowElement): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of node.attributes) {
    if (a.type === 'mdxJsxAttribute' && typeof a.value === 'string') out[a.name] = a.value;
  }
  return out;
}

export function GenericBlock({ mdastNode }: JsxEditorProps) {
  const updater = useMdastNodeUpdater<MdxJsxFlowElement>();
  const removeNode = useLexicalNodeRemove();
  const descriptors = useMdxComponents();

  const node = mdastNode as MdxJsxFlowElement;
  const attrs = readAttrs(node);
  const name = node.name ?? '';
  const found = descriptors.find((d): d is MdxComponentDescriptor => 'name' in d && d.name === name);
  const descriptor = found && isJsxDescriptor(found) ? found : null;
  const template = TEMPLATES[name];

  const slot = (
    <NestedLexicalEditor<MdxJsxFlowElement>
      getContent={(n) => n.children as Mdast.PhrasingContent[]}
      getUpdatedMdastNode={(n, children) => ({ ...n, children: children as MdxJsxFlowElement['children'] })}
    />
  );

  return (
    <div className="conloca-generic-block">
      <div className="conloca-generic-block__controls" contentEditable={false}>
        <span className="conloca-generic-block__name">{name}</span>
        {descriptor?.props?.map((prop) => (
          <PropInput
            key={prop.name}
            name={prop.name}
            label={prop.label}
            value={attrs[prop.name] ?? ''}
            options={prop.type === 'string' ? prop.options : undefined}
            onChange={(next) =>
              updater({ attributes: writeStringAttribute(node.attributes, prop.name, next) as typeof node.attributes })
            }
          />
        ))}
        <button
          type="button"
          onClick={removeNode}
          aria-label={`Remove ${name}`}
          className="conloca-generic-block__remove"
        >
          <Trash2 size={14} aria-hidden />
        </button>
      </div>
      {template ? template.render(attrs, slot) : <div data-mdx-block={name}>{slot}</div>}
    </div>
  );
}

interface PropInputProps {
  name: string;
  label?: string;
  value: string;
  options?: ReadonlyArray<{ value: string; label: string }>;
  onChange: (value: string) => void;
}

function PropInput({ name, label, value, options, onChange }: PropInputProps) {
  const display = label ?? name;
  if (options && options.length > 0) {
    return (
      <label className="conloca-generic-block__field">
        <span>{display}</span>
        <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={display}>
          <option value="">—</option>
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </label>
    );
  }
  return (
    <label className="conloca-generic-block__field">
      <span>{display}</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={display}
        aria-label={display}
      />
    </label>
  );
}
