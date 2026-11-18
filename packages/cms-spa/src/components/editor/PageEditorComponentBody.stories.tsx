import type { MDXEditorMethods } from '@mdxeditor/editor';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { $getRoot, getNearestEditorFromDOMNode } from 'lexical';
import { createRef } from 'react';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import '../../main.css';
import { setMdxComponents } from '../../mdx-components.js';
import { CMSMDXEditor } from './CMSMDXEditor.js';

/** A component's body in the page editor: typing reaches the document at once, and undo takes back whole words. */

const queryClient = new QueryClient();
const editorRef = createRef<MDXEditorMethods>();
const markdown = () => editorRef.current?.getMarkdown() ?? '';

const meta = {
  title: 'Editor/PageEditorComponentBody',
  render: (args: { value: string }) => (
    <QueryClientProvider client={queryClient}>
      <CMSMDXEditor ref={editorRef} value={args.value} onChange={() => {}} />
    </QueryClientProvider>
  ),
  beforeEach: () => {
    // No `import`: the block shows its labelled card with the editable body, with no render request.
    setMdxComponents([{ name: 'Aside', kind: 'flow', hasChildren: true, insert: { label: 'Aside' } }]);
    return () => setMdxComponents([]);
  },
} satisfies Meta<{ value: string }>;

export default meta;
type Story = StoryObj<typeof meta>;

export const UndoInComponentBodyTakesBackTheWord: Story = {
  args: { value: '<Aside>\n  Text\n</Aside>\n' },
  play: async ({ canvasElement }) => {
    const body = await waitFor(() => {
      const el = canvasElement.querySelector<HTMLElement>(
        '.conloca-generic-block__fallback-body [contenteditable="true"]',
      );
      if (!el) throw new Error('no component body');
      return el;
    });
    await userEvent.click(within(body).getByText('Text'));
    getNearestEditorFromDOMNode(body)?.update(() => $getRoot().selectEnd(), { discrete: true });
    await userEvent.keyboard(' more');
    await waitFor(() => expect(markdown()).toBe('<Aside>\n  Text more\n</Aside>\n'));
    // Lexical reads Cmd on macOS and Ctrl elsewhere.
    const mod = /Mac/.test(navigator.platform) ? 'Meta' : 'Control';
    await userEvent.keyboard(`{${mod}>}z{/${mod}}`);
    await waitFor(() => expect(body).toHaveTextContent(/^Text$/));
    await waitFor(() => expect(markdown()).toBe('<Aside>\n  Text\n</Aside>\n'));
  },
};
