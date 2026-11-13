/**
 * A doc channel for stories and tests: the real `createDocChannel` over an in-memory parent that holds one `Y.Doc` per
 * key and answers synchronously. Not exported from the package.
 */

import type { ContentData } from '@conloca/content-api';
import { hydrateDoc } from '@conloca/content-api/ydoc';
import * as Y from 'yjs';
import type { EditorFlushResult } from '../src/editor-flush.js';
import type { FrameChannel } from '../src/frame/channel.js';
import { createDocChannel, type FrameDocChannel } from '../src/live/doc-channel.js';
import type { DocOpenRequest, DocOpenResult, LiveMessage } from '../src/live/messages.js';

const FROM_FRAME = Symbol('from-frame');
const USER = { id: 'u1', name: 'Ann' };

export interface FakeDocChannelOptions {
  /** `doc.open` rejects with it. */
  refuseOpen?: Error;
  /** `doc.open` answers only on `releaseOpens()`. */
  holdOpen?: boolean;
  flush?: () => Promise<EditorFlushResult>;
}

export interface FakeDocChannel {
  channel: FrameDocChannel;
  /** The parent's doc behind `docKey`. */
  parent(docKey: string): Y.Doc;
  /** A teammate's change arriving through the parent. */
  parentEdit(docKey: string, change: (doc: Y.Doc) => void): void;
  /** The parent discards `docKey`: a new generation from `content`; returns the new key. */
  replace(docKey: string, content: ContentData): string;
  emit(message: LiveMessage): void;
  releaseOpens(): void;
  updates(): { docKey: string; update: Uint8Array }[];
  closes(): string[];
  held(): { docKey: string; held: boolean; message: string | null }[];
}

export function createFakeDocChannel(content: ContentData, options: FakeDocChannelOptions = {}): FakeDocChannel {
  const docs = new Map<string, Y.Doc>();
  const updates: { docKey: string; update: Uint8Array }[] = [];
  const closes: string[] = [];
  const held: { docKey: string; held: boolean; message: string | null }[] = [];
  const waiting: (() => void)[] = [];
  let generation = 0;
  let channel: FrameDocChannel | undefined;

  const resultOf = (docKey: string): DocOpenResult => ({
    docKey,
    generation,
    update: Y.encodeStateAsUpdate(docOf(docKey)),
    user: USER,
  });
  const docOf = (docKey: string) => {
    const doc = docs.get(docKey);
    if (!doc) throw new Error(`no parent doc ${docKey}`);
    return doc;
  };
  const create = (req: Pick<DocOpenRequest, 'kind' | 'id' | 'locale'>, from: ContentData): string => {
    generation += 1;
    const docKey = `${req.kind}:web:${req.id}:${req.locale}#${generation}`;
    const doc = hydrateDoc(from);
    doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin !== FROM_FRAME) channel?.receive('doc.update', { docKey, update });
    });
    docs.set(docKey, doc);
    return docKey;
  };

  const frame: FrameChannel = {
    async call(method, args = []) {
      if (method === 'doc.flush') return options.flush ? options.flush() : { ok: true };
      if (method === 'doc.close') {
        const [arg] = args;
        if (typeof arg === 'object' && arg !== null && 'docKey' in arg && typeof arg.docKey === 'string') {
          closes.push(arg.docKey);
        }
        return undefined;
      }
      if (method !== 'doc.open') throw new Error(`unexpected call ${method}`);
      if (options.refuseOpen) throw options.refuseOpen;
      const [req] = args;
      if (typeof req !== 'object' || req === null || !('kind' in req) || !('id' in req) || !('locale' in req)) {
        throw new Error('doc.open takes { kind, id, locale }');
      }
      const { kind, id, locale } = req;
      if (
        (kind !== 'puck' && kind !== 'mdx' && kind !== 'data') ||
        typeof id !== 'string' ||
        typeof locale !== 'string'
      ) {
        throw new Error('doc.open takes { kind, id, locale }');
      }
      const docKey = create({ kind, id, locale }, content);
      if (options.holdOpen) await new Promise<void>((resolve) => waiting.push(resolve));
      return resultOf(docKey);
    },
    emit(name, payload) {
      if (typeof payload !== 'object' || payload === null || !('docKey' in payload)) return;
      const { docKey } = payload;
      if (typeof docKey !== 'string') return;
      if (name === 'doc.update' && 'update' in payload && payload.update instanceof Uint8Array) {
        updates.push({ docKey, update: payload.update });
        Y.applyUpdate(docOf(docKey), payload.update, FROM_FRAME);
      } else if (name === 'doc.held' && 'held' in payload && 'message' in payload) {
        const message = typeof payload.message === 'string' ? payload.message : null;
        held.push({ docKey, held: payload.held === true, message });
      }
    },
    post() {},
    close() {},
  };
  channel = createDocChannel(frame);
  const live = channel;

  return {
    channel: live,
    parent: docOf,
    parentEdit(docKey, change) {
      const doc = docOf(docKey);
      doc.transact(() => change(doc));
    },
    replace(docKey, next) {
      const [kind, , id, rest] = docKey.split(':');
      const locale = rest?.split('#')[0] ?? 'en';
      if (kind !== 'puck' && kind !== 'mdx' && kind !== 'data') throw new Error(`bad key ${docKey}`);
      const nextKey = create({ kind, id: id ?? '', locale }, next);
      live.receive('doc.replaced', { docKey, next: resultOf(nextKey) });
      return nextKey;
    },
    emit: (message) => live.receive('live.message', message),
    releaseOpens() {
      for (const release of waiting.splice(0)) release();
    },
    updates: () => updates,
    closes: () => closes,
    held: () => held,
  };
}
