/**
 * The shared-session messages: what the server tells an open page, and what the parent tells the editor page about
 * its docs over the frame port. Both sides read them with the guards below.
 */

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

type PageRef = { site: string; id: string; locale: string };

type RefusalStatus = 400 | 401 | 402 | 403 | 404 | 413;
type RefusalCode = 'editor-auth-required' | 'update-too-large' | 'too-large' | 'invalid-update';

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
   * A page edited here was deleted on the server: its changes can never be sent, so they are kept on this device for
   * download and do not hold a save back. Named until the download is taken or dismissed. Absent from senders that
   * predate it, which name none.
   */
  deletedExport?: { message: string } | null;
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

const REFUSAL_STATUSES = new Set<unknown>([400, 401, 402, 403, 404, 413]);
const REFUSAL_CODES = new Set<unknown>(['editor-auth-required', 'update-too-large', 'too-large', 'invalid-update']);
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
  if (!isGeneration(generation) || byName === false || byUserId === false || staleSnapshotId === false) {
    return undefined;
  }
  return {
    ...page,
    type: 'conloca:discarded',
    generation,
    ...(byName === undefined ? {} : { byName }),
    ...(byUserId === undefined ? {} : { byUserId }),
    ...(staleSnapshotId === undefined ? {} : { staleSnapshotId }),
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
  return { ...page, type: 'conloca:live-hello', generation: data.generation, user, access: data.access };
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

function readDeletedExport(data: unknown): LiveStatus['deletedExport'] | undefined {
  if (data === null || data === undefined) return null;
  if (!isFields(data) || typeof data.message !== 'string') return undefined;
  return { message: data.message };
}

/** Reads a live status event; `undefined` when `data` is not a well-formed one. */
export function readLiveStatus(data: unknown): LiveStatus | undefined {
  if (!isFields(data) || !isConnection(data.connection)) return undefined;
  if (typeof data.pending !== 'boolean' || typeof data.persisted !== 'boolean') return undefined;
  const readOnly = readReadOnly(data.readOnly);
  if (readOnly === undefined) return undefined;
  const deletedExport = readDeletedExport(data.deletedExport);
  if (deletedExport === undefined) return undefined;
  return { connection: data.connection, pending: data.pending, persisted: data.persisted, readOnly, deletedExport };
}

/* oxlint-enable anti-slop/no-unknown-parameters */
