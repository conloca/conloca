import { describe, expect, test } from 'bun:test';
import { findUnknownFragmentComponents } from '../render.js';

const declared = new Set(['Callout']);

describe('findUnknownFragmentComponents', () => {
  test('a declared component is not reported', () => {
    expect(findUnknownFragmentComponents('<Callout>Hi</Callout>\n', declared)).toEqual([]);
  });

  test('reports an undeclared component with its line', () => {
    expect(findUnknownFragmentComponents('# Title\n\n<Nope />\n', declared)).toEqual([{ name: 'Nope', line: 3 }]);
  });

  test('reports a component nested in a declared one', () => {
    expect(findUnknownFragmentComponents('<Callout><Nope/></Callout>\n', declared)).toEqual([
      { name: 'Nope', line: 1 },
    ]);
  });

  test('reports names the renderer rejects: underscore, dotted', () => {
    expect(findUnknownFragmentComponents('<_Foo/>\n\n<a.b/>\n', declared).map((u) => u.name)).toEqual(['_Foo', 'a.b']);
  });

  test('never reports a lowercase HTML element', () => {
    expect(findUnknownFragmentComponents('<div>text</div>\n', declared)).toEqual([]);
  });

  test('a parse failure throws', () => {
    expect(() => findUnknownFragmentComponents('<Callout>\n', declared)).toThrow();
  });
});
