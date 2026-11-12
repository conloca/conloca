import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ComponentProps } from 'react';
import { expect, fn, userEvent, within } from 'storybook/test';
import '../../main.css';
import { FRAGMENT_STATUS_ID, FragmentEditorHeaderActions, fragmentStatusText } from './FragmentEditorHeaderActions.js';

/**
 * The fragment editor's Save edits action and status line in every save state.
 * The real FragmentEditor stories cover the back arrow, its destinations, and all dirty-exit choices.
 * Embedding does not imply an external publication action.
 */

const meta = {
  component: FragmentEditorHeaderActions,
  args: {
    saveState: 'idle',
    isDirty: false,
    saveHidden: false,
    savedSinceOpen: false,
    onSave: fn(),
  },
  render: (args) => (
    <div className="flex items-center gap-4 p-4 bg-overlay">
      <p id={FRAGMENT_STATUS_ID} role="status" className="text-xs text-muted">
        {fragmentStatusText(args)}
      </p>
      <div className="flex items-center gap-2">
        <FragmentEditorHeaderActions {...args} />
      </div>
    </div>
  ),
} satisfies Meta<ComponentProps<typeof FragmentEditorHeaderActions> & { savedSinceOpen: boolean }>;

export default meta;
type Story = StoryObj<typeof meta>;

function saveButton(canvasElement: HTMLElement, name: string) {
  return within(canvasElement).getByRole('button', { name });
}

/** Opened and untouched: nothing to save, so Save edits is disabled and the status line says why. */
export const NothingToSave: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const save = saveButton(canvasElement, 'Save edits');
    await expect(save).toBeDisabled();
    await expect(save).toHaveAccessibleDescription('No unsaved changes.');
    await userEvent.click(save);
    await expect(args.onSave).not.toHaveBeenCalled();
    await expect(canvas.queryByRole('button', { name: /^(Done|Cancel)$/ })).toBeNull();
  },
};

/** Unsaved edits enable Save edits and explain the local save state. */
export const UnsavedEdits: Story = {
  args: { isDirty: true },
  play: async ({ args, canvasElement }) => {
    const save = saveButton(canvasElement, 'Save edits');
    await expect(save).toBeEnabled();
    await expect(save).toHaveAttribute('title', 'Save your changes to this fragment.');
    await expect(save).toHaveAccessibleDescription('Unsaved changes.');
    await userEvent.click(save);
    await expect(args.onSave).toHaveBeenCalledTimes(1);
  },
};

/** An in-flight save cannot be submitted twice; the status line identifies the draft write. */
export const Saving: Story = {
  args: { isDirty: true, saveState: 'saving' },
  play: async ({ canvasElement }) => {
    await expect(saveButton(canvasElement, 'Saving…')).toBeDisabled();
    await expect(within(canvasElement).getByRole('status')).toHaveTextContent('Saving…');
  },
};

/** Just saved: the button settles to Saved, disabled so a click cannot re-send identical content. */
export const JustSaved: Story = {
  args: { saveState: 'saved', savedSinceOpen: true },
  play: async ({ args, canvasElement }) => {
    const saved = saveButton(canvasElement, 'Saved');
    await expect(saved).toBeDisabled();
    await userEvent.click(saved);
    await expect(args.onSave).not.toHaveBeenCalled();
    await expect(within(canvasElement).getByRole('status')).toHaveTextContent('All changes saved.');
  },
};

/** The status remains saved after transient button feedback ends. */
export const SavedAndClean: Story = {
  args: { savedSinceOpen: true },
  play: async ({ canvasElement }) => {
    await expect(saveButton(canvasElement, 'Save edits')).toBeDisabled();
    await expect(within(canvasElement).getByRole('status')).toHaveTextContent('All changes saved.');
  },
};

export const EditsDuringSavedWindow: Story = {
  args: { saveState: 'saved', savedSinceOpen: true, isDirty: true },
  play: async ({ args, canvasElement }) => {
    const saved = saveButton(canvasElement, 'Save edits');
    await expect(saved).toBeEnabled();
    await userEvent.click(saved);
    await expect(args.onSave).toHaveBeenCalledTimes(1);
    await expect(within(canvasElement).getByRole('status')).toHaveTextContent('Unsaved changes.');
  },
};

/** A failed save keeps the edits and stays clickable so the same content can be retried. */
export const RetryableSaveError: Story = {
  args: { isDirty: true, saveState: 'error' },
  play: async ({ args, canvasElement }) => {
    const retry = saveButton(canvasElement, 'Retry save');
    await expect(retry).toBeEnabled();
    await expect(within(canvasElement).getByRole('status')).toHaveTextContent(
      'Save failed. Your changes are still here.',
    );
    await userEvent.click(retry);
    await expect(args.onSave).toHaveBeenCalledTimes(1);
  },
};

/** A save refused as stale says Conflict and nothing was saved. */
export const SaveConflict: Story = {
  args: { isDirty: true, saveState: 'conflict' },
  play: async ({ args, canvasElement }) => {
    const conflict = saveButton(canvasElement, 'Conflict');
    await expect(conflict).toBeEnabled();
    await expect(within(canvasElement).getByRole('status')).toHaveTextContent(
      'Someone else changed this fragment. Your changes are not saved.',
    );
    await userEvent.click(conflict);
    await expect(args.onSave).toHaveBeenCalledTimes(1);
  },
};

/** Standalone editors use Save edits without offering a separate Publish action. */
export const StandaloneHasNoPublishStep: Story = {
  args: { isDirty: true, savedSinceOpen: true },
  play: async ({ canvasElement }) => {
    const save = saveButton(canvasElement, 'Save edits');
    await expect(save).toHaveAttribute('title', 'Save your changes to this fragment.');
    await expect(within(canvasElement).getByRole('status')).toHaveTextContent('Unsaved changes.');
    await expect(canvasElement).not.toHaveTextContent('Publish');
  },
};

/** A host whose chrome owns saving hides the local action while the status remains readable. */
export const SaveHiddenByHost: Story = {
  args: { saveHidden: true, isDirty: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByRole('button', { name: /^Save/ })).toBeNull();
    await expect(canvas.queryAllByRole('button')).toHaveLength(0);
    await expect(canvas.getByRole('status')).toHaveTextContent('Unsaved changes.');
  },
};

/** A clean buffer has no failed edits to retry. */
export const CleanAfterFailure: Story = {
  args: { isDirty: false, saveState: 'error' },
  play: async ({ canvasElement }) => {
    await expect(saveButton(canvasElement, 'Save edits')).toBeDisabled();
    await expect(within(canvasElement).getByRole('status')).toHaveTextContent('No unsaved changes.');
  },
};

/** A clean buffer does not claim unsaved conflicting changes. */
export const CleanAfterConflict: Story = {
  ...CleanAfterFailure,
  args: { isDirty: false, saveState: 'conflict' },
};
