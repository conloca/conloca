import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { compileMDX } from '../mdx/compile.js';
import { evaluateMDXToComponent } from '../mdx/evaluate.js';

/**
 * A fragment's outline is the list of its headings, produced while the MDX is
 * already being parsed. It exists so every surface reads the same list from the
 * same code: the published page renders through `evaluate.ts`, and every
 * editing surface compiles through `compile.ts`. A second extraction pass —
 * scanning rendered HTML in a browser, say — is what these tests exist to keep
 * out, because two passes drift and only one of them is ever looked at.
 */

async function outlineOf(mdx: string) {
  const { outline, error } = await evaluateMDXToComponent(mdx);
  if (error) throw error;
  return outline;
}

async function markupOf(mdx: string): Promise<string> {
  const { Component, error } = await evaluateMDXToComponent(mdx);
  if (error || !Component) return '';
  return renderToStaticMarkup(createElement(Component));
}

describe('fragment outline', () => {
  test('collects headings in document order with their depth', async () => {
    const outline = await outlineOf('## First\n\ntext\n\n### Nested\n\n## Second');

    expect(outline).toEqual([
      { depth: 2, id: 'first', text: 'First' },
      { depth: 3, id: 'nested', text: 'Nested' },
      { depth: 2, id: 'second', text: 'Second' },
    ]);
  });

  test('a fragment with no headings has an empty outline', async () => {
    expect(await outlineOf('Just a paragraph.')).toEqual([]);
  });

  /**
   * The invariant the whole design rests on: the id in the outline is the id on
   * the heading. If these can disagree, a contents link points at nothing.
   */
  test('every outline id is the id rendered on its heading', async () => {
    const mdx = "## Here's how it works in practice:\n\n## Second one\n\n## Über uns";
    const outline = await outlineOf(mdx);
    const markup = await markupOf(mdx);

    expect(outline.length).toBe(3);
    for (const heading of outline) {
      expect(markup).toContain(`id="${heading.id}"`);
    }
  });

  test('a heading in any script gets a readable id that does not depend on its position', async () => {
    const outline = await outlineOf('## Über uns\n\n## Café résumé\n\n## Привет мир\n\n## 你好');

    expect(outline.map((h) => h.id)).toEqual(['über-uns', 'café-résumé', 'привет-мир', '你好']);
    expect((await outlineOf('## Контакты'))[0]?.id).toBe('контакты');
    expect((await outlineOf('## Новости\n\n## Контакты'))[1]?.id).toBe('контакты');
  });

  test('de-duplicates repeated heading text', async () => {
    const outline = await outlineOf('## Same\n\n## Same\n\n## Same');

    expect(outline.map((h) => h.id)).toEqual(['same', 'same-1', 'same-2']);
  });

  test('a heading with no sluggable characters still gets a usable id', async () => {
    const outline = await outlineOf('## !!!\n\n## ???');

    expect(outline.map((h) => h.id)).toEqual(['section', 'section-1']);
    for (const heading of outline) {
      expect(heading.id).not.toBe('');
    }
  });

  test('flattens inline markup when reading a heading, and ids come from the text', async () => {
    const outline = await outlineOf('## A **bold** word and `code`');

    expect(outline[0]?.text).toBe('A bold word and code');
    expect(outline[0]?.id).toBe('a-bold-word-and-code');
  });

  /**
   * A heading authored as literal JSX survives `remarkRehype`'s passThrough as
   * an mdxJsxElement rather than a plain element. The browser script this
   * module replaces saw it (it queried rendered HTML), so dropping it here
   * would be a regression rather than a limitation.
   */
  test('collects a heading written as literal JSX', async () => {
    const outline = await outlineOf('## Markdown one\n\n<h2>Written as JSX</h2>');

    expect(outline.map((h) => h.text)).toEqual(['Markdown one', 'Written as JSX']);
    expect(outline[1]?.depth).toBe(2);
  });

  test('respects an id the author already put on a heading', async () => {
    const outline = await outlineOf('<h2 id="chosen-by-hand">Titled</h2>');

    expect(outline[0]?.id).toBe('chosen-by-hand');
  });

  test('a generated id never takes an id the author wrote', async () => {
    const outline = await outlineOf('<h2 id="same">Hand</h2>\n\n## Same');

    expect(outline.map((h) => h.id)).toEqual(['same', 'same-1']);
  });
});

describe('fragment outline — both pipelines agree', () => {
  /**
   * `evaluate.ts` renders the published page and `compile.ts` serves every
   * editing surface. They are separate pipelines, so the outline is only
   * trustworthy while they produce the same one for the same source. This is
   * the test that fails if a future change lands in one and not the other.
   */
  test('the editor pipeline produces the same outline as the published one', async () => {
    const mdx = "## Here's how it works\n\n### Detail\n\n## Same\n\n## Same\n\n## Контакты\n\n<h2>JSX one</h2>";

    const published = await outlineOf(mdx);
    const { outline: editor } = await compileMDX(mdx);

    expect(editor).toEqual(published);
  });

  test('the editor pipeline puts those ids on its headings too', async () => {
    const { code, outline } = await compileMDX('## A heading here');

    expect(outline[0]?.id).toBe('a-heading-here');
    expect(code).toContain('a-heading-here');
  });
});
