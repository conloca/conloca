import { afterEach, describe, expect, mock, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { compileMDX } from '../mdx/compile.js';
import { evaluateMDXToComponent } from '../mdx/evaluate.js';
import {
  createSandboxRuntime,
  MDX_SANDBOX_FRAME_POLICY,
  runCompiledMdx,
  SANDBOX_FRAME_CSP,
  sandboxFrameMain,
} from '../sandbox-frame.js';

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

  test('an image the host sent bytes for shows them; every other image keeps its src', async () => {
    // The host page's blob URLs are unreadable from the frame's opaque origin, so draft images arrive as data URLs.
    const images = { '/assets/hero.png': 'data:image/png;base64,iVBORw0KGgo=' };
    const host = await renderPreview(
      '![Hero](/assets/hero.png) ![Other](/assets/other.png) ![Inherited](constructor)',
      createSandboxRuntime(images),
    );
    expect([...host.querySelectorAll('img')].map((img) => img.getAttribute('src'))).toEqual([
      'data:image/png;base64,iVBORw0KGgo=',
      '/assets/other.png',
      'constructor',
    ]);
    const plain = await renderPreview('![Hero](/assets/hero.png)');
    expect(plain.querySelector('img')?.getAttribute('src')).toBe('/assets/hero.png');
  });
});

/** Puts the test window at `origin`, inside a frame whose parent records what it is posted when `framed`. */
function frameAs(origin: string, framed: boolean) {
  document.body.innerHTML = '<div id="__sandbox_root"></div>';
  const spy = mock((_message: { kind: string }) => {});
  Object.defineProperty(self, 'origin', { value: origin, configurable: true });
  if (framed) Object.defineProperty(window, 'parent', { value: { postMessage: spy }, configurable: true });
  return spy;
}

describe('the preview frame refuses to run unless it is sandboxed', () => {
  const renderMessage = { __conlocaSandbox: true, kind: 'render', mode: 'html', payload: '<b>x</b>' };

  // The test DOM registers `origin` and `parent` as own globals, so deleting an
  // override would delete the global itself; put the originals back instead.
  const originals = {
    origin: Object.getOwnPropertyDescriptor(self, 'origin'),
    parent: Object.getOwnPropertyDescriptor(window, 'parent'),
  };
  afterEach(() => {
    for (const [name, descriptor] of Object.entries(originals)) {
      if (descriptor) Object.defineProperty(window, name, descriptor);
      else Reflect.deleteProperty(window, name);
    }
  });

  // The refusing cases run first: a frame that does start keeps its window
  // listeners, which would answer the messages later tests dispatch.
  test('does nothing on a real origin, even when framed', () => {
    const spy = frameAs('https://site.example', true);
    sandboxFrameMain({ createSandboxRuntime, runCompiledMdx });
    window.dispatchEvent(new MessageEvent('message', { data: renderMessage }));
    expect(spy).not.toHaveBeenCalled();
    expect(document.getElementById('__sandbox_root')?.innerHTML).toBe('');
  });

  test('does nothing when opened top level with an opaque origin', () => {
    frameAs('null', false);
    sandboxFrameMain({ createSandboxRuntime, runCompiledMdx });
    window.dispatchEvent(new MessageEvent('message', { data: renderMessage }));
    expect(document.getElementById('__sandbox_root')?.innerHTML).toBe('');
  });

  test('posts ready and renders inside a frame with an opaque origin', () => {
    const spy = frameAs('null', true);
    sandboxFrameMain({ createSandboxRuntime, runCompiledMdx });
    expect(spy.mock.calls.some(([message]) => message.kind === 'ready')).toBe(true);
    window.dispatchEvent(new MessageEvent('message', { data: renderMessage }));
    expect(document.getElementById('__sandbox_root')?.innerHTML).toBe('<b>x</b>');
  });

  test('a render message carries the image data URLs into the runtime', async () => {
    const spy = frameAs('null', true);
    const rendered = Promise.withResolvers<void>();
    // A frame started by an earlier test still listens, rendering into its own detached root.
    spy.mockImplementation((message) => {
      if (message.kind === 'rendered' && document.querySelector('#__sandbox_root img')) rendered.resolve();
    });
    sandboxFrameMain({ createSandboxRuntime, runCompiledMdx });
    const { code } = await compileMDX('![Hero](/assets/hero.png)');
    const images = { '/assets/hero.png': 'data:image/png;base64,iVBORw0KGgo=' };
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { __conlocaSandbox: true, kind: 'render', mode: 'mdx', payload: code, images },
      }),
    );
    await rendered.promise;
    expect(document.querySelector('#__sandbox_root img')?.getAttribute('src')).toBe(images['/assets/hero.png']);
  });

  test('the response policy adds the sandbox directive', () => {
    expect(MDX_SANDBOX_FRAME_POLICY).toBe(`${SANDBOX_FRAME_CSP}; sandbox allow-scripts; frame-ancestors 'self'`);
  });
});
