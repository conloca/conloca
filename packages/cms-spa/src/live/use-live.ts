/** React hooks over the editor's doc channel, and the one-edit write the notices and pickers use. */

import type { ContentData } from '@conloca/content-api';
import { applyAnchorValue, deepEqual, valueAtAnchor } from '@conloca/content-api/merge';
import { applyContentDiff, serializeDoc } from '@conloca/content-api/ydoc';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { type EditorFlushResult, flushOpenEditor } from '../editor-flush.js';
import { getUIConfig } from '../ui-config.js';
import { type DocChannel, EDIT_ORIGIN, type FrameLiveDoc, openFailureMessage, useDocChannel } from './doc-channel.js';
import {
  type DocOpenRequest,
  isJsonValue,
  type JsonValue,
  type LiveMessage,
  type LiveStatus,
  type PresencePeer,
} from './messages.js';

export type LiveDocState =
  | { state: 'loading' }
  | { state: 'ready'; live: FrameLiveDoc }
  | { state: 'failed'; message: string };

/** Where a doc binding stands: `bound` follows every handover at once, `shown` is what the editor has rendered. */
export interface LiveBinding {
  readonly bound: FrameLiveDoc | null;
  readonly shown: FrameLiveDoc | null;
  /** The open answered. */
  bind(live: FrameLiveDoc): void;
  /** The editor rendered `shown`: a replica it moved off is destroyed, then its key closed. */
  commit(shown: FrameLiveDoc | null): void;
  /** The editor unmounts: every replica it held closes (a held one stays for the next mount). */
  stop(): void;
}

/**
 * `useLiveDoc`'s handover: on `doc.replaced` the binding moves to the new replica, and the old one is closed only after
 * the editor rendered the new one, so its edits until then still go out under the old key. A replica replaced again
 * before it was ever rendered is closed at once.
 */
export function followHandovers(channel: DocChannel, onMove: (live: FrameLiveDoc) => void): LiveBinding {
  let bound: FrameLiveDoc | null = null;
  let shown: FrameLiveDoc | null = null;
  const stopReplaced = channel.on('replaced', (event) => {
    if (bound === null || event.docKey !== bound.docKey) return;
    if (bound !== shown) bound.close();
    bound = event.live;
    onMove(event.live);
  });
  return {
    get bound() {
      return bound;
    },
    get shown() {
      return shown;
    },
    bind(live) {
      bound = live;
      onMove(live);
    },
    commit(next) {
      const before = shown;
      shown = next;
      if (before !== null && next !== null && before !== next) before.close();
    },
    stop() {
      stopReplaced();
      bound?.close();
      if (shown !== bound) shown?.close();
    },
  };
}

/** Opens `req` through the doc channel and follows its handovers (see `followHandovers`). */
export function useLiveDoc(req: DocOpenRequest | null): LiveDocState {
  const channel = useDocChannel();
  const [state, setState] = useState<LiveDocState>({ state: 'loading' });
  const binding = useRef<LiveBinding | null>(null);
  const kind = req?.kind;
  const id = req?.id;
  const locale = req?.locale;
  useEffect(() => {
    if (!channel || kind === undefined || id === undefined || locale === undefined) return undefined;
    const abort = new AbortController();
    const handover = followHandovers(channel, (live) => setState({ state: 'ready', live }));
    binding.current = handover;
    setState({ state: 'loading' });
    channel.open({ kind, id, locale }, abort.signal).then(
      (live) => handover.bind(live),
      (error: unknown) => {
        if (!abort.signal.aborted) setState({ state: 'failed', message: openFailureMessage(error) });
      },
    );
    return () => {
      abort.abort();
      handover.stop();
    };
  }, [channel, kind, id, locale]);
  const shown = state.state === 'ready' ? state.live : null;
  useEffect(() => {
    binding.current?.commit(shown);
  }, [shown]);
  return state;
}

/** Calls `handler` with each live message of `type` while mounted. */
export function useLiveMessage<T extends LiveMessage['type']>(
  type: T,
  handler: (m: Extract<LiveMessage, { type: T }>) => void,
): void {
  const channel = useDocChannel();
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => {
    if (!channel) return undefined;
    return channel.on('message', (message) => {
      if (isOfType(message, type)) latest.current(message);
    });
  }, [channel, type]);
}

function isOfType<T extends LiveMessage['type']>(
  message: LiveMessage,
  type: T,
): message is Extract<LiveMessage, { type: T }> {
  return message.type === type;
}

const noSubscribe = () => () => {};

export function useLiveStatus(): LiveStatus | null {
  const channel = useDocChannel();
  return useSyncExternalStore(
    channel ? (notify) => channel.on('status', notify) : noSubscribe,
    () => channel?.status() ?? null,
  );
}

const NO_PEERS: PresencePeer[] = [];

export function usePresencePeers(docKey: string): PresencePeer[] {
  const channel = useDocChannel();
  return useSyncExternalStore(
    channel ? (notify) => channel.on('peers', notify) : noSubscribe,
    () => channel?.peers(docKey) ?? NO_PEERS,
  );
}

/**
 * Pushes pending work: held work answers not ok with its notice, otherwise the parent answers; without a channel the
 * open editor's own save runs.
 */
export async function flushLive(): Promise<EditorFlushResult> {
  const channel = getUIConfig().docChannel;
  return channel ? channel.flush() : flushOpenEditor();
}

/** Some replica or value in this frame is held; a leave guard counts it as unsaved. */
export function anyHeld(): boolean {
  return (getUIConfig().docChannel?.held() ?? null) !== null;
}

/** The serialized held replica of `docKey`, for its copy-out button; null when it is not held. */
export function heldContent(docKey: string): ContentData | null {
  return getUIConfig().docChannel?.heldContent(docKey) ?? null;
}

export type DocEditResult =
  | { ok: true }
  | { ok: false; reason: 'not-found' | 'not-open' | 'error' | 'changed'; message: string };
export type DocEditValue = JsonValue | null | undefined;
/** `expected`, when given, is the value the anchor must still hold; anything else refuses the write as `changed`. */
export type DocEdit = { anchor: string; value: DocEditValue; expected?: DocEditValue };
export type DocEdits = (edits: DocEdit[]) => DocEditResult;

const NOT_FOUND = 'This block was deleted, so the value could not be restored.';
const CHANGED = 'Changed again since. Check the field.';

/** The parsed file the anchor helpers read, from a serialized doc. */
function wrap(content: ContentData): { kind: 'mdx' | 'vxjson'; doc: JsonValue } | null {
  if (typeof content.mdx === 'string') return { kind: 'mdx', doc: content.mdx };
  if (content.puckData !== undefined)
    return { kind: 'vxjson', doc: { type: 'puck', content: { puckData: content.puckData } } };
  if (content.data !== undefined) {
    return isJsonValue(content.data) ? { kind: 'vxjson', doc: { type: 'json', data: content.data } } : null;
  }
  return null;
}

function unwrap(kind: 'mdx' | 'vxjson', doc: JsonValue): ContentData | null {
  if (kind === 'mdx') return typeof doc === 'string' ? { mdx: doc } : null;
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) return null;
  const { content, data } = doc;
  if (typeof content === 'object' && content !== null && !Array.isArray(content)) return { puckData: content.puckData };
  return typeof data === 'object' && data !== null && !Array.isArray(data) ? { data } : null;
}

/**
 * Writes each edit at its content anchor over the serialized doc, then applies the result in one transaction: all or
 * nothing. Never throws.
 */
export function applyDocEdits(live: FrameLiveDoc | undefined, edits: DocEdit[]): DocEditResult {
  if (!live) return { ok: false, reason: 'not-open', message: 'This page is not open for editing.' };
  if (live.held)
    return { ok: false, reason: 'error', message: getUIConfig().docChannel?.held() ?? 'This page is held.' };
  try {
    const base = wrap(serializeDoc(live.doc));
    if (!base) return { ok: false, reason: 'error', message: 'This page could not be read.' };
    let current = base.doc;
    for (const edit of edits) {
      const { anchor, value } = edit;
      const input = { kind: base.kind, doc: current, anchor, base: base.doc };
      const found = valueAtAnchor(input);
      const now = found.found ? found.value : undefined;
      if ('expected' in edit && !deepEqual(now, edit.expected))
        return { ok: false, reason: 'changed', message: CHANGED };
      const written = applyAnchorValue({ ...input, expected: now, value });
      if (!written.ok) return { ok: false, reason: 'not-found', message: NOT_FOUND };
      current = written.doc;
    }
    const next = unwrap(base.kind, current);
    if (!next) return { ok: false, reason: 'error', message: 'This page could not be written.' };
    applyContentDiff(live.doc, next, EDIT_ORIGIN);
    return { ok: true };
  } catch (error) {
    console.error('[live] could not write an edit', error);
    return { ok: false, reason: 'error', message: error instanceof Error ? error.message : String(error) };
  }
}

/** One value at an anchor (Restore yours, picker choices); `undefined` removes the key. */
export function useDocEdit(
  docKey: string,
): (anchor: string, value: DocEditValue, expected?: { value: DocEditValue }) => DocEditResult {
  const channel = useDocChannel();
  return useCallback(
    (anchor, value, expected) =>
      applyDocEdits(channel?.live(docKey), [
        expected ? { anchor, value, expected: expected.value } : { anchor, value },
      ]),
    [channel, docKey],
  );
}

/** Reads the value at an anchor in the open doc now; `undefined` when it is absent or the doc is not open. */
export function useDocRead(docKey: string): (anchor: string) => DocEditValue {
  const channel = useDocChannel();
  return useCallback(
    (anchor) => {
      const live = channel?.live(docKey);
      const base = live ? wrap(serializeDoc(live.doc)) : null;
      if (!base) return undefined;
      const found = valueAtAnchor({ kind: base.kind, doc: base.doc, anchor, base: base.doc });
      return found.found ? found.value : undefined;
    },
    [channel, docKey],
  );
}

/** Several values in one transaction (MDX page settings): all keys or none. */
export function useDocEdits(docKey: string): DocEdits {
  const channel = useDocChannel();
  return useCallback((edits) => applyDocEdits(channel?.live(docKey), edits), [channel, docKey]);
}
