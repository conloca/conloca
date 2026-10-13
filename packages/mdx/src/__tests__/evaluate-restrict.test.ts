import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { evaluateMDXToComponent } from '../mdx/evaluate.js';

/**
 * The expression restriction reaches the PUBLISHED render path.
 * `evaluateMDXToComponent` renders CMS content fragments at Astro build/SSR, so
 * it applies the same `remarkRestrictExpressions` gate as the editor's
 * `compileMDX`: standalone `{…}` expressions and top-level ESM
 * `import`/`export` statements are rejected up front (the static pipeline never
 * executes them, but a clear author-facing rejection beats silently dropping
 * content). Legitimate prose still evaluates unchanged.
 */

/** Evaluate MDX to a component and render it to static markup, exactly as the
 * published Astro build/SSR does. Returns '' when the fragment was rejected (the
 * error stub the page handler renders in that case is not part of this string). */
async function renderMdx(mdx: string): Promise<string> {
  const { Component, error } = await evaluateMDXToComponent(mdx);
  if (error || !Component) return '';
  return renderToStaticMarkup(createElement(Component));
}

describe('evaluateMDXToComponent — expression + ESM restriction', () => {
  test('evaluates plain markdown to a component', async () => {
    const { Component, error } = await evaluateMDXToComponent('# Build\n\nSome **bold** text.\n\n- a\n- b');
    expect(error).toBeUndefined();
    expect(Component).not.toBeNull();
  });

  test('evaluates frontmatter content (frontmatter is parsed, not rejected)', async () => {
    // The frontmatter block parses as yaml (not authored ESM), so the
    // restriction lets a real fragment (frontmatter + prose) evaluate.
    const { Component, error } = await evaluateMDXToComponent(
      '---\ntitle: Welcome Hero\ncategory: headers\n---\n\n# Build Better Websites\n\nSome **bold** copy.',
    );
    expect(error).toBeUndefined();
    expect(Component).not.toBeNull();
  });

  test('rejects a standalone flow expression (would run JS at build/SSR)', async () => {
    const { Component, error } = await evaluateMDXToComponent(
      "{(() => { globalThis.__pwned = true; return 'x'; })()}\n\n# hi",
    );
    expect(Component).toBeNull();
    expect(error?.message).toMatch(/expression/i);
    expect((globalThis as Record<string, unknown>).__pwned).toBeUndefined();
  });

  test('rejects a text expression embedded in prose', async () => {
    const { Component, error } = await evaluateMDXToComponent('Hello {globalThis.__CONTENT_API_CLIENT__}');
    expect(Component).toBeNull();
    expect(error?.message).toMatch(/expression/i);
  });

  test('rejects a top-level ESM export statement', async () => {
    const { Component, error } = await evaluateMDXToComponent(
      'export const x = (globalThis.__pwned_esm = true)\n\n# hi',
    );
    expect(Component).toBeNull();
    expect(error?.message).toMatch(/import\/export statements are not allowed/i);
    expect((globalThis as Record<string, unknown>).__pwned_esm).toBeUndefined();
  });

  test('rejects a top-level ESM import statement', async () => {
    const { Component, error } = await evaluateMDXToComponent(
      "import x from 'data:text/javascript,globalThis.__p=1'\n\n# hi",
    );
    expect(Component).toBeNull();
    expect(error?.message).toMatch(/import\/export statements are not allowed/i);
  });
});

/**
 * HTML-injection class on the published path. Expression-restriction is NOT HTML
 * sanitization: a JSON-literal `dangerouslySetInnerHTML` object, raw `<script>`,
 * and `data:text/html` URLs all round-trip past a `{…}`-only gate and reach the
 * visitor's page unsandboxed. These are REAL render assertions (evaluate + React
 * SSR), the exact pipeline `fragments.ts` → `page-handler.astro` runs.
 */
describe('evaluateMDXToComponent — HTML-injection neutralization (rendered output)', () => {
  test('dangerouslySetInnerHTML never injects a script into the rendered output', async () => {
    const html = await renderMdx('<div dangerouslySetInnerHTML={{"__html": "<script>alert(1)</script>"}} />');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('alert(1)');
  });

  test('a raw <script> element is dropped, not rendered verbatim', async () => {
    const html = await renderMdx('<script>alert(1)</script>\n\n# Heading');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('alert(1)');
    expect(html).toContain('Heading'); // the rest of the fragment still renders
  });

  test('a raw <style> element (CSS beacon) is dropped', async () => {
    const html = await renderMdx('<style>{`body{background:url(https://attacker/beacon)}`}</style>\n\n# ok');
    expect(html).not.toContain('<style>');
    expect(html.toLowerCase()).not.toContain('attacker');
  });

  test('a data:text/html href is neutralized', async () => {
    const html = await renderMdx('<a href="data:text/html,<script>alert(1)</script>">x</a>');
    expect(html.toLowerCase()).not.toContain('data:text/html');
    expect(html).not.toContain('alert(1)');
  });

  test('a markdown link with a data:text/html URL is neutralized', async () => {
    const html = await renderMdx('[click](data:text/html,<script>alert(1)</script>)');
    expect(html.toLowerCase()).not.toContain('data:text/html');
  });

  test('inline event handlers are dropped', async () => {
    const html = await renderMdx('<img src="/logo.png" onerror="alert(1)" />');
    expect(html.toLowerCase()).not.toContain('onerror');
    expect(html).not.toContain('alert(1)');
  });

  test('legitimate content renders unchanged (prose, benign links, images, code)', async () => {
    const html = await renderMdx(
      '---\ntitle: T\n---\n\n# Title\n\nSome **bold** and `code` with a [link](https://example.com) and ![alt](https://example.com/a.png).',
    );
    // Headings carry the anchor id the outline pass assigns; the text and
    // element are otherwise untouched, which is what this case is about.
    expect(html).toContain('<h1 id="title">Title</h1>');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<code>code</code>');
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('src="https://example.com/a.png"');
  });

  test('a benign raw HTML block with safe attributes renders', async () => {
    const html = await renderMdx('<div class="callout"><a href="https://example.com" title="ok">link</a></div>');
    expect(html).toContain('class="callout"');
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('title="ok"');
  });
});
