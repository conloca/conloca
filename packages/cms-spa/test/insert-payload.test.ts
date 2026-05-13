import { describe, expect, test } from 'bun:test';
import { buildInsertPayload } from '../src/components/editor/insert-menu/insert-payload';
import type { MdxComponentDescriptor } from '../src/mdx-components';

describe('buildInsertPayload', () => {
  test('produces an empty payload for a propless flow descriptor', () => {
    const d: MdxComponentDescriptor = { name: 'FileTree', kind: 'flow', hasChildren: true };
    const out = buildInsertPayload(d);
    expect(out).toEqual({ kind: 'flow', name: 'FileTree', props: {}, children: undefined });
  });

  test('merges defaults.attributes with caller overrides', () => {
    const d: MdxComponentDescriptor = {
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
    const d: MdxComponentDescriptor = {
      name: 'CardGrid',
      kind: 'flow',
      hasChildren: true,
      props: [{ name: 'stagger', type: 'boolean' }],
      defaults: { attributes: { stagger: true } },
    };
    const out = buildInsertPayload(d);
    expect(out.props.stagger).toEqual({ type: 'mdxJsxAttributeValueExpression', value: 'true' });
  });

  test('parses defaults.children as CommonMark when hasChildren is true', () => {
    const d: MdxComponentDescriptor = {
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
    const d: MdxComponentDescriptor = {
      name: 'LinkCard',
      kind: 'flow',
      hasChildren: false,
      defaults: { attributes: { title: 'x', href: '/y' }, children: 'ignored' },
    };
    const out = buildInsertPayload(d);
    expect(out.children).toBeUndefined();
  });
});
