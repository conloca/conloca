import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ReactNode } from 'react';
import { expect } from 'storybook/test';
import { FramedContent } from './EditorFrame.js';

const ArticleFrame = ({ pathname, children }: { pathname: string; children: ReactNode }) => (
  <div className="page-shell" data-path={pathname}>
    {children}
  </div>
);

/** A page's content inside its routing entry's editor frame, around the page-root marker the published page carries. */
const meta = {
  title: 'Editor/EditorFrame',
  component: FramedContent,
  args: { route: 'blog', Frame: ArticleFrame, pathname: '/blog/a', children: <p>Page content</p> },
} satisfies Meta<typeof FramedContent>;

export default meta;

type Story = StoryObj<typeof meta>;

export const WrapsContentInTheFrame: Story = {
  play: async ({ canvasElement }) => {
    const content = canvasElement.querySelector('.page-shell[data-path="/blog/a"] > [data-conloca-page-root] > p');
    await expect(content?.textContent).toBe('Page content');
  },
};
