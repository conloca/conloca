/**
 * The editor page's side of the co-edited docs: one replica `Y.Doc` per open doc, kept in step with the parent's over
 * the frame port. Every frame edit is applied to its replica and sent as `doc.update` in the same tick, so the frame
 * owes the parent nothing, except while a replica is held: then its work lives only here, shown with a copy-out notice
 * until the page reloads, and the parent is told through `doc.held`.
 */

import type { ContentData } from '@conloca/content-api';
import { serializeDoc } from '@conloca/content-api/ydoc';
import * as Y from 'yjs';
import type { EditorFlushResult } from '../editor-flush.js';
import type { FrameChannel } from '../frame/channel.js';
import { getUIConfig } from '../ui-config.js';
import {
  type DocOpenRequest,
  type DocOpenResult,
  type LiveMessage,
  type LiveStatus,
  type PresencePeer,
  readLiveMessage,
  readLiveStatus,
} from './messages.js';

/** Edits by this user in this editor. */
export const LOCAL_ORIGIN: unique symbol = Symbol('live-local');
/** Updates that came from the parent. */
export const RELAY_ORIGIN: unique symbol = Symbol('live-relay');
/** `useDocEdit` writes: sent to the parent, tracked by undo, and re-seeding every binding (unlike LOCAL_ORIGIN). */
export const EDIT_ORIGIN: unique symbol = Symbol('live-edit');

export const HELD_TOO_LARGE = 'This change is too large to keep. Copy it out before reloading';
export const HELD_WRITE_FAILED = 'This change could not be applied. Copy your changes, then reload the page.';
const OPEN_CAP_MESSAGE = 'Close the other open fragment to edit this one.';

export interface FrameLiveDoc {
  docKey: string;
  doc: Y.Doc;
  user: { id: string; name: string };
  /** Its work is not in the parent: kept, read-only, until the page reloads. */
  readonly held: boolean;
  /** A binding whose write threw holds its replica with that notice. */
  hold(message: string): void;
  /** Destroys the replica, then closes its key in the parent; a held replica stays. */
  close(): void;
}

export type DocChannelEvents = {
  status: LiveStatus;
  message: LiveMessage;
  peers: { docKey: string; peers: PresencePeer[] };
  /** The parent replaced `docKey` with `live`; the binding moves, then closes the old one. */
  replaced: { docKey: string; live: FrameLiveDoc };
};

export interface DocChannel {
  /** Opens a doc; a held replica of the same page is handed back instead. `signal` closes a result nobody wants. */
  open(req: DocOpenRequest, signal?: AbortSignal): Promise<FrameLiveDoc>;
  /** The parent's answer; never ok on the frame's own say. */
  flush(): Promise<EditorFlushResult>;
  setSelection(docKey: string, blockId: string | null): void;
  /** Null until the first `live.status` event; the parent sends none on subscribe. */
  status(): LiveStatus | null;
  peers(docKey: string): PresencePeer[];
  live(docKey: string): FrameLiveDoc | undefined;
  /** The notice of the first held replica or held values, or null when the frame owes nothing. */
  held(): string | null;
  heldContent(docKey: string): ContentData | null;
  /** Values the editor holds unwritten for `docKey` (invalid data), with their notice; null releases them. */
  setValuesHeld(docKey: string, message: string | null): void;
  on<K extends keyof DocChannelEvents>(type: K, handler: (event: DocChannelEvents[K]) => void): () => void;
}

/** The channel plus its event intake, which the frame's port handler feeds. */
export interface FrameDocChannel extends DocChannel {
  /** Takes a parent event; false when the name is not the doc channel's. */
  receive(name: string, payload: unknown): boolean;
}

interface Replica extends FrameLiveDoc {
  pageId: string;
  heldMessage: string | null;
  /** `close` ran: it sends nothing more, and is destroyed once the parent answers, unless a refusal holds it first. */
  closing: boolean;
}

/* oxlint-disable anti-slop/no-unknown-parameters -- the readers below check what arrives over the port. */
function readOpenResult(value: unknown): DocOpenResult | null {
  if (typeof value !== 'object' || value === null) return null;
  if (!('docKey' in value) || !('update' in value) || !('user' in value) || !('generation' in value)) return null;
  const { docKey, update, user, generation } = value;
  if (typeof docKey !== 'string' || !(update instanceof Uint8Array) || typeof generation !== 'number') return null;
  if (typeof user !== 'object' || user === null || !('id' in user) || !('name' in user)) return null;
  const { id, name } = user;
  if (typeof id !== 'string' || typeof name !== 'string') return null;
  return { docKey, update, generation, user: { id, name } };
}

function readFlush(value: unknown): EditorFlushResult | null {
  if (typeof value !== 'object' || value === null || !('ok' in value)) return null;
  if (value.ok === true) return { ok: true };
  return value.ok === false && 'message' in value && typeof value.message === 'string'
    ? { ok: false, message: value.message }
    : null;
}

function docKeyOf(payload: unknown): string | null {
  return typeof payload === 'object' && payload !== null && 'docKey' in payload && typeof payload.docKey === 'string'
    ? payload.docKey
    : null;
}

function readPeers(value: unknown): PresencePeer[] | null {
  return Array.isArray(value) ? value.filter(isPeer) : null;
}

function isPeer(value: unknown): value is PresencePeer {
  if (typeof value !== 'object' || value === null) return false;
  if (!('clientId' in value) || !('user' in value) || !('selection' in value)) return false;
  const { clientId, user, selection } = value;
  return (
    typeof clientId === 'number' &&
    typeof user === 'object' &&
    user !== null &&
    'id' in user &&
    typeof user.id === 'string' &&
    'name' in user &&
    typeof user.name === 'string' &&
    typeof selection === 'object' &&
    selection !== null &&
    'blockId' in selection &&
    (selection.blockId === null || typeof selection.blockId === 'string')
  );
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
/* oxlint-enable anti-slop/no-unknown-parameters */

/** Each event's subscribers. */
type DocChannelHandlers = { [K in keyof DocChannelEvents]: Set<(event: DocChannelEvents[K]) => void> };

/** The message `useLiveDoc` shows for a refused open. */
export function openFailureMessage(error: unknown): string {
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- a rejection reason is untyped.
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'rate_limited'
    ? OPEN_CAP_MESSAGE
    : messageOf(error);
}

const pageIdOf = (req: DocOpenRequest) => `${req.kind}:${req.id}:${req.locale}`;

export function createDocChannel(channel: FrameChannel): FrameDocChannel {
  const replicas = new Map<string, Replica>();
  const valuesHeld = new Map<string, string>();
  const peers = new Map<string, PresencePeer[]>();
  /** What `doc.held` last told the parent per key. */
  const reported = new Map<string, string | null>();
  let status: LiveStatus | null = null;
  const handlers: DocChannelHandlers = {
    status: new Set(),
    message: new Set(),
    peers: new Set(),
    replaced: new Set(),
  };
  const emit = <K extends keyof DocChannelEvents>(type: K, event: DocChannelEvents[K]) => {
    for (const handler of handlers[type]) handler(event);
  };

  const report = (docKey: string) => {
    const message = replicas.get(docKey)?.heldMessage ?? valuesHeld.get(docKey) ?? null;
    if ((reported.get(docKey) ?? null) === message) return;
    reported.set(docKey, message);
    channel.emit('doc.held', { docKey, held: message !== null, message });
  };

  const refused = () => status?.readOnly?.code === 'update-too-large-unsaved';

  const build = (result: DocOpenResult, pageId: string): Replica => {
    const doc = new Y.Doc({ guid: result.docKey });
    Y.applyUpdate(doc, result.update, RELAY_ORIGIN);
    const replica: Replica = {
      docKey: result.docKey,
      doc,
      user: result.user,
      pageId,
      heldMessage: null,
      closing: false,
      get held() {
        return replica.heldMessage !== null;
      },
      hold(message) {
        if (replica.heldMessage !== null) return;
        replica.heldMessage = message;
        report(replica.docKey);
      },
      close() {
        if (replica.heldMessage !== null || replica.closing || replicas.get(replica.docKey) !== replica) return;
        // Silent from here: the port delivers in order, so no edit under this key can follow the close.
        replica.closing = true;
        // Kept until the parent answers: a refusal of its last edits arrives first and holds it instead.
        void channel
          .call('doc.close', [{ docKey: replica.docKey }])
          .catch(() => {})
          .then(() => {
            if (replica.heldMessage !== null || replicas.get(replica.docKey) !== replica) return;
            replicas.delete(replica.docKey);
            peers.delete(replica.docKey);
            doc.destroy();
          });
      },
    };
    doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === RELAY_ORIGIN || replica.heldMessage !== null || replica.closing) return;
      if (replicas.get(replica.docKey) !== replica) return;
      channel.emit('doc.update', { docKey: replica.docKey, update });
    });
    replicas.set(result.docKey, replica);
    if (refused()) replica.hold(HELD_TOO_LARGE);
    return replica;
  };

  /** The newest held replica of the page: it carries the binding's latest work. */
  const heldReplicaOf = (pageId: string) => {
    let newest: Replica | undefined;
    for (const replica of replicas.values())
      if (replica.pageId === pageId && replica.heldMessage !== null) newest = replica;
    return newest;
  };

  const receive = (name: string, payload: unknown): boolean => {
    switch (name) {
      case 'doc.update': {
        const replica = replicas.get(docKeyOf(payload) ?? '');
        if (!replica || replica.heldMessage !== null) return true;
        const update = typeof payload === 'object' && payload !== null && 'update' in payload ? payload.update : null;
        if (!(update instanceof Uint8Array)) return true;
        try {
          Y.applyUpdate(replica.doc, update, RELAY_ORIGIN);
        } catch (error) {
          console.error('[live] could not apply a parent update', error);
        }
        return true;
      }
      case 'doc.replaced': {
        const replica = replicas.get(docKeyOf(payload) ?? '');
        const next = typeof payload === 'object' && payload !== null && 'next' in payload ? payload.next : null;
        const result = readOpenResult(next);
        if (!replica || !result) return true;
        // The binding stays on the held replica; the new key stays open so the parent keeps the page owed.
        if (replica.heldMessage !== null) return true;
        emit('replaced', { docKey: replica.docKey, live: build(result, replica.pageId) });
        return true;
      }
      case 'presence.peers': {
        const docKey = docKeyOf(payload);
        const list = typeof payload === 'object' && payload !== null && 'peers' in payload ? payload.peers : null;
        const read = readPeers(list);
        if (docKey === null || read === null) return true;
        peers.set(docKey, read);
        emit('peers', { docKey, peers: read });
        return true;
      }
      case 'live.message': {
        const message = readLiveMessage(payload);
        if (message) emit('message', message);
        return true;
      }
      case 'live.status': {
        const next = readLiveStatus(payload);
        if (!next) return true;
        status = next;
        // Page-wide: the frame cannot tell which doc the parent refused, so every replica holds.
        if (refused()) for (const replica of replicas.values()) replica.hold(HELD_TOO_LARGE);
        emit('status', next);
        return true;
      }
      default:
        return false;
    }
  };

  return {
    receive,
    async open(req, signal) {
      const pageId = pageIdOf(req);
      const kept = heldReplicaOf(pageId);
      if (kept) return kept;
      const result = readOpenResult(await channel.call('doc.open', [req]));
      if (!result) throw new Error('The parent answered doc.open with something that is not a doc.');
      if (signal?.aborted) {
        // Nobody holds it: the key closes at once, so it takes no open slot.
        channel.call('doc.close', [{ docKey: result.docKey }]).catch(() => {});
        throw new DOMException('The editor closed before the doc opened.', 'AbortError');
      }
      return build(result, pageId);
    },
    async flush() {
      const held = this.held();
      if (held !== null) return { ok: false, message: held };
      try {
        return readFlush(await channel.call('doc.flush', [])) ?? { ok: false, message: 'Not saved.' };
      } catch (error) {
        return { ok: false, message: messageOf(error) };
      }
    },
    setSelection(docKey, blockId) {
      channel.emit('presence.set', { docKey, selection: { blockId } });
    },
    status: () => status,
    peers: (docKey) => peers.get(docKey) ?? NO_PEERS,
    live(docKey) {
      const replica = replicas.get(docKey);
      // A closing replica sends nothing more: a write into it would answer ok and never leave the frame.
      return replica?.closing && replica.heldMessage === null ? undefined : replica;
    },
    held() {
      for (const replica of replicas.values()) if (replica.heldMessage !== null) return replica.heldMessage;
      for (const message of valuesHeld.values()) return message;
      return null;
    },
    heldContent(docKey) {
      const replica = replicas.get(docKey);
      return replica?.heldMessage == null ? null : serializeDoc(replica.doc);
    },
    setValuesHeld(docKey, message) {
      if (message === null) valuesHeld.delete(docKey);
      else valuesHeld.set(docKey, message);
      report(docKey);
    },
    on(type, handler) {
      handlers[type].add(handler);
      return () => handlers[type].delete(handler);
    },
  };
}

const NO_PEERS: PresencePeer[] = [];

/** The editor's doc channel, or null when the parent carries none (the editor keeps its save path); set once at mount. */
export function useDocChannel(): DocChannel | null {
  return getUIConfig().docChannel ?? null;
}
