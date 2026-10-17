import { describe, expect, test } from 'bun:test';
import { run } from '@mdx-js/mdx';
import { createElement } from 'react';
import * as devRuntime from 'react/jsx-dev-runtime';
import * as runtime from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import { compileMDX } from '../mdx/compile.js';

/**
 * The preview compile exposes YAML frontmatter twice: as `metadata` (gray-matter) and as the compiled module's
 * `frontmatter` export (remark-mdx-frontmatter). Only the `---` YAML fence is registered, so a `+++` TOML fence
 * is ordinary body text and no TOML parser ever sees author input.
 */
async function compileModule(source: string) {
  const { code, metadata } = await compileMDX(source);
  // compileMDX emits jsxDEV calls when NODE_ENV is development, so hand run() both runtimes.
  const module = await run(code, { ...runtime, ...devRuntime, baseUrl: import.meta.url });
  return { metadata, frontmatter: module.frontmatter, html: renderToStaticMarkup(createElement(module.default)) };
}

describe('compileMDX — frontmatter', () => {
  test('exports YAML frontmatter as `frontmatter`, keys in source order, equal to the metadata', async () => {
    const { metadata, frontmatter, html } = await compileModule(
      [
        '---',
        'title: Getting Started',
        'description: >-',
        '  How to install and set up',
        '  the editor',
        'id: vx-ByRL-cB7',
        "created: '2026-05-07T18:07:39.047Z'",
        'order: 3',
        'draft: false',
        'tags:',
        '  - guide',
        '  - setup',
        'seo:',
        '  noindex: true',
        '---',
        '',
        '# Body',
      ].join('\n'),
    );
    const expected = {
      title: 'Getting Started',
      description: 'How to install and set up the editor',
      id: 'vx-ByRL-cB7',
      created: '2026-05-07T18:07:39.047Z',
      order: 3,
      draft: false,
      tags: ['guide', 'setup'],
      seo: { noindex: true },
    };
    expect(frontmatter).toEqual(expected);
    // toEqual ignores key order; the serialized form keeps it.
    expect(JSON.stringify(frontmatter)).toBe(JSON.stringify(expected));
    expect(metadata).toEqual(expected);
    expect(html).toBe('<h1 id="body">Body</h1>');
  });

  test('exports an undefined `frontmatter` and empty metadata when the document has none', async () => {
    const { metadata, frontmatter, html } = await compileModule('# Hello\n\nworld');
    expect(frontmatter).toBeUndefined();
    expect(metadata).toEqual({});
    expect(html).toBe('<h1 id="hello">Hello</h1>\n<p>world</p>');
  });

  test('fails the compile when the YAML frontmatter is malformed', async () => {
    await expect(compileMDX('---\ntitle: [unclosed\n---\n\n# Broken\n')).rejects.toThrow(/^MDX compilation failed:/);
  });

  test('renders a `+++` block as body text and never hands it to a TOML parser', async () => {
    // Not valid TOML: a TOML parser on this path would fail the compile instead of rendering the text.
    const { metadata, frontmatter, html } = await compileModule('+++\ntitle = "TOML title"\n[[[bad\n+++\n\n# Body\n');
    expect(frontmatter).toBeUndefined();
    expect(metadata).toEqual({});
    expect(html).toBe('<p>+++\ntitle = &quot;TOML title&quot;\n[[[bad\n+++</p>\n<h1 id="body">Body</h1>');
  });
});
