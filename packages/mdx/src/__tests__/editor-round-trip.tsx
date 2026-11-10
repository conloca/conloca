import { expect, spyOn } from 'bun:test';
import type { MDXEditorMethods } from '@mdxeditor/editor';
import { render, waitFor } from '@testing-library/react';
import { createRef } from 'react';
import { MDXEditor } from '../index.js';

/**
 * Push a markdown body through the real editor's parse → serialize round trip. Fails on a parse
 * error: the editor then falls back to the source text, which would pass any byte-identity check.
 */
export async function editorRoundTrip(markdown: string): Promise<string> {
  const errors = spyOn(console, 'error');
  try {
    const ref = createRef<MDXEditorMethods>();
    const { container } = render(<MDXEditor ref={ref} value={markdown} onChange={() => {}} />);
    await waitFor(() => {
      expect(container.querySelector('[contenteditable]')).toBeTruthy();
    });
    const editor = ref.current;
    if (editor === null) throw new Error('editor ref was never attached');
    const parseErrors = errors.mock.calls.filter(([first]) => String(first).includes('[MDXEditor] parse error'));
    expect(parseErrors).toEqual([]);
    return editor.getMarkdown();
  } finally {
    errors.mockRestore();
  }
}
