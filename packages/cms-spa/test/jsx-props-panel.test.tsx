/// <reference lib="dom" />
import { afterEach, expect, mock, setSystemTime, spyOn, test } from 'bun:test';
import { parseFragmentMdx } from '@conloca/mdx/render';
import type { MDXEditorMethods } from '@mdxeditor/editor';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { $getRoot, getNearestEditorFromDOMNode, UNDO_COMMAND } from 'lexical';
import { createRef } from 'react';
import { CMSMDXEditor } from '../src/components/editor/CMSMDXEditor.js';
import { JsxPropsPanel } from '../src/components/editor/JsxPropsPanel.js';
import { type MdxComponentProp, setMdxComponents } from '../src/mdx-components.js';
import { markLiveEditing, type SelectedBlock, setSelectedBlock } from '../src/selected-block.js';
import { readAttrs } from '../src/utils/mdast-tree.js';

afterEach(() => {
  cleanup();
  setSelectedBlock(null);
  setMdxComponents([]);
});

function select(props: MdxComponentProp[], attrs: SelectedBlock['attrs'] = {}) {
  const onPropChange = mock((_name: string, _value: unknown) => {});
  act(() =>
    setSelectedBlock({
      key: '1',
      name: 'Thing',
      descriptor: { name: 'Thing', kind: 'flow', props },
      attrs,
      onPropChange,
      onRemove: () => {},
    }),
  );
  const view = render(
    <div>
      <JsxPropsPanel />
      <button type="button">outside</button>
    </div>,
  );
  return { ...view, onPropChange };
}

const linkFields = { label: { type: 'string' }, href: { type: 'string' } } as const;

function blurTo(from: Element, outside: HTMLElement) {
  fireEvent.focusOut(from, { relatedTarget: outside });
}

test('a list prop is edited with Add item and Remove, never as JSON text', () => {
  const { container, onPropChange } = select([
    { name: 'items', type: 'list', of: { type: 'object', fields: linkFields } },
  ]);
  fireEvent.click(screen.getByRole('button', { name: '+ Add item' }));
  expect(onPropChange.mock.calls).toEqual([['items', [{}]]]);

  const label = screen.getByLabelText('Label');
  if (!(label instanceof HTMLInputElement)) throw new Error('Label is not an input');
  label.focus();
  for (const ch of 'Alpha') {
    fireEvent.change(label, { target: { value: label.value + ch } });
    expect(document.activeElement).toBe(screen.getByLabelText('Label'));
  }
  expect(onPropChange).toHaveBeenCalledTimes(1);

  blurTo(screen.getByLabelText('Label'), screen.getByRole('button', { name: 'outside' }));
  expect(onPropChange).toHaveBeenCalledTimes(2);
  expect(onPropChange.mock.calls[1]).toEqual(['items', [{ label: 'Alpha' }]]);

  const panel = container.querySelector('aside');
  if (!panel) throw new Error('no props panel');
  expect(panel.querySelector('textarea')).toBeNull();
  for (const input of panel.querySelectorAll('input')) expect(input.value).not.toMatch(/^[[{]/);

  // Label keeps focus, as in Safari: the list length change alone commits.
  fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
  expect(onPropChange.mock.calls.at(-1)).toEqual(['items', []]);
});

test('an object prop renders one control per field', () => {
  const { onPropChange } = select([{ name: 'cta', type: 'object', fields: linkFields }], { cta: { label: 'Go' } });
  expect(screen.getAllByRole('textbox')).toHaveLength(2);
  const href = screen.getByLabelText('Href');
  href.focus();
  fireEvent.change(href, { target: { value: '/x' } });
  expect(onPropChange).not.toHaveBeenCalled();
  blurTo(href, screen.getByRole('button', { name: 'outside' }));
  expect(onPropChange.mock.calls).toEqual([['cta', { label: 'Go', href: '/x' }]]);
});

test('a cleared object prop removes the attribute', () => {
  const { onPropChange } = select([{ name: 'cta', type: 'object', fields: linkFields }], { cta: { label: 'Go' } });
  const label = screen.getByLabelText('Label');
  label.focus();
  fireEvent.change(label, { target: { value: '' } });
  expect(onPropChange).not.toHaveBeenCalled();
  blurTo(label, screen.getByRole('button', { name: 'outside' }));
  expect(onPropChange.mock.calls).toEqual([['cta', null]]);
});

test('focus passing through a field without an edit writes nothing', () => {
  const { onPropChange } = select([
    { name: 'items', type: 'list', of: { type: 'string' } },
    { name: 'cta', type: 'object', fields: linkFields },
  ]);
  const outside = screen.getByRole('button', { name: 'outside' });
  const add = screen.getByRole('button', { name: '+ Add item' });
  add.focus();
  blurTo(add, outside);
  const label = screen.getByLabelText('Label');
  label.focus();
  blurTo(label, outside);
  expect(onPropChange).not.toHaveBeenCalled();
});

test('an object edit keeps keys the descriptor does not declare, in order', () => {
  const { onPropChange } = select([{ name: 'cta', type: 'object', fields: linkFields }], {
    cta: { icon: 'star', label: 'Go' },
  });
  const label = screen.getByLabelText('Label');
  label.focus();
  fireEvent.change(label, { target: { value: 'Went' } });
  blurTo(label, screen.getByRole('button', { name: 'outside' }));
  expect(JSON.stringify(onPropChange.mock.calls)).toBe(JSON.stringify([['cta', { icon: 'star', label: 'Went' }]]));
});

test('a value written as code is shown read-only and never overwritten', () => {
  const { onPropChange } = select([{ name: 'items', type: 'list', of: { type: 'string' } }], {
    items: '[{ label: A }]',
  });
  expect(screen.getByText(/is code, not data, so it is not published; fix it in source mode/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: '+ Add item' })).toBeNull();
  expect(onPropChange).not.toHaveBeenCalled();
});

test('a list prop in the object-literal form prettier writes is editable, as publish reads it', () => {
  const [node] = parseFragmentMdx(
    '<Thing\n  items={[\n    {\n      label: \'A\',\n      href: "/a",\n    },\n  ]}\n/>\n',
  ).children;
  if (node?.type !== 'mdxJsxFlowElement') throw new Error('no Thing element');
  select([{ name: 'items', type: 'list', of: { type: 'object', fields: linkFields } }], readAttrs(node));
  expect(screen.queryByText(/so it is not published/)).toBeNull();
  expect(screen.getByRole('button', { name: '+ Add item' })).toBeTruthy();
  expect(screen.getByLabelText('Label')).toHaveProperty('value', 'A');
});

test('Add item commits even when a text input keeps focus, as in Safari', () => {
  const { onPropChange } = select([{ name: 'tags', type: 'list', of: { type: 'string' } }], { tags: ['a'] });
  screen.getByRole('textbox').focus();
  fireEvent.click(screen.getByRole('button', { name: '+ Add item' }));
  expect(onPropChange.mock.calls).toEqual([['tags', ['a', '']]]);
});

test('a list of strings adds an empty string, not null', () => {
  const { onPropChange } = select([{ name: 'tags', type: 'list', of: { type: 'string' } }]);
  fireEvent.click(screen.getByRole('button', { name: '+ Add item' }));
  expect(onPropChange.mock.calls).toEqual([['tags', ['']]]);
});

test('scalar fields keep their controls', () => {
  select([
    { name: 'tone', type: 'string', options: [{ value: 'info', label: 'Info' }] },
    { name: 'open', type: 'boolean' },
  ]);
  expect(screen.getByRole('combobox', { name: 'tone' }).tagName).toBe('SELECT');
  expect(screen.getByRole('checkbox', { name: 'open' })).toBeTruthy();
});

test('while co-editing, a side-panel text field keeps its element and focus as it is typed and writes once it is left', () => {
  const release = markLiveEditing();
  try {
    const { onPropChange } = select([{ name: 'title', type: 'string' }], { title: '' });
    const field = screen.getByLabelText('title');
    field.focus();
    for (const typed of ['T', 'Ti', 'Tip']) {
      fireEvent.change(field, { target: { value: typed } });
      expect(screen.getByLabelText('title')).toBe(field);
      expect(document.activeElement).toBe(field);
    }
    expect(onPropChange).not.toHaveBeenCalled();
    blurTo(field, screen.getByRole('button', { name: 'outside' }));
    expect(onPropChange.mock.calls).toEqual([['title', 'Tip']]);
  } finally {
    release();
  }
});

/** Types `value` into a prop field as the browser does: a side-panel input, or a prop edited in place in the preview. */
function typeInto(field: HTMLElement, value: string) {
  if (field instanceof HTMLInputElement) {
    fireEvent.change(field, { target: { value } });
    return;
  }
  field.textContent = value;
  fireEvent.input(field);
}

// Typing that wrote each key would make each key its own undo step.
for (const { name, find } of [
  { name: 'a side-panel field', find: () => screen.findByLabelText('title') },
  {
    name: 'a prop edited in place',
    find: () =>
      waitFor(() => {
        const found = document.querySelector<HTMLElement>('[data-conloca-prop="title"]');
        if (!found) throw new Error('no title edited in place');
        return found;
      }),
  },
]) {
  test(`without co-editing, a visit to ${name} is one write and one undo step`, async () => {
    setMdxComponents([
      {
        name: 'Callout',
        kind: 'flow',
        hasChildren: true,
        // A source of its own: renders are cached per source for the whole run, and other test files render `site`.
        import: { from: 'site-without-co-editing' },
        props: [{ name: 'title', type: 'string' }],
      },
    ]);
    // The site renders the title as text the author can edit in place, and the body into its slot.
    const site = spyOn(globalThis, 'fetch').mockImplementation(
      Object.assign(
        async (_url: URL | RequestInfo, init?: RequestInit) => {
          if (typeof init?.body !== 'string') throw new Error('the render request has no JSON body');
          const request: { tree: { props: { title?: string } } } = JSON.parse(init.body);
          return new Response(`<p>${request.tree.props.title ?? ''}</p><conloca-slot></conloca-slot>`);
        },
        { preconnect: fetch.preconnect },
      ),
    );
    // The clock stands still, so every change falls inside Lexical's 300 ms undo merge window: the two undo steps below
    // must come from the writes themselves, not from how fast the test runs.
    setSystemTime(Date.now());
    try {
      const ref = createRef<MDXEditorMethods>();
      const { container } = render(
        <QueryClientProvider client={new QueryClient()}>
          <CMSMDXEditor ref={ref} value={'<Callout title="Note">\n\nHello\n\n</Callout>\n'} onChange={() => {}} />
          <JsxPropsPanel />
          <button type="button">outside</button>
        </QueryClientProvider>,
      );
      const markdown = () => ref.current?.getMarkdown() ?? '';
      const body = await waitFor(() => {
        const found = [...container.querySelectorAll<HTMLElement>('[contenteditable="true"]')].find(
          (el) => el.textContent === 'Hello',
        );
        if (!found) throw new Error('no component body');
        return found;
      });
      const nested = getNearestEditorFromDOMNode(body);
      if (!nested) throw new Error('no body editor');
      // An edit before the field visit, so undo has a step to go back to.
      const editBody = () =>
        nested.update(
          () => {
            const text = $getRoot().getAllTextNodes()[0];
            // Through 'Hello' first: on a retry the text is already 'Hello!', and setting it unchanged edits nothing.
            text?.setTextContent('Hello').setTextContent('Hello!');
            text?.selectEnd();
          },
          { discrete: true },
        );
      act(() => {
        fireEvent.mouseDown(body);
        body.focus();
        editBody();
      });
      // The body can show before the effect that writes its edits back to the document has run; an edit made then never
      // reaches the document, so it is made again.
      await waitFor(() => {
        if (!markdown().includes('Hello!')) editBody();
        expect(markdown()).toContain('Hello!');
      });
      // Undo merges changes within 300 ms, but the field's write is tagged as a new history step.
      const title = await find();
      title.focus();
      for (const typed of ['NoteX', 'NoteXY', 'NoteXYZ']) typeInto(title, typed);
      expect(markdown()).toContain('title="Note"');
      // React's onBlur listens for focusout; the field edited in place has a blur listener of its own.
      blurTo(title, screen.getByRole('button', { name: 'outside' }));
      fireEvent.blur(title);
      await waitFor(() => expect(markdown()).toContain('title="NoteXYZ"'));
      // The first editable in the page is the root editor's; component bodies are editables inside it.
      const root = getNearestEditorFromDOMNode(container.querySelector('[contenteditable="true"]'));
      if (!root) throw new Error('no root editor');
      act(() => {
        root.dispatchCommand(UNDO_COMMAND, undefined);
      });
      await waitFor(() => expect(markdown()).toContain('title="Note"'));
      expect(markdown()).toContain('Hello!');
    } finally {
      setSystemTime();
      site.mockRestore();
    }
  });
}

test('without co-editing, a list item typed in place writes once it is left, not on each key', async () => {
  setMdxComponents([
    {
      name: 'Steps',
      kind: 'flow',
      hasChildren: true,
      // A source of its own: renders are cached per source for the whole run.
      import: { from: 'site-list-without-co-editing' },
      props: [],
    },
  ]);
  // The site renders a list body as its items, which its list component wraps.
  const site = spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(
      async (_url: URL | RequestInfo, init?: RequestInit) => {
        if (typeof init?.body !== 'string') throw new Error('the render request has no JSON body');
        const request: { tree: { bodyHtml?: string } } = JSON.parse(init.body);
        return new Response(`<p>Steps</p><ol>${request.tree.bodyHtml ?? ''}</ol>`);
      },
      { preconnect: fetch.preconnect },
    ),
  );
  try {
    const ref = createRef<MDXEditorMethods>();
    const { container } = render(
      <QueryClientProvider client={new QueryClient()}>
        <CMSMDXEditor ref={ref} value={'<Steps>\n\n- one\n- two\n\n</Steps>\n'} onChange={() => {}} />
        <button type="button">outside</button>
      </QueryClientProvider>,
    );
    const markdown = () => ref.current?.getMarkdown() ?? '';
    const item = await waitFor(() => {
      const found = [...container.querySelectorAll<HTMLElement>('li[data-conloca-listitem]')].find(
        (li) => li.textContent === 'one',
      );
      if (!found) throw new Error('no editable list item');
      return found;
    });
    item.focus();
    for (const typed of ['on', 'o', 'uno']) typeInto(item, typed);
    expect(markdown()).toContain('one');
    expect(markdown()).not.toContain('uno');
    fireEvent.blur(item);
    await waitFor(() => expect(markdown()).toContain('uno'));
  } finally {
    site.mockRestore();
  }
});
