/**
 * The contract between the editor page and the parent frame around it: the
 * messages on their shared port, the methods either side may call, and the
 * parent origins the page accepts. Both sides import it from here.
 */
import type { ContentAPIClient } from '@conloca/content-api-client';
import type { ThemePreference } from '../theme.js';
import type { EditorWriteRefusal, PreviewCapability } from '../ui-config.js';

export {
  EDITOR_HOST_PROTOCOL,
  EDITOR_HOST_PROTOCOLS,
  type EditorFrameFailure,
  type EditorHostPageData,
} from '@conloca/content-api-client';
export { CONTENT_METHOD_CLASSIFICATION } from '../write-access.js';

export interface ProtocolRange {
  min: number;
  max: number;
}

export const HELLO_TYPE = 'conloca:hello';

/** The parent's window message; it carries exactly one port. */
export interface Hello {
  type: typeof HELLO_TYPE;
  protocols: ProtocolRange;
}

/** The page's answer to a hello, with the identity its build baked in, so the parent can compare it. */
export interface Accepted {
  kind: 'accepted';
  protocol: number;
  repo: string | null;
  siteId: string;
}

export interface Nack {
  kind: 'nack';
  code: 'origin-rejected' | 'unsupported-protocol';
  /** The protocol the page speaks, sent with `unsupported-protocol`. */
  page?: number;
}

/** The parent's settings, sent once after `accepted`. */
export interface Init {
  kind: 'init';
  initialPath: string;
  readOnly: EditorWriteRefusal | null;
  previewCapability: PreviewCapability;
  theme: ThemePreference;
  locales?: { list: string[]; defaultLocale: string };
  mediaEnabled: boolean;
}

export interface Ready {
  kind: 'ready';
}

export interface Call {
  kind: 'call';
  id: number;
  method: string;
  args: unknown[];
}

export type Result =
  | { kind: 'result'; id: number; ok: true; value: unknown }
  | { kind: 'result'; id: number; ok: false; error: WireError };

export interface FrameEvent {
  kind: 'event';
  name: string;
  payload: unknown;
}

export type ControlMessage = Accepted | Nack | Init | Ready;
export type FrameMessage = ControlMessage | Call | Result | FrameEvent;

/** Codes of the errors the channel itself raises. */
export type RpcErrorCode = 'method_not_allowed' | 'bad_arguments' | 'rate_limited';

/** An error as it crosses the port; the receiving side rebuilds the matching class. */
export interface WireError {
  /** `APIClientError`, `StaleWriteError`, `ContentWriteRefusedError`, `RpcError` or `Error`. */
  name: string;
  message: string;
  /** `APIClientError.code`, or an {@link RpcErrorCode}. */
  code?: string;
  /** `APIClientError.details`. */
  details?: unknown;
  /** `StaleWriteError.data`. */
  data?: unknown;
  /** `ContentWriteRefusedError.method`. */
  method?: string;
  refusal?: { reason: string };
}

/** The argument of `media.load`. */
export interface MediaLoadInput {
  route: 'serve' | 'draft';
  /** Relative to the media root (`uploads/hero.png`): raw, never URL-encoded, no leading slash. */
  path: string;
}

/** The answer to `preview.open`. */
export type PreviewOpenResult =
  | { ok: true }
  | { ok: false; reason: 'not-deployed'; message: string }
  | { ok: false; reason: 'popup-blocked' };

/** The answer to `site.open`; a refused path rejects with `RpcError` `bad_arguments`. */
export type SiteOpenResult = { ok: true } | { ok: false; reason: 'popup-blocked' };

/** Each event name and its payload. */
export interface FrameEventPayloads {
  'editor.dirty': { dirty: boolean };
  'shortcut.save': null;
  'editor.stale': null;
  'load.failed': {
    stage: 'site' | 'css' | 'ui';
    /** For logs; the parent shows its own text. */
    message: string;
  };
  'route.changed': { path: string; replace: boolean };
  'route.navigate': { path: string };
  'readOnly.changed': { readOnly: EditorWriteRefusal | null };
  'previewCapability.changed': { previewCapability: PreviewCapability };
  'theme.changed': { theme: ThemePreference };
}

/** Content methods the page may call; the parent refuses every other client method. */
export const FRAME_CONTENT_METHODS = [
  'getContent',
  'getLocalized',
  'getSitePages',
  'getFragments',
  'getData',
  'getDataCollections',
  'listAllContent',
  'getSitesConfig',
  'getPageByPathname',
  'getFragmentByName',
  'getDataByName',
  'isPathnameAvailable',
  'isDataNameAvailable',
  'compileMDX',
  'createContent',
  'updateLocalized',
  'deleteContent',
  'deleteLocalized',
  'batchUpdate',
  'movePage',
  'listAssets',
  'getAsset',
  'listFolder',
  'getFolderTree',
  'getAssetUsage',
  'uploadAsset',
  'importAssetUrl',
  'deleteAsset',
  'createFolder',
  'updateAssetMetadata',
  'moveAssets',
] as const satisfies readonly (keyof ContentAPIClient)[];

/** Parent-side methods the page may call; `site.open` takes `{ path }`, the page pathname relative to the site base. */
export const FRAME_HOST_METHODS = [
  'mediaBridge.getAssetScope',
  'mediaBridge.getMediaIssue',
  'media.load',
  'preview.open',
  'site.open',
] as const;

/**
 * The parent calls this on the page and gets an `EditorFlushResult`. Its `message` is for logs; the parent shows its
 * own text.
 */
export const EDITOR_FLUSH_METHOD = 'editor.flush';

export type FrameMethod = (typeof FRAME_CONTENT_METHODS)[number] | (typeof FRAME_HOST_METHODS)[number];

/** The most arguments each method takes, as the client declares them. */
export const FRAME_METHOD_MAX_ARGS = {
  getContent: 1,
  getLocalized: 2,
  getSitePages: 2,
  getFragments: 2,
  getData: 2,
  getDataCollections: 0,
  listAllContent: 1,
  getSitesConfig: 0,
  getPageByPathname: 3,
  getFragmentByName: 3,
  getDataByName: 3,
  isPathnameAvailable: 4,
  isDataNameAvailable: 3,
  compileMDX: 1,
  createContent: 1,
  updateLocalized: 1,
  deleteContent: 2,
  deleteLocalized: 1,
  batchUpdate: 1,
  movePage: 5,
  listAssets: 0,
  getAsset: 1,
  listFolder: 1,
  getFolderTree: 0,
  getAssetUsage: 1,
  uploadAsset: 1,
  importAssetUrl: 3,
  deleteAsset: 1,
  createFolder: 1,
  updateAssetMetadata: 2,
  moveAssets: 3,
  'mediaBridge.getAssetScope': 1,
  'mediaBridge.getMediaIssue': 1,
  'media.load': 1,
  'preview.open': 1,
  'site.open': 1,
} as const satisfies Readonly<Record<FrameMethod, number>>;

const FRAME_PATH_RE = /^\/[A-Za-z0-9/_.:%-]{0,512}(\?[A-Za-z0-9_.:%=&-]{0,512})?$/;
const DNS_LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** Whether `path` is an editor route (`pathname + search`) the page may report or the parent may send. */
export function isFramePath(path: string): boolean {
  return FRAME_PATH_RE.test(path) && !path.includes('//');
}

/* oxlint-disable anti-slop/no-unknown-parameters -- the guards below read what arrives on the port, untyped by nature. */

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system';
}

export function isPreviewCapability(value: unknown): value is PreviewCapability {
  return value === 'available' || value === 'unavailable' || value === 'unknown';
}

export function isWriteRefusal(value: unknown): value is EditorWriteRefusal {
  return typeof value === 'object' && value !== null && 'reason' in value && typeof value.reason === 'string';
}

function readLocales(value: unknown): Init['locales'] | undefined {
  if (typeof value !== 'object' || value === null || !('list' in value) || !('defaultLocale' in value))
    return undefined;
  const { list, defaultLocale } = value;
  if (!Array.isArray(list) || typeof defaultLocale !== 'string') return undefined;
  const locales = list.filter((locale): locale is string => typeof locale === 'string');
  return locales.length === list.length ? { list: locales, defaultLocale } : undefined;
}

function readInit(data: unknown): Init | undefined {
  if (typeof data !== 'object' || data === null) return undefined;
  if (!('initialPath' in data) || typeof data.initialPath !== 'string' || !isFramePath(data.initialPath)) {
    return undefined;
  }
  if (!('readOnly' in data) || !(data.readOnly === null || isWriteRefusal(data.readOnly))) return undefined;
  if (!('previewCapability' in data) || !isPreviewCapability(data.previewCapability)) return undefined;
  if (!('theme' in data) || !isThemePreference(data.theme)) return undefined;
  if (!('mediaEnabled' in data) || typeof data.mediaEnabled !== 'boolean') return undefined;
  const init: Init = {
    kind: 'init',
    initialPath: data.initialPath,
    readOnly: data.readOnly,
    previewCapability: data.previewCapability,
    theme: data.theme,
    mediaEnabled: data.mediaEnabled,
  };
  if (!('locales' in data) || data.locales === undefined) return init;
  const locales = readLocales(data.locales);
  return locales ? { ...init, locales } : undefined;
}

/** Reads a control message off the port; `undefined` when `data` is not a well-formed one. */
export function readControlMessage(data: unknown): ControlMessage | undefined {
  if (typeof data !== 'object' || data === null || !('kind' in data)) return undefined;
  switch (data.kind) {
    case 'ready':
      return { kind: 'ready' };
    case 'init':
      return readInit(data);
    case 'accepted':
      if (!('protocol' in data) || typeof data.protocol !== 'number') return undefined;
      if (!('repo' in data) || !(data.repo === null || typeof data.repo === 'string')) return undefined;
      if (!('siteId' in data) || typeof data.siteId !== 'string') return undefined;
      return { kind: 'accepted', protocol: data.protocol, repo: data.repo, siteId: data.siteId };
    case 'nack': {
      if (!('code' in data) || (data.code !== 'origin-rejected' && data.code !== 'unsupported-protocol'))
        return undefined;
      const nack: Nack = { kind: 'nack', code: data.code };
      return 'page' in data && typeof data.page === 'number' ? { ...nack, page: data.page } : nack;
    }
    default:
      return undefined;
  }
}

/* oxlint-enable anti-slop/no-unknown-parameters */

/**
 * Whether the page accepts a hello from `origin`: `https://<label>.<root>` without a port, `<label>` one DNS label
 * that is not reserved. Under a `.localhost` root, `http:` and any port are allowed too.
 */
export function acceptsParentOrigin(origin: string, root: string, isReserved: (label: string) => boolean): boolean {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  const local = root.endsWith('.localhost');
  if (url.origin !== origin) return false;
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) return false;
  if (url.port !== '' && !local) return false;
  const suffix = `.${root}`;
  if (!url.hostname.endsWith(suffix)) return false;
  const label = url.hostname.slice(0, -suffix.length);
  return DNS_LABEL_RE.test(label) && !isReserved(label);
}
