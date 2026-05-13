import { describe, expect, test } from 'bun:test';
import {
  defineMdxComponents,
  isJsxDescriptor,
  isSnippetDescriptor,
  type MdxJsxComponentDescriptor,
  type MdxSnippetDescriptor,
  toJsxComponentDescriptor,
} from '../src/mdx-components';

// Smallest JSX descriptor that satisfies the type — `kind: 'flow'` is the
// default insert path, `name` is required, everything else stays optional.
const minimal = (over: Partial<MdxJsxComponentDescriptor> = {}): MdxJsxComponentDescriptor => ({
  name: 'Steps',
  kind: 'flow',
  ...over,
});

// Smallest snippet descriptor. `insert` and `content` are required because
// a snippet with no label or no content is nonsensical.
const snippetMinimal = (over: Partial<MdxSnippetDescriptor> = {}): MdxSnippetDescriptor => ({
  name: 'CalloutSnippet',
  kind: 'snippet',
  insert: { label: 'Callout' },
  content: '> A short, sharp takeaway.\n',
  ...over,
});

describe('defineMdxComponents', () => {
  test('returns the same array on valid input', () => {
    const input = [minimal({ name: 'Steps' }), minimal({ name: 'Tabs' })];
    const out = defineMdxComponents(input);
    expect(out).toBe(input);
  });

  test('throws on duplicate name', () => {
    expect(() => defineMdxComponents([minimal({ name: 'Steps' }), minimal({ name: 'Steps' })])).toThrow(
      /duplicate descriptor for 'Steps'/,
    );
  });

  test('throws on duplicate name with conflicting import.from', () => {
    expect(() =>
      defineMdxComponents([
        minimal({ name: 'Steps', import: { from: '@astrojs/starlight/components' } }),
        minimal({ name: 'Steps', import: { from: '@somewhere/else' } }),
      ]),
    ).toThrow(/conflicting import.from/);
  });

  test("throws on kind: 'text' with hasChildren: true", () => {
    expect(() => defineMdxComponents([minimal({ name: 'Icon', kind: 'text', hasChildren: true })])).toThrow(
      /kind: 'text' with hasChildren: true/,
    );
  });

  test("permits kind: 'text' without hasChildren", () => {
    expect(() => defineMdxComponents([minimal({ name: 'Icon', kind: 'text', hasChildren: false })])).not.toThrow();
    expect(() => defineMdxComponents([minimal({ name: 'Icon', kind: 'text' })])).not.toThrow();
  });

  test('accepts snippet descriptors alongside JSX descriptors', () => {
    const input = [minimal({ name: 'Steps' }), snippetMinimal({ name: 'ProofPoints' })];
    expect(() => defineMdxComponents(input)).not.toThrow();
  });

  test('throws when a snippet collides with a JSX component name', () => {
    // Cross-kind collision is intentional: both surface in the insert menu
    // under the same label, so allowing them would produce silent shadowing.
    expect(() => defineMdxComponents([minimal({ name: 'Aside' }), snippetMinimal({ name: 'Aside' })])).toThrow(
      /duplicate descriptor for 'Aside'/,
    );
  });

  test('throws on snippet with empty content', () => {
    expect(() => defineMdxComponents([snippetMinimal({ content: '' })])).toThrow(/empty content/);
  });
});

describe('isJsxDescriptor / isSnippetDescriptor', () => {
  test('JSX descriptors satisfy isJsxDescriptor only', () => {
    const d = minimal();
    expect(isJsxDescriptor(d)).toBe(true);
    expect(isSnippetDescriptor(d)).toBe(false);
  });

  test('snippet descriptors satisfy isSnippetDescriptor only', () => {
    const d = snippetMinimal();
    expect(isSnippetDescriptor(d)).toBe(true);
    expect(isJsxDescriptor(d)).toBe(false);
  });
});

describe('toJsxComponentDescriptor', () => {
  test('maps import.from to upstream source field', () => {
    const out = toJsxComponentDescriptor(minimal({ name: 'Steps', import: { from: '@astrojs/starlight/components' } }));
    expect(out.source).toBe('@astrojs/starlight/components');
    expect(out.defaultExport).toBe(false);
  });

  test('maps import.default: true to defaultExport: true', () => {
    const out = toJsxComponentDescriptor(
      minimal({ name: 'Hero', import: { from: '@/components/Hero', default: true } }),
    );
    expect(out.source).toBe('@/components/Hero');
    expect(out.defaultExport).toBe(true);
  });

  test('omits source when descriptor has no import', () => {
    const out = toJsxComponentDescriptor(minimal({ name: 'Steps' }));
    expect(out.source).toBeUndefined();
    expect(out.defaultExport).toBeUndefined();
  });

  test("translates props with type: 'boolean' to upstream 'expression'", () => {
    const out = toJsxComponentDescriptor(minimal({ name: 'CardGrid', props: [{ name: 'stagger', type: 'boolean' }] }));
    expect(out.props).toEqual([{ name: 'stagger', type: 'expression', required: undefined }]);
  });

  test("passes through 'string' and 'number' prop types", () => {
    const out = toJsxComponentDescriptor(
      minimal({
        name: 'Card',
        props: [
          { name: 'title', type: 'string', required: true },
          { name: 'columns', type: 'number' },
        ],
      }),
    );
    expect(out.props).toEqual([
      { name: 'title', type: 'string', required: true },
      { name: 'columns', type: 'number', required: undefined },
    ]);
  });

  test('falls back to GenericJsxEditor when no Editor is provided', () => {
    const out = toJsxComponentDescriptor(minimal({ name: 'Steps' }));
    expect(typeof out.Editor).toBe('function');
  });

  test('throws when called with a snippet descriptor', () => {
    expect(() => toJsxComponentDescriptor(snippetMinimal())).toThrow(/is a snippet, not a JSX component/);
  });
});
