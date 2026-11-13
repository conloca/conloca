import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { ListItemNode } from '@lexical/list';
import { type MDXEditorMethods, type RealmPlugin, realmPlugin, rootEditor$ } from '@mdxeditor/editor';
import { cleanup, render, waitFor } from '@testing-library/react';
import { $copyNode, $createTextNode, $getRoot, $isTextNode, $nodesOfType, type LexicalEditor } from 'lexical';
import { createRef } from 'react';
import { MDXEditor } from '../index.js';
import { LinkDefinitionNode } from '../markdown-fidelity/LinkDefinitionNode.js';
import { editorRoundTrip } from './editor-round-trip.js';

afterEach(() => {
  cleanup();
});

/** Opens `markdown`, applies `edit` as one Lexical update, and returns the saved markdown. `onChange` sees each change. */
async function markdownAfterEdit(
  markdown: string,
  edit: () => void,
  onChange: (value: string, initialMarkdownNormalize?: boolean) => void = () => {},
): Promise<string | undefined> {
  const editors: (LexicalEditor | null)[] = [];
  const captureEditor: RealmPlugin = realmPlugin({
    postInit(realm) {
      editors.push(realm.getValue(rootEditor$));
    },
  })();
  const ref = createRef<MDXEditorMethods>();
  render(<MDXEditor ref={ref} value={markdown} onChange={onChange} extraPlugins={[captureEditor]} />);
  await waitFor(() => expect(editors).toHaveLength(1));
  editors[0]?.update(edit, { discrete: true });
  return ref.current?.getMarkdown();
}

describe('hard line breaks (D22 loss 3)', () => {
  test('keeps a two-space hard break', async () => {
    const input = 'Line one  \nline two';
    expect(await editorRoundTrip(input)).toBe(input);
  });
  test('keeps a backslash hard break', async () => {
    const input = 'Line one\\\nline two';
    expect(await editorRoundTrip(input)).toBe(input);
  });
  test('keeps a hard break inside a list item', async () => {
    const input = '- item line one\\\n  item line two';
    expect(await editorRoundTrip(input)).toBe(input);
  });
  test('leaves a soft line ending soft', async () => {
    const input = 'Line one\nline two';
    expect(await editorRoundTrip(input)).toBe(input);
  });
  test('keeps a backslash hard break before a CRLF line ending', async () => {
    const input = 'Line one\\\r\nline two';
    expect(await editorRoundTrip(input)).toBe(input);
  });
  test('keeps a two-space hard break before a CRLF line ending', async () => {
    const input = 'Line one  \r\nline two';
    expect(await editorRoundTrip(input)).toBe(input);
  });
});

describe('formatting around a link (D22 loss 2)', () => {
  test('keeps bold around a link', async () => {
    const input = 'Install **[Bun](https://bun.sh/)** first.';
    expect(await editorRoundTrip(input)).toBe(input);
  });
  test('keeps bold inside a link', async () => {
    const input = 'Install [**Bun**](https://bun.sh/) first.';
    expect(await editorRoundTrip(input)).toBe(input);
  });
  test('keeps bold that spans text and a link', async () => {
    const input = '**Install [Bun](https://bun.sh/) first.**';
    expect(await editorRoundTrip(input)).toBe(input);
  });
  test('keeps italic around a link', async () => {
    const input = 'See _[the guide](https://example.com/guide)_.';
    expect(await editorRoundTrip(input)).toBe(input);
  });
  test('keeps bold around a link whose text has a hard break', async () => {
    const input = '**[a\\\nb](https://example.com/)**';
    expect(await editorRoundTrip(input)).toBe(input);
  });
  test('keeps bold around italic around a link', async () => {
    const input = 'See **_[the guide](https://example.com/guide)_**.';
    expect(await editorRoundTrip(input)).toBe(input);
  });
  test('keeps italic around bold around a link', async () => {
    const input = 'See _**[the guide](https://example.com/guide)**_.';
    expect(await editorRoundTrip(input)).toBe(input);
  });
});

describe('adjacent lists with different markers (D22 loss 1)', () => {
  test('keeps star, plus and dash lists apart', async () => {
    const input = '* star one\n* star two\n\n+ plus one\n+ plus two\n\n- dash one\n- dash two';
    expect(await editorRoundTrip(input)).toBe(input);
  });
  test('keeps a dot list and a paren list apart', async () => {
    const input = '1. dot one\n2. dot two\n\n1) paren one\n2) paren two';
    expect(await editorRoundTrip(input)).toBe(input);
  });
  test('keeps the marker of a nested list', async () => {
    const input = '* star one\n  + nested plus\n* star two';
    expect(await editorRoundTrip(input)).toBe(input);
  });
  test('still writes dash for a list with no source marker', async () => {
    // control: lists the editor creates keep today's behaviour (TO_MARKDOWN_OPTIONS.bullet)
    const input = '- dash one\n- dash two';
    expect(await editorRoundTrip(input)).toBe(input);
  });
  test('keeps sibling nested lists in one item in their order', async () => {
    const input = '* a\n  - b\n  + c';
    expect(await editorRoundTrip(input)).toBe(input);
  });
  test('keeps three sibling nested lists in their order', async () => {
    const input = '- a\n  * b\n  + c\n  - d';
    expect(await editorRoundTrip(input)).toBe(input);
  });
  test('keeps a nested task list before a nested plain list', async () => {
    const input = '- a\n  * [ ] b\n  + plain';
    expect(await editorRoundTrip(input)).toBe(input);
  });
});

describe('plain items next to task items (D22 loss 4)', () => {
  test('adds no checkbox to plain items before a task list', async () => {
    const input = '- plain item one\n- plain item two\n- [ ] task open\n- [x] task done';
    expect(await editorRoundTrip(input)).toBe(input);
  });
  test('adds no checkbox to plain items after task items', async () => {
    const input = '- [ ] task open\n- plain item\n- [x] task done';
    expect(await editorRoundTrip(input)).toBe(input);
  });
  test('adds no checkbox to a loose list before a task list and keeps its blank lines', async () => {
    const input = '- loose item one\n\n- loose item two\n\n- [ ] task open\n- [x] task done';
    expect(await editorRoundTrip(input)).toBe(input);
  });
  test('keeps a loose plain list loose', async () => {
    const input = '- loose item one\n\n- loose item two';
    expect(await editorRoundTrip(input)).toBe(input);
  });
  test('keeps a loose item with two paragraphs', async () => {
    const input = '- first paragraph\n\n  second paragraph\n- next item';
    expect(await editorRoundTrip(input)).toBe(input);
  });
  test('adds no blank line before a nested list in a loose item', async () => {
    const input = '- a\n\n  b\n  - nested\n- c';
    expect(await editorRoundTrip(input)).toBe(input);
  });
  test('adds no blank line before a code block in a loose item', async () => {
    const input = '- a\n\n  b\n  ```js\n  code\n  ```\n- c';
    expect(await editorRoundTrip(input)).toBe(input);
  });
  test('adds no blank line before a quote in a loose item', async () => {
    const input = '- a\n\n  b\n  > q\n- c';
    expect(await editorRoundTrip(input)).toBe(input);
  });
  test('keeps the blank line before a nested list in an item', async () => {
    const input = '- a\n\n  - nested\n- c';
    expect(await editorRoundTrip(input)).toBe(input);
  });
  test('keeps a paragraph after a nested list after it, and a paragraph after the list', async () => {
    const input = '- a\n  - nested\n\n  b\n- c\n\nafter';
    expect(await editorRoundTrip(input)).toBe(input);
  });
  test('keeps two paragraphs after a nested list, then another nested list, in order', async () => {
    const input = '- a\n  - one\n\n  b\n\n  c\n  * two\n- d';
    expect(await editorRoundTrip(input)).toBe(input);
  });
  test('keeps the marker of a nested list after a paragraph that follows another nested list', async () => {
    const input = '- a\n  - b\n\n  para\n  - c';
    expect(await editorRoundTrip(input)).toBe(input);
  });
  test('keeps a thematic break after a paragraph in an item from turning the paragraph into a heading', async () => {
    const input = '- a\n  ***\n- b';
    expect(await editorRoundTrip(input)).toBe(input);
  });
});

describe('thematic breaks', () => {
  test('keeps a top-level `___` rule', async () => {
    const input = 'Intro\n\n___\n\nRest';
    expect(await editorRoundTrip(input)).toBe(input);
  });
  test('keeps a `* * *` rule', async () => {
    const input = 'Intro\n\n* * *\n\nRest';
    expect(await editorRoundTrip(input)).toBe(input);
  });
  test('still writes a `---` rule that opens the body as `***`, so the body never reads as front matter', async () => {
    expect(await editorRoundTrip('---\n\nIntro')).toBe('***\n\nIntro');
  });
  test('keeps a `___` rule that opens the body', async () => {
    const input = '___\n\nIntro';
    expect(await editorRoundTrip(input)).toBe(input);
  });
  test('keeps a `* * *` rule that opens the body', async () => {
    const input = '* * *\n\nIntro';
    expect(await editorRoundTrip(input)).toBe(input);
  });
});

describe('reference-style links (D22 loss 5)', () => {
  test('keeps full, collapsed and shortcut references and their definitions', async () => {
    const input =
      'Use [Bun][bun], read [the docs][] or ask [Discord].\n\n' +
      '[bun]: https://bun.sh/\n[the docs]: https://example.com/docs\n[discord]: https://example.com/chat "Chat"';
    expect(await editorRoundTrip(input)).toBe(input);
  });
  test('keeps bold around a reference link', async () => {
    const input = 'Install **[Bun][bun]** first.\n\n[bun]: https://bun.sh/';
    expect(await editorRoundTrip(input)).toBe(input);
  });
  test('opens a file with a reference link without a parse error', async () => {
    // BaseMDXEditor has no onError prop; editor-core.tsx logs parse errors to console.error
    const errors = spyOn(console, 'error');
    const { container } = render(<MDXEditor value={'Use [Bun][bun].\n\n[bun]: https://bun.sh/'} onChange={() => {}} />);
    await waitFor(() => expect(container.querySelector('a[href="https://bun.sh/"]')).toBeTruthy());
    expect(errors.mock.calls.some(([first]) => String(first).includes('[MDXEditor] parse error'))).toBe(false);
    errors.mockRestore();
  });
  test('writes a reference link inline once its definition is deleted', async () => {
    const output = await markdownAfterEdit('Use [Bun][bun].\n\n[bun]: https://bun.sh/', () => {
      for (const definition of $nodesOfType(LinkDefinitionNode)) definition.remove();
    });
    expect(output).toBe('Use [Bun](https://bun.sh/).');
  });
});

describe('editing after a paragraph that follows a nested list', () => {
  test('a new item added after it saves as its own item', async () => {
    const output = await markdownAfterEdit('- a\n  - nested\n\n  b', () => {
      const continuation = $nodesOfType(ListItemNode).find((item) => item.getTextContent() === 'b');
      if (!continuation) throw new Error('no item holds the paragraph after the nested list');
      // What Enter at the end of an item does (ListItemNode.insertNewAfter): a copy, NodeState included.
      continuation.insertAfter($copyNode(continuation).append($createTextNode('new')));
    });
    expect(output).toStartWith('- a\n  - nested\n\n  b\n');
    expect(output).toEndWith('\n- new');
  });
  test('a code block after a nested list stays after it', async () => {
    const input = '- a\n  - n\n\n  ```js\n  x\n  ```\n- b';
    expect(await editorRoundTrip(input)).toBe(input);
  });
  test('a quote after a nested list stays after it', async () => {
    const input = '- a\n  - n\n\n  > q\n- b';
    expect(await editorRoundTrip(input)).toBe(input);
  });
  test('the item holding the paragraph renders no bullet, number or checkbox', async () => {
    const { container } = render(<MDXEditor value={'1. a\n   - n\n\n   b\n2. c'} onChange={() => {}} />);
    await waitFor(() => {
      const item = [...container.querySelectorAll('li')].find((li) => li.textContent === 'b');
      expect(item?.classList.contains('conloca-md-continuation')).toBe(true);
    });
    const css = await Bun.file(new URL('../editor-styles.css', import.meta.url)).text();
    expect(css).toContain('li.conloca-md-continuation {\n  list-style: none;');
    expect(css).toContain('li.conloca-md-continuation::before,\nli.conloca-md-continuation::after {\n  display: none;');
  });
});

describe('the end of the body', () => {
  test.each([
    ['a trailing blank line', 'First.\n\nSecond.\n\n'],
    ['a final newline', 'First.\n\nSecond.\n'],
    ['no final newline', 'First.\n\nSecond.'],
    ['an import above it and a trailing blank line', "import { X } from './x.js'\n\nFirst.\n\n"],
  ])('opening and exporting a body with %s keeps its bytes', async (_name, input) => {
    expect(await editorRoundTrip(input)).toBe(input);
  });
  test('a save after typing elsewhere keeps the trailing blank line', async () => {
    const saves: string[] = [];
    const output = await markdownAfterEdit(
      'First.\n\nSecond.\n\n',
      () => {
        const first = $getRoot().getFirstDescendant();
        if (!$isTextNode(first)) throw new Error('the body does not open with text');
        first.setTextContent(`x${first.getTextContent()}`);
      },
      (value, initialMarkdownNormalize) => {
        if (!initialMarkdownNormalize) saves.push(value);
      },
    );
    expect(saves).toEqual(['xFirst.\n\nSecond.\n\n']);
    expect(output).toBe('xFirst.\n\nSecond.\n\n');
  });
  test('a body emptied in the editor exports nothing', async () => {
    const output = await markdownAfterEdit('First.\n\n', () => {
      $getRoot().clear();
    });
    expect(output).toBe('');
  });
});
