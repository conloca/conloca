import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import '../../main.css';
import { UnsavedChangesDialog } from './UnsavedChangesDialog.js';

/**
 * The prompt an editor raises when the author leaves with unsaved edits. The
 * boundary is its three callbacks; what "save" and "discard" do belongs to
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
