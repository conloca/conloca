import { expect, test } from 'bun:test';
import type { Root, RootContent } from 'mdast';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { defineFragmentComponents } from '../mdx/vocabulary.js';
import { evaluateMDXToComponent, fragmentComponentProps, parseFragmentMdx } from '../render.js';
import { hostileCases, hostileComponents, hostileElements } from './fixtures/hostile-cases.js';

type Node = RootContent | Root;
type JsxElement = Extract<RootContent, { type: 'mdxJsxFlowElement' | 'mdxJsxTextElement' }>;

/** Every JSX element whose name is a vocabulary component, in document order. */
function componentNodes(node: Node, names: ReadonlySet<string>): JsxElement[] {
  const own =
    (node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement') && names.has(node.name ?? '')
      ? [node]
      : [];
  const children: readonly Node[] = 'children' in node ? node.children : [];
  return [...own, ...children.flatMap((child) => componentNodes(child, names))];
}

/** The props the published render passes to each vocabulary component in `mdx`, without `children`. */
async function publishedProps(mdx: string): Promise<object[]> {
  const captured: object[] = [];
  const recording = Object.fromEntries(
    Object.keys(hostileComponents).map((name) => [
      name,
      ({ children: _children, ...props }: { children?: unknown }) => {
        captured.push(props);
        return null;
      },
    ]),
  );
  const vocabulary = defineFragmentComponents({ components: recording, elements: hostileElements });
  const { Component, error } = await evaluateMDXToComponent(mdx, vocabulary);
  expect(error).toBeUndefined();
  if (!Component) throw new Error(`no Component for ${mdx}`);
  renderToStaticMarkup(createElement(Component));
  return captured;
}

test('equals the props publish passes, for every hostile vocabulary case that renders', async () => {
  const names = new Set(Object.keys(hostileComponents));
  const rendered = Object.values(hostileCases).filter(({ renders }) => renders);
  const published = await Promise.all(rendered.map(({ mdx }) => publishedProps(mdx)));
  for (const [index, { mdx }] of rendered.entries()) {
    const expected = componentNodes(parseFragmentMdx(mdx), names).map((node) =>
      fragmentComponentProps(node.attributes),
    );
    expect(published[index]).toStrictEqual(expected);
  }
  expect(published.flat().length).toBeGreaterThan(5);
});

test('drops on*, style and dangerouslySetInnerHTML, and empties dangerous schemes at any depth', () => {
  const [node] = componentNodes(
    parseFragmentMdx(
      '<C onClick="x" STYLE="color:red" href="javascript:alert(1)" data={{"a":[{"u":"data:text/html,x"}],"dangerouslySetInnerHTML":{"__html":"x"}}} ok="1" flag />',
    ),
    new Set(['C']),
  );
  expect(fragmentComponentProps(node.attributes)).toEqual({ href: '', data: { a: [{ u: '' }] }, ok: '1', flag: true });
});

test('drops a top-level __proto__ attribute and keeps a nested __proto__ key as own data', () => {
  const [node] = componentNodes(
    parseFragmentMdx('<C __proto__={{"x":1}} data={{"__proto__":{"x":1}}} />'),
    new Set(['C']),
  );
  const result = fragmentComponentProps(node.attributes);
  expect(Object.keys(result)).toEqual(['data']);
  expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
  expect(Object.getOwnPropertyNames(result.data)).toEqual(['__proto__']);
  expect(Reflect.get({}, 'x')).toBeUndefined();
});
