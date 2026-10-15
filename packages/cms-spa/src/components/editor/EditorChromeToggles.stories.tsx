import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, userEvent, within } from 'storybook/test';
import '../../main.css';
import { EditorChromeToggles } from './EditorChromeToggles.js';

/**
 * The live-preview toggle in the fragment editor's header. The boundary is the
 * editor's `previewOpen` state and its toggle callback; the stories hold that
 * state themselves, as `FragmentEditor` does.
 *
 * Recorded, not invented: the toggle is the row's only control, and surfaces
 * whose content the in-browser compiler cannot preview pass no state, so the
 * row renders nothing rather than a disabled toggle.
 */

function ToggleWithState({ initiallyOpen }: { initiallyOpen: boolean }) {
  const [previewOpen, setPreviewOpen] = useState(initiallyOpen);
  return <EditorChromeToggles previewOpen={previewOpen} onTogglePreview={() => setPreviewOpen((open) => !open)} />;
}

const meta = {
  component: EditorChromeToggles,
} satisfies Meta<typeof EditorChromeToggles>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Closed preview: the toggle offers to show it, reports not pressed, and flips on click and from the keyboard. */
export const PreviewClosed: Story = {
  render: () => <ToggleWithState initiallyOpen={false} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const show = canvas.getByRole('button', { name: 'Show live preview' });
    await expect(show).toHaveAttribute('aria-pressed', 'false');
    await expect(show).toHaveAttribute('title', 'Show live preview');

    await userEvent.click(show);
    const hide = canvas.getByRole('button', { name: 'Hide live preview' });
    await expect(hide).toHaveAttribute('aria-pressed', 'true');

    hide.focus();
    await userEvent.keyboard('{Enter}');
    await expect(canvas.getByRole('button', { name: 'Show live preview' })).toHaveFocus();
  },
};

/** Open preview: the toggle offers to hide it and reports pressed. */
export const PreviewOpen: Story = {
  render: () => <ToggleWithState initiallyOpen />,
  play: async ({ canvasElement }) => {
    const hide = within(canvasElement).getByRole('button', { name: 'Hide live preview' });
    await expect(hide).toHaveAttribute('aria-pressed', 'true');
  },
};

/** A surface without live preview passes no state, and nothing renders. */
export const PreviewNotSupported: Story = {
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByRole('button')).toBeNull();
  },
};
