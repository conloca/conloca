import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { evaluateMDXToComponent } from '../mdx/evaluate.js';

/**
 * The published render path must run where creating code from strings is
 * forbidden (on Cloudflare Workers `eval`/`new Function` throw `EvalError`), so
 * `evaluateMDXToComponent` must produce a component WITHOUT executing compiled
 * MDX — `remarkRestrictExpressions` restricts content to prose plus
 * literal-attribute JSX, which needs no code execution to render. These tests
 * pin the semantics of that static pipeline against the same React SSR the
 * page handler uses.
 */

async function renderMdx(mdx: string): Promise<string> {
  const { Component, error } = await evaluateMDXToComponent(mdx);
  if (error || !Component) return '';
  return renderToStaticMarkup(createElement(Component));
}

describe('evaluateMDXToComponent — static (eval-free) rendering', () => {
  test('renders a GFM table', async () => {
    const html = await renderMdx('| a | b |\n| - | - |\n| 1 | 2 |');
    expect(html).toContain('<table>');
    expect(html).toContain('<td>1</td>');
  });

  test('renders GFM strikethrough and task lists', async () => {
    const html = await renderMdx('~~gone~~\n\n- [x] done\n- [ ] open');
    expect(html).toContain('<del>gone</del>');
    expect(html).toContain('type="checkbox"');
  });

  test('frontmatter is stripped, never rendered', async () => {
    const html = await renderMdx('---\ntitle: Secret Title\n---\n\n# Visible');
    expect(html).toContain('Visible');
    expect(html).not.toContain('Secret Title');
  });

  test('a JSON-literal numeric attribute renders as its static value', async () => {
    const html = await renderMdx('<img src="/a.png" width={300} />');
    expect(html).toContain('width="300"');
  });

  test('a JSON-literal true attribute renders as a boolean attribute', async () => {
    const html = await renderMdx('<input type="checkbox" disabled={true} />');
    expect(html).toContain('disabled=""');
  });

  test('a JSON-literal false attribute is omitted', async () => {
    const html = await renderMdx('<input type="checkbox" disabled={false} />');
    expect(html).toContain('type="checkbox"');
    expect(html).not.toContain('disabled');
  });

  test('markdown nested inside a raw HTML element renders', async () => {
    const html = await renderMdx('<div class="callout">\n\nSome **bold** prose\n\n</div>');
    expect(html).toContain('class="callout"');
    expect(html).toContain('<strong>bold</strong>');
  });

  test('an unregistered capitalized component fails at evaluate time, not render time', async () => {
    // Before the static pipeline this only exploded when React rendered the
    // component; now the conversion happens eagerly, so the caller gets the
    // error result and can show its fragment-error UI instead of a 500.
    const { Component, error } = await evaluateMDXToComponent('# hi\n\n<UnregisteredThing />');
    expect(Component).toBeNull();
    expect(error?.message).toMatch(/UnregisteredThing/);
  });
});
