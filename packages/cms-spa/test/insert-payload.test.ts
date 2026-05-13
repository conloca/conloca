import { describe, expect, test } from 'bun:test';
import {
  buildInsertPayload,
  dispatchInsert,
  type InsertJsxPayload,
} from '../src/components/editor/insert-menu/insert-payload';
import type { MdxJsxComponentDescriptor, MdxSnippetDescriptor } from '../src/mdx-components';

describe('buildInsertPayload', () => {
  test('produces an empty payload for a propless flow descriptor', () => {
    const d: MdxJsxComponentDescriptor = { name: 'FileTree', kind: 'flow', hasChildren: true };
    const out = buildInsertPayload(d);
    expect(out).toEqual({ kind: 'flow', name: 'FileTree', props: {}, children: undefined });
  });

  test('merges defaults.attributes with caller overrides', () => {
    const d: MdxJsxComponentDescriptor = {
      name: 'Card',
      kind: 'flow',
      hasChildren: true,
      props: [{ name: 'title', type: 'string', required: true }],
      defaults: { attributes: { title: 'Default title' } },
    };
    const out = buildInsertPayload(d, { title: 'Overridden' });
    expect(out.props).toEqual({ title: 'Overridden' });
  });

  test('wraps number/boolean values as expression attributes', () => {
    const d: MdxJsxComponentDescriptor = {
      name: 'CardGrid',
      kind: 'flow',
      hasChildren: true,
      props: [{ name: 'stagger', type: 'boolean' }],
      defaults: { attributes: { stagger: true } },
    };
    const out = buildInsertPayload(d);
    expect(out.props.stagger).toEqual({ type: 'expression', value: 'true' });
  });

  test('parses defaults.children as CommonMark when hasChildren is true', () => {
    const d: MdxJsxComponentDescriptor = {
      name: 'Steps',
      kind: 'flow',
      hasChildren: true,
      defaults: { children: '1. one\n2. two' },
    };
    const out = buildInsertPayload(d);
    const children = out.children as Array<{ type: string }>;
    expect(Array.isArray(children)).toBe(true);
    expect(children[0]?.type).toBe('list');
  });

  test('leaves children undefined when hasChildren is false', () => {
    const d: MdxJsxComponentDescriptor = {
      name: 'LinkCard',
      kind: 'flow',
      hasChildren: false,
      defaults: { attributes: { title: 'x', href: '/y' }, children: 'ignored' },
    };
    const out = buildInsertPayload(d);
    expect(out.children).toBeUndefined();
  });
});

describe('dispatchInsert', () => {
  // Tiny stub publishers — the real publishers are bound by usePublisher in
  // the editor. The dispatcher should call exactly one of them depending on
  // the descriptor's kind.
  function makePublishers() {
    const jsxCalls: InsertJsxPayload[] = [];
    const markdownCalls: string[] = [];
    return {
      jsxCalls,
      markdownCalls,
      publishers: {
        jsx: (p: InsertJsxPayload) => jsxCalls.push(p),
        markdown: (v: string) => markdownCalls.push(v),
      },
    };
  }

  test('routes JSX descriptors through the jsx publisher', () => {
    const { jsxCalls, markdownCalls, publishers } = makePublishers();
    const d: MdxJsxComponentDescriptor = { name: 'FileTree', kind: 'flow', hasChildren: true };
    dispatchInsert(d, publishers);
    expect(jsxCalls).toHaveLength(1);
    expect(markdownCalls).toHaveLength(0);
    expect(jsxCalls[0]?.name).toBe('FileTree');
  });

  test('routes snippet descriptors through the markdown publisher', () => {
    const { jsxCalls, markdownCalls, publishers } = makePublishers();
    const d: MdxSnippetDescriptor = {
      name: 'snippet-callout-quote',
      kind: 'snippet',
      insert: { label: 'Callout Quote' },
      content: '> A short, sharp takeaway.\n',
    };
    dispatchInsert(d, publishers);
    expect(markdownCalls).toEqual(['> A short, sharp takeaway.\n']);
    expect(jsxCalls).toHaveLength(0);
  });
});
