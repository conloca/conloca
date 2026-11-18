import { defineFragmentComponents } from '@conloca/mdx/render';
import type { MDXEditorMethods } from '@mdxeditor/editor';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { $getRoot, getNearestEditorFromDOMNode } from 'lexical';
import { createRef, type ReactNode, useEffect, useState } from 'react';
import { expect, userEvent, waitFor } from 'storybook/test';
import '../../main.css';
import { setMdxComponents } from '../../mdx-components.js';
import { setSiteRender } from '../../site-render.js';
import { configureUI, getUIConfig } from '../../ui-config.js';
import { CMSMDXEditor } from './CMSMDXEditor.js';
import { SoftBreakNode } from './soft-break-plugin.js';

/** The fragment editor lays a fragment's prose out the way the published page does. */

const queryClient = new QueryClient();
const editorRef = createRef<MDXEditorMethods>();

const meta = {
  title: 'Editor/FragmentEditorLayout',
  render: (args: { value: string }) => (
    <QueryClientProvider client={queryClient}>
      <CMSMDXEditor ref={editorRef} value={args.value} onChange={() => {}} fragment />
    </QueryClientProvider>
  ),
} satisfies Meta<{ value: string }>;

export default meta;
type Story = StoryObj<typeof meta>;

function find<T extends Element>(root: ParentNode, selector: string): Promise<T> {
  return waitFor(() => {
    const el = root.querySelector<T>(selector);
    if (!el) throw new Error(`no ${selector}`);
    return el;
  });
}

/** A paragraph wrapped over two source lines reads as one line where the editor is wide enough for it. */
export const SoftBreakReflows: Story = {
  args: { value: 'A short paragraph wrapped in its source\nonto a second line.\n' },
  play: async ({ canvasElement }) => {
    const paragraph = await find<HTMLElement>(canvasElement, '[contenteditable="true"] p');
    const lineHeight = Number.parseFloat(getComputedStyle(paragraph).lineHeight);
    await expect(paragraph.getBoundingClientRect().height).toBeLessThan(lineHeight * 1.5);
    // The line ending is still there, only drawn as the space the published page draws.
    await expect(paragraph.textContent).toBe('A short paragraph wrapped in its source\nonto a second line.');
  },
};

/** Typing on either side of a soft break types into the words around it, and the break saves as the line ending. */
export const TypingAroundSoftBreak: Story = {
  args: { value: 'First line\nsecond line.\n' },
  play: async ({ canvasElement }) => {
    const root = await find<HTMLElement>(canvasElement, '[contenteditable="true"]');
    await userEvent.click(root);
    const editor = getNearestEditorFromDOMNode(root);
    // Either side of the break: its end (1), then its start (0).
    const caretAtBreak = (offset: number) =>
      editor?.update(
        () =>
          $getRoot()
            .getAllTextNodes()
            .find((node) => node instanceof SoftBreakNode)
            ?.select(offset, offset),
        { discrete: true },
      );
    caretAtBreak(1);
    await userEvent.keyboard('the ');
    caretAtBreak(0);
    await userEvent.keyboard(' one');
    await waitFor(() => expect(editorRef.current?.getMarkdown()).toBe('First line one\nthe second line.\n'));
  },
};

/** A published page: `css` and `body` in a document of their own. */
function page(css: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${body}</body></html>`;
}

/**
 * A published page whose prose wrapper spaces its own children, the way conloca.com's `.conloca-prose` does, and
 * draws a box the editor must show once.
 */
function flowPage(wrapper: string): string {
  const css = `@layer base { p, h2 { margin: 0; } }
.${wrapper} { border: 3px solid #999; }
.${wrapper} > * + * { margin-top: 40px; }
.${wrapper} > p + p { margin-top: 24px; }`;
  return page(css, `<main><div class="${wrapper}"><p>One.</p><p>Two.</p><h2>Heading</h2><p>Three.</p></div></main>`);
}

/** The gap above each block after the first. */
function gaps(blocks: Element[]): number[] {
  const result: number[] = [];
  let above: DOMRect | undefined;
  for (const block of blocks) {
    const rect = block.getBoundingClientRect();
    if (above) result.push(Math.round(rect.top - above.bottom));
    above = rect;
  }
  return result;
}

/** The fragment editor inside the workspace frame, where the probe's load of the published page styles it. */
function FramedEditor({ html, value }: { html: string; value: string }) {
  const [pageUrl, setPageUrl] = useState<string>();
  useEffect(() => {
    const previous = getUIConfig();
    configureUI({ ...previous, memoryRouter: { initialPath: '/', onNavigate() {}, subscribe: () => () => {} } });
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    setPageUrl(url);
    return () => {
      configureUI(previous);
      URL.revokeObjectURL(url);
    };
  }, [html]);
  return (
    <QueryClientProvider client={queryClient}>
      {pageUrl && (
        <>
          <iframe title="published" src={pageUrl} style={{ width: 800, height: 300 }} />
          <div className="conloca-mdx-editor-surround" style={{ width: 800 }}>
            <CMSMDXEditor value={value} onChange={() => {}} previewRouteUrl={pageUrl} fragment />
          </div>
        </>
      )}
    </QueryClientProvider>
  );
}

/** The gaps between the published root's children, once the page has loaded and two reads a frame apart agree. */
async function publishedGaps(canvasElement: HTMLElement, root: string): Promise<number[]> {
  const frame = await find<HTMLIFrameElement>(canvasElement, 'iframe[title="published"]');
  const read = () => {
    const doc = frame.contentDocument;
    const element = doc?.readyState === 'complete' ? doc.querySelector(root) : null;
    if (!element?.lastElementChild) throw new Error('published page not loaded');
    return gaps([...element.children]);
  };
  return waitFor(async () => {
    const first = read();
    const tick = Promise.withResolvers<number>();
    requestAnimationFrame(tick.resolve);
    await tick.promise;
    await expect(read()).toEqual(first);
    return first;
  });
}

/** Polls `check` on the editor's contenteditable: the probe and the site's CSS land across effects and remounts. */
function editableSettles(canvasElement: HTMLElement, check: (editable: HTMLElement) => Promise<void>): Promise<void> {
  return waitFor(
    async () => {
      const editable = canvasElement.querySelector<HTMLElement>('[contenteditable="true"]');
      if (!editable) throw new Error('no contenteditable');
      await check(editable);
    },
    { timeout: 10000 },
  );
}

function siteFlowStory(wrapper: string): Story {
  return {
    args: { value: 'One.\n\nTwo.\n\n## Heading\n\nThree.\n' },
    render: (args) => <FramedEditor html={flowPage(wrapper)} value={args.value} />,
    play: async ({ canvasElement }) => {
      const published = await publishedGaps(canvasElement, `.${wrapper}`);
      await expect(published).toEqual([24, 40, 40]);
      await editableSettles(canvasElement, async (editable) => {
        await expect(gaps([...editable.children])).toEqual(published);
        // The wrapper's box is drawn once, by the clone around the contenteditable.
        const clone = editable.closest(`div.${wrapper}:not([contenteditable])`);
        const borders = [clone, editable].map((el) => el && getComputedStyle(el).borderTopWidth);
        await expect(borders).toEqual(['3px', '0px']);
      });
    },
  };
}

/** The editor's root blocks are spaced by the site's own flow rules, as the published wrapper's children are. */
export const RootBlocksFollowTheSiteFlow: Story = siteFlowStory('site-prose');

/** The same with Conloca's own prose class, which the contenteditable carries anyway: the probe must not override it. */
export const RootBlocksFollowTheConlocaProseFlow: Story = siteFlowStory('conloca-prose');

/** The editor's root blocks of `value` sit `expected` apart, as the published page's blocks under `root` do. */
function sameGapsStory(css: string, body: string, root: string, value: string, expected: number[]): Story {
  return {
    args: { value },
    render: (args) => <FramedEditor html={page(css, body)} value={args.value} />,
    play: async ({ canvasElement }) => {
      const published = await publishedGaps(canvasElement, root);
      await expect(published).toEqual(expected);
      await editableSettles(canvasElement, async (editable) => {
        await expect(gaps([...editable.children])).toEqual(published);
      });
    },
  };
}

/**
 * A site that resets every margin and spaces paragraphs from an ancestor the editor does not have (`article p`): the
 * probe's measured spacing outranks the reset.
 */
export const SpacingFromAnAncestorSurvivesTheReset: Story = sameGapsStory(
  '@layer base { *, ::before, ::after { margin: 0; } } article p { margin-block: 16px; }',
  '<main><article><div class="content"><p>One.</p><p>Two.</p><p>Three.</p></div></article></main>',
  '.content',
  'One.\n\nTwo.\n\nThree.\n',
  [16, 16],
);

/**
 * Flow spacing in `em` under an ancestor that sets the font size: the site's rules still space the editor's blocks,
 * each pair by its own rule (27px between paragraphs, 45px around the heading).
 */
export const EmFlowSpacingUnderAFontSizeAncestor: Story = sameGapsStory(
  `@layer base { *, ::before, ::after { margin: 0; } }
article { font-size: 18px; }
.site-em > * + * { margin-top: 2.5em; }
.site-em > p + p { margin-top: 1.5em; }
.site-em h2 { font-size: 1em; }`,
  '<main><article><div class="site-em"><p>One.</p><p>Two.</p><h2>Heading</h2><p>Three.</p></div></article></main>',
  '.site-em',
  'One.\n\nTwo.\n\n## Heading\n\nThree.\n',
  [27, 45, 45],
);

/**
 * A wrapper that drops its last child's bottom margin, spacing blocks from an ancestor the editor does not have: the
 * probe measures a block mid-flow, not as the wrapper's last child.
 */
export const SpacingMeasuredMidFlowNotAtTheEnd: Story = sameGapsStory(
  `@layer base { *, ::before, ::after { margin: 0; } }
article .site-last p { margin-bottom: 20px; }
.site-last > :last-child { margin-bottom: 0; }`,
  '<main><article><div class="site-last"><p>One.</p><p>Two.</p><p>Three.</p></div></article></main>',
  '.site-last',
  'One.\n\nTwo.\n\nThree.\n',
  [20, 20],
);

/** A wrapper with its own box and layout: the clone draws them, the contenteditable inside it does not again. */
export const WrapperBoxAndLayoutDrawnOnce: Story = {
  args: { value: 'One.\n\nTwo.\n' },
  render: (args) => (
    <FramedEditor
      html={page(
        '.site-box { padding: 32px; display: grid; gap: 10px; overflow: hidden; min-height: 400px; width: 600px; }',
        '<main><div class="site-box"><p>One.</p><p>Two.</p></div></main>',
      )}
      value={args.value}
    />
  ),
  play: async ({ canvasElement }) => {
    await editableSettles(canvasElement, async (editable) => {
      const clone = editable.closest('div.site-box:not([contenteditable])');
      if (!clone) throw new Error('no wrapper clone');
      await expect(getComputedStyle(clone).paddingTop).toBe('32px');
      const own = getComputedStyle(editable);
      await expect({
        classes: editable.classList.contains('site-box'),
        padding: own.paddingTop === '32px',
        display: own.display,
        rowGap: own.rowGap,
        overflow: own.overflow,
        minHeight: own.minHeight === '400px',
        width: own.width === '600px',
      }).toEqual({
        classes: true,
        padding: false,
        display: 'block',
        rowGap: 'normal',
        overflow: 'visible',
        minHeight: false,
        width: false,
      });
    });
  },
};

/** A site section that draws its own box and spaces its own children, as conloca.com's `.conloca-prose__section`. */
const Section = ({ children }: { children?: ReactNode }) => <section className="site-section">{children}</section>;
const Eyebrow = ({ children }: { children?: ReactNode }) => <p className="site-eyebrow">{children}</p>;

/** From the eyebrow's bottom to the heading's top under `root`: what a reader sees between them. */
function eyebrowToHeading(root: ParentNode): number {
  const eyebrow = root.querySelector('.site-eyebrow');
  const heading = root.querySelector('h2');
  if (!eyebrow || !heading) throw new Error('no eyebrow or heading');
  return Math.round(heading.getBoundingClientRect().top - eyebrow.getBoundingClientRect().bottom);
}

/** The box an element draws at its top. */
function topBox(el: Element): string[] {
  const style = getComputedStyle(el);
  return [style.paddingTop, style.borderTopWidth];
}

/**
 * Blocks inside a component's body are spaced by the site's flow rules on the component's own children, as on the
 * published page, and the component's box is drawn once.
 */
export const ComponentBodyFollowsTheSiteFlow: Story = {
  args: { value: '<Section>\n<Eyebrow>01 — Label</Eyebrow>\n\n## Heading\n\nOne.\n\nTwo.\n</Section>\n' },
  beforeEach: () => {
    setSiteRender({ vocabulary: defineFragmentComponents({ components: { Section, Eyebrow } }) });
    setMdxComponents([
      { name: 'Section', kind: 'flow', hasChildren: true },
      { name: 'Eyebrow', kind: 'flow', hasChildren: true },
    ]);
    return () => {
      setSiteRender({});
      setMdxComponents([]);
    };
  },
  render: (args) => (
    <FramedEditor
      html={page(
        `@layer base { *, ::before, ::after { margin: 0; } }
.site-section { padding-top: 30px; border-top: 3px solid #999; }
.site-section > * + * { margin-top: 24px; }
.site-section > h2 + * { margin-top: 12px; }`,
        `<main><div class="site-body"><section class="site-section"><p class="site-eyebrow">01 — Label</p>
<h2>Heading</h2><p>One.</p><p>Two.</p></section></div></main>`,
      )}
      value={args.value}
    />
  ),
  play: async ({ canvasElement }) => {
    const published = await publishedGaps(canvasElement, '.site-section');
    await expect(published).toEqual([24, 12, 24]);
    await editableSettles(canvasElement, async (editable) => {
      const section = editable.querySelector('section.site-section');
      const body = section?.querySelector(':scope > [contenteditable]');
      if (!section || !body) throw new Error('no section body');
      await expect(gaps([...body.children])).toEqual(published);
      // An eyebrow drawn as a block inside the paragraph that holds it adds no line of its own below it.
      const doc = canvasElement.querySelector<HTMLIFrameElement>('iframe[title="published"]')?.contentDocument;
      if (!doc) throw new Error('no published page');
      await expect(eyebrowToHeading(section)).toBe(eyebrowToHeading(doc));
      // The section's box is drawn once, by the site's own element around the body.
      await expect([topBox(section), topBox(body)]).toEqual([
        ['30px', '3px'],
        ['0px', '0px'],
      ]);
    });
  },
};

/**
 * The caret can sit after a component that draws a block in a paragraph of its own (the eyebrow), where the editor
 * hides the trailing break that would draw an empty line under it, and what the author types there lands there.
 */
export const TypingAfterABlockDrawnInlineComponent: Story = {
  ...ComponentBodyFollowsTheSiteFlow,
  play: async ({ canvasElement }) => {
    const { userEvent: real } = await import('vitest/browser');
    const body = await waitFor(() => {
      const found = canvasElement.querySelector<HTMLElement>('section.site-section > [contenteditable]');
      if (!found?.querySelector('.site-eyebrow')) throw new Error('no section body');
      return found;
    });
    const holder = body.querySelector('.site-eyebrow')?.closest('[contenteditable] > p');
    if (!holder) throw new Error('no paragraph holding the eyebrow');
    await expect(getComputedStyle(holder.lastElementChild ?? holder).display).toBe('none');
    // From the heading's start, one step back lands after the component, where the hidden break was the caret's spot.
    await real.click(body.querySelector('h2') ?? body);
    await real.keyboard('{Home}{ArrowLeft}Typed');
    await waitFor(async () => {
      // Typing writes the section back, which may render its body afresh.
      const current = canvasElement.querySelector('section.site-section > [contenteditable]');
      const blocks = [...(current?.children ?? [])].map((child) => child.textContent);
      await expect(blocks).toEqual(['01 — LabelTyped', 'Heading', 'One.', 'Two.']);
    });
  },
};

/**
 * A component whose own class sizes its text relative to its parent, decorates it, makes it see-through and moves it.
 * The editor's body carries that class too (so the site's flow rules reach the body's blocks), but must not apply any
 * of it a second time.
 */
const Lead = ({ children }: { children?: ReactNode }) => <div className="site-lead">{children}</div>;

/** The text, its offset in the component and how the component draws it, read the same way on both sides. */
function leadLook(component: Element) {
  const text = component.querySelector('p');
  if (!text) throw new Error('no lead text');
  let opacity = 1;
  for (let node: Element | null = text; node && node !== component.parentElement; node = node.parentElement) {
    opacity *= Number(getComputedStyle(node).opacity);
  }
  const decorated = [component, ...component.querySelectorAll('*')].filter(
    (el) => getComputedStyle(el, '::before').content !== 'none',
  ).length;
  const style = getComputedStyle(text);
  const [box, own] = [component.getBoundingClientRect(), text.getBoundingClientRect()];
  return {
    fontSize: style.fontSize,
    // The element right inside the component: the text on the page, the editor's body in the editor.
    innerFontSize: component.firstElementChild ? getComputedStyle(component.firstElementChild).fontSize : '',
    letterSpacing: style.letterSpacing,
    lineHeight: style.lineHeight,
    opacity: Math.round(opacity * 100) / 100,
    decorated,
    componentFontSize: getComputedStyle(component).fontSize,
    top: Math.round(own.top - box.top),
    left: Math.round(own.left - box.left),
  };
}

export const ComponentDecorationDrawnOnce: Story = {
  args: { value: 'Intro.\n\n<Lead>\nLead text.\n</Lead>\n' },
  beforeEach: () => {
    setSiteRender({ vocabulary: defineFragmentComponents({ components: { Lead } }) });
    setMdxComponents([{ name: 'Lead', kind: 'flow', hasChildren: true }]);
    return () => {
      setSiteRender({});
      setMdxComponents([]);
    };
  },
  render: (args) => (
    <FramedEditor
      html={page(
        `@layer base { *, ::before, ::after { margin: 0; } }
.site-lead { font-size: 1.25em; letter-spacing: 0.1em; line-height: 1.5em; opacity: 0.8; position: relative; top: 6px;
  transform: translateX(4px); filter: grayscale(0.5); }
.site-lead::before { content: "*"; display: block; }`,
        '<main><div class="site-body"><p>Intro.</p><div class="site-lead"><p>Lead text.</p></div></div></main>',
      )}
      value={args.value}
    />
  ),
  play: async ({ canvasElement }) => {
    const doc = await waitFor(() => {
      const found = canvasElement.querySelector<HTMLIFrameElement>('iframe[title="published"]')?.contentDocument;
      if (found?.readyState !== 'complete' || !found.querySelector('.site-lead p')) throw new Error('published page');
      return found;
    });
    const published = leadLook(doc.querySelector('.site-lead') ?? doc.body);
    await expect(published).toMatchObject({ opacity: 0.8, decorated: 1 });
    await editableSettles(canvasElement, async (editable) => {
      const lead = editable.querySelector('div.site-lead:not([contenteditable])');
      if (!lead?.querySelector(':scope > [contenteditable].site-lead p')) throw new Error('the lead body has no class');
      await expect(leadLook(lead)).toEqual(published);
    });
  },
};
