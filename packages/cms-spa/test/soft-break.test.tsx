/// <reference lib="dom" />
import { afterEach, describe, expect, test } from 'bun:test';
import { BaseMDXEditor } from '@conloca/mdx';
import type { MDXEditorMethods } from '@mdxeditor/editor';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import {
  $createRangeSelection,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $setSelection,
  BLUR_COMMAND,
  getNearestEditorFromDOMNode,
  type LexicalEditor,
  PASTE_COMMAND,
  type RangeSelection,
  REDO_COMMAND,
  UNDO_COMMAND,
} from 'lexical';
import { createRef } from 'react';
import { CMSMDXEditor } from '../src/components/editor/CMSMDXEditor.js';
import { SoftBreakNode } from '../src/components/editor/soft-break-plugin.js';

afterEach(cleanup);

async function open(markdown: string, fragment: boolean) {
  const ref = createRef<MDXEditorMethods>();
  const { container } = render(
    <QueryClientProvider client={new QueryClient()}>
      <CMSMDXEditor ref={ref} value={markdown} onChange={() => {}} fragment={fragment} />
    </QueryClientProvider>,
  );
  const root = await waitFor(() => {
    const el = container.querySelector('[contenteditable="true"]');
    if (!el?.textContent) throw new Error('editor not loaded');
    return el;
  });
  const editor = getNearestEditorFromDOMNode(root);
  if (!editor) throw new Error('no Lexical editor');
  return { ref, editor };
}

// Source wrapped at a fixed width, the way the site's MDX is: soft breaks in plain, bold and linked text and a list.
const source = [
  'Teams often accept a slower site as the price of an editor. The CMS injects its own runtime, hydrates more than the page',
  'needs, and **turns a marketing site\ninto an application**. Visitors pay for [a workflow they\nnever asked for](/why).',
  '',
  '- A list item wrapped\n  onto a second line',
  '',
].join('\n');

describe('soft breaks', () => {
  for (const fragment of [true, false]) {
    test(`open and save keeps the source byte for byte (${fragment ? 'fragment' : 'page'} editor)`, async () => {
      const { ref, editor } = await open(source, fragment);
      const breaks = editor.getEditorState().read(() =>
        $getRoot()
          .getAllTextNodes()
          .filter((n) => n instanceof SoftBreakNode),
      );
      expect(breaks).toHaveLength(4);
      expect(ref.current?.getMarkdown()).toBe(source);
    });
  }

  test('typing in a paragraph keeps its soft breaks as line endings', async () => {
    const { ref, editor } = await open('First line\nsecond line.\n', true);
    act(() => {
      editor.update(
        () => {
          const paragraph = $getRoot().getFirstChild();
          if ($isElementNode(paragraph)) paragraph.append($createTextNode(' More.'));
        },
        { discrete: true },
      );
      editor.dispatchCommand(BLUR_COMMAND, new FocusEvent('blur'));
    });
    await waitFor(() => expect(ref.current?.getMarkdown()).toBe('First line\nsecond line. More.\n'));
  });

  // Shared editing stores markdown text, so an editor build without the plugin must write the same text.
  test('an editor without the plugin writes the same source', async () => {
    const ref = createRef<MDXEditorMethods>();
    render(<BaseMDXEditor ref={ref} value={source} onChange={() => {}} />);
    await waitFor(() => expect(ref.current?.getMarkdown()).toBe(source));
  });
});

/** Runs `change` on the opened paragraph as one update, then reads what the editor saves. */
async function saved(markdown: string, change: (editor: LexicalEditor) => void): Promise<string> {
  const { ref, editor } = await open(markdown, true);
  act(() => {
    change(editor);
    editor.dispatchCommand(BLUR_COMMAND, new FocusEvent('blur'));
  });
  return ref.current?.getMarkdown() ?? '';
}

/** Selects from `[node, offset]` to `[node, offset]`, nodes counted in the document's text nodes. */
function $select(from: [number, number], to: [number, number] = from): RangeSelection {
  const nodes = $getRoot().getAllTextNodes();
  const at = (index: number) => {
    const node = nodes[index];
    if (!node) throw new Error(`no text node ${index}`);
    return node.getKey();
  };
  const selection = $createRangeSelection();
  selection.anchor.set(at(from[0]), from[1], 'text');
  selection.focus.set(at(to[0]), to[1], 'text');
  $setSelection(selection);
  return selection;
}

const update = (editor: LexicalEditor, change: () => void) => editor.update(change, { discrete: true });

describe('editing across a soft break', () => {
  const paragraph = 'First line\nsecond line.\n';

  // The paragraph's text nodes: 0 "First line", 1 the break, 2 "second line.".
  test('deleting across the break joins the lines', async () => {
    const markdown = await saved(paragraph, (editor) => update(editor, () => $select([0, 5], [2, 6]).removeText()));
    expect(markdown).toBe('First line.\n');
  });

  test('typing over a selection that starts at the break replaces it and what follows', async () => {
    const markdown = await saved(paragraph, (editor) =>
      update(editor, () => $select([1, 0], [2, 6]).insertText(' new')),
    );
    expect(markdown).toBe('First line new line.\n');
  });

  test('pasting right after the break keeps it as the line ending', async () => {
    const { ref, editor } = await open(paragraph, true);
    act(() => {
      update(editor, () => $select([1, 1]));
      const clipboardData = new DataTransfer();
      clipboardData.setData('text/plain', 'the ');
      editor.dispatchCommand(PASTE_COMMAND, new ClipboardEvent('paste', { clipboardData }));
    });
    // The paste lands in an update of its own.
    await waitFor(() => expect(ref.current?.getMarkdown()).toBe('First line\nthe second line.\n'));
  });

  test('undo and redo of an edit next to the break write the break back each time', async () => {
    const { ref, editor } = await open(paragraph, true);
    act(() => update(editor, () => $select([1, 0]).insertText(' one')));
    expect(ref.current?.getMarkdown()).toBe('First line one\nsecond line.\n');
    // History applies a state in an update of its own.
    act(() => {
      editor.dispatchCommand(UNDO_COMMAND, undefined);
    });
    await waitFor(() => expect(ref.current?.getMarkdown()).toBe(paragraph));
    act(() => {
      editor.dispatchCommand(REDO_COMMAND, undefined);
    });
    await waitFor(() => expect(ref.current?.getMarkdown()).toBe('First line one\nsecond line.\n'));
  });

  test('bold across the break keeps the break inside the bold text', async () => {
    const markdown = await saved(paragraph, (editor) =>
      update(editor, () => $select([0, 6], [2, 6]).formatText('bold')),
    );
    expect(markdown).toBe('First **line\nsecond** line.\n');
  });

  test('typing after a link that spans a break keeps the link and the break', async () => {
    const markdown = await saved('See [the\nsite](/x) now.\n', (editor) =>
      update(editor, () => {
        $getRoot().selectEnd();
        const selection = $getSelection();
        if ($isRangeSelection(selection)) selection.insertText(' More.');
      }),
    );
    expect(markdown).toBe('See [the\nsite](/x) now. More.\n');
  });
});
