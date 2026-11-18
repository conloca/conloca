import type { MDXEditorMethods } from '@mdxeditor/editor';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { $getRoot, getNearestEditorFromDOMNode } from 'lexical';
import { createRef } from 'react';
import { expect, userEvent, waitFor } from 'storybook/test';
import '../../main.css';
import { CMSMDXEditor } from './CMSMDXEditor.js';
import { SoftBreakNode } from './soft-break-plugin.js';

/** The fragment editor lays a fragment's prose out the way the published page does. */

const queryClient = new QueryClient();
const editorRef = createRef<MDXEditorMethods>();

const meta = {
  title: 'Editor/FragmentEditorLayout',
  render: (args: { value: string }) => (
    <QueryClientProvider client={queryClient}>
      <CMSMDXEditor ref={editorRef} value={args.value} onChange={() => {}} fragment />
    </QueryClientProvider>
  ),
} satisfies Meta<{ value: string }>;

export default meta;
type Story = StoryObj<typeof meta>;

function find<T extends Element>(root: ParentNode, selector: string): Promise<T> {
  return waitFor(() => {
    const el = root.querySelector<T>(selector);
    if (!el) throw new Error(`no ${selector}`);
    return el;
  });
}

/** A paragraph wrapped over two source lines reads as one line where the editor is wide enough for it. */
export const SoftBreakReflows: Story = {
  args: { value: 'A short paragraph wrapped in its source\nonto a second line.\n' },
  play: async ({ canvasElement }) => {
    const paragraph = await find<HTMLElement>(canvasElement, '[contenteditable="true"] p');
    const lineHeight = Number.parseFloat(getComputedStyle(paragraph).lineHeight);
    await expect(paragraph.getBoundingClientRect().height).toBeLessThan(lineHeight * 1.5);
    // The line ending is still there, only drawn as the space the published page draws.
    await expect(paragraph.textContent).toBe('A short paragraph wrapped in its source\nonto a second line.');
  },
};

/** Typing on either side of a soft break types into the words around it, and the break saves as the line ending. */
export const TypingAroundSoftBreak: Story = {
  args: { value: 'First line\nsecond line.\n' },
  play: async ({ canvasElement }) => {
    const root = await find<HTMLElement>(canvasElement, '[contenteditable="true"]');
    await userEvent.click(root);
    const editor = getNearestEditorFromDOMNode(root);
    // Either side of the break: its end (1), then its start (0).
    const caretAtBreak = (offset: number) =>
      editor?.update(
        () =>
          $getRoot()
            .getAllTextNodes()
            .find((node) => node instanceof SoftBreakNode)
            ?.select(offset, offset),
        { discrete: true },
      );
    caretAtBreak(1);
    await userEvent.keyboard('the ');
    caretAtBreak(0);
    await userEvent.keyboard(' one');
    await waitFor(() => expect(editorRef.current?.getMarkdown()).toBe('First line one\nthe second line.\n'));
  },
};
