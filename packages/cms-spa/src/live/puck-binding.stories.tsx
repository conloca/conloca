import { hydrateDoc } from '@conloca/content-api/ydoc';
import type { Data } from '@puckeditor/core';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import '../main.css';
import type { FrameLiveDoc } from './doc-channel.js';
import { createPuckBinding, PuckHeldNotice } from './puck-binding.js';

const page: Data = { content: [], root: { props: {} } };

const heldLive: FrameLiveDoc = {
  docKey: 'story',
  // Tagged with its kind like every doc the parent serves.
  doc: hydrateDoc({ puckData: page }),
  user: { id: 'u1', name: 'Maria Lopez' },
  held: true,
  hold: () => undefined,
  close: () => undefined,
};

/** The notice above the canvas once a write failed and the replica is held. */
const meta = {
  title: 'Live/PuckHeldNotice',
  component: PuckHeldNotice,
  args: { binding: createPuckBinding(heldLive, page) },
} satisfies Meta<typeof PuckHeldNotice>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Held: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('alert')).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'Copy changes' })).toBeVisible();
  },
};
