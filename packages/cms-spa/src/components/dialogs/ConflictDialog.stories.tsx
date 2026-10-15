import type { UpdateResult } from '@conloca/content-api-client';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import '../../main.css';
import { ConflictDialog } from './ConflictDialog.js';

/**
 * The stale-write dialog an editor opens when its save lost an etag race. The
 * boundary is the `UpdateResult` the content API returned and the three
 * callbacks the editor wires: reload (discard local edits), force save with
 * the server's current etag, or cancel back to editing.
 *
 * Recorded, not invented: the dialog is a labelled modal, but it does not move
 * focus into itself or trap it, so these stories check its name, its keyboard
 * dismissal and its actions — not focus management it does not have.
 */

const CONTENT_CHANGED: UpdateResult = {
  success: false,
  reason: 'stale_write',
  currentEtag: 'etag-server-2',
  conflictDetails: { metaChanged: false, contentChanged: true },
};

const meta = {
  component: ConflictDialog,
  args: {
    conflict: CONTENT_CHANGED,
    onReload: fn(),
    onForceSave: fn(),
    onCancel: fn(),
  },
} satisfies Meta<typeof ConflictDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Force Save overwrites with the etag the server reported; Escape cancels. */
export const ContentChangedElsewhere: Story = {
  play: async ({ args, canvasElement }) => {
    const dialog = within(canvasElement).getByRole('dialog', { name: 'Conflict Detected' });
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    await expect(within(dialog).getByTestId('conflict-details')).toHaveTextContent('Only content has changed.');

    await userEvent.click(within(dialog).getByRole('button', { name: 'Force Save' }));
    await expect(args.onForceSave).toHaveBeenCalledWith('etag-server-2');

    await userEvent.keyboard('{Escape}');
    await expect(args.onCancel).toHaveBeenCalledTimes(1);
    await expect(args.onReload).not.toHaveBeenCalled();
  },
};

/** Reloading discards local edits, so it asks first; backing out of the question changes nothing. */
export const ReloadAsksBeforeDiscarding: Story = {
  play: async ({ args, canvasElement }) => {
    const dialog = within(canvasElement).getByRole('dialog', { name: 'Conflict Detected' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reload and Lose Changes' }));
    await expect(within(dialog).getByTestId('conflict-discard-warning')).toBeVisible();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await expect(args.onReload).not.toHaveBeenCalled();
    await expect(args.onCancel).not.toHaveBeenCalled();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Reload and Lose Changes' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Yes, Reload' }));
    await expect(args.onReload).toHaveBeenCalledTimes(1);
  },
};

/** Changed metadata is listed with the server's current values. */
export const MetadataChangedElsewhere: Story = {
  args: {
    conflict: {
      success: false,
      reason: 'stale_write',
      currentEtag: 'etag-server-3',
      conflictDetails: {
        metaChanged: true,
        contentChanged: true,
        currentMeta: { title: 'Pricing for teams', author: 'Grace Hopper' },
      },
    },
  },
  play: async ({ canvasElement }) => {
    const dialog = within(canvasElement).getByRole('dialog', { name: 'Conflict Detected' });
    await expect(within(dialog).getByTestId('conflict-details')).toHaveTextContent(
      'Both metadata and content have been modified.',
    );
    await expect(dialog).toHaveTextContent('Pricing for teams');
    await expect(dialog).toHaveTextContent('Grace Hopper');
  },
};

/** Without the server's etag there is nothing to overwrite against, so Force Save is not offered. */
export const NoServerEtag: Story = {
  args: { conflict: { success: false, reason: 'stale_write' } },
  play: async ({ canvasElement }) => {
    const dialog = within(canvasElement).getByRole('dialog', { name: 'Conflict Detected' });
    await expect(within(dialog).queryByRole('button', { name: 'Force Save' })).toBeNull();
    await expect(within(dialog).queryByText('Changes detected:')).toBeNull();
  },
};

/** Any outcome other than a stale write is not a conflict: nothing renders. */
export const NotAConflict: Story = {
  args: { conflict: { success: false, reason: 'write_error' } },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByRole('dialog')).toBeNull();
  },
};
