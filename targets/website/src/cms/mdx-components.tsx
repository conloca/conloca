// Starlight MDX component descriptors for the CMS editor. The CMS shell
// ships the plugin API only — these descriptors are the host's own code so
// the core stays framework-agnostic.
import {
  type CodeBlockConfig,
  defineMdxComponents,
  type MdxComponentDescriptor,
  type MdxSnippetDescriptor,
} from '@conloca/astro-cms';
import { AsideEditor } from './editors/AsideEditor';
import { CardEditor } from './editors/CardEditor';
import { LinkCardEditor } from './editors/LinkCardEditor';
import { TabItemEditor } from './editors/TabItemEditor';

const STARLIGHT_SOURCE = '@astrojs/starlight/components';

/**
 * Starlight `<Aside>` — callout box with type + title.
 * The `source` is required: without it the editor's save pipeline would
 * strip the host's `import { Aside } ...` line on every save.
 */
export const asideDescriptor: MdxComponentDescriptor = {
  name: 'Aside',
  kind: 'flow',
  hasChildren: true,
  insert: {
    label: 'Aside',
    description: 'Callout (note / tip / caution / danger)',
    icon: 'message-square-warning',
    keywords: ['callout', 'admonition', 'note', 'tip'],
  },
  props: [
    {
      name: 'type',
      type: 'string',
      label: 'Type',
      defaultValue: 'note',
      options: [
        { value: 'note', label: 'Note' },
        { value: 'tip', label: 'Tip' },
        { value: 'caution', label: 'Caution' },
        { value: 'danger', label: 'Danger' },
      ],
    },
    { name: 'title', type: 'string', label: 'Title (optional)' },
  ],
  defaults: { attributes: { type: 'note' }, children: 'Callout body content.' },
  Editor: AsideEditor,
  import: { from: STARLIGHT_SOURCE },
};

/** Starlight `<Steps>` — props from user-components/Steps.astro (none). */
export const stepsDescriptor: MdxComponentDescriptor = {
  name: 'Steps',
  kind: 'flow',
  hasChildren: true,
  insert: {
    label: 'Steps',
    description: 'Numbered step-by-step list',
    icon: 'list-ordered',
    keywords: ['ordered', 'numbered', 'list'],
  },
  defaults: { children: '1. First step\n2. Second step\n3. Third step' },
  import: { from: STARLIGHT_SOURCE },
};

/** Starlight `<Tabs>` — props: { syncKey?: string }. */
export const tabsDescriptor: MdxComponentDescriptor = {
  name: 'Tabs',
  kind: 'flow',
  hasChildren: true,
  insert: {
    label: 'Tabs',
    description: 'Tabbed group of TabItems',
    icon: 'layout-panel-top',
    keywords: ['tab', 'group'],
  },
  props: [{ name: 'syncKey', type: 'string', label: 'Sync key', help: 'Persist active tab across pages' }],
  defaults: {
    children: '<TabItem label="One">First tab content</TabItem>\n<TabItem label="Two">Second tab content</TabItem>',
  },
  import: { from: STARLIGHT_SOURCE },
};

/** Starlight `<TabItem>` — props: { label: string; icon?: StarlightIcon }. */
export const tabItemDescriptor: MdxComponentDescriptor = {
  name: 'TabItem',
  kind: 'flow',
  hasChildren: true,
  insert: {
    label: 'Tab item',
    description: 'A single tab inside a Tabs group',
    icon: 'square',
    keywords: ['tab', 'panel'],
  },
  props: [
    { name: 'label', type: 'string', required: true, label: 'Label' },
    { name: 'icon', type: 'string', label: 'Icon (StarlightIcon name)' },
  ],
  defaults: { attributes: { label: 'New tab' }, children: 'Tab content' },
  Editor: TabItemEditor,
  import: { from: STARLIGHT_SOURCE },
};

/** Starlight `<Card>` — props: { title: string; icon?: StarlightIcon }. */
export const cardDescriptor: MdxComponentDescriptor = {
  name: 'Card',
  kind: 'flow',
  hasChildren: true,
  insert: {
    label: 'Card',
    description: 'Titled card with optional icon',
    icon: 'square-stack',
    keywords: ['box', 'panel'],
  },
  props: [
    { name: 'title', type: 'string', required: true, label: 'Title' },
    { name: 'icon', type: 'string', label: 'Icon (StarlightIcon name)' },
  ],
  defaults: { attributes: { title: 'Card title' }, children: 'Card body content.' },
  Editor: CardEditor,
  import: { from: STARLIGHT_SOURCE },
};

/** Starlight `<CardGrid>` — props: { stagger?: boolean }. */
export const cardGridDescriptor: MdxComponentDescriptor = {
  name: 'CardGrid',
  kind: 'flow',
  hasChildren: true,
  insert: {
    label: 'Card grid',
    description: 'Responsive grid of cards',
    icon: 'layout-grid',
    keywords: ['grid', 'cards'],
  },
  props: [{ name: 'stagger', type: 'boolean', label: 'Stagger', help: 'Offset cards vertically on wide screens' }],
  defaults: { children: '<Card title="One">First</Card>\n<Card title="Two">Second</Card>' },
  import: { from: STARLIGHT_SOURCE },
};

/**
 * Starlight `<LinkCard>` — props: { title: string; description?: string } &
 * HTMLAttributes<'a'>. The plugin API surfaces title/href/description as
 * the editable subset; authors needing other anchor attributes drop into
 * Source mode.
 */
export const linkCardDescriptor: MdxComponentDescriptor = {
  name: 'LinkCard',
  kind: 'flow',
  hasChildren: false,
  insert: {
    label: 'Link card',
    description: 'Card that links to a URL',
    icon: 'external-link',
    keywords: ['link', 'card', 'navigation'],
  },
  props: [
    { name: 'title', type: 'string', required: true, label: 'Title' },
    { name: 'href', type: 'string', required: true, label: 'Href' },
    { name: 'description', type: 'string', label: 'Description' },
  ],
  defaults: { attributes: { title: 'Link title', href: '/' } },
  Editor: LinkCardEditor,
  import: { from: STARLIGHT_SOURCE },
};

/** Starlight `<FileTree>` — no props; children-only. */
export const fileTreeDescriptor: MdxComponentDescriptor = {
  name: 'FileTree',
  kind: 'flow',
  hasChildren: true,
  insert: {
    label: 'File tree',
    description: 'Directory/file structure',
    icon: 'folder-tree',
    keywords: ['files', 'directory', 'folder'],
  },
  defaults: { children: '- src/\n  - **index.ts**\n  - utils.ts\n- package.json' },
  import: { from: STARLIGHT_SOURCE },
};

/**
 * Starlight `<Icon>` — inline. Props: { name: StarlightIcon; label?: string;
 * color?: string; size?: string; class?: string }. v1 surfaces `name` as a
 * plain string input; a typeahead off the `StarlightIcon` union is polish.
 */
export const iconDescriptor: MdxComponentDescriptor = {
  name: 'Icon',
  kind: 'text',
  insert: {
    label: 'Icon',
    description: 'Inline Starlight icon',
    icon: 'sparkles',
    keywords: ['icon', 'svg'],
  },
  props: [
    { name: 'name', type: 'string', required: true, label: 'Name (StarlightIcon)' },
    { name: 'label', type: 'string', label: 'Accessible label' },
    { name: 'size', type: 'string', label: 'Size (e.g. 1em)' },
    { name: 'color', type: 'string', label: 'Color (CSS color)' },
  ],
  defaults: { attributes: { name: 'star' } },
  import: { from: STARLIGHT_SOURCE },
};

/**
 * Starlight `<Code>` — the JSX form of a code block (used when the source
 * comes from a string variable rather than a fenced triple-backtick). Props
 * from astro-expressive-code/components/Code.astro (re-exported by
 * Starlight) — `code` and `lang` are the load-bearing ones; the rest are
 * passed through to expressive-code.
 */
export const codeDescriptor: MdxComponentDescriptor = {
  name: 'Code',
  kind: 'flow',
  hasChildren: false,
  insert: {
    label: 'Code block (JSX)',
    description: 'String-driven code block',
    icon: 'code',
    keywords: ['code', 'syntax', 'highlight'],
  },
  props: [
    { name: 'code', type: 'string', required: true, label: 'Code' },
    { name: 'lang', type: 'string', required: true, label: 'Language', defaultValue: 'ts' },
    { name: 'title', type: 'string', label: 'Title' },
    {
      name: 'frame',
      type: 'string',
      label: 'Frame',
      options: [
        { value: 'auto', label: 'Auto' },
        { value: 'code', label: 'Code' },
        { value: 'terminal', label: 'Terminal' },
        { value: 'none', label: 'None' },
      ],
    },
    { name: 'ins', type: 'string', label: 'Inserted lines / marker' },
    { name: 'del', type: 'string', label: 'Deleted lines / marker' },
    { name: 'mark', type: 'string', label: 'Marked lines / marker' },
    { name: 'meta', type: 'string', label: 'Meta string' },
    { name: 'wrap', type: 'boolean', label: 'Wrap long lines' },
  ],
  defaults: { attributes: { code: 'const x = 1;', lang: 'ts' } },
  import: { from: STARLIGHT_SOURCE },
};
/**
 * Markdown snippets — host-curated boilerplate the toolbar/slash menu
 * inserts as raw MDX. Migrated from the hardcoded `contentBlockSnippets`
 * list that used to live in `@conloca/cms-spa`; moved here so consumer-specific
 * marketing language stops leaking into the shared CMS package and so other
 * hosts (a future docs target, say) can register their own without inheriting
 * these.
 *
 * `category: 'Patterns'` groups them as a single section in the toolbar
 * dropdown so they sit visually apart from the typed Starlight components.
 */
const SNIPPET_CATEGORY = 'Patterns';

export const sectionHeadingSnippet: MdxSnippetDescriptor = {
  name: 'snippet-section-heading',
  kind: 'snippet',
  insert: { label: 'Section Heading', category: SNIPPET_CATEGORY },
  content: '## Section title\n\nWrite the opening paragraph for this section here.\n',
};

export const calloutQuoteSnippet: MdxSnippetDescriptor = {
  name: 'snippet-callout-quote',
  kind: 'snippet',
  insert: { label: 'Callout Quote', category: SNIPPET_CATEGORY },
  content: '> A short, sharp takeaway or highlighted recommendation.\n',
};

export const proofPointsSnippet: MdxSnippetDescriptor = {
  name: 'snippet-proof-points',
  kind: 'snippet',
  insert: { label: 'Proof Points', category: SNIPPET_CATEGORY },
  content: '- Clear editorial workflow\n- Reusable narrative blocks\n- Git-native publishing history\n',
};

export const comparisonTableSnippet: MdxSnippetDescriptor = {
  name: 'snippet-comparison-table',
  kind: 'snippet',
  insert: { label: 'Comparison Table', category: SNIPPET_CATEGORY },
  content:
    '| Option | Best for | Tradeoff |\n| --- | --- | --- |\n| Option A | Teams that want speed | Less flexibility |\n| Option B | Teams that need control | More setup |\n',
};

export const beforeAfterSnippet: MdxSnippetDescriptor = {
  name: 'snippet-before-after',
  kind: 'snippet',
  insert: { label: 'Before / After Table', category: SNIPPET_CATEGORY },
  content:
    '| Before | After |\n| --- | --- |\n| Editors wait on developers | Editors publish with reusable blocks |\n| Content lives in tools | Content lives in the repo |\n',
};

export const nextStepsSnippet: MdxSnippetDescriptor = {
  name: 'snippet-next-steps',
  kind: 'snippet',
  insert: { label: 'Next Steps List', category: SNIPPET_CATEGORY },
  content: '## Next steps\n\n1. First action\n2. Second action\n3. Third action\n',
};

export const codeCalloutSnippet: MdxSnippetDescriptor = {
  name: 'snippet-code-callout',
  kind: 'snippet',
  insert: { label: 'Code Callout', category: SNIPPET_CATEGORY },
  content: '```ts\nconlocaCMS({\n  contentRoot: "./content",\n  puckConfigPath: "./src/puck.config.tsx",\n})\n```\n',
};

/**
 * Code-block frame chrome toggles. Picked up by the CMS schemas-loader and
 * pushed into `@conloca/cms-spa`'s registry, which the MDX editor's
 * code-block descriptor reads at render time. Theming flows through CSS
 * tokens in `src/styles/code-blocks.css`, not this object.
 */
export const codeBlockConfig: CodeBlockConfig = {
  showCopyButton: true,
  showFilename: true,
  showLanguageTag: true,
};

export const mdxComponents = defineMdxComponents([
  asideDescriptor,
  stepsDescriptor,
  tabsDescriptor,
  tabItemDescriptor,
  cardDescriptor,
  cardGridDescriptor,
  linkCardDescriptor,
  fileTreeDescriptor,
  iconDescriptor,
  codeDescriptor,
  sectionHeadingSnippet,
  calloutQuoteSnippet,
  proofPointsSnippet,
  comparisonTableSnippet,
  beforeAfterSnippet,
  nextStepsSnippet,
  codeCalloutSnippet,
]);
