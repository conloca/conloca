/**
 * The shared-session messages: what the server tells an open page, and what the parent tells the editor page about
 * its docs over the frame port. Both sides read them with the guards below.
 */

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

type PageRef = { site: string; id: string; locale: string };

type RefusalStatus = 400 | 401 | 402 | 403 | 404 | 413 | 503;
/** `too-large`: the page is over the server's size limit; `busy`: the server has no room to load it now. */
type RefusalCode = 'editor-auth-required' | 'update-too-large' | 'too-large' | 'busy' | 'invalid-update';

/**
 * `both-kept`: both values are in the list; `change-stands`: told to the one who removed it; `rehomed`: written into a
 * list another writer turned into items, so it moved to the end; `unknown`: only the list is known.
 */
type ChangedTogetherOutcome = 'both-kept' | 'change-stands' | 'rehomed' | 'unknown';

const CHANGED_TOGETHER_OUTCOMES: readonly ChangedTogetherOutcome[] = [
  'both-kept',
  'change-stands',
  'rehomed',
  'unknown',
];

export type LiveMessage = PageRef &
  (
    | { type: 'conloca:merged'; source: 'github' | 'agent' | 'review'; commit?: string; byName: string }
    | { type: 'conloca:conflict'; open: boolean; anchors: string[] }
    | {
        type: 'conloca:overwritten';
        anchor: string;
        value: JsonValue | null;
        byUserId: string;
        byName: string;
        /** Absent: not restorable (the snapshot cap was full). */
        snapshotId?: string;
      }
    | {
        type: 'conloca:discarded';
        generation: number;
        /** Who discarded; absent for a tab refused later as stale, which is told only that. */
        byName?: string;
        byUserId?: string;
        staleSnapshotId?: string;
        /** The state vector (base64) of the page kept from before the bump: owed work posts its diff against it. */
        sv?: string;
      }
    | {
        /** Two writers changed one entry of a list of primitives at once; every change stayed in the list. */
        type: 'conloca:changed-together';
        anchor: string;
        outcome: ChangedTogetherOutcome;
        /** The entry's value, its first 200 characters. */
        value?: string;
        byUserId?: string;
        byName?: string;
      }
    | { type: 'conloca:refused'; status: RefusalStatus; code?: RefusalCode; message?: string; snapshotId?: string }
  );

/** The first message of a co-editing connection; not the frame handshake's `HELLO_TYPE`. */
export type LiveHello = PageRef & {
  type: 'conloca:live-hello';
  /** The generation the server bound this connection to. */
  generation: number;
  user: { id: string; name: string };
  access: 'write' | 'read';
  /** The largest update the server takes on this connection; absent from an older server (the client's default). */
  updateMaxBytes?: number;
};

export interface LiveStatus {
  connection: 'connected' | 'syncing' | 'offline' | 'read-only';
  /** Local updates the server has not acknowledged. */
  pending: boolean;
  /** Local persistence opened for every open doc. */
  persisted: boolean;
  readOnly: {
    status: RefusalStatus;
    code?: RefusalCode | 'update-too-large-unsaved';
    message?: string;
    snapshotId?: string;
  } | null;
  /**
   * Work edited here that can never be sent now: a page deleted on the server, or stored work from before a reload
   * that the server refused. It is kept on this device for download and does not hold a save back. Named until the
   * download is taken, dismissed or discarded. Absent from senders that predate it, which name none.
   */
  deletedExport?: { message: string } | null;
  /**
   * Something the editor page should tell the user beside the page's own state, which `connection` and `readOnly` keep
   * naming: work the frame holds that it could not report (`unreported`), work it holds with its copy-out notice
   * (`held`), held work a frame reload dropped (`lost-on-reload`), or earlier work stored on this device that could not
   * be read (`stored-unread`). Absent from parents that predate it.
   */
  notice?: LiveNotice | null;
}

export interface LiveNotice {
  kind: 'unreported' | 'held' | 'lost-on-reload' | 'stored-unread';
  message: string;
}

export interface PresencePeer {
  clientId: number;
  user: { id: string; name: string };
  selection: { blockId: string | null };
}

export interface DocOpenRequest {
  kind: 'puck' | 'mdx' | 'data';
  id: string;
  locale: string;
}

export interface DocOpenResult {
  /** `${kind}:${siteId}:${id}:${locale}#${generation}`, also the doc's guid. */
  docKey: string;
  generation: number;
  update: Uint8Array;
  user: { id: string; name: string };
}

/* oxlint-disable anti-slop/no-unknown-parameters -- the guards below read what arrives off the wire, untyped by nature. */

// oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- a raw payload only while the readers below check every field they return.
type Fields = Record<string, unknown>;

function isFields(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const REFUSAL_STATUSES = new Set<unknown>([400, 401, 402, 403, 404, 413, 503]);
const REFUSAL_CODES = new Set<unknown>([
  'editor-auth-required',
  'update-too-large',
  'too-large',
  'busy',
  'invalid-update',
]);
const MERGE_SOURCES = new Set<unknown>(['github', 'agent', 'review']);
const CONNECTIONS = new Set<unknown>(['connected', 'syncing', 'offline', 'read-only']);

function isRefusalStatus(value: unknown): value is RefusalStatus {
  return REFUSAL_STATUSES.has(value);
}
function isRefusalCode(value: unknown): value is RefusalCode {
  return REFUSAL_CODES.has(value);
}
function isMergeSource(value: unknown): value is 'github' | 'agent' | 'review' {
  return MERGE_SOURCES.has(value);
}
function isConnection(value: unknown): value is LiveStatus['connection'] {
  return CONNECTIONS.has(value);
}
/** Whether `value` is JSON all the way down (finite numbers, plain objects); a value read off a port can be anything. */
export function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  return isFields(value) && Object.values(value).every(isJsonValue);
}
function isGeneration(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/** `undefined` when absent, `false` when present but not a string. */
function optionalString(data: Fields, key: string): string | undefined | false {
  if (!(key in data) || data[key] === undefined) return undefined;
  return typeof data[key] === 'string' ? data[key] : false;
}

function readPageRef(data: Fields): PageRef | undefined {
  const { site, id, locale } = data;
  if (typeof site !== 'string' || typeof id !== 'string' || typeof locale !== 'string') return undefined;
  return { site, id, locale };
}

function readUser(value: unknown): { id: string; name: string } | undefined {
  if (!isFields(value) || typeof value.id !== 'string' || typeof value.name !== 'string') return undefined;
  return { id: value.id, name: value.name };
}

function readRefused(page: PageRef, data: Fields): LiveMessage | undefined {
  if (!isRefusalStatus(data.status)) return undefined;
  const message = optionalString(data, 'message');
  const snapshotId = optionalString(data, 'snapshotId');
  if (message === false || snapshotId === false) return undefined;
  if (data.code !== undefined && !isRefusalCode(data.code)) return undefined;
  return {
    ...page,
    type: 'conloca:refused',
    status: data.status,
    ...(data.code === undefined ? {} : { code: data.code }),
    ...(message === undefined ? {} : { message }),
    ...(snapshotId === undefined ? {} : { snapshotId }),
  };
}

function readOverwritten(page: PageRef, data: Fields): LiveMessage | undefined {
  const { anchor, value, byUserId, byName } = data;
  if (typeof anchor !== 'string' || typeof byUserId !== 'string' || typeof byName !== 'string') return undefined;
  if (!isJsonValue(value)) return undefined;
  const snapshotId = optionalString(data, 'snapshotId');
  if (snapshotId === false) return undefined;
  return {
    ...page,
    type: 'conloca:overwritten',
    anchor,
    value,
    byUserId,
    byName,
    ...(snapshotId === undefined ? {} : { snapshotId }),
  };
}

function readDiscarded(page: PageRef, data: Fields): LiveMessage | undefined {
  const { generation } = data;
  const byName = optionalString(data, 'byName');
  const byUserId = optionalString(data, 'byUserId');
  const staleSnapshotId = optionalString(data, 'staleSnapshotId');
  const sv = optionalString(data, 'sv');
  if (
    !isGeneration(generation) ||
    byName === false ||
    byUserId === false ||
    staleSnapshotId === false ||
    sv === false
  ) {
    return undefined;
  }
  return {
    ...page,
    type: 'conloca:discarded',
    generation,
    ...(byName === undefined ? {} : { byName }),
    ...(byUserId === undefined ? {} : { byUserId }),
    ...(staleSnapshotId === undefined ? {} : { staleSnapshotId }),
    ...(sv === undefined ? {} : { sv }),
  };
}

function readChangedTogether(page: PageRef, data: Fields): LiveMessage | undefined {
  const { anchor, outcome } = data;
  const value = optionalString(data, 'value');
  const byUserId = optionalString(data, 'byUserId');
  const byName = optionalString(data, 'byName');
  if (typeof anchor !== 'string' || value === false || byUserId === false || byName === false) return undefined;
  const known = CHANGED_TOGETHER_OUTCOMES.find((candidate) => candidate === outcome);
  if (known === undefined) return undefined;
  return {
    ...page,
    type: 'conloca:changed-together',
    anchor,
    outcome: known,
    ...(value === undefined ? {} : { value }),
    ...(byUserId === undefined ? {} : { byUserId }),
    ...(byName === undefined ? {} : { byName }),
  };
}

/** Reads a server message; `undefined` when `data` is not a well-formed one. */
export function readLiveMessage(data: unknown): LiveMessage | undefined {
  if (!isFields(data)) return undefined;
  const page = readPageRef(data);
  if (!page) return undefined;
  switch (data.type) {
    case 'conloca:merged': {
      const commit = optionalString(data, 'commit');
      if (!isMergeSource(data.source) || typeof data.byName !== 'string' || commit === false) return undefined;
      return {
        ...page,
        type: 'conloca:merged',
        source: data.source,
        byName: data.byName,
        ...(commit === undefined ? {} : { commit }),
      };
    }
    case 'conloca:conflict': {
      const { open, anchors } = data;
      if (typeof open !== 'boolean' || !Array.isArray(anchors)) return undefined;
      const strings = anchors.filter((anchor): anchor is string => typeof anchor === 'string');
      return strings.length === anchors.length
        ? { ...page, type: 'conloca:conflict', open, anchors: strings }
        : undefined;
    }
    case 'conloca:overwritten':
      return readOverwritten(page, data);
    case 'conloca:discarded':
      return readDiscarded(page, data);
    case 'conloca:changed-together':
      return readChangedTogether(page, data);
    case 'conloca:refused':
      return readRefused(page, data);
    default:
      return undefined;
  }
}

/** Reads a co-editing connection's hello; `undefined` when `data` is not a well-formed one. */
export function readLiveHello(data: unknown): LiveHello | undefined {
  if (!isFields(data) || data.type !== 'conloca:live-hello') return undefined;
  const page = readPageRef(data);
  const user = readUser(data.user);
  if (!page || !user || !isGeneration(data.generation)) return undefined;
  if (data.access !== 'write' && data.access !== 'read') return undefined;
  const hello: LiveHello = {
    ...page,
    type: 'conloca:live-hello',
    generation: data.generation,
    user,
    access: data.access,
  };
  const cap = data.updateMaxBytes;
  return typeof cap === 'number' && Number.isSafeInteger(cap) && cap > 0 ? { ...hello, updateMaxBytes: cap } : hello;
}

function readReadOnly(value: unknown): LiveStatus['readOnly'] | undefined {
  if (value === null) return null;
  if (!isFields(value) || !isRefusalStatus(value.status)) return undefined;
  const { code } = value;
  if (code !== undefined && !isRefusalCode(code) && code !== 'update-too-large-unsaved') return undefined;
  const message = optionalString(value, 'message');
  const snapshotId = optionalString(value, 'snapshotId');
  if (message === false || snapshotId === false) return undefined;
  return {
    status: value.status,
    ...(code === undefined ? {} : { code }),
    ...(message === undefined ? {} : { message }),
    ...(snapshotId === undefined ? {} : { snapshotId }),
  };
}

function readNotice(value: unknown): LiveNotice | null | undefined {
  if (value === null) return null;
  if (!isFields(value) || typeof value.message !== 'string') return undefined;
  const { kind, message } = value;
  return kind === 'unreported' || kind === 'held' || kind === 'lost-on-reload' || kind === 'stored-unread'
    ? { kind, message }
    : undefined;
}

function readDeletedExport(data: unknown): LiveStatus['deletedExport'] | undefined {
  if (data === null || data === undefined) return null;
  if (!isFields(data) || typeof data.message !== 'string') return undefined;
  return { message: data.message };
}

/** Reads a live status event; `undefined` when `data` is not a well-formed one. An unreadable notice is left out. */
export function readLiveStatus(data: unknown): LiveStatus | undefined {
  if (!isFields(data) || !isConnection(data.connection)) return undefined;
  if (typeof data.pending !== 'boolean' || typeof data.persisted !== 'boolean') return undefined;
  const readOnly = readReadOnly(data.readOnly);
  if (readOnly === undefined) return undefined;
  const deletedExport = readDeletedExport(data.deletedExport);
  if (deletedExport === undefined) return undefined;
  const notice = readNotice(data.notice);
  return {
    connection: data.connection,
    pending: data.pending,
    persisted: data.persisted,
    readOnly,
    deletedExport,
    ...(notice === undefined ? {} : { notice }),
  };
}

/* oxlint-enable anti-slop/no-unknown-parameters */
