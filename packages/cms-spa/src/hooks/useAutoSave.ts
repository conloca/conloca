import { useEffect, useRef } from 'react';

export type AutoSaveStatus = 'saved' | 'conflict' | 'error';

interface UseAutoSaveOptions {
  /** Master toggle. `false` disables the effect entirely. */
  enabled: boolean;
  /** Live editor content. */
  content: string;
  /** True when content differs from the saved-on-disk snapshot. */
  isDirty: boolean;
  /**
   * Persist function. Called with the latest content after the debounce
   * window. The function should already mirror its own outcome onto the
   * editor's save state — auto-save is just a trigger, not a parallel
   * state machine.
   */
  persist: (value: string) => Promise<AutoSaveStatus>;
  /** Pause auto-save while the host editor is already saving. */
  isSaving: boolean;
  /**
   * Debounce window in ms from the last keystroke. 2000ms is a balance
   * between feeling responsive (writers notice "Saved" pills land soon
   * after they pause) and not pummeling the content API on every
   * character.
   */
  debounceMs?: number;
}

/**
 * Debounced auto-save trigger for the MDX editors.
 *
 * Watches `content` while `enabled` is true and the editor is dirty; after
 * `debounceMs` of no further changes, calls `persist`. Skips when the host
 * editor is already saving so two save round-trips can't race. Stale
 * scheduled persists from before a save started are cancelled by the
 * cleanup function — each render schedules a fresh timer keyed off the
 * latest `content`.
 */
export function useAutoSave({ enabled, content, isDirty, persist, isSaving, debounceMs = 2000 }: UseAutoSaveOptions) {
  const persistRef = useRef(persist);
  useEffect(() => {
    persistRef.current = persist;
  }, [persist]);

  useEffect(() => {
    if (!enabled || !isDirty || isSaving) return;
    const handle = window.setTimeout(() => {
      void persistRef.current(content);
    }, debounceMs);
    return () => window.clearTimeout(handle);
  }, [enabled, isDirty, isSaving, content, debounceMs]);
}
