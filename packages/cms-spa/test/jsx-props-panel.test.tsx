/// <reference lib="dom" />
import { afterEach, expect, mock, test } from 'bun:test';
import { parseFragmentMdx } from '@conloca/mdx/render';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { JsxPropsPanel } from '../src/components/editor/JsxPropsPanel.js';
import type { MdxComponentProp } from '../src/mdx-components.js';
import { type SelectedBlock, setSelectedBlock } from '../src/selected-block.js';
import { readAttrs } from '../src/utils/mdast-tree.js';

afterEach(() => {
  cleanup();
  setSelectedBlock(null);
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
