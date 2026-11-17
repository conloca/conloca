import { describe, expect, test } from 'bun:test';
import { createElement, type HTMLAttributes, type ReactNode, type TdHTMLAttributes } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { evaluateMDXToComponent } from '../mdx/evaluate.js';
import { defineFragmentComponents, type FragmentVocabulary } from '../mdx/vocabulary.js';

/**
 * The published render path must run where creating code from strings is
 * forbidden (on Cloudflare Workers `eval`/`new Function` throw `EvalError`), so
 * `evaluateMDXToComponent` must produce a component WITHOUT executing compiled
 * MDX — `remarkRestrictExpressions` restricts content to prose plus
 * literal-attribute JSX, which needs no code execution to render. These tests
 * pin the semantics of that static pipeline against the same React SSR the
 * page handler uses.
 */

async function renderMdx(mdx: string, vocabulary?: FragmentVocabulary): Promise<string> {
  const { Component, error } = await evaluateMDXToComponent(mdx, vocabulary);
  if (error || !Component) return '';
  return renderToStaticMarkup(createElement(Component));
}

const UNKNOWN = (name: string) =>
  `Unknown component <${name}>: the site does not declare it in its fragment components.`;

describe('evaluateMDXToComponent — fragment vocabulary', () => {
  test('registered component renders with children', async () => {
    const vocabulary = defineFragmentComponents({
      components: {
        Callout: ({ tone, children }: { tone?: string; children?: ReactNode }) =>
          createElement('aside', { 'data-tone': tone }, children),
      },
    });
    const html = await renderMdx('<Callout tone="info">\n\nSome **bold**\n\n</Callout>', vocabulary);
    expect(html).toContain('<aside data-tone="info">');
    expect(html).toContain('<strong>bold</strong>');
  });

  test('element override replaces h2 and keeps its id', async () => {
    const vocabulary = defineFragmentComponents({
      elements: {
        h2: ({ id, children }: { id?: string; children?: ReactNode }) =>
          createElement('h2', { id, className: 't' }, children),
      },
    });
    const html = await renderMdx('## Why', vocabulary);
    expect(html).toContain('class="t"');
    expect(html).toContain('id="why"');
    const { outline } = await evaluateMDXToComponent('## Why', vocabulary);
    expect(outline.map((h) => h.id)).toContain('why');
  });

  test('td override still gets column alignment', async () => {
    const vocabulary = defineFragmentComponents({
      elements: { td: (p: TdHTMLAttributes<HTMLTableCellElement>) => createElement('td', p) },
    });
    const html = await renderMdx('| a |\n|:-:|\n| 1 |', vocabulary);
    expect(html).toContain('text-align:center');
  });

  test.each(['Nope', '_Foo'])('unregistered component <%s> errors', async (name) => {
    const { Component, error } = await evaluateMDXToComponent(`<${name} />`);
    expect(Component).toBeNull();
    expect(error?.message).toBe(UNKNOWN(name));
  });

  test.each(['Foo-bar', 'Foo:bar'])('non-identifier component name <%s> errors', async (name) => {
    const { Component, error } = await evaluateMDXToComponent(`<${name} />`);
    expect(Component).toBeNull();
    expect(error?.message).toBe(UNKNOWN(name));
  });

  test('dotted name errors', async () => {
    const { Component, error } = await evaluateMDXToComponent('<a.b />');
    expect(Component).toBeNull();
    expect(error?.message).toBe(UNKNOWN('a.b'));
  });

  test.each([
    [
      '| a | b |\n| - | - |\n| 1 | 2 |',
      '<table><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>',
    ],
    [
      '~~gone~~\n\n- [x] done\n- [ ] open',
      '<p><del>gone</del></p>\n<ul class="contains-task-list">\n<li class="task-list-item"><input type="checkbox" disabled="" checked=""/> done</li>\n<li class="task-list-item"><input type="checkbox" disabled=""/> open</li>\n</ul>',
    ],
    ['---\ntitle: Secret Title\n---\n\n# Visible', '<h1 id="visible">Visible</h1>'],
    [
      '<div class="callout">\n\nSome **bold** prose\n\n</div>',
      '<div class="callout"><p>Some <strong>bold</strong> prose</p></div>',
    ],
  ])("no vocabulary keeps today's output: %p", async (mdx, expected) => {
    expect(await renderMdx(mdx)).toBe(expected);
  });
});

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

  test('a JSON-literal true or false on an aria- or data- attribute renders as its word, as React renders it', async () => {
    const html = await renderMdx(
      '<span aria-hidden={false} data-open={false} aria-expanded={true} data-ready={true}>x</span>',
    );
    expect(html).toBe('<span aria-hidden="false" data-open="false" aria-expanded="true" data-ready="true">x</span>');
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
    expect(error?.message).toBe(UNKNOWN('UnregisteredThing'));
  });
});

/**
 * Markdown reads an HTML tag written on one line, `<div>x</div>`, as the start of a paragraph. Left
 * like that it renders `<p><div>x</div></p>`, which a browser splits into an empty paragraph and a
 * loose `<div>`, moving the page around. The `@mdx-js/mdx` compiler this path replaced lifts such
 * tags out of the paragraph when nothing but whitespace sits beside them; the expected output is
 * what that compiler rendered.
 */
describe('evaluateMDXToComponent — a paragraph that holds only HTML tags', () => {
  test.each([
    ['<div>x</div>', '<div>x</div>'],
    ['<section>Note text</section>', '<section>Note text</section>'],
    ['<details><summary>More</summary>Hidden text</details>', '<details><summary>More</summary>Hidden text</details>'],
    ['<table><tr><td>a</td></tr></table>', '<table><tr><td>a</td></tr></table>'],
    ['<p>already a p</p>', '<p>already a p</p>'],
    ['Para one\n\n<div>x</div>\n\nPara two', '<p>Para one</p>\n<div>x</div>\n<p>Para two</p>'],
    ['<span>a</span> <span>b</span>', '<span>a</span>\n<span>b</span>'],
    ['<div>a</div>\n<div>b</div>', '<div>a</div>\n<div>b</div>'],
    ['- <div>in a list</div>', '<ul>\n<li>\n<div>in a list</div>\n</li>\n</ul>'],
    ['> <div>quoted</div>', '<blockquote>\n<div>quoted</div>\n</blockquote>'],
  ])('%p renders without a wrapping paragraph', async (mdx, html) => {
    expect(await renderMdx(mdx)).toBe(html);
  });

  test.each([
    ['<span>inline</span> text', '<p><span>inline</span> text</p>'],
    ['Text with <strong>bold</strong> tag', '<p>Text with <strong>bold</strong> tag</p>'],
  ])('%p keeps its paragraph, since it has text beside the tags', async (mdx, html) => {
    expect(await renderMdx(mdx)).toBe(html);
  });
});

describe('evaluateMDXToComponent — JSON props and raw-HTML style', () => {
  test('array and object props reach a component', async () => {
    const vocabulary = defineFragmentComponents({
      components: {
        Table: ({ rows, cta }: { rows: unknown[]; cta: { href: string } }) =>
          createElement('div', null, `${rows.length} ${cta.href}`),
      },
    });
    const html = await renderMdx(
      '<Table rows={[{"term":"a","text":"b"}]} cta={{"label":"Go","href":"/x"}} />',
      vocabulary,
    );
    expect(html).toContain('1');
    expect(html).toContain('/x');
  });

  test('__proto__ stays data', async () => {
    const vocabulary = defineFragmentComponents({
      components: {
        Probe: ({ data }: { data: object }) =>
          createElement(
            'p',
            null,
            `${String(Reflect.get({}, 'polluted'))} ${String(Object.getPrototypeOf(data) === Object.prototype)}`,
          ),
      },
    });
    const html = await renderMdx('<Probe data={{"__proto__":{"polluted":true}}} />', vocabulary);
    expect(html).toContain('undefined true');
  });

  test('objects never reach intrinsic elements', async () => {
    expect(await renderMdx('<div data-x={{"a":1}}>t</div>')).not.toContain('data-x');
  });

  test('style dropped on raw HTML', async () => {
    expect(await renderMdx('<div style="position:fixed">t</div>')).toBe('<div>t</div>');
    expect(await renderMdx('<p style={{"color":"red"}}>t</p>')).not.toContain('style=');
  });
});

test('style dropped on raw HTML whatever its case', async () => {
  expect(await renderMdx('<div STYLE="position:fixed">t</div>')).toBe('<div>t</div>');
  expect(await renderMdx('<div Style={"position:fixed"}>t</div>')).toBe('<div>t</div>');
});

test('style dropped on a component that spreads its props, whatever its case', async () => {
  const vocabulary = defineFragmentComponents({
    components: { Spread: (props: HTMLAttributes<HTMLDivElement>) => createElement('div', props) },
  });
  const rendered = await Promise.all(
    [
      '<Spread style={{"position":"fixed","background":"url(https://evil)"}}>t</Spread>',
      '<Spread STYLE="position:fixed">t</Spread>',
    ].map((mdx) => renderMdx(mdx, vocabulary)),
  );
  expect(rendered).toEqual(['<div>t</div>', '<div>t</div>']);
});
