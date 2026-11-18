/// <reference lib="dom" />
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { defineFragmentComponents } from '@conloca/mdx/render';
import { act, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { BLUR_COMMAND, getNearestEditorFromDOMNode } from 'lexical';
import type { ReactNode } from 'react';
import { getSelectedBlock, setSelectedBlock } from '../src/selected-block.js';
import { setSiteRender } from '../src/site-render.js';
import { appendWord, openFragment as open } from './fragment-editor-harness.js';

const Box = ({ children }: { children?: ReactNode }) => <div>{children}</div>;

beforeEach(() => {
  setSiteRender({
    vocabulary: defineFragmentComponents({
      components: {
        Eyebrow: Box,
        Group: Box,
        QuietTitle: Box,
        Section: ({ children }: { children?: ReactNode }) => <section>{children}</section>,
        TextTable: () => null,
      },
      outline: { Section: { id: 'id', text: 'label' } },
    }),
  });
});
afterEach(() => {
  cleanup();
  setSiteRender({});
  setSelectedBlock(null);
});

// A fragment written the way sites write them: wrapped paragraphs, children at the tag's column, a blank line before
// each closing tag, lists and a multi-line JSON prop inside components, a section with a contents label but no anchor,
// and a root paragraph last.
const fragment = readFileSync(new URL('./fixtures/source-layout.mdx', import.meta.url), 'utf8');

describe('component blocks keep their source layout', () => {
  test('open and save writes the file back unchanged', async () => {
    const { saved } = await open(fragment);
    expect(saved()).toBe(fragment);
  });

  test('a word added to the last paragraph is the only change', async () => {
    const { container, saved } = await open(fragment);
    appendWord(container, 'The shelf is full again');
    expect(saved()).toBe(`${fragment.trimEnd()} word\n`);
  });

  test('a word added inside a section changes only that line', async () => {
    const { container, saved } = await open(fragment);
    const line = 'warm until the lunch crowd arrives.\n';
    appendWord(container, 'Each oven holds');
    await waitFor(() => expect(saved()).toBe(fragment.replace(line, `${line.trimEnd()} word\n`)));
  });

  // Opening and saving leaves the anchorless section as it was; the anchor comes with the first edit to the section.
  test('a word added inside a section with no anchor gives it one', async () => {
    const { container, saved } = await open(fragment);
    const line = 'with coffee before the bread is sliced.';
    appendWord(container, 'The counter opens');
    await waitFor(() =>
      expect(saved()).toBe(
        fragment
          .replace('<Section label="The counter">', '<Section label="The counter" id="the-counter">')
          .replace(line, `${line} word`),
      ),
    );
  });

  test('leaving a section with no anchor unedited leaves it as it was', async () => {
    const { container, saved } = await open(fragment);
    const body = [...container.querySelectorAll('section [contenteditable="true"]')].find((el) =>
      el.textContent?.includes('The counter opens'),
    );
    const editor = body && getNearestEditorFromDOMNode(body);
    if (!editor) throw new Error('no counter body');
    act(() => {
      editor.focus();
      editor.dispatchCommand(BLUR_COMMAND, new FocusEvent('blur'));
    });
    expect(saved()).toBe(fragment);
  });

  // The editor keeps the line endings inside what it read and writes its own breaks between blocks as `\n`.
  test('a CRLF file changes only in the breaks between blocks, and an edit only by the edit', async () => {
    const crlf = fragment.replaceAll('\n', '\r\n');
    const { container, saved } = await open(crlf);
    const written = saved() ?? '';
    expect(written.replaceAll('\r\n', '\n')).toBe(fragment);
    expect(written).toContain(
      '<TextTable\r\n  items={[\r\n    {"title": "Top oven.", "text": "Bread, at the highest heat, in two rounds."},\r\n',
    );
    appendWord(container, 'Each oven holds');
    await waitFor(() => expect(saved()).toBe(written.replace('crowd arrives.', 'crowd arrives. word')));
  });

  test('indented children keep their indent', async () => {
    const source =
      '<Group>\n  <Section id="a" label="A">\n    First line\n    second line.\n\n  </Section>\n</Group>\n';
    const { container, saved } = await open(source);
    expect(saved()).toBe(source);
    appendWord(container, 'First line');
    await waitFor(() => expect(saved()).toBe(source.replace('second line.', 'second line. word')));
  });

  // The editor writes adjacent link definitions on consecutive lines; a block's children follow the same rules.
  test('children follow the join rules', async () => {
    const source = '<Group>\nSee [a] and [b].\n\n[a]: /a\n[b]: /b\n\n</Group>\n';
    const { saved } = await open(source);
    expect(saved()).toBe(source);
  });

  // The editor keeps the line endings inside what it read (a paragraph's soft breaks, a tag's attributes) and writes
  // its own line breaks between blocks as `\n`.
  for (const eol of ['\r\n', '\r']) {
    test(`an opening tag keeps its ${JSON.stringify(eol)} line endings`, async () => {
      const table = ['<TextTable', '    items={[', '      {"title": "a", "text": "b"}', '    ]}', '  />'].join(eol);
      const source = `<Group>${eol}  Inside${eol}  text.${eol}${eol}  ${table}${eol}${eol}</Group>${eol}`;
      const { container, saved } = await open(source);
      const written = `<Group>\n  Inside${eol}  text.\n\n  ${table}\n\n</Group>${eol}`;
      expect(saved()).toBe(written);
      appendWord(container, 'Inside');
      await waitFor(() => expect(saved()).toBe(written.replace('text.', 'text. word')));
    });
  }

  test('a changed attribute rewrites only the opening tag', async () => {
    const source = '<Section id="a" label="A">\nFirst line\nsecond line.\n\n</Section>\n';
    const { container, saved } = await open(source);
    const section = container.querySelector('section');
    if (!section) throw new Error('no section');
    fireEvent.click(section);
    act(() => getSelectedBlock()?.onPropChange('label', 'B'));
    await waitFor(() => expect(saved()).toBe(source.replace('label="A"', 'label="B"')));
  });
});
