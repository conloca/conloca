import { defineFragmentComponents } from '@conloca/mdx/render';
import type { MDXEditorMethods } from '@mdxeditor/editor';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { $getRoot, getNearestEditorFromDOMNode } from 'lexical';
import { type ComponentProps, createRef, type ReactNode } from 'react';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import '../../main.css';
import { isJsxDescriptor, type MdxComponents, setMdxComponents } from '../../mdx-components.js';
import { setSiteRender } from '../../site-render.js';
import { CMSMDXEditor } from './CMSMDXEditor.js';
import { FragmentBlockTypeSelect } from './FragmentBlockTypeSelect.js';
import { JsxPropsPanel } from './JsxPropsPanel.js';

/**
 * The fragment editor's Block type dropdown, in its toolbar: text-style components (`blockType: true`) sit next to
 * Paragraph and the headings; containers do not. A section's anchor is hidden and made from its contents label, once.
 */

const Eyebrow = ({ children }: { children?: ReactNode }) => <div className="site-eyebrow">{children}</div>;
const QuietTitle = ({ children }: { children?: ReactNode }) => <h2 className="site-quiet-title">{children}</h2>;
const Group = ({ children }: { children?: ReactNode }) => <div className="site-group">{children}</div>;
const Section = ({ children }: { children?: ReactNode }) => <section className="site-section">{children}</section>;
const TextTable = () => <dl className="site-text-table" />;

const vocabulary = defineFragmentComponents({
  components: { Eyebrow, QuietTitle, Group, Section, TextTable },
  outline: { Section: { id: 'id', text: 'label' } },
});
const descriptors: MdxComponents = [
  { name: 'Eyebrow', kind: 'flow', hasChildren: true, blockType: true, insert: { label: 'Eyebrow' } },
  { name: 'QuietTitle', kind: 'flow', hasChildren: true, blockType: true, insert: { label: 'Quiet title' } },
  { name: 'Group', kind: 'flow', hasChildren: true, insert: { label: 'Group' } },
  {
    name: 'Section',
    kind: 'flow',
    hasChildren: true,
    insert: { label: 'Section' },
    props: [
      { name: 'id', type: 'string', label: 'Anchor', hidden: true },
      { name: 'label', type: 'string', label: 'Contents label' },
    ],
  },
  { name: 'TextTable', kind: 'flow', hasChildren: false, insert: { label: 'Text table' } },
];

const queryClient = new QueryClient();
const editorRef = createRef<MDXEditorMethods>();
const markdown = () => editorRef.current?.getMarkdown() ?? '';

type Args = ComponentProps<typeof FragmentBlockTypeSelect> & { value: string };

const meta = {
  title: 'Editor/FragmentBlockType',
  // The editor's toolbar mounts the dropdown and passes it the block-type components; `args.components` names them.
  component: FragmentBlockTypeSelect,
  args: { components: descriptors.filter(isJsxDescriptor).filter((d) => d.blockType) },
  render: (args: Args) => (
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
} satisfies Meta<Args>;

export default meta;
type Story = StoryObj<typeof meta>;

function find(root: ParentNode, selector: string): Promise<HTMLElement> {
  return waitFor(() => {
    const el = root.querySelector<HTMLElement>(selector);
    if (!el) throw new Error(`no ${selector}`);
    return el;
  });
}

const blockType = (canvasElement: HTMLElement) => within(canvasElement).getByRole('combobox', { name: 'Block type' });

async function chooseBlockType(canvasElement: HTMLElement, name: string): Promise<void> {
  await userEvent.click(blockType(canvasElement));
  await userEvent.click(await within(document.body).findByRole('option', { name }));
}

export const ParagraphToComponentAndBack: Story = {
  args: { value: 'Before\n\nOpening line\n' },
  play: async ({ canvasElement }) => {
    const root = await find(canvasElement, '[contenteditable="true"]');
    await userEvent.click(within(root).getByText('Opening line'));
    await chooseBlockType(canvasElement, 'Eyebrow');
    await waitFor(() => expect(markdown()).toMatch(/^Before\s*<Eyebrow>\s*Opening line\s*<\/Eyebrow>\s*$/));
    // The caret is in the eyebrow now: the dropdown names it.
    await waitFor(() => expect(blockType(canvasElement)).toHaveTextContent('Eyebrow'));

    await chooseBlockType(canvasElement, 'Paragraph');
    await waitFor(() => expect(markdown()).toMatch(/^Before\s*Opening line\s*$/));
    await waitFor(() => expect(blockType(canvasElement)).toHaveTextContent('Paragraph'));
  },
};

export const ComponentToComponent: Story = {
  args: { value: '<Eyebrow>\n  Kicker\n</Eyebrow>\n' },
  play: async ({ canvasElement }) => {
    await userEvent.click(await find(canvasElement, '.site-eyebrow [contenteditable="true"]'));
    await waitFor(() => expect(blockType(canvasElement)).toHaveTextContent('Eyebrow'));
    await chooseBlockType(canvasElement, 'Quiet title');
    await waitFor(() => expect(markdown()).toMatch(/^<QuietTitle>\s*Kicker\s*<\/QuietTitle>\s*$/));
  },
};

/** With no component involved, Quote converts both ways as the stock dropdown does. */
export const ParagraphToQuoteAndBack: Story = {
  args: { value: 'Before\n\nQuoted line\n' },
  play: async ({ canvasElement }) => {
    const root = await find(canvasElement, '[contenteditable="true"]');
    await userEvent.click(within(root).getByText('Quoted line'));
    await chooseBlockType(canvasElement, 'Quote');
    await waitFor(() => expect(markdown()).toBe('Before\n\n> Quoted line\n'));

    await userEvent.click(within(root).getByText('Quoted line'));
    await chooseBlockType(canvasElement, 'Heading 2');
    await waitFor(() => expect(markdown()).toBe('Before\n\n## Quoted line\n'));
  },
};

/** The live posts write eyebrows on one line, which parses as a component alone in its paragraph. */
const POST_SECTION =
  '<Section id="real-page" label="The real page">\n<Eyebrow>01 — The real page</Eyebrow>\n\n## Edit the page\n\n</Section>\n';

export const OneLineComponentBackToParagraph: Story = {
  args: { value: POST_SECTION },
  play: async ({ canvasElement }) => {
    await userEvent.click(await find(canvasElement, '.site-eyebrow [contenteditable="true"]'));
    await waitFor(() => expect(blockType(canvasElement)).toHaveTextContent('Eyebrow'));
    await chooseBlockType(canvasElement, 'Paragraph');
    // The section keeps the layout it was written in; only the converted line changes.
    await waitFor(() =>
      expect(markdown()).toBe(POST_SECTION.replace('<Eyebrow>01 — The real page</Eyebrow>', '01 — The real page')),
    );
    await expect(canvasElement.querySelector('.site-eyebrow')).toBeNull();
  },
};

export const OneLineComponentToComponent: Story = {
  args: { value: POST_SECTION },
  play: async ({ canvasElement }) => {
    await userEvent.click(await find(canvasElement, '.site-eyebrow [contenteditable="true"]'));
    await chooseBlockType(canvasElement, 'Quiet title');
    await waitFor(() => expect(markdown()).toBe(POST_SECTION.replace(/Eyebrow/g, 'QuietTitle')));
  },
};

/** A document written with one-line components, unindented as the posts write them, saves byte for byte. */
export const OneLineComponentsSaveUnchanged: Story = {
  args: {
    value: `${POST_SECTION}\n<QuietTitle>Here is how it works:</QuietTitle>\n`,
  },
  play: async ({ args, canvasElement }) => {
    await find(canvasElement, '.site-quiet-title [contenteditable="true"]');
    await expect(markdown()).toBe(args.value);
  },
};

export const ContainersStayOutOfBlockType: Story = {
  args: { value: 'Line\n' },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(await find(canvasElement, '[contenteditable="true"]')).getByText('Line'));
    await userEvent.click(blockType(canvasElement));
    const options = (await within(document.body).findAllByRole('option')).map((o) => o.textContent);
    await expect(options).toEqual(expect.arrayContaining(['Paragraph', 'Heading 2', 'Eyebrow', 'Quiet title']));
    await expect(options.filter((o) => o === 'Section' || o === 'Group' || o === 'Text table')).toEqual([]);
    await userEvent.keyboard('{Escape}');
  },
};

async function setContentsLabel(canvasElement: HTMLElement, text: string): Promise<void> {
  await userEvent.click(await find(canvasElement, 'section.site-section [contenteditable="true"]'));
  const panel = await find(canvasElement, '.conloca-jsx-props-panel');
  const field = await within(panel).findByRole('textbox', { name: 'Contents label' });
  await userEvent.clear(field);
  await userEvent.type(field, text);
  await userEvent.tab();
}

export const SectionAnchorFromLabel: Story = {
  args: { value: '<Section>\n  Text\n</Section>\n' },
  play: async ({ canvasElement }) => {
    await setContentsLabel(canvasElement, 'Git history');
    const panel = await find(canvasElement, '.conloca-jsx-props-panel');
    await expect(within(panel).queryByRole('textbox', { name: 'Anchor' })).toBeNull();
    await waitFor(() => expect(markdown()).toMatch(/<Section label="Git history" id="git-history">/));

    await setContentsLabel(canvasElement, 'Every edit has a history');
    await waitFor(() => expect(markdown()).toMatch(/<Section id="git-history" label="Every edit has a history">/));
  },
};

export const ExistingAnchorKept: Story = {
  args: { value: '<Section id="real-page" label="The real page">\n  Text\n</Section>\n' },
  play: async ({ canvasElement }) => {
    await setContentsLabel(canvasElement, 'Edit the page that ships');
    await waitFor(() => expect(markdown()).toMatch(/<Section id="real-page" label="Edit the page that ships">/));
  },
};

/** The section's own heading keeps its slug: the new anchor takes another. */
export const SectionAnchorAvoidsHeadingSlug: Story = {
  args: { value: '<Section>\n\n## Git history\n\n</Section>\n' },
  play: async ({ canvasElement }) => {
    await setContentsLabel(canvasElement, 'Git history');
    await waitFor(() => expect(markdown()).toMatch(/<Section label="Git history" id="git-history-1">/));
  },
};

/** Typing in a section's body reaches the document while the caret is still there, so Save edits arms at once. */
export const TypingInSectionReachesTheDocument: Story = {
  args: { value: '<Section>\n\nText\n\n</Section>\n' },
  play: async ({ canvasElement }) => {
    const body = await find(canvasElement, 'section.site-section [contenteditable="true"]');
    await userEvent.click(within(body).getByText('Text'));
    getNearestEditorFromDOMNode(body)?.update(() => $getRoot().selectEnd(), { discrete: true });
    await userEvent.keyboard(' more');
    await waitFor(() => expect(markdown()).toBe('<Section>\n\nText more\n\n</Section>\n'));
    await expect(body).toContainElement(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  },
};

/** One undo after typing a word in a section's body takes the whole word back, as in a paragraph outside one. */
export const UndoInSectionTakesBackTheWord: Story = {
  args: { value: '<Section>\n\nText\n\n</Section>\n' },
  play: async ({ canvasElement }) => {
    const body = await find(canvasElement, 'section.site-section [contenteditable="true"]');
    await userEvent.click(within(body).getByText('Text'));
    getNearestEditorFromDOMNode(body)?.update(() => $getRoot().selectEnd(), { discrete: true });
    await userEvent.keyboard(' more');
    await waitFor(() => expect(markdown()).toBe('<Section>\n\nText more\n\n</Section>\n'));
    // Lexical reads Cmd on macOS and Ctrl elsewhere.
    const mod = /Mac/.test(navigator.platform) ? 'Meta' : 'Control';
    await userEvent.keyboard(`{${mod}>}z{/${mod}}`);
    await waitFor(() => expect(body).toHaveTextContent(/^Text$/));
    await waitFor(() => expect(markdown()).toBe('<Section>\n\nText\n\n</Section>\n'));
  },
};

/** A section inserted with a contents label gets its anchor at once; one loaded without an anchor waits for an edit. */
export const InsertedSectionGetsAnAnchor: Story = {
  args: { value: '' },
  beforeEach: () => {
    setMdxComponents([
      ...descriptors.filter((d) => d.name !== 'Section'),
      { name: 'Section', kind: 'flow', hasChildren: true, defaults: { attributes: { label: 'Fresh start' } } },
    ]);
  },
  play: async ({ canvasElement }) => {
    await userEvent.click(await find(canvasElement, '[contenteditable="true"]'));
    await userEvent.keyboard('/Section');
    await userEvent.click(
      within(await find(document.body, '[data-slash-menu]')).getByRole('option', { name: /^Section/ }),
    );
    await waitFor(() => expect(markdown()).toMatch(/^<Section label="Fresh start" id="fresh-start"/));
  },
};
