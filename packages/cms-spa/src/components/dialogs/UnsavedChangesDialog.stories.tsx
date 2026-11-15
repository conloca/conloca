import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import { createFakeDocChannel } from '../../../test/fake-doc-channel.js';
import type { EditorFlushResult } from '../../editor-flush.js';
import '../../main.css';
import { configureUI, getUIConfig } from '../../ui-config.js';
import { UnsavedChangesDialog } from './UnsavedChangesDialog.js';

/**
 * The prompt an editor raises when the author leaves with unsaved edits. The
 * boundary covers its exit variant, pending controls, and three callbacks; what "save" and "discard" do belongs to
 * the editor that wires them.
 *
 * Recorded, not invented: this prompt is a styled overlay, not a dialog — it
 * has no `dialog` role, no accessible name, no Escape handling and no focus
 * management. These stories check only what it offers: three named actions
 * and a named close control.
 */

const meta = {
  component: UnsavedChangesDialog,
  args: { onSave: fn(), onDiscard: fn(), onCancel: fn() },
} satisfies Meta<typeof UnsavedChangesDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SaveAndContinue: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('heading', { name: 'Unsaved Changes' })).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: 'Save & Continue' }));
    await expect(args.onSave).toHaveBeenCalledTimes(1);
    await expect(args.onDiscard).not.toHaveBeenCalled();
  },
};

export const DiscardChanges: Story = {
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Discard Changes' }));
    await expect(args.onDiscard).toHaveBeenCalledTimes(1);
    await expect(args.onSave).not.toHaveBeenCalled();
  },
};

/** Both the Cancel button and the close icon keep the author where they are. */
export const StayOnThePage: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Cancel' }));
    await userEvent.click(canvas.getByRole('button', { name: 'Close dialog' }));
    await expect(args.onCancel).toHaveBeenCalledTimes(2);
    await expect(args.onSave).not.toHaveBeenCalled();
    await expect(args.onDiscard).not.toHaveBeenCalled();
  },
};

export const BackNavigation: Story = {
  args: { backNavigation: true },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('heading', { name: 'Discard changes?' })).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'Continue editing' })).toBeEnabled();
    await expect(canvas.getByRole('button', { name: 'Discard changes' })).toBeEnabled();
    await userEvent.click(canvas.getByRole('button', { name: 'Save and go back' }));
    await expect(args.onSave).toHaveBeenCalledTimes(1);
  },
};

export const PendingSave: Story = {
  args: { pending: true },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('button', { name: 'Save & Continue' })).toBeDisabled();
    const discard = canvas.getByRole('button', { name: 'Discard Changes' });
    await expect(discard).toBeDisabled();
    await userEvent.click(discard);
    await userEvent.click(canvas.getByRole('button', { name: 'Cancel' }));
    await userEvent.click(canvas.getByRole('button', { name: 'Close dialog' }));
    await expect(args.onCancel).toHaveBeenCalledTimes(2);
    await expect(args.onSave).not.toHaveBeenCalled();
    await expect(args.onDiscard).not.toHaveBeenCalled();
  },
};

export const PendingBackNavigation: Story = {
  args: { pending: true, backNavigation: true },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('heading', { name: 'Discard changes?' })).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'Save and go back' })).toBeDisabled();
    await expect(canvas.getByRole('button', { name: 'Discard changes' })).toBeDisabled();
    await userEvent.click(canvas.getByRole('button', { name: 'Continue editing' }));
    await expect(args.onCancel).toHaveBeenCalledTimes(1);
    await expect(args.onSave).not.toHaveBeenCalled();
    await expect(args.onDiscard).not.toHaveBeenCalled();
  },
};

/** Live: edits the server has not acknowledged and this device could not keep. */
const unsynced = (flush: () => Promise<EditorFlushResult>) => () => {
  const previous = getUIConfig();
  const fake = createFakeDocChannel({}, { flush });
  fake.channel.receive('live.status', { connection: 'syncing', pending: true, persisted: false, readOnly: null });
  configureUI({ ...previous, docChannel: fake.channel });
  return () => configureUI(previous);
};

export const Unsynced: Story = {
  args: { live: true },
  beforeEach: unsynced(async () => ({ ok: true })),
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('heading', { name: 'Changes not synced yet' })).toBeVisible();
    await expect(
      canvas.getByText("Some edits haven't reached the server and can't be kept on this device."),
    ).toBeVisible();
    await expect(canvas.getAllByRole('button').map((button) => button.textContent)).toEqual([
      '',
      'Stay',
      'Leave anyway',
      'Sync and continue',
    ]);
    await userEvent.click(canvas.getByRole('button', { name: 'Sync and continue' }));
    await waitFor(() => expect(args.onDiscard).toHaveBeenCalledTimes(1));
    await expect(args.onSave).not.toHaveBeenCalled();
  },
};

export const UnsyncedStayAndLeave: Story = {
  args: { live: true },
  beforeEach: unsynced(async () => ({ ok: true })),
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Stay' }));
    await expect(args.onCancel).toHaveBeenCalledTimes(1);
    await userEvent.click(canvas.getByRole('button', { name: 'Leave anyway' }));
    await expect(args.onDiscard).toHaveBeenCalledTimes(1);
  },
};

export const UnsyncedFlushFails: Story = {
  args: { live: true },
  beforeEach: unsynced(async () => ({ ok: false, message: 'The connection dropped. Try again.' })),
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Sync and continue' }));
    await expect(await canvas.findByRole('alert')).toHaveTextContent('The connection dropped. Try again.');
    await expect(canvas.getByRole('heading', { name: 'Changes not synced yet' })).toBeVisible();
    await expect(args.onDiscard).not.toHaveBeenCalled();
  },
};

/** An editor saving with Save keeps Save inside a live frame: the channel's status is not its own. */
export const SaveEditorInsideALiveFrame: Story = {
  beforeEach: unsynced(async () => ({ ok: true })),
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('heading', { name: 'Unsaved Changes' })).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: 'Save & Continue' }));
    await expect(args.onSave).toHaveBeenCalledTimes(1);
  },
};
