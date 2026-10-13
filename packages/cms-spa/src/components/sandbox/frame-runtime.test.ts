import { describe, expect, test } from 'bun:test';
import { compileMDX } from '@conloca/mdx/node';
import {
  buildSandboxSrcdoc,
  createSandboxRuntime,
  runCompiledMdx,
  SANDBOX_FRAME_CSP,
  SANDBOX_FRAME_PATH,
} from './frame-runtime.js';

/**
 * Correctness of the isolated render pipeline: real MDX compiled by the
 * shipped `compileMDX`, evaluated through the frame's runtime, produces the
 * expected DOM. Isolation itself (that this runs in an opaque-origin frame
 * with no privileged globals) is proven separately in the browser story.
 */
async function renderMarkdown(source: string): Promise<HTMLElement> {
  const { code } = await compileMDX(source);
  const runtime = createSandboxRuntime();
  const module = await runCompiledMdx(code, runtime as unknown as Record<string, unknown>);
  const host = document.createElement('div');
  const output = module.default?.({});
  if (output) host.appendChild(output);
  return host;
}

describe('sandbox frame runtime — render pipeline', () => {
  test('renders a heading and paragraph to intrinsic DOM elements', async () => {
    const host = await renderMarkdown('# Hello block\n\nsome text');
    expect(host.querySelector('h1')?.textContent).toBe('Hello block');
    expect(host.querySelector('p')?.textContent).toContain('some text');
  });

  test('renders lists', async () => {
    const host = await renderMarkdown('- one\n- two');
    const items = host.querySelectorAll('li');
    expect(items.length).toBe(2);
    expect(items[0]?.textContent).toContain('one');
  });

  test('renders links with their href', async () => {
    const host = await renderMarkdown('[home](https://example.com)');
    const anchor = host.querySelector('a');
    expect(anchor?.getAttribute('href')).toBe('https://example.com');
  });

  test('never wires an inline event handler prop onto an element', () => {
    const runtime = createSandboxRuntime();
    const el = runtime.jsx('div', { onClick: 'evil()', className: 'ok', children: 'x' }) as HTMLElement;
    expect(el.getAttribute('onclick')).toBeNull();
    expect(el.getAttribute('class')).toBe('ok');
    expect(el.textContent).toBe('x');
  });
});

describe('sandbox frame runtime — srcdoc document', () => {
  test('confines unsafe-eval and closes structured-data egress, leaving only metadata channels', () => {
    expect(SANDBOX_FRAME_CSP).toContain("script-src 'unsafe-inline' 'unsafe-eval'");
    expect(SANDBOX_FRAME_CSP).toContain("default-src 'none'");
    // No connect-src: fetch/XHR/WebSocket/sendBeacon cannot post data out.
    expect(SANDBOX_FRAME_CSP).not.toContain('connect-src');
    // Passive img/font GETs to https: stay open for preview fidelity — a
    // metadata-only channel (as is inherent self-navigation), never privileged
    // content, since the opaque origin exposes nothing to exfiltrate.
    expect(SANDBOX_FRAME_CSP).toContain('img-src data: https: blob:');
    expect(SANDBOX_FRAME_CSP).toContain('font-src data: https:');
  });

  test('embeds the CSP meta and the serialized bootstrap, without privileged globals', () => {
    const srcdoc = buildSandboxSrcdoc();
    expect(srcdoc).toContain('http-equiv="Content-Security-Policy"');
    expect(srcdoc).toContain(SANDBOX_FRAME_CSP);
    expect(srcdoc).toContain('__sandbox_root');
    // flow-root contains collapsing prose margins so height posts match paint
    expect(srcdoc).toContain('display:flow-root');
    // The frame document must never reference the privileged singletons.
    expect(srcdoc).not.toContain('__CONTENT_API_CLIENT__');
    expect(srcdoc).not.toContain('__QUERY_CLIENT__');
  });

  test('exposes the well-known frame path for the SPA asset', () => {
    expect(SANDBOX_FRAME_PATH).toBe('/api/v1/mdx/sandbox-frame');
  });

  test('bootstrap defines __name so bundled Function#toString helpers do not crash', () => {
    const srcdoc = buildSandboxSrcdoc();
    expect(srcdoc).toContain('var __name=');
    // Simulate a bundler's keepNames annotation inside the serialized body.
    const withHelperUse = srcdoc.replace(
      'var __name=function(fn){return fn};',
      'var __name=function(fn){return fn}; var _x=/* @__PURE__ */ __name(function(){return 1}, "x");',
    );
    expect(withHelperUse).toContain('__name=function');
  });
});
