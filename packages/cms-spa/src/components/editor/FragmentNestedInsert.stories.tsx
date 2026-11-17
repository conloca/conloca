import { defineFragmentComponents } from '@conloca/mdx/render';
import { insertJsx$, type MDXEditorMethods, realmPlugin } from '@mdxeditor/editor';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { $createParagraphNode, $getRoot, getNearestEditorFromDOMNode, type LexicalEditor } from 'lexical';
import { createRef, type ReactNode } from 'react';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import '../../main.css';
import { type MdxComponents, setMdxComponents } from '../../mdx-components.js';
import { setSiteRender } from '../../site-render.js';
import { CMSMDXEditor } from './CMSMDXEditor.js';
import { JsxPropsPanel } from './JsxPropsPanel.js';

/**
 * Authors put components inside a component's body: the `/` menu and the toolbar's Insert component both land at the
 * caret in the focused nested editor. A body that cannot be loaded is contained to its block.
 */

const Section = ({ children }: { children?: ReactNode }) => <section className="site-section">{children}</section>;
const Eyebrow = ({ children }: { children?: ReactNode }) => <div className="site-eyebrow">{children}</div>;
const Badge = () => <span className="site-badge">badge</span>;

const vocabulary = defineFragmentComponents({ components: { Section, Eyebrow, Badge } });
// The stage's menu: snippets first, then the site's components, so the slash menu is about as tall as the author's.
const snippets: MdxComponents = ['Callout Quote', 'Proof Points', 'Comparison Table', 'Before / After Table'].map(
  (label) => ({
    name: `snippet-${label}`,
    kind: 'snippet',
    insert: { label, description: `Inserts a ${label.toLowerCase()} at the caret`, category: 'Patterns' },
    content: `${label}\n`,
  }),
);
const descriptors: MdxComponents = [
  ...snippets,
  { name: 'Section', kind: 'flow', hasChildren: true, defaults: { children: '## Section title\n\nSection text.\n' } },
  { name: 'Badge', kind: 'flow', hasChildren: false },
  { name: 'Eyebrow', kind: 'flow', hasChildren: true },
];

const queryClient = new QueryClient();
const editorRef = createRef<MDXEditorMethods>();
const markdown = () => editorRef.current?.getMarkdown() ?? '';

/** Inserts a Section whose body holds an `html` node, the payload a CommonMark-parsed default used to produce. */
let insertBrokenSection = () => {};
const brokenInsert = realmPlugin({
  init(realm) {
    insertBrokenSection = () =>
      realm.pub(insertJsx$, {
        kind: 'flow',
        name: 'Section',
        props: {},
        children: [{ type: 'html', value: '<Eyebrow>01 — Section label</Eyebrow>' }],
      });
  },
});
const extraPlugins = [brokenInsert()];

const meta = {
  title: 'Editor/FragmentNestedInsert',
  render: (args: { value: string }) => (
    <QueryClientProvider client={queryClient}>
      <div style={{ display: 'flex' }}>
        {/* The editor scrolls inside its column, as it does in the fragment editor. */}
        <div style={{ flex: 1, height: '100vh', overflow: 'auto' }} data-testid="editor-scroll">
          <CMSMDXEditor ref={editorRef} value={args.value} onChange={() => {}} fragment extraPlugins={extraPlugins} />
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

function lexicalOf(editable: HTMLElement): LexicalEditor {
  const editor = getNearestEditorFromDOMNode(editable);
  if (!editor) throw new Error('no Lexical editor on the editable');
  return editor;
}

/** Clicks the editable and puts the caret at its end, the way an author clicking after its last word would. */
async function caretAtEnd(editable: HTMLElement): Promise<void> {
  await userEvent.click(editable);
  lexicalOf(editable).update(() => $getRoot().selectEnd(), { discrete: true });
}

function editableIn(canvasElement: HTMLElement, selector: string): Promise<HTMLElement> {
  return waitFor(() => {
    const el = canvasElement.querySelector<HTMLElement>(selector);
    if (!el) throw new Error(`no ${selector}`);
    return el;
  });
}

async function pickSlashOption(name: string): Promise<void> {
  const menu = await waitFor(() => {
    const el = document.querySelector<HTMLElement>('[data-slash-menu]');
    if (!el) throw new Error('no slash menu');
    return el;
  });
  await userEvent.click(within(menu).getByRole('option', { name: new RegExp(name) }));
}

export const SlashInsideComponentBody: Story = {
  args: { value: '<Section>\n\nHello\n\n</Section>' },
  play: async ({ canvasElement }) => {
    await caretAtEnd(await editableIn(canvasElement, 'section.site-section [contenteditable="true"]'));
    await userEvent.keyboard(' /');
    await pickSlashOption('Badge');
    await waitFor(() => expect(markdown()).toMatch(/<Section>[\s\S]*Hello[\s\S]*<Badge \/>[\s\S]*<\/Section>/));
  },
};

/** The stage's shape: a Section inserted from the root `/` menu, caret in an empty first paragraph of its body. */
export const ToolbarInsideComponentBody: Story = {
  args: { value: '' },
  play: async ({ canvasElement }) => {
    await caretAtEnd(await editableIn(canvasElement, '[contenteditable="true"]'));
    await userEvent.keyboard('/');
    await pickSlashOption('Section');
    const body = await editableIn(canvasElement, 'section.site-section [contenteditable="true"]');
    await userEvent.click(body);
    lexicalOf(body).update(
      () => {
        const empty = $createParagraphNode();
        $getRoot().getFirstChildOrThrow().insertBefore(empty);
        empty.select();
      },
      { discrete: true },
    );
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Insert component' }));
    await userEvent.click(await within(document.body).findByRole('menuitem', { name: /Eyebrow/ }));
    await waitFor(() =>
      expect(markdown()).toMatch(/^<Section>\s*<Eyebrow \/>\s*## Section title\s*Section text\.\s*<\/Section>/),
    );
  },
};

const MOD = /Mac|iPhone|iPad/.test(navigator.platform) ? 'Meta' : 'Control';

export const FailedBodyStaysUsable: Story = {
  args: { value: 'Before' },
  play: async ({ canvasElement }) => {
    const root = await editableIn(canvasElement, '[contenteditable="true"]');
    await caretAtEnd(root);
    insertBrokenSection();
    const card = await editableIn(canvasElement, '[data-mdx-block="Section"][role="alert"]');
    await expect(card.textContent).toContain('Section failed to render');

    // The rest of the editor still types, undoes and opens the `/` menu.
    await caretAtEnd(root);
    await userEvent.keyboard(' typed');
    await waitFor(() => expect(markdown()).toContain('typed'));
    await userEvent.keyboard(`{${MOD}>}z{/${MOD}}`);
    await waitFor(() => expect(markdown()).not.toContain('typed'));
    await userEvent.keyboard(' /');
    await waitFor(() => expect(document.querySelector('[data-slash-menu]')).not.toBeNull());
    await userEvent.keyboard('{Escape}');

    // The broken block is removable.
    await userEvent.click(card);
    await userEvent.click(await within(canvasElement).findByRole('button', { name: 'Remove Section' }));
    await waitFor(() => expect(markdown()).not.toContain('<Section'));
  },
};

/** Eyebrows inside the outer one's body, and all of them in the editor. */
function eyebrowCounts(outer: HTMLElement, canvasElement: HTMLElement) {
  return {
    inside: outer.querySelectorAll('[data-mdx-block="Eyebrow"]').length,
    total: canvasElement.querySelectorAll('[data-mdx-block="Eyebrow"]').length,
  };
}

/**
 * The stage's journey, repeated with real clicks and keys: with the caret anywhere in a component's body (start,
 * middle or end of its text, after typing, after visiting the root or a body nested in it, or with an arrow key having
 * selected a component there), the toolbar's Insert component always lands in that body, never at the root and never
 * nowhere.
 */
export const ToolbarInsertLoopsInsideComponentBody: Story = {
  args: { value: 'Root text\n\n<Eyebrow>\n  Outer721\n\n  <Eyebrow>\n    SlashInner721\n  </Eyebrow>\n</Eyebrow>\n' },
  play: async ({ canvasElement }) => {
    const { userEvent: real } = await import('vitest/browser');
    const outer = await editableIn(canvasElement, '[data-mdx-block="Eyebrow"]');
    // The outer body's first paragraph with text; inserts split it, so it is looked up again each time.
    const outerText = () => {
      const body = outer.querySelector<HTMLElement>('[contenteditable="true"]');
      const paragraph = [...(body?.querySelectorAll<HTMLElement>(':scope > p') ?? [])].find((p) => p.textContent);
      if (!paragraph) throw new Error('the outer body lost its text');
      return paragraph;
    };
    const rootText = await editableIn(canvasElement, '[contenteditable="true"] > p');
    const innerBody = () => {
      const body = outer.querySelector<HTMLElement>('[data-mdx-block="Eyebrow"] [contenteditable="true"]');
      if (!body) throw new Error('no inner body');
      return body;
    };
    const placements: Array<() => Promise<void>> = [
      async () => {
        await real.click(outerText());
        await real.keyboard('{End}');
      },
      async () => {
        await real.click(outerText());
        await real.keyboard('{Home}');
      },
      // Keys faster than the selection event: ArrowRight starts from the click's caret at the end of the text and
      // selects the component after it, the way an author's arrow key onto a component does.
      async () => {
        await real.click(outerText());
        await real.keyboard('{Home}{ArrowRight}{ArrowRight}{ArrowRight}');
      },
      async () => {
        await real.click(outerText());
        await real.keyboard('{End} x');
      },
      async () => {
        await real.click(rootText);
        await real.click(outerText());
      },
      async () => {
        await real.click(innerBody());
        await real.click(outerText());
        await real.keyboard('{End}');
      },
    ];
    /* oxlint-disable no-await-in-loop -- each insert must land before the next caret placement starts. */
    for (let round = 0; round < 20; round++) {
      const before = eyebrowCounts(outer, canvasElement);
      await placements[round % placements.length]?.();
      await real.click(within(canvasElement).getByRole('button', { name: 'Insert component' }));
      await real.click(await within(document.body).findByRole('menuitem', { name: /Eyebrow/ }));
      await waitFor(() =>
        expect({ round, ...eyebrowCounts(outer, canvasElement) }).toEqual({
          round,
          inside: before.inside + 1,
          total: before.total + 1,
        }),
      );
    }
    /* oxlint-enable no-await-in-loop */
  },
};

/**
 * A component body at the bottom of the visible editor: its `/` menu opens where all of it can be seen (above the caret
 * when there is no room below), and the author picks its last entry without anything scrolling.
 */
export const SlashMenuNearViewportBottom: Story = {
  args: {
    value: `${Array.from({ length: 40 }, (_, i) => `Filler paragraph ${i + 1}.`).join('\n\n')}\n\n<Eyebrow>\n  Near the bottom\n</Eyebrow>\n`,
  },
  play: async ({ canvasElement }) => {
    const { userEvent: real } = await import('vitest/browser');
    const body = await editableIn(canvasElement, '[data-mdx-block="Eyebrow"] [contenteditable="true"]');
    body.scrollIntoView({ block: 'end' });
    const scroller = await editableIn(canvasElement, '[data-testid="editor-scroll"]');
    const view = canvasElement.ownerDocument.defaultView ?? window;
    await expect(body.getBoundingClientRect().bottom).toBeGreaterThan(view.innerHeight - 80);

    await real.click(body);
    await real.keyboard('{End}{Enter}/');
    const menu = await waitFor(() => {
      const el = document.querySelector<HTMLElement>('[data-slash-menu]');
      if (!el) throw new Error('no slash menu');
      return el;
    });
    const options = within(menu).getAllByRole('option');
    await expect(options.length).toBe(snippets.length + 3);
    // All of it is on screen, so reaching its last entry scrolls nothing outside the menu.
    const rect = menu.getBoundingClientRect();
    await expect({ top: rect.top >= 0, bottom: rect.bottom <= view.innerHeight }).toEqual({ top: true, bottom: true });
    const scrollTop = scroller.scrollTop;
    await real.click(within(menu).getByRole('option', { name: /Eyebrow/ }));
    await waitFor(() => expect(markdown()).toMatch(/<Eyebrow>\s*Near the bottom\s*<Eyebrow \/>\s*<\/Eyebrow>\s*$/));
    await expect(scroller.scrollTop).toBe(scrollTop);
  },
};
