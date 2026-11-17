import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import '../../main.css';
import { InlinePreviewFrame } from './InlinePreviewFrame.js';

const meta = {
  title: 'Editor/InlinePreviewFrame',
  component: InlinePreviewFrame,
  args: { title: 'Fragment preview', children: null },
} satisfies Meta<typeof InlinePreviewFrame>;

export default meta;

type Story = StoryObj<typeof meta>;

function ResizingFrame() {
  const [tall, setTall] = useState(true);
  return (
    <div>
      <button type="button" onClick={() => setTall((value) => !value)}>
        Toggle
      </button>
      <InlinePreviewFrame title="Fragment preview">
        <div style={{ height: tall ? 600 : 100 }}>
          <a href="/away">plain link</a>{' '}
          <a href="/away" target="_top">
            top link
          </a>{' '}
          <a href="/away" target="_parent">
            parent link
          </a>
          <map name="m">
            <area href="/away" shape="rect" coords="0,0,10,10" alt="area link" />
          </map>
          <form action="/away">
            <button type="submit">submit</button>
          </form>
        </div>
      </InlinePreviewFrame>
    </div>
  );
}

export const FrameShrinksAndKeepsLinksInPlace: Story = {
  render: () => <ResizingFrame />,
  play: async ({ canvasElement }) => {
    const iframe = () => canvasElement.querySelector<HTMLIFrameElement>('iframe[title="Fragment preview"]');
    await waitFor(() => expect(iframe()?.offsetHeight).toBe(600));
    await userEvent.click(within(canvasElement).getByText('Toggle'));
    await waitFor(() => expect(iframe()?.offsetHeight).toBe(100));

    const doc = iframe()?.contentDocument;
    if (!doc) throw new Error('the preview frame has no document');
    const topHref = window.location.href;
    // The guard listens in the capture phase, so these bubble listeners see whether it cancelled each event.
    const cancelled: string[] = [];
    for (const type of ['click', 'submit']) {
      doc.addEventListener(type, (event) => cancelled.push(`${event.type}:${event.defaultPrevented}`));
    }
    for (const name of ['plain link', 'top link', 'parent link']) {
      const link = [...doc.querySelectorAll('a')].find((anchor) => anchor.textContent === name);
      if (!link) throw new Error(`no ${name}`);
      link.click();
    }
    doc.querySelector('area')?.click();
    doc.querySelector<HTMLButtonElement>('button[type="submit"]')?.click();
    // A submit that does not come from a click (Enter in a field) is cancelled at the submit event.
    doc.querySelector('form')?.requestSubmit();
    await new Promise((resolve) => setTimeout(resolve, 200));
    await expect(iframe()?.contentDocument).toBe(doc);
    await expect(doc.URL).toBe('about:srcdoc');
    await expect(window.location.href).toBe(topHref);
    await expect(cancelled).toEqual([
      'click:true',
      'click:true',
      'click:true',
      'click:true',
      'click:true',
      'submit:true',
    ]);
  },
};
