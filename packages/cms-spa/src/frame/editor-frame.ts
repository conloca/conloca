import { EDITOR_DIRTY_CHANGED_EVENT, flushOpenEditor, isOpenEditorDirty } from '../editor-flush.js';
import type { AssetScope, MediaIssue } from '../media/types.js';
import { THEME_CHANGED_EVENT, THEME_STORAGE_KEY } from '../theme.js';
import { setEditorReadOnly, setPreviewCapability, type UIConfig } from '../ui-config.js';
import { type FrameChannel, type FramePort, openFrameChannel, RpcError } from './channel.js';
import {
  EDITOR_FLUSH_METHOD,
  type FrameEventPayloads,
  type FrameMethod,
  type Init,
  isFramePath,
  isPreviewCapability,
  isThemePreference,
  isWriteRefusal,
  type PreviewOpenResult,
} from './protocol.js';
import { RpcContentClient } from './rpc-content-client.js';
import { isSaveCombo } from './save-shortcut.js';

/** The editor page's side of its connection to the parent frame, once the parent's settings arrived. */
export interface EditorFrame {
  /** The parent's settings. */
  init: Init;
  /** The `UIConfig` part the page mounts with: content client, memory router, preview and media through the parent. */
  config: Partial<UIConfig>;
  /** Tells the parent the editor is mounted. */
  ready(): void;
  /** Tells the parent this page is out of date and should be reloaded. */
  reportStale(): void;
  /** Tells the parent the page could not load; `message` is for logs, the parent shows its own text. */
  reportLoadFailed(stage: FrameEventPayloads['load.failed']['stage'], message: string): void;
}

function isPreviewOpenResult(value: unknown): value is PreviewOpenResult {
  if (typeof value !== 'object' || value === null || !('ok' in value)) return false;
  if (value.ok === true) return true;
  if (value.ok !== false || !('reason' in value)) return false;
  if (value.reason === 'popup-blocked') return true;
  return value.reason === 'not-deployed' && 'message' in value && typeof value.message === 'string';
}

function isAssetScope(value: unknown): value is AssetScope | null {
  return value === null || value === 'branch' || value === 'published';
}

function isMediaIssue(value: unknown): value is MediaIssue | null {
  if (value === null) return true;
  if (typeof value !== 'object' || !('filename' in value) || typeof value.filename !== 'string') return false;
  if (!('kind' in value)) return false;
  if (value.kind === 'blocked') return 'reason' in value && typeof value.reason === 'string';
  return (
    value.kind === 'oversized' &&
    'sizeBytes' in value &&
    typeof value.sizeBytes === 'number' &&
    'limitBytes' in value &&
    typeof value.limitBytes === 'number'
  );
}

function isBlob(value: unknown): value is Blob {
  return value instanceof Blob;
}

/** Calls the parent and rejects an answer that is not the shape the method promises. */
async function checkedCall<T>(
  channel: FrameChannel,
  method: FrameMethod,
  input: unknown,
  isAnswer: (value: unknown) => value is T,
): Promise<T> {
  const answer = await channel.call(method, [input]);
  if (!isAnswer(answer)) throw new Error(`${method} answered with an unexpected value`);
  return answer;
}

/**
 * Opens the channel on the port the parent handed over and resolves on the parent's first `init`; later ones are
 * ignored. From then on the parent can flush the open editor, and dirty state and Cmd/Ctrl+S go to the parent.
 * Route, read-only, preview capability and theme follow the parent's events.
 */
export function connectEditorFrame(port: FramePort): Promise<EditorFrame> {
  const routeListeners = new Set<(path: string) => void>();
  // Executor form: the package's production lib predates Promise.withResolvers.
  return new Promise((resolve) => {
    let connected = false;
    const channel = openFrameChannel(port, {
      control(message) {
        if (message.kind !== 'init' || connected) return;
        connected = true;
        resolve(start(channel, message, routeListeners));
      },
      async call(method) {
        if (method === EDITOR_FLUSH_METHOD) return flushOpenEditor();
        throw new RpcError(`Method not allowed: ${method}`, 'method_not_allowed');
      },
      event(name, payload) {
        if (typeof payload !== 'object' || payload === null) return;
        if (name === 'route.navigate' && 'path' in payload) {
          const { path } = payload;
          if (typeof path === 'string' && isFramePath(path)) for (const listener of routeListeners) listener(path);
        } else if (
          name === 'readOnly.changed' &&
          'readOnly' in payload &&
          (payload.readOnly === null || isWriteRefusal(payload.readOnly))
        ) {
          setEditorReadOnly(payload.readOnly);
        } else if (
          name === 'previewCapability.changed' &&
          'previewCapability' in payload &&
          isPreviewCapability(payload.previewCapability)
        ) {
          setPreviewCapability(payload.previewCapability);
        } else if (name === 'theme.changed' && 'theme' in payload && isThemePreference(payload.theme)) {
          localStorage.setItem(THEME_STORAGE_KEY, payload.theme);
          window.dispatchEvent(new Event(THEME_CHANGED_EVENT));
        }
      },
    });
  });
}

function start(channel: FrameChannel, init: Init, routeListeners: Set<(path: string) => void>): EditorFrame {
  const emit = <K extends keyof FrameEventPayloads>(name: K, payload: FrameEventPayloads[K]) =>
    channel.emit(name, payload);

  localStorage.setItem(THEME_STORAGE_KEY, init.theme);
  let dirty = false;
  window.addEventListener(EDITOR_DIRTY_CHANGED_EVENT, () => {
    const next = isOpenEditorDirty();
    if (next === dirty) return;
    dirty = next;
    emit('editor.dirty', { dirty });
  });
  window.addEventListener('keydown', (event) => {
    if (!isSaveCombo(event)) return;
    event.preventDefault();
    emit('shortcut.save', null);
  });

  const config: Partial<UIConfig> = {
    contentClient: new RpcContentClient(channel),
    // Always present, so `configureUI` replaces a refusal left from before.
    readOnly: init.readOnly ?? undefined,
    previewCapability: init.previewCapability,
    ...(init.locales ? { locales: init.locales } : {}),
    previewTab: 'parent',
    openSiteUrl: async (input) => {
      await channel.call('site.open', [input]);
    },
    openPreview: (input) => checkedCall(channel, 'preview.open', input, isPreviewOpenResult),
    memoryRouter: {
      initialPath: init.initialPath,
      onNavigate: (path, replace) => {
        // The parent refuses any other route, so it is not sent.
        if (isFramePath(path)) emit('route.changed', { path, replace });
      },
      subscribe: (navigate) => {
        routeListeners.add(navigate);
        return () => routeListeners.delete(navigate);
      },
    },
    ...(init.mediaEnabled
      ? {
          mediaBridge: {
            getAssetScope: (input) => checkedCall(channel, 'mediaBridge.getAssetScope', input, isAssetScope),
            getMediaIssue: (input) => checkedCall(channel, 'mediaBridge.getMediaIssue', input, isMediaIssue),
          },
          loadMedia: (input) => checkedCall(channel, 'media.load', input, isBlob),
        }
      : {}),
  };

  return {
    init,
    config,
    ready: () => channel.post({ kind: 'ready' }),
    reportStale: () => emit('editor.stale', null),
    reportLoadFailed: (stage, message) => emit('load.failed', { stage, message }),
  };
}
