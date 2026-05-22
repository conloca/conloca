import { useCallback, useState } from 'react';

/**
 * Generic hook for managing dialog state with open/close functionality.
 * Reduces boilerplate for dialogs that need to track additional data alongside isOpen.
 *
 * @param initialData - The initial state for dialog data (excluding isOpen)
 * @returns Tuple of [state, open, close] where state includes isOpen
 *
 * @example
 * const [deleteDialog, openDeleteDialog, closeDeleteDialog] = useDialogState({
 *   entryId: '',
 *   entryTitle: '',
 * });
 *
 * // Open with data
 * openDeleteDialog({ entryId: '123', entryTitle: 'My Entry' });
 *
 * // Close (resets to initial state)
 * closeDeleteDialog;
 */
export function useDialogState<T extends Record<string, unknown>>(
  initialData: T,
): [T & { isOpen: boolean }, (data: Partial<T>) => void, () => void] {
  const initialState = { ...initialData, isOpen: false as const };
  const [state, setState] = useState<T & { isOpen: boolean }>(initialState);

  const open = useCallback(
    (data: Partial<T>) => {
      setState({ ...initialData, ...data, isOpen: true });
    },
    [initialData],
  );

  const close = useCallback(() => {
    setState({ ...initialData, isOpen: false });
  }, [initialData]);

  return [state, open, close];
}
