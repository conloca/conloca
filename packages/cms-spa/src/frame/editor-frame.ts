import { readPageConversionFacts } from '../convert-pages.js';
import type {
  DiscardOutcome,
  DraftToolsHost,
  EarlierVersion,
  PageConflict,
  PageRef,
  ResolveConflictInput,
  ResolveConflictOutcome,
  RestoreVersionOutcome,
} from '../draft-tools.js';
import { EDITOR_DIRTY_CHANGED_EVENT, flushOpenEditor, isOpenEditorDirty } from '../editor-flush.js';
import { invalidateEditorQueries } from '../editor-queries.js';
import { createDocChannel, type FrameDocChannel } from '../live/doc-channel.js';
import type { AssetScope, MediaIssue } from '../media/types.js';
import { THEME_CHANGED_EVENT, THEME_STORAGE_KEY } from '../theme.js';
import { setEditorReadOnly, setPageConversion, setPreviewCapability, type UIConfig } from '../ui-config.js';
import { type FrameChannel, type FramePort, openFrameChannel, RpcError } from './channel.js';
import {
  EDITOR_FLUSH_METHOD,
  type FrameEventPayloads,
  type FrameMethod,
  type Init,
  isFramePath,
  isJsonValue,
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
  const capability = 'previewCapability' in value ? value.previewCapability : undefined;
  if (value.ok === true) {
    return capability === undefined || capability === 'available' || capability === 'unknown';
  }
  if (value.ok !== false || !('reason' in value)) return false;
  if (value.reason === 'popup-blocked') return true;
  if (!('message' in value) || typeof value.message !== 'string') return false;
  if (value.reason === 'not-allowed') return capability === undefined || capability === 'unknown';
  return (
    value.reason === 'not-deployed' &&
    (capability === undefined || capability === 'unavailable' || capability === 'unknown')
  );
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

/* oxlint-disable anti-slop/no-unknown-parameters -- the guards below read the parent's answers, untyped off the port. */

function isSide(held: unknown): boolean {
  return held === undefined || isJsonValue(held);
}

function isPageConflict(value: unknown): value is PageConflict {
  if (typeof value !== 'object' || value === null) return false;
  if (!('anchor' in value) || typeof value.anchor !== 'string') return false;
  if (!('valueId' in value) || typeof value.valueId !== 'string') return false;
  if (!('source' in value) || (value.source !== 'github' && value.source !== 'review')) return false;
  if (!('authorLabel' in value) || typeof value.authorLabel !== 'string') return false;
  if (!('createdAt' in value) || typeof value.createdAt !== 'number') return false;
  const sides = ['base' in value ? value.base : undefined, 'ours' in value ? value.ours : undefined];
  return [...sides, 'theirs' in value ? value.theirs : undefined].every(isSide);
}

function isEarlierVersion(value: unknown): value is EarlierVersion {
  if (typeof value !== 'object' || value === null) return false;
  if (!('snapshotId' in value) || typeof value.snapshotId !== 'string') return false;
  if (!('reason' in value) || typeof value.reason !== 'string') return false;
  if (!('authors' in value) || !isStrings(value.authors)) return false;
  if (!('at' in value) || typeof value.at !== 'number') return false;
  if (!('expiresAt' in value) || typeof value.expiresAt !== 'number') return false;
  return 'restorable' in value && typeof value.restorable === 'boolean';
}

function isStrings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function listOf<T>(isItem: (value: unknown) => value is T) {
  return (value: unknown): value is T[] => Array.isArray(value) && value.every(isItem);
}

/** `{ ok: true }`, or a refusal `{ ok: false, reason, message? }` whose reason is one of `reasons`. */
function isOutcome(value: unknown, reasons: readonly string[]): boolean {
  if (typeof value !== 'object' || value === null || !('ok' in value)) return false;
  if (value.ok === true) return true;
  if (value.ok !== false) return false;
  if (!('reason' in value) || typeof value.reason !== 'string' || !reasons.includes(value.reason)) return false;
  return !('message' in value) || value.message === undefined || typeof value.message === 'string';
}

const RESOLVE_REFUSALS = ['changed', 'not-found', 'anchor-gone', 'too-large', 'bad-value', 'refused', 'unknown'];
const DISCARD_REFUSALS = ['kept', 'changed', 'committed', 'not-found', 'refused', 'unknown'];
const RESTORE_REFUSALS = [
  'changed',
  'expired',
  'not-found',
  'not-a-page',
  'too-large',
  'path-taken',
  'refused',
  'unknown',
];

function isResolveOutcome(value: unknown): value is ResolveConflictOutcome {
  return isOutcome(value, RESOLVE_REFUSALS);
}

function isDiscardOutcome(value: unknown): value is DiscardOutcome {
  return isOutcome(value, DISCARD_REFUSALS);
}

function isRestoreOutcome(value: unknown): value is RestoreVersionOutcome {
  if (!isOutcome(value, RESTORE_REFUSALS) || typeof value !== 'object' || value === null) return false;
  // An `ok: true` answer must name the anchors where newer work stayed.
  return !('ok' in value) || value.ok !== true || ('kept' in value && isStrings(value.kept));
}

/* oxlint-enable anti-slop/no-unknown-parameters */

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

/** Untrusted fields understood by config events; each handler validates its field before applying it. */
interface FrameConfigFields {
  readOnly?: unknown;
  pageConversion?: unknown;
  previewCapability?: unknown;
  theme?: unknown;
}

/** Keeps the mount configuration and the running editor on the same preview observation. */
function applyPreviewCapability(payload: FrameConfigFields, config: Partial<UIConfig> | undefined): void {
  if (!('previewCapability' in payload) || !isPreviewCapability(payload.previewCapability)) return;
  // Site installation can still be pending; its eventual configureUI must use this same observation.
  if (config) config.previewCapability = payload.previewCapability;
  setPreviewCapability(payload.previewCapability);
}

/** Configuration events may arrive while the site module is still installing. */
function applyReadOnly(payload: FrameConfigFields, config: Partial<UIConfig> | undefined): void {
  if (!('readOnly' in payload) || !(payload.readOnly === null || isWriteRefusal(payload.readOnly))) return;
  if (config) config.readOnly = payload.readOnly ?? undefined;
  setEditorReadOnly(payload.readOnly);
}

function applyPageConversion(payload: FrameConfigFields, config: Partial<UIConfig> | undefined): void {
  if (!('pageConversion' in payload)) return;
  const facts = readPageConversionFacts(payload.pageConversion);
  if (config) config.pageConversion = facts;
  setPageConversion(facts ?? null);
}

function applyFrameConfig(name: string, payload: FrameConfigFields, config: Partial<UIConfig> | undefined): void {
  switch (name) {
    case 'readOnly.changed':
      applyReadOnly(payload, config);
      break;
    case 'pageConversion.changed':
      applyPageConversion(payload, config);
      break;
    case 'previewCapability.changed':
      applyPreviewCapability(payload, config);
      break;
    case 'theme.changed':
      if ('theme' in payload && isThemePreference(payload.theme)) {
        localStorage.setItem(THEME_STORAGE_KEY, payload.theme);
        window.dispatchEvent(new Event(THEME_CHANGED_EVENT));
      }
      break;
    case 'queries.stale':
      if ('queries' in payload && (payload.queries === 'content' || payload.queries === 'media')) {
        invalidateEditorQueries(payload.queries);
      }
      break;
  }
}

/**
 * A draft-tools write. The parent refuses with an `RpcError` before sending anything (read-only, rate limit), so that
 * is `refused`; any other failure, a closed channel included, leaves the outcome `unknown`.
 */
async function draftWrite<T>(
  channel: FrameChannel,
  method: FrameMethod,
  input: ResolveConflictInput | PageRef | { snapshotId: string },
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- the answer arrives off the port untyped; isAnswer parses it.
  isAnswer: (value: unknown) => value is T,
): Promise<T | { ok: false; reason: 'refused' | 'unknown'; message?: string }> {
  try {
    return await checkedCall(channel, method, input, isAnswer);
  } catch (error) {
    if (error instanceof RpcError) return { ok: false, reason: 'refused', message: error.message };
    return { ok: false, reason: 'unknown' };
  }
}

function draftTools(channel: FrameChannel): DraftToolsHost {
  return {
    listConflicts: (page) => checkedCall(channel, 'conflicts.list', page, listOf(isPageConflict)),
    resolveConflict: (input) => draftWrite(channel, 'conflicts.resolve', input, isResolveOutcome),
    discardPage: (page) => draftWrite(channel, 'pages.discard', page, isDiscardOutcome),
    listVersions: (page) => checkedCall(channel, 'snapshots.list', page, listOf(isEarlierVersion)),
    restoreVersion: (input) => draftWrite(channel, 'snapshots.restore', input, isRestoreOutcome),
  };
}

/**
 * Opens the channel on the port the parent handed over and resolves on the parent's first `init`; later ones are
 * ignored. From then on the parent can flush the open editor, and dirty state and Cmd/Ctrl+S go to the parent.
 * Route, read-only, preview capability, theme and page conversion facts follow the parent's events, and the parent's
 * Save marks the caches it changed stale.
 */
export function connectEditorFrame(port: FramePort): Promise<EditorFrame> {
  const routeListeners = new Set<(path: string) => void>();
  // Executor form: the package's production lib predates Promise.withResolvers.
  return new Promise((resolve) => {
    let frame: EditorFrame | undefined;
    // Built with the parent's first init when it carries docs; until then doc events have no taker, as on an old page.
    let docChannel: FrameDocChannel | null = null;
    const channel = openFrameChannel(port, {
      control(message) {
        if (message.kind !== 'init' || frame) return;
        docChannel = message.docChannel ? createDocChannel(channel) : null;
        frame = start(channel, message, routeListeners, docChannel);
        resolve(frame);
      },
      async call(method) {
        if (method === EDITOR_FLUSH_METHOD) return flushOpenEditor();
        throw new RpcError(`Method not allowed: ${method}`, 'method_not_allowed');
      },
      event(name, payload) {
        if (docChannel?.receive(name, payload)) return;
        if (typeof payload !== 'object' || payload === null) return;
        if (name === 'route.navigate' && 'path' in payload) {
          const { path } = payload;
          if (typeof path === 'string' && isFramePath(path)) for (const listener of routeListeners) listener(path);
        } else {
          applyFrameConfig(name, payload, frame?.config);
        }
      },
    });
  });
}

function start(
  channel: FrameChannel,
  init: Init,
  routeListeners: Set<(path: string) => void>,
  docChannel: FrameDocChannel | null,
): EditorFrame {
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
    ...(init.pageConversion ? { pageConversion: init.pageConversion } : {}),
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
    ...(docChannel ? { docChannel } : {}),
    ...(init.draftTools ? { draftTools: draftTools(channel) } : {}),
  };

  return {
    init,
    config,
    ready: () => channel.post({ kind: 'ready' }),
    reportStale: () => emit('editor.stale', null),
    reportLoadFailed: (stage, message) => emit('load.failed', { stage, message }),
  };
}
