/// <reference lib="dom" />
import type { MDXEditorMethods } from '@mdxeditor/editor';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, waitFor } from '@testing-library/react';
import { $createTextNode, $getRoot, $isElementNode, BLUR_COMMAND, getNearestEditorFromDOMNode } from 'lexical';
import { createRef } from 'react';
import { CMSMDXEditor } from '../src/components/editor/CMSMDXEditor.js';

/** Opens `markdown` in the fragment editor; `saved()` reads what a save would write. */
export async function openFragment(markdown: string) {
  const ref = createRef<MDXEditorMethods>();
  const { container } = render(
    <QueryClientProvider client={new QueryClient()}>
      <CMSMDXEditor ref={ref} value={markdown} onChange={() => {}} fragment />
    </QueryClientProvider>,
  );
  await waitFor(() => {
    if (!container.querySelector('[contenteditable="true"]')?.textContent) throw new Error('editor not loaded');
  });
  return { container, saved: () => ref.current?.getMarkdown() };
}

/**
 * Appends ` word` to the paragraph starting with `start`, in the innermost editable showing it (the root editor or a
 * component body's), then leaves the editor so a component body saves.
 */
export function appendWord(container: HTMLElement, start: string) {
  const showing = (el: Element) => el.textContent?.includes(start);
  const editable = [...container.querySelectorAll('[contenteditable="true"]')].find(
    (el) => showing(el) && ![...el.querySelectorAll('[contenteditable="true"]')].some(showing),
  );
  const editor = editable && getNearestEditorFromDOMNode(editable);
  if (!editor) throw new Error(`no editor shows ${start}`);
  act(() => {
    editor.update(
      () => {
        const paragraph = $getRoot()
          .getChildren()
          .find((node) => node.getTextContent().startsWith(start));
        if (!$isElementNode(paragraph)) throw new Error(`no paragraph starts with ${start}`);
        paragraph.append($createTextNode(' word'));
      },
      { discrete: true },
    );
    editor.dispatchCommand(BLUR_COMMAND, new FocusEvent('blur'));
  });
}
