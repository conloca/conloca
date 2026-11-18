import { defineFragmentComponents } from '@conloca/mdx/render';
import type { MDXEditorMethods } from '@mdxeditor/editor';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { $getRoot, getNearestEditorFromDOMNode } from 'lexical';
import { createRef, type ReactNode } from 'react';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import '../../main.css';
import { type MdxComponents, setMdxComponents } from '../../mdx-components.js';
import { setSiteRender } from '../../site-render.js';
import { CMSMDXEditor } from './CMSMDXEditor.js';
import { JsxPropsPanel } from './JsxPropsPanel.js';

/**
 * A site with more insertable entries than the menus show at once, as a real site has: both menus scroll by wheel and
 * keyboard with a scrollbar in sight and stay inside the viewport, and the `/` menu ranks an exact name first.
 */

const Eyebrow = ({ children }: { children?: ReactNode }) => <div className="site-eyebrow">{children}</div>;
const QuietTitle = ({ children }: { children?: ReactNode }) => <h2 className="site-quiet-title">{children}</h2>;
const Group = ({ children }: { children?: ReactNode }) => <div className="site-group">{children}</div>;
const Section = ({ children }: { children?: ReactNode }) => <section className="site-section">{children}</section>;
const TextTable = () => <dl className="site-text-table" />;

const vocabulary = defineFragmentComponents({ components: { Eyebrow, QuietTitle, Group, Section, TextTable } });
const snippets: MdxComponents = [
  'Section Heading',
  'Callout Quote',
  'Proof Points',
  'Comparison Table',
  'Before / After Table',
  'Next Steps List',
  'Code Callout',
].map((label) => ({
  name: `snippet-${label}`,
  kind: 'snippet',
  insert: { label, category: 'Patterns' },
  content: `${label}\n`,
}));
const descriptors: MdxComponents = [
  ...snippets,
  { name: 'Eyebrow', kind: 'flow', hasChildren: true, insert: { label: 'Eyebrow', category: 'Patterns' } },
  {
    name: 'Group',
    kind: 'flow',
    hasChildren: true,
    insert: { label: 'Group', description: 'Keeps the blocks inside it close together', category: 'Patterns' },
  },
  {
    name: 'QuietTitle',
    kind: 'flow',
    hasChildren: true,
    insert: {
      label: 'Quiet title',
      description: 'Semibold title that stays out of the contents',
      category: 'Patterns',
    },
    defaults: { children: 'Title' },
  },
  {
    name: 'Section',
    kind: 'flow',
    hasChildren: true,
    insert: { label: 'Section', description: 'Divider line, eyebrow, title and text', category: 'Patterns' },
    defaults: { children: '<Eyebrow>01 — Section label</Eyebrow>\n\n## Section title\n\nSection text.\n' },
  },
  {
    name: 'TextTable',
    kind: 'flow',
    hasChildren: false,
    insert: { label: 'Text table', description: 'Rows of a term and its description', category: 'Patterns' },
  },
];

const queryClient = new QueryClient();
const editorRef = createRef<MDXEditorMethods>();
const markdown = () => editorRef.current?.getMarkdown() ?? '';

const meta = {
  title: 'Editor/FragmentInsertMenus',
  render: (args: { value: string }) => (
    <QueryClientProvider client={queryClient}>
      <div style={{ display: 'flex' }}>
        <div style={{ flex: 1 }}>
          <CMSMDXEditor ref={editorRef} value={args.value} onChange={() => {}} fragment />
        </div>
        <JsxPropsPanel />
      </div>
    </QueryClientProvider>
  ),
  beforeEach: () => {
    setSiteRender({ vocabulary });
    setMdxComponents(descriptors);
    return () => {
      setSiteRender({});
      setMdxComponents([]);
    };
  },
} satisfies Meta<{ value: string }>;

export default meta;
type Story = StoryObj<typeof meta>;

function find(selector: string, root: ParentNode = document): Promise<HTMLElement> {
  return waitFor(() => {
    const el = root.querySelector<HTMLElement>(selector);
    if (!el) throw new Error(`no ${selector}`);
    return el;
  });
}

async function caretInEditor(canvasElement: HTMLElement): Promise<void> {
  const root = await find('[contenteditable="true"]', canvasElement);
  await userEvent.click(root);
  getNearestEditorFromDOMNode(root)?.update(() => $getRoot().selectEnd(), { discrete: true });
}

/** The menu scrolls inside itself, shows its scrollbar, and stays inside the viewport. */
async function expectScrollableInView(menu: HTMLElement): Promise<void> {
  await expect(menu.scrollHeight).toBeGreaterThan(menu.clientHeight);
  // A scrollbar that takes room is one the author can see. Chromium here draws classic scrollbars; the menu's own
  // scrollbar style is what keeps it visible where the system uses overlay scrollbars (macOS).
  await expect(menu.offsetWidth - menu.clientWidth).toBeGreaterThan(0);
  await expect(getComputedStyle(menu, '::-webkit-scrollbar').width).toBe('10px');
  const box = menu.getBoundingClientRect();
  await expect(box.top).toBeGreaterThanOrEqual(0);
  await expect(box.bottom).toBeLessThanOrEqual(window.innerHeight);
}

/** `item` lies wholly inside the scrolled `menu`. */
async function expectShown(menu: HTMLElement, item: HTMLElement): Promise<void> {
  const outer = menu.getBoundingClientRect();
  const inner = item.getBoundingClientRect();
  await expect(inner.top).toBeGreaterThanOrEqual(outer.top - 1);
  await expect(inner.bottom).toBeLessThanOrEqual(outer.bottom + 1);
}

export const SlashMenuScrolls: Story = {
  args: { value: '' },
  play: async ({ canvasElement }) => {
    // Real wheel and key events come from the browser runner, which the static catalog build does not bundle.
    const { userEvent: real } = await import('vitest/browser');
    await caretInEditor(canvasElement);
    await userEvent.keyboard('/');
    const menu = await find('[data-slash-menu]');
    await waitFor(() => expect(menu.style.visibility).not.toBe('hidden'));
    await expectScrollableInView(menu);
    const options = within(menu).getAllByRole('option');
    const last = within(menu).getByRole('option', { name: /Text table/ });

    await real.keyboard('{ArrowDown}'.repeat(options.length - 1));
    await waitFor(() => expect(last).toHaveAttribute('aria-selected', 'true'));
    await waitFor(() => expectShown(menu, last));

    menu.scrollTop = 0;
    await real.wheel(menu, { delta: { y: 1000 } });
    await waitFor(() => expectShown(menu, last));
    await real.keyboard('{Escape}');
  },
};

export const ToolbarMenuScrolls: Story = {
  args: { value: '' },
  play: async ({ canvasElement }) => {
    // Real wheel and key events come from the browser runner, which the static catalog build does not bundle.
    const { userEvent: real } = await import('vitest/browser');
    await caretInEditor(canvasElement);
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Insert component' }));
    const menu = await within(document.body).findByRole('menu');
    await expectScrollableInView(menu);
    const last = within(menu).getByRole('menuitem', { name: /Text table/ });

    await real.wheel(menu, { delta: { y: 1000 } });
    await waitFor(() => expectShown(menu, last));

    menu.scrollTop = 0;
    await real.keyboard('{End}');
    await waitFor(() => expectShown(menu, last));
    await real.keyboard('{Escape}');
  },
};

/** A window too short for the menu's full height: the menu shrinks to fit under its button and still scrolls. */
export const ToolbarMenuFitsShortWindow: Story = {
  args: { value: '' },
  play: async ({ canvasElement }) => {
    const { page } = await import('vitest/browser');
    const [width, height] = [window.innerWidth, window.innerHeight];
    await page.viewport(width, 280);
    try {
      await caretInEditor(canvasElement);
      await userEvent.click(within(canvasElement).getByRole('button', { name: 'Insert component' }));
      const menu = await within(document.body).findByRole('menu');
      await waitFor(() => expectScrollableInView(menu));
      await userEvent.keyboard('{Escape}');
    } finally {
      await page.viewport(width, height);
    }
  },
};

export const SlashRanksExactNameFirst: Story = {
  args: { value: '' },
  play: async ({ canvasElement }) => {
    await caretInEditor(canvasElement);
    await userEvent.keyboard('/Section');
    const menu = await find('[data-slash-menu]');
    await waitFor(() => expect(within(menu).getAllByRole('option')[0]).toHaveTextContent(/^Section\s*Divider/));
    await waitFor(() => expect(within(menu).getAllByRole('option')[1]).toHaveTextContent('Section Heading'));
  },
};

export const PanelNamesTheComponentByLabel: Story = {
  args: { value: '<QuietTitle>\n  Title\n</QuietTitle>\n' },
  play: async ({ canvasElement }) => {
    await userEvent.click(await find('.site-quiet-title [contenteditable="true"]', canvasElement));
    const panel = await find('.conloca-jsx-props-panel:not(.conloca-jsx-props-panel--empty)', canvasElement);
    await expect(within(panel).getByRole('heading')).toHaveTextContent('Quiet title');
    await expect(within(panel).getByRole('button', { name: 'Remove Quiet title' })).toBeVisible();
  },
};

export const DefaultBodyWithAComponent: Story = {
  args: { value: '' },
  play: async ({ canvasElement }) => {
    await caretInEditor(canvasElement);
    await userEvent.keyboard('/Section');
    const menu = await find('[data-slash-menu]');
    await userEvent.click(within(menu).getByRole('option', { name: /^Section Divider/ }));
    await waitFor(() =>
      expect(markdown()).toMatch(
        /^<Section>\s*<Eyebrow>\s*01 — Section label\s*<\/Eyebrow>\s*## Section title\s*Section text\.\s*<\/Section>/,
      ),
    );
    await find('section.site-section .site-eyebrow', canvasElement);
  },
};
