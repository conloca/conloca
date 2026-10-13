export type EditorFlushResult = { ok: true } | { ok: false; message: string };

type FlushHandler = () => Promise<EditorFlushResult>;
type DirtyGetter = () => boolean;

let handler: FlushHandler | null = null;
let dirtyGetter: DirtyGetter | null = null;

/** A host's save control and its Cmd+S handler listen for this to re-read {@link isOpenEditorDirty}. */
export const EDITOR_DIRTY_CHANGED_EVENT = 'conloca:editor-dirty-changed';

export function notifyEditorDirtyChanged(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(EDITOR_DIRTY_CHANGED_EVENT));
}

/**
 * Register the open document editor's flush callback (and optional live dirty
 * getter). A host's save control arms when {@link isOpenEditorDirty} is true,
 * even if the host's own view of saved changes still reads clean. Returns
 * unregister.
 */
export function registerEditorFlushHandler(fn: FlushHandler, options?: { isDirty?: DirtyGetter }): () => void {
  handler = fn;
  dirtyGetter = options?.isDirty ?? null;
  notifyEditorDirtyChanged();
  return () => {
    if (handler === fn) {
      handler = null;
      dirtyGetter = null;
      notifyEditorDirtyChanged();
    }
  };
}

/** True when the mounted editor has in-memory edits not yet flushed. */
export function isOpenEditorDirty(): boolean {
  return dirtyGetter?.() === true;
}

/** Host calls before commit. No editor open → success no-op. */
export async function flushOpenEditor(): Promise<EditorFlushResult> {
  if (!handler) return { ok: true };
  const result = await handler();
  notifyEditorDirtyChanged();
  return result;
}
