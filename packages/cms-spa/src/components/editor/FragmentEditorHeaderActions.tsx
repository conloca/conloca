import { Check } from 'lucide-react';
import type { SaveState } from '../../types.js';

/** Save edits persists this fragment; the editor's back arrow owns navigation. */
interface FragmentStatusFacts {
  saveState: SaveState;
  isDirty: boolean;
  /** A save has succeeded since this fragment and locale were opened. */
  savedSinceOpen: boolean;
}

/** Fresh edits can be saved immediately; a clean buffer no longer carries an old failure. */
function visibleSaveState(saveState: SaveState, isDirty: boolean): SaveState {
  if (isDirty && saveState === 'saved') return 'idle';
  return !isDirty && (saveState === 'error' || saveState === 'conflict') ? 'idle' : saveState;
}

/** The fragment's save state does not assume which actions an embedding application supplies. */
export function fragmentStatusText({ saveState, isDirty, savedSinceOpen }: FragmentStatusFacts): string {
  const displayState = visibleSaveState(saveState, isDirty);
  if (displayState === 'saving') return 'Saving…';
  if (displayState === 'conflict') return 'Someone else changed this fragment. Your changes are not saved.';
  if (displayState === 'error') return 'Save failed. Your changes are still here.';
  if (isDirty) return 'Unsaved changes.';
  if (savedSinceOpen) return 'All changes saved.';
  return 'No unsaved changes.';
}

function saveButtonLabel(saveState: SaveState): string {
  switch (saveState) {
    case 'saving':
      return 'Saving…';
    case 'saved':
      return 'Saved';
    case 'error':
      return 'Retry save';
    case 'conflict':
      return 'Conflict';
    default:
      return 'Save edits';
  }
}

interface FragmentEditorHeaderActionsProps extends Pick<FragmentStatusFacts, 'saveState' | 'isDirty'> {
  /** The host's chrome is the only save affordance. */
  saveHidden: boolean;
  onSave: () => void;
}

/** Id of the status line, so the control can point at the reason it is disabled. */
export const FRAGMENT_STATUS_ID = 'fragment-editor-status';

export function FragmentEditorHeaderActions({
  saveState,
  isDirty,
  saveHidden,
  onSave,
}: FragmentEditorHeaderActionsProps) {
  const displayState = visibleSaveState(saveState, isDirty);
  const saving = displayState === 'saving';
  if (saveHidden) return null;
  return (
    <button
      type="button"
      onClick={onSave}
      // An in-flight save or a clean buffer has no new write to submit.
      disabled={saving || !isDirty}
      aria-describedby={FRAGMENT_STATUS_ID}
      title="Save your changes to this fragment."
      className="px-3 py-1.5 text-sm bg-accent text-accent-foreground rounded hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1"
      data-testid="fragment-editor-save"
    >
      {displayState === 'saved' && <Check aria-hidden className="h-4 w-4" />}
      {saveButtonLabel(displayState)}
    </button>
  );
}
