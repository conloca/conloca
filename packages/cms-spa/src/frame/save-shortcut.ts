import { useEffect } from 'react';
import { inEditorFrame } from '../ui-config.js';

/** Whether a key press is Cmd/Ctrl+S. */
export function isSaveCombo(event: KeyboardEvent): boolean {
  return (event.metaKey || event.ctrlKey) && (event.key === 's' || event.key === 'S');
}

/**
 * In a parent frame, hands Cmd/Ctrl+S pressed inside the editing canvas to the editor's `window`, where the frame
 * connection sends it to the parent. The canvas is its own document, so its key presses never reach `window`.
 */
export function useCanvasSaveShortcut(canvasDocument: Document | undefined): void {
  useEffect(() => {
    if (!canvasDocument || !inEditorFrame()) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isSaveCombo(event)) return;
      event.preventDefault();
      const { key, metaKey, ctrlKey } = event;
      window.dispatchEvent(new KeyboardEvent('keydown', { key, metaKey, ctrlKey, cancelable: true }));
    };
    canvasDocument.addEventListener('keydown', onKeyDown);
    return () => canvasDocument.removeEventListener('keydown', onKeyDown);
  }, [canvasDocument]);
}
