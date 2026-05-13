import { describe, expect, test } from 'bun:test';
import { defineMdxComponents, type MdxComponentDescriptor, toJsxComponentDescriptor } from '../src/mdx-components';

const minimal = (over: Partial<MdxComponentDescriptor> = {}): MdxComponentDescriptor => ({
  name: 'Steps',
  kind: 'flow',
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
});
