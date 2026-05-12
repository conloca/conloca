import { useCallback, useSyncExternalStore } from 'react';

/**
 * Cross-tab-aware boolean preference backed by `localStorage`.
 *
 * Used for editor chrome toggles (preview pane open, auto-save on, etc.)
 * where the preference should persist across reloads and feel sticky from
 * the author's perspective. `useSyncExternalStore` keeps the value in sync
 * with both React renders and external mutations (`storage` events from
 * other tabs, programmatic writes from elsewhere in the app).
 */
const EVENT_NAME = 'conloca:editorPrefChange';

function readPref(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function subscribePref(callback: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.storageArea === window.localStorage) callback();
  };
  window.addEventListener('storage', onStorage);
  window.addEventListener(EVENT_NAME, callback);
  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener(EVENT_NAME, callback);
  };
}

export function useEditorPref(key: string): [boolean, (value: boolean) => void] {
  const value = useSyncExternalStore(
    subscribePref,
    () => readPref(key),
    () => false,
  );

  const setValue = useCallback(
    (next: boolean) => {
      try {
        if (next) {
          window.localStorage.setItem(key, '1');
        } else {
          window.localStorage.removeItem(key);
        }
      } catch {
        // localStorage may be unavailable — ignore.
      }
      window.dispatchEvent(new Event(EVENT_NAME));
    },
    [key],
  );

  return [value, setValue];
}
