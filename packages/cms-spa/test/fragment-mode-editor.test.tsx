/// <reference lib="dom" />
import { afterAll, afterEach, beforeEach, describe, expect, type Mock, mock, spyOn, test } from 'bun:test';
import { defineFragmentComponents, EMPTY_FRAGMENT_VOCABULARY, evaluateMDXToComponent } from '@conloca/mdx/render';
import type { MDXEditorMethods } from '@mdxeditor/editor';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  $createTextNode,
  $getRoot,
  $isElementNode,
  BLUR_COMMAND,
  getNearestEditorFromDOMNode,
  type LexicalEditor,
} from 'lexical';
import { createRef, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CMSMDXEditor } from '../src/components/editor/CMSMDXEditor.js';
import { JsxPropsPanel } from '../src/components/editor/JsxPropsPanel.js';
import { offeredMdxComponents } from '../src/components/editor/offered-mdx-components.js';
import { type MdxComponents, setMdxComponents } from '../src/mdx-components.js';
import { getSelectedBlock, setSelectedBlock } from '../src/selected-block.js';
import { setSiteRender } from '../src/site-render.js';

// The suite preload stubs the typeahead plugin; this one lists the options the slash menu would show.
await mock.module('@lexical/react/LexicalTypeaheadMenuPlugin', () => ({
  LexicalTypeaheadMenuPlugin: ({ options }: { options: { key: string }[] }) => (
    <ul data-testid="slash-options">
      {options.map((option) => (
        <li key={option.key}>{option.key}</li>
      ))}
    </ul>
  ),
  MenuOption: class MenuOption {
    key: string;
    constructor(key: string) {
      this.key = key;
    }
    setRefElement() {}
  },
  useBasicTypeaheadTriggerMatch: () => () => null,
}));

// mock.module is process-wide: put back the preload's stub so later files see the slash plugin they expect.
afterAll(async () => {
  await mock.module('@lexical/react/LexicalTypeaheadMenuPlugin', () => ({
    LexicalTypeaheadMenuPlugin: () => null,
    MenuOption: class MenuOption {
      key: string;
      constructor(key: string) {
        this.key = key;
      }
    },
    useBasicTypeaheadTriggerMatch: () => () => null,
  }));
});

const Boom = (): ReactNode => {
  throw new Error('kaboom');
};

const Callout = ({ tone, children }: { tone?: string; children?: ReactNode }) => (
  <aside data-tone={tone} className="site-callout">
    {children}
  </aside>
);
const Badge = ({ children }: { children?: ReactNode }) => <span className="site-badge">{children}</span>;
const LinkOut = (p: { href?: string; target?: string; children?: ReactNode }) => <a {...p}>{p.children}</a>;
const Img = (p: { src?: string }) => <img className="site-img" alt="" {...p} />;

const vocabulary = defineFragmentComponents({ components: { Callout, Badge, LinkOut, Img } });

const descriptors: MdxComponents = [
  {
    name: 'Callout',
    kind: 'flow',
    hasChildren: true,
    props: [{ name: 'tone', type: 'string' }],
    import: { from: './Callout.astro' },
  },
  { name: 'LinkOut', kind: 'flow', hasChildren: true },
  { name: 'Steps', kind: 'flow', hasChildren: true, import: { from: './Steps.astro' } },
];

let fetchSpy: Mock<typeof fetch>;
const renderRequests = () =>
  fetchSpy.mock.calls
    .map(([input]) => String(input instanceof Request ? input.url : input))
    .filter((url) => url.includes('/api/render'));

beforeEach(() => {
  fetchSpy = spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(async () => new Response('', { status: 404 }), { preconnect: fetch.preconnect }),
  );
  setSiteRender({ vocabulary });
  setMdxComponents(descriptors);
});

afterEach(() => {
  cleanup();
  fetchSpy.mockRestore();
  setMdxComponents([]);
  setSiteRender({});
  setSelectedBlock(null);
});

function renderEditor(markdown: string, ref = createRef<MDXEditorMethods>()) {
  const view = render(
    <QueryClientProvider client={new QueryClient()}>
      <CMSMDXEditor ref={ref} value={markdown} onChange={() => {}} fragment />
    </QueryClientProvider>,
  );
  return { ...view, ref };
}

function lexicalOf(element: Element | null | undefined): LexicalEditor {
  const editor = getNearestEditorFromDOMNode(element ?? null);
  if (!editor) throw new Error('no Lexical editor on element');
  return editor;
}

async function openInsertMenu(): Promise<string[]> {
  const trigger = await screen.findByRole('button', { name: 'Insert component' });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  const items = await screen.findAllByRole('menuitem');
  return items.map((item) => item.textContent ?? '');
}

describe('fragment mode', () => {
  test('offers only vocabulary components in fragment mode, with a synthesized one for a component without a descriptor', async () => {
    expect(offeredMdxComponents(descriptors, vocabulary).map((d) => d.name)).toEqual([
      'Callout',
      'LinkOut',
      'Badge',
      'Img',
    ]);
    expect(offeredMdxComponents(descriptors, undefined)).toBe(descriptors);

    renderEditor('Hello');
    const items = await openInsertMenu();
    expect(items).toContain('Callout');
    expect(items).toContain('Badge');
    expect(items).not.toContain('Steps');
    const slash = (await screen.findByTestId('slash-options')).textContent ?? '';
    expect(slash).toContain('Callout');
    expect(slash).toContain('Badge');
    expect(slash).not.toContain('Steps');
  });

  test('renders a vocabulary component as the site component while typing', async () => {
    const { container } = renderEditor('<Callout tone="info">\n\nHello **there**\n\n</Callout>');
    const aside = await waitFor(() => {
      const el = container.querySelector('aside.site-callout[data-tone="info"]');
      if (!el) throw new Error('no callout');
      return el;
    });
    const nested = aside.querySelector('[contenteditable="true"]');
    expect(nested).not.toBeNull();
    expect(nested?.textContent).toBe('Hello there');
  });

  test('renders a vocabulary component that has no descriptor as the site component', async () => {
    const { container } = renderEditor('Say <Badge>New</Badge> now');
    const badge = await waitFor(() => {
      const el = container.querySelector('span.site-badge');
      if (!el) throw new Error('no badge');
      return el;
    });
    expect(badge.querySelector('[contenteditable="true"]')?.textContent).toBe('New');
  });

  test('a void-element component without a descriptor renders with no children and no error card', async () => {
    const { container } = renderEditor('<Img src="/a.png" />');
    await waitFor(() => expect(container.querySelector('img.site-img[src="/a.png"]')).not.toBeNull());
    expect(container.textContent).not.toContain('failed to render');
  });

  test('never fetches /api/render in fragment mode', async () => {
    const { container } = renderEditor('<Callout tone="info">\n\nHello\n\n</Callout>');
    const aside = await waitFor(() => {
      const el = container.querySelector('aside.site-callout');
      if (!el) throw new Error('no callout');
      return el;
    });
    fireEvent.focus(aside);
    act(() => getSelectedBlock()?.onPropChange('tone', 'warning'));
    await waitFor(() => expect(container.querySelector('aside[data-tone="warning"]')).not.toBeNull());
    expect(renderRequests()).toEqual([]);
  });

  test('a fragment with a descriptor that has an import saves without import lines', async () => {
    const { ref } = renderEditor('Hello');
    await openInsertMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Callout' }));
    await waitFor(() => expect(ref.current?.getMarkdown()).toContain('<Callout'));
    expect(ref.current?.getMarkdown()).not.toMatch(/^\s*import\s/m);
  });

  test('editing a child inline keeps the component and its props', async () => {
    const { container, ref } = renderEditor('<Callout tone="info">\n\nHello\n\n</Callout>');
    const nestedRoot = await waitFor(() => {
      const el = container.querySelector('aside.site-callout [contenteditable="true"]');
      if (!el) throw new Error('no nested editor');
      return el;
    });
    const nested = lexicalOf(nestedRoot);
    act(() => {
      nested.update(
        () => {
          const paragraph = $getRoot().getFirstChild();
          if ($isElementNode(paragraph)) paragraph.append($createTextNode(' world'));
        },
        { discrete: true },
      );
      nested.dispatchCommand(BLUR_COMMAND, new FocusEvent('blur'));
    });
    await waitFor(() => expect(ref.current?.getMarkdown()).toContain('Hello world'));
    expect(ref.current?.getMarkdown()).toMatch(/<Callout tone="info">[\s\S]*Hello world[\s\S]*<\/Callout>/);
  });

  test('a rendered link does not navigate, including target=_top', async () => {
    const { container } = renderEditor('<LinkOut href="https://x.example" target="_top">go</LinkOut>');
    const anchor = await waitFor(() => {
      const el = container.querySelector('a[href="https://x.example"]');
      if (!el) throw new Error('no anchor');
      return el;
    });
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    anchor.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
  });

  test('a component that throws shows a labelled card and keeps the children editable', async () => {
    setSiteRender({ vocabulary: defineFragmentComponents({ components: { Boom } }) });
    const consoleError = spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { container } = renderEditor('<Boom>\n\nStill here\n\n</Boom>');
      await waitFor(() => expect(container.textContent).toContain('Boom failed to render: kaboom'));
      const editable = Array.from(container.querySelectorAll('[contenteditable="true"]')).find(
        (el) => el.textContent === 'Still here',
      );
      expect(editable).toBeDefined();
    } finally {
      consoleError.mockRestore();
    }
  });

  test('selecting the component publishes a SelectedBlock whose onPropChange rewrites the attribute', async () => {
    const { container, ref } = renderEditor('<Callout tone="info">\n\nHello\n\n</Callout>');
    const aside = await waitFor(() => {
      const el = container.querySelector('aside.site-callout');
      if (!el) throw new Error('no callout');
      return el;
    });
    fireEvent.click(aside);
    expect(getSelectedBlock()?.name).toBe('Callout');
    act(() => getSelectedBlock()?.onPropChange('tone', 'warning'));
    await waitFor(() => expect(ref.current?.getMarkdown()).toContain('tone="warning"'));
  });

  test('prop edits after typing in the body keep the typed text and each other, and refresh the panel attrs', async () => {
    const { container, ref } = renderEditor('<Callout tone="info">\n\nHello\n\n</Callout>');
    const nestedRoot = await waitFor(() => {
      const el = container.querySelector('aside.site-callout [contenteditable="true"]');
      if (!el) throw new Error('no nested editor');
      return el;
    });
    fireEvent.click(nestedRoot);
    const nested = lexicalOf(nestedRoot);
    act(() => {
      nested.update(
        () => {
          const paragraph = $getRoot().getFirstChild();
          if ($isElementNode(paragraph)) paragraph.append($createTextNode(' world'));
        },
        { discrete: true },
      );
      nested.dispatchCommand(BLUR_COMMAND, new FocusEvent('blur'));
    });
    await waitFor(() => expect(ref.current?.getMarkdown()).toContain('Hello world'));
    act(() => {
      getSelectedBlock()?.onPropChange('tone', 'warning');
      getSelectedBlock()?.onPropChange('title', 'Heads up');
    });
    await waitFor(() => expect(getSelectedBlock()?.attrs).toEqual({ tone: 'warning', title: 'Heads up' }));
    const markdown = ref.current?.getMarkdown() ?? '';
    expect(markdown).toContain('Hello world');
    expect(markdown).toContain('tone="warning"');
    expect(markdown).toContain('title="Heads up"');
  });

  test('a list prop edited in the panel saves as JSON and publish renders the same value', async () => {
    type Link = { label: string; href: string };
    const List = ({ items }: { items: Link[] }) => (
      <ul className="site-list">
        {items.map((item) => (
          <li key={item.href}>
            <a href={item.href}>{item.label}</a>
          </li>
        ))}
      </ul>
    );
    const listVocabulary = defineFragmentComponents({ components: { List } });
    setSiteRender({ vocabulary: listVocabulary });
    const linkFields = { label: { type: 'string' }, href: { type: 'string' } } as const;
    setMdxComponents([
      {
        name: 'List',
        kind: 'flow',
        props: [{ name: 'items', type: 'list', of: { type: 'object', fields: linkFields } }],
      },
    ]);
    const ref = createRef<MDXEditorMethods>();
    const { container } = render(
      <QueryClientProvider client={new QueryClient()}>
        <CMSMDXEditor ref={ref} value={'<List items={[]} />'} onChange={() => {}} fragment />
        <JsxPropsPanel />
        <button type="button">outside</button>
      </QueryClientProvider>,
    );
    const list = await waitFor(() => {
      const el = container.querySelector('ul.site-list');
      if (!el) throw new Error('no list');
      return el;
    });
    fireEvent.click(list);
    fireEvent.click(await screen.findByRole('button', { name: '+ Add item' }));
    const labelInput = await screen.findByLabelText('Label');
    labelInput.focus();
    fireEvent.change(labelInput, { target: { value: 'A' } });
    const hrefInput = screen.getByLabelText('Href');
    hrefInput.focus();
    fireEvent.change(hrefInput, { target: { value: '/a' } });
    expect(ref.current?.getMarkdown()).not.toContain('"/a"');
    fireEvent.focusOut(screen.getByLabelText('Href'), {
      relatedTarget: screen.getByRole('button', { name: 'outside' }),
    });
    await waitFor(() => expect(ref.current?.getMarkdown()).toContain('items={[{"label":"A","href":"/a"}]}'));
    const { Component, error } = await evaluateMDXToComponent(ref.current?.getMarkdown() ?? '', listVocabulary);
    expect(error).toBeUndefined();
    expect(Component && renderToStaticMarkup(<Component />)).toContain('<li><a href="/a">A</a></li>');
  });

  test('fragment mode with the empty vocabulary offers only snippets and keeps an existing <Callout> editable as a generic card, with no /api/render fetch', async () => {
    setSiteRender({ vocabulary: EMPTY_FRAGMENT_VOCABULARY });
    setMdxComponents([...descriptors, { name: 'Note', kind: 'snippet', insert: { label: 'Note' }, content: 'A note' }]);
    expect(offeredMdxComponents(descriptors, EMPTY_FRAGMENT_VOCABULARY)).toEqual([]);
    const { container } = renderEditor('<Callout>\n\nStill editable\n\n</Callout>');
    await waitFor(() =>
      expect(
        Array.from(container.querySelectorAll('[contenteditable="true"]')).some(
          (el) => el.textContent === 'Still editable',
        ),
      ).toBe(true),
    );
    expect(container.querySelector('aside.site-callout')).toBeNull();
    expect(await openInsertMenu()).toEqual(['Note']);
    expect(renderRequests()).toEqual([]);
  });
});
