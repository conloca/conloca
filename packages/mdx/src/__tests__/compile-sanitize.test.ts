import { describe, expect, test } from 'bun:test';
import { compileMDX } from '../mdx/compile.js';

/**
 * MDX expressions are the arbitrary-JS-eval vector.
 * Standalone `{...}` blocks are rejected at compile so they can
 * never reach `new AsyncFunction` (now inside the sandbox); non-literal
 * JSX attribute expressions are dropped while JSON-literal props survive.
 */
describe('compileMDX — expression restriction', () => {
  test('compiles plain markdown unchanged', async () => {
    const { code } = await compileMDX('# Hello\n\nworld');
    expect(code).toContain('function');
    expect(code.length).toBeGreaterThan(0);
  });

  test('rejects a standalone flow expression', async () => {
    await expect(compileMDX('{fetch("/api/steal", { credentials: "include" })}')).rejects.toThrow(/expression/i);
  });

  test('rejects a text expression embedded in prose', async () => {
    await expect(compileMDX('Hello {globalThis.__CONTENT_API_CLIENT__}')).rejects.toThrow(/expression/i);
  });

  test('compiles an MDX comment, on its own line or inside a sentence, to nothing', async () => {
    const { code } = await compileMDX('# Title\n\n{/* flow comment */}\n\nBefore {/* text comment */}after');
    expect(code).toContain('Title');
    expect(code).not.toContain('flow comment');
    expect(code).not.toContain('text comment');
  });

  test('rejects an expression written beside a comment', async () => {
    await expect(compileMDX('{/* note */ globalThis.__CONTENT_API_CLIENT__}')).rejects.toThrow(/expression/i);
  });

  test('keeps a JSON-literal JSX attribute expression', async () => {
    const { code } = await compileMDX('<Box columns={3} />');
    expect(code).toContain('columns');
    expect(code).toContain('3');
  });

  test('drops a non-literal JSX attribute expression but still compiles', async () => {
    const { code } = await compileMDX('<Box onClick={fetch("/api")} />');
    expect(code).not.toContain('fetch("/api")');
    expect(code).not.toContain('onClick');
  });

  test('drops a JSX spread-attribute expression', async () => {
    const { code } = await compileMDX('<Box {...stealAll} />');
    expect(code).not.toContain('stealAll');
  });

  test('rejects a top-level ESM export statement (mdxjsEsm)', async () => {
    // `export const x = (…)()` smuggles a live IIFE past the `{…}` walk unless
    // mdxjsEsm nodes are rejected too. It must never reach the compiled body.
    await expect(compileMDX('export const x = (globalThis.__PWNED__ = true)\n\n# hi')).rejects.toThrow(
      /import\/export statements are not allowed/i,
    );
  });

  test('rejects a top-level ESM import statement (mdxjsEsm)', async () => {
    await expect(compileMDX("import x from 'data:text/javascript,globalThis.__P__=1'\n\n# hi")).rejects.toThrow(
      /import\/export statements are not allowed/i,
    );
  });

  test('still compiles frontmatter content (the legit export mdxjsEsm survives)', async () => {
    // `remarkMdxFrontmatter` injects its own `export const frontmatter` node.
    // The restriction runs BEFORE it, so this legitimate export is untouched
    // while an author-written export is still rejected.
    const { code, metadata } = await compileMDX(
      '---\ntitle: Welcome Hero\ncategory: headers\n---\n\n# Build Better Websites\n\nSome **bold** copy.',
    );
    expect(code).toContain('function');
    expect(metadata.title).toBe('Welcome Hero');
  });
});

/**
 * HTML-injection class at the compile choke point. A JSON-literal
 * `dangerouslySetInnerHTML` object passes the `{…}`-literal exemption, so the
 * gate must drop it (and raw script/style elements and dangerous URL schemes)
 * BEFORE the code is generated — the sink must never appear in the compiled body.
 */
describe('compileMDX — HTML-injection neutralization', () => {
  test('drops dangerouslySetInnerHTML so the sink never reaches the compiled code', async () => {
    const { code } = await compileMDX('<div dangerouslySetInnerHTML={{"__html": "<script>alert(1)</script>"}} />');
    expect(code).not.toContain('dangerouslySetInnerHTML');
    expect(code).not.toContain('alert(1)');
  });

  test('drops a raw <script> element', async () => {
    const { code } = await compileMDX('<script>alert(1)</script>\n\n# Heading');
    expect(code).not.toContain('alert(1)');
    expect(code).toContain('Heading');
  });

  test('empties a data:text/html href', async () => {
    const { code } = await compileMDX('<a href="data:text/html,payload">x</a>');
    expect(code.toLowerCase()).not.toContain('data:text/html');
  });

  test('keeps a benign https link and safe attributes', async () => {
    const { code } = await compileMDX('<a href="https://example.com" title="ok">x</a>');
    expect(code).toContain('https://example.com');
    expect(code).toContain('ok');
  });
});
