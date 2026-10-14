import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { compileMDX } from '../mdx/compile.js';
import { evaluateMDXToComponent } from '../mdx/evaluate.js';
import { createSandboxRuntime, runCompiledMdx } from '../sandbox-frame.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const HTML_NS = 'http://www.w3.org/1999/xhtml';

/**
 * The preview frame builds DOM with its own small runtime instead of React,
 * so the published page and the preview agree only where that runtime makes
 * the choices React makes. These tests render compiled MDX through it and
 * check the DOM a browser would draw.
 */
async function renderPreview(source: string, runtime = createSandboxRuntime()): Promise<HTMLElement> {
  const { code } = await compileMDX(source);
  const module = await runCompiledMdx(code, runtime as unknown as Record<string, unknown>);
  const host = document.createElement('div');
  const output = module.default?.({});
  if (output) host.appendChild(output);
  return host;
}

/** The same source as the published page renders it. */
async function renderPublished(source: string): Promise<HTMLElement> {
  const { Component } = await evaluateMDXToComponent(source);
  const host = document.createElement('div');
  if (Component) host.innerHTML = renderToStaticMarkup(createElement(Component));
  return host;
}

describe('preview frame runtime — what React would draw', () => {
  test('an inline SVG and everything in it are SVG elements, so the icon draws', async () => {
    const host = await renderPreview(
      'Status: <svg width="12" height="12" viewBox="0 0 12 12"><g><linearGradient id="g" /><circle cx="6" cy="6" r="5" fill="green" /></g></svg> ok',
    );
    const svg = host.querySelector('svg');
    expect(svg?.namespaceURI).toBe(SVG_NS);
    expect(svg?.getAttribute('viewBox')).toBe('0 0 12 12');
    for (const element of svg?.querySelectorAll('*') ?? []) expect(element.namespaceURI).toBe(SVG_NS);
    expect(svg?.querySelector('linearGradient')?.localName).toBe('linearGradient');
    expect(svg?.querySelector('circle')?.getAttribute('fill')).toBe('green');
  });

  test('what a foreignObject holds stays HTML', async () => {
    const host = await renderPreview('<svg><foreignObject width="10" height="10"><p>Hi</p></foreignObject></svg>');
    const foreign = host.querySelector('svg')?.firstElementChild;
    expect(foreign?.namespaceURI).toBe(SVG_NS);
    expect(foreign?.localName).toBe('foreignObject');
    expect(foreign?.firstElementChild?.namespaceURI).toBe(HTML_NS);
    expect(foreign?.firstElementChild?.localName).toBe('p');
  });

  test('an aligned table column keeps its alignment, as on the published page', async () => {
    // The compiler writes a column's alignment as a style object on each cell,
    // the same shape an author's style={{…}} takes, so the frame cannot drop
    // style objects without losing it.
    const source = '| a | b |\n| :- | -: |\n| 1 | 2 |';
    const alignments = (host: HTMLElement) =>
      [...host.querySelectorAll('th, td')].map((cell) => (cell as HTMLElement).style.textAlign);
    const preview = alignments(await renderPreview(source));
    expect(preview).toEqual(['left', 'right', 'left', 'right']);
    expect(preview).toEqual(alignments(await renderPublished(source)));
  });

  test('an attribute written as an object, a list or null shows nowhere, as on the published page', async () => {
    const source =
      '<div style={{"background":"tomato","width":120}} data-items={[1, 2]} title={null} lang={"en"}>Hi</div>';
    const preview = await renderPreview(source);
    const div = preview.querySelector('div');
    expect(div?.hasAttribute('style')).toBe(false);
    expect(div?.hasAttribute('data-items')).toBe(false);
    expect(div?.hasAttribute('title')).toBe(false);
    expect(div?.getAttribute('lang')).toBe('en');
    expect(preview.innerHTML).toBe((await renderPublished(source)).innerHTML);
  });

  test('htmlFor becomes the for attribute, as on the published page', async () => {
    const source = '<label htmlFor="email">Email</label>';
    const preview = await renderPreview(source);
    expect(preview.querySelector('label')?.getAttribute('for')).toBe('email');
    expect(preview.innerHTML).toBe((await renderPublished(source)).innerHTML);
  });

  test('the runtime still works once serialized into the frame document', async () => {
    // The frame receives the runtime as source text, so it must not reach
    // anything outside its own body.
    const serialized = new Function(`return (${createSandboxRuntime.toString()})`)() as typeof createSandboxRuntime;
    const host = await renderPreview('<svg><circle r="5" /></svg>', serialized());
    expect(host.querySelector('circle')?.namespaceURI).toBe(SVG_NS);
  });
});
