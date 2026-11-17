import { describe, expect, test } from 'bun:test';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { evaluateMDXToComponent } from '../mdx/evaluate.js';
import { defineFragmentComponents } from '../mdx/vocabulary.js';

/**
 * A fragment's outline is the list of its headings, produced while the MDX is
 * already being parsed. It exists so every surface reads the same list from the
 * same code: the published page and every editing surface render through
 * `evaluate.ts`. A second extraction pass —
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

function Section({ id, children }: { id?: unknown; children?: ReactNode }) {
  return createElement('section', { id: typeof id === 'string' ? id : undefined }, children);
}

function Note({ children }: { children?: ReactNode }) {
  return createElement('aside', null, children);
}

const outlined = defineFragmentComponents({
  components: { Note, Section },
  outline: { Section: { id: 'id', text: 'label' } },
});

async function evaluated(mdx: string) {
  const result = await evaluateMDXToComponent(mdx, outlined);
  if (result.error) throw result.error;
  return result;
}

describe('component outline', () => {
  test('lists the declared components in document order, nested ones included', async () => {
    const { componentOutline } = await evaluated(
      '<Section id="one" label="First’s part">\n\n## Heading\n\n</Section>\n\n<Note>\n\n<Section id="two" label="Second">\n\nx\n\n</Section>\n\n</Note>',
    );

    expect(componentOutline).toEqual([
      { component: 'Section', id: 'one', text: 'First’s part' },
      { component: 'Section', id: 'two', text: 'Second' },
    ]);
  });

  test('keeps components out of the heading outline', async () => {
    const { outline } = await evaluated('<Section id="one" label="First">\n\n## Heading\n\n</Section>');

    expect(outline).toEqual([{ depth: 2, id: 'heading', text: 'Heading' }]);
  });

  test('every entry id is the id the component renders, even with the attribute written twice', async () => {
    const results = await Promise.all(
      ['<Section id="here" label="Here">x</Section>', '<Section id="old" id="here" label="Here">x</Section>'].map(
        evaluated,
      ),
    );
    for (const { Component, componentOutline } of results) {
      if (!Component) throw new Error('no component');

      expect(componentOutline[0]?.id).toBe('here');
      expect(renderToStaticMarkup(createElement(Component))).toContain('id="here"');
    }
  });

  test('skips an entry unless both props are non-empty strings after the attribute gate', async () => {
    const { componentOutline } = await evaluated(
      [
        '<Section label="No id">x</Section>',
        '<Section id="no-label">x</Section>',
        '<Section id="" label="Empty id">x</Section>',
        '<Section id="a" label="">x</Section>',
        '<Section id={1} label="Number id">x</Section>',
        '<Section id="b" label={["list"]}>x</Section>',
        '<Section id="c" label={null}>x</Section>',
        '<Section id="d" label="javascript:alert(1)">x</Section>',
        '<Section {...{ id: "e", label: "Spread" }}>x</Section>',
        '<Section id="kept" label="Kept">x</Section>',
      ].join('\n\n'),
    );

    expect(componentOutline).toEqual([{ component: 'Section', id: 'kept', text: 'Kept' }]);
  });

  test('ignores components the vocabulary does not declare as outline entries', async () => {
    const { componentOutline } = await evaluated('<Note id="n" label="Note">x</Note>');

    expect(componentOutline).toEqual([]);
  });

  test('without a declaration there are no component entries', async () => {
    const result = await evaluateMDXToComponent(
      '<Section id="one" label="First">x</Section>',
      defineFragmentComponents({ components: { Section } }),
    );

    expect(result.componentOutline).toEqual([]);
  });

  test('a generated heading id never takes an outlined component’s id', async () => {
    const { outline } = await evaluated('<Section id="same" label="Same">\n\n## Same\n\n</Section>');

    expect(outline.map((h) => h.id)).toEqual(['same-1']);
  });
});
