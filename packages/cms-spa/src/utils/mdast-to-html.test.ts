import { describe, expect, test } from 'bun:test';
import { mdastToHtml } from './mdast-to-html.js';

/**
 * Deterministic, DOM-free neutralization at the serialization boundary.
 * These are the vectors the serializer itself controls (attribute names,
 * URL schemes) — closed here so they never reach an innerHTML sink even
 * before the DOMPurify browser belt runs. Opaque raw-`html` node strings
 * are the DOMPurify belt's job (proven in the browser story), not this
 * layer's.
 */
describe('mdastToHtml — serialization-level sanitization', () => {
  test('drops on* event-handler attributes on lowercase JSX elements', () => {
    const node = {
      type: 'mdxJsxFlowElement',
      name: 'img',
      attributes: [
        { type: 'mdxJsxAttribute', name: 'src', value: 'x' },
        { type: 'mdxJsxAttribute', name: 'onerror', value: 'steal()' },
        { type: 'mdxJsxAttribute', name: 'onclick', value: 'evil()' },
      ],
      children: [],
    };
    const out = mdastToHtml(node);
    expect(out).toContain('src="x"');
    expect(out.toLowerCase()).not.toContain('onerror');
    expect(out.toLowerCase()).not.toContain('onclick');
    expect(out).not.toContain('steal()');
  });

  test('blocks a javascript: scheme in a link href', () => {
    const node = { type: 'link', url: 'javascript:fetch("/api")', children: [{ type: 'text', value: 'go' }] };
    const out = mdastToHtml(node);
    expect(out.toLowerCase()).not.toContain('javascript:');
    expect(out).toContain('go');
  });

  test('blocks a javascript: scheme in an element URL attribute', () => {
    const node = {
      type: 'mdxJsxFlowElement',
      name: 'a',
      attributes: [{ type: 'mdxJsxAttribute', name: 'href', value: 'javascript:evil()' }],
      children: [{ type: 'text', value: 'x' }],
    };
    const out = mdastToHtml(node);
    expect(out.toLowerCase()).not.toContain('javascript:');
  });

  test('keeps a normal https link untouched', () => {
    const node = { type: 'link', url: 'https://example.com', children: [{ type: 'text', value: 'home' }] };
    const out = mdastToHtml(node);
    expect(out).toContain('href="https://example.com"');
    expect(out).toContain('home');
  });

  test('keeps legitimate structural attributes (class, id)', () => {
    const node = {
      type: 'mdxJsxFlowElement',
      name: 'div',
      attributes: [
        { type: 'mdxJsxAttribute', name: 'class', value: 'lead' },
        { type: 'mdxJsxAttribute', name: 'id', value: 'x' },
      ],
      children: [{ type: 'text', value: 'body' }],
    };
    const out = mdastToHtml(node);
    expect(out).toContain('class="lead"');
    expect(out).toContain('id="x"');
    expect(out).toContain('body');
  });
});
