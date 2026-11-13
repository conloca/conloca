import { afterEach, describe, expect, it } from 'bun:test';
import { hydrateDoc, serializeDoc } from '@conloca/content-api/ydoc';
import { act, cleanup, render } from '@testing-library/react';
import * as Y from 'yjs';
import { createFakeDocChannel } from '../../test/fake-doc-channel.js';
import { fakePortPair } from '../../test/fake-ports.js';
import { openFrameChannel, RpcError } from '../frame/channel.js';
import { configureUI } from '../ui-config.js';
import {
  createDocChannel,
  type DocChannel,
  type FrameDocChannel,
  type FrameLiveDoc,
  LOCAL_ORIGIN,
  useDocChannel,
} from './doc-channel.js';
import type { DocOpenRequest, LiveStatus } from './messages.js';
import { anyHeld, flushLive, heldContent, type LiveDocState, useLiveDoc } from './use-live.js';

const REQ: DocOpenRequest = { kind: 'data', id: 'd1', locale: 'en' };
const SIZE_REFUSED: LiveStatus = {
  connection: 'read-only',
  pending: true,
  persisted: true,
  readOnly: { status: 413, code: 'update-too-large-unsaved' },
  deletedExport: null,
};
/** Yields one macrotask, so port messages, promise chains and React effects queued so far run; no wall-clock wait. */
const delivered = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function localEdit(live: FrameLiveDoc, key: string, value: string): void {
  live.doc.transact(() => live.doc.getMap('data').set(key, value), LOCAL_ORIGIN);
}

/** `useLiveDoc`'s latest state, as a probe saw it. */
interface SeenDoc {
  state: LiveDocState;
}

/** Mounts `useLiveDoc` and hands back its latest state. */
function mountLiveDoc(channel: DocChannel, req: DocOpenRequest = REQ) {
  configureUI({ docChannel: channel });
  const seen: SeenDoc = { state: { state: 'loading' } };
  function Probe() {
    seen.state = useLiveDoc(req);
    return null;
  }
  const view = render(<Probe />);
  return { seen, unmount: () => view.unmount() };
}

function readyLive(state: LiveDocState): FrameLiveDoc {
  if (state.state !== 'ready') throw new Error(`not ready: ${state.state}`);
  return state.live;
}

afterEach(() => {
  cleanup();
  configureUI({ docChannel: undefined });
});

describe('frame doc channel', () => {
  it('mirrors a parent doc into the frame and sends only local edits back', async () => {
    const fake = createFakeDocChannel({ data: { title: 'A' } });
    const live = await fake.channel.open(REQ);
    expect(serializeDoc(live.doc).data).toEqual({ title: 'A' });
    fake.parentEdit(live.docKey, (doc) => doc.getMap('data').set('title', 'B'));
    expect(serializeDoc(live.doc).data).toEqual({ title: 'B' });
    expect(fake.updates()).toHaveLength(0);
    localEdit(live, 'title', 'C');
    expect(fake.updates()).toHaveLength(1);
    expect(serializeDoc(fake.parent(live.docKey)).data).toEqual({ title: 'C' });
  });

  it('returns no channel when the parent sent no docChannel', () => {
    configureUI({ docChannel: undefined });
    let seen: DocChannel | null | undefined;
    function Probe() {
      seen = useDocChannel();
      return null;
    }
    render(<Probe />);
    expect(seen).toBeNull();
  });

  it('carries update bytes across the port unchanged', async () => {
    const [pagePort, outerPort] = fakePortPair();
    const server = hydrateDoc({ data: { title: 'A' } });
    const opened = Y.encodeStateAsUpdate(server);
    const received: Uint8Array[] = [];
    const outer = openFrameChannel(outerPort, {
      call: async () => ({
        docKey: 'data:web:d1:en#1',
        generation: 1,
        update: opened,
        user: { id: 'u1', name: 'Ann' },
      }),
      event: (name, payload) => {
        if (name === 'doc.update' && typeof payload === 'object' && payload !== null && 'update' in payload) {
          if (payload.update instanceof Uint8Array) received.push(payload.update);
        }
      },
    });
    let docChannel: FrameDocChannel | undefined;
    const page = openFrameChannel(pagePort, { event: (name, payload) => docChannel?.receive(name, payload) });
    docChannel = createDocChannel(page);
    const live = await docChannel.open(REQ);
    expect(Y.encodeStateAsUpdate(live.doc)).toEqual(Y.encodeStateAsUpdate(server));
    const sent: Uint8Array[] = [];
    live.doc.on('update', (update: Uint8Array) => sent.push(update));
    localEdit(live, 'title', 'B');
    await delivered();
    expect(received).toEqual(sent);
    const parentEdit = new Y.Doc();
    Y.applyUpdate(parentEdit, Y.encodeStateAsUpdate(live.doc));
    const before = Y.encodeStateVector(parentEdit);
    parentEdit.getMap('data').set('title', 'C');
    outer.emit('doc.update', { docKey: live.docKey, update: Y.encodeStateAsUpdate(parentEdit, before) });
    await delivered();
    expect(live.doc.getMap('data').get('title')).toBe('C');
    outer.close();
    page.close();
  });

  it('ignores doc events while no doc channel is open, as an old frame does', () => {
    const fake = createFakeDocChannel({ data: {} });
    expect(() => fake.channel.receive('doc.update', { docKey: 'nope', update: new Uint8Array([1]) })).not.toThrow();
    expect(fake.channel.receive('doc.unknown', {})).toBe(false);
    expect(fake.channel.receive('doc.replaced', { docKey: 'nope', next: null })).toBe(true);
  });

  it('keeps sending old-key edits after doc.replaced until the binding moves, then closes the old key', async () => {
    const fake = createFakeDocChannel({ data: { title: 'A' } });
    const { seen } = mountLiveDoc(fake.channel);
    await act(delivered);
    const first = readyLive(seen.state);
    // Registered after the hook's own listener: it runs before React re-renders, while the binding is still on k1.
    const oldKeyEdits: (string | undefined)[] = [];
    fake.channel.on('replaced', () => {
      localEdit(first, 'old', 'x');
      oldKeyEdits.push(fake.updates().at(-1)?.docKey);
    });
    act(() => {
      fake.replace(first.docKey, { data: { title: 'reset' } });
    });
    expect(oldKeyEdits).toEqual([first.docKey]);
    await act(delivered);
    const second = readyLive(seen.state);
    expect(second.docKey).not.toBe(first.docKey);
    expect(fake.closes()).toEqual([first.docKey]);
    // Destroyed, then closed: nothing more goes out under the old key.
    expect(first.doc.isDestroyed).toBe(true);
  });

  it('closes a replica replaced again before the binding moved, so a later refusal reopens the newest', async () => {
    const fake = createFakeDocChannel({ data: { title: 'A' } });
    const view = mountLiveDoc(fake.channel);
    await act(delivered);
    const first = readyLive(view.seen.state);
    let middle = '';
    let last = '';
    act(() => {
      middle = fake.replace(first.docKey, { data: { title: 'b' } });
      last = fake.replace(middle, { data: { title: 'c' } });
    });
    await act(delivered);
    const bound = readyLive(view.seen.state);
    expect(bound.docKey).toBe(last);
    expect(fake.closes()).toEqual([middle, first.docKey]);
    localEdit(bound, 'mine', 'huge');
    act(() => {
      fake.channel.receive('live.status', SIZE_REFUSED);
    });
    view.unmount();
    const again = mountLiveDoc(fake.channel);
    await act(delivered);
    expect(readyLive(again.seen.state)).toBe(bound);
  });

  it('fails the open with the cap message and writes nothing', async () => {
    const fake = createFakeDocChannel({ data: {} }, { refuseOpen: new RpcError('at most 2 docs', 'rate_limited') });
    const { seen } = mountLiveDoc(fake.channel);
    await act(delivered);
    expect(seen.state).toEqual({ state: 'failed', message: 'Close the other open fragment to edit this one.' });
    expect(fake.updates()).toHaveLength(0);
  });

  it('fails the open with the error the channel gives otherwise', async () => {
    const fake = createFakeDocChannel({ data: {} }, { refuseOpen: new Error('Content not found') });
    const { seen } = mountLiveDoc(fake.channel);
    await act(delivered);
    expect(seen.state).toEqual({ state: 'failed', message: 'Content not found' });
  });

  it('reports a null status until the first live.status event', () => {
    const fake = createFakeDocChannel({ data: {} });
    expect(fake.channel.status()).toBeNull();
    const status: LiveStatus = {
      connection: 'connected',
      pending: false,
      persisted: true,
      readOnly: null,
      deletedExport: null,
    };
    fake.channel.receive('live.status', status);
    expect(fake.channel.status()).toEqual(status);
  });

  it('holds every replica on a size refusal that arrives beside a notice', async () => {
    const fake = createFakeDocChannel({ data: {} });
    const live = await fake.channel.open(REQ);
    const status: LiveStatus = {
      ...SIZE_REFUSED,
      notice: { kind: 'unreported', message: 'The editor is holding changes it could not report.' },
    };
    fake.channel.receive('live.status', status);
    expect(live.held).toBe(true);
    expect(fake.channel.status()).toEqual(status);
  });

  it('answers flush with the parent answer, never its own ok', async () => {
    const fake = createFakeDocChannel({ data: {} }, { flush: async () => ({ ok: false, message: 'Syncing…' }) });
    configureUI({ docChannel: fake.channel });
    expect(await flushLive()).toEqual({ ok: false, message: 'Syncing…' });
  });

  it('answers not ok when the flush call rejects', async () => {
    const fake = createFakeDocChannel(
      { data: {} },
      {
        flush: async () => {
          throw new Error('port closed');
        },
      },
    );
    configureUI({ docChannel: fake.channel });
    expect(await flushLive()).toEqual({ ok: false, message: 'port closed' });
  });

  it('closes a late open result', async () => {
    const fake = createFakeDocChannel({ data: {} }, { holdOpen: true });
    const { unmount } = mountLiveDoc(fake.channel);
    unmount();
    fake.releaseOpens();
    await act(delivered);
    expect(fake.closes()).toHaveLength(1);
    expect(fake.channel.live(fake.closes()[0] ?? '')).toBeUndefined();
  });

  it('holds a closed replica whose last edit the parent refuses before it answers the close', async () => {
    const fake = createFakeDocChannel({ data: {} });
    const live = await fake.channel.open(REQ);
    localEdit(live, 'title', 'huge');
    live.close();
    // The refusal of that edit was on its way before the close: it arrives ahead of the close's answer.
    fake.channel.receive('live.status', SIZE_REFUSED);
    await delivered();
    expect(live.held).toBe(true);
    expect(live.doc.isDestroyed).toBe(false);
    expect(await fake.channel.open(REQ)).toBe(live);
    localEdit(live, 'title', 'more');
    expect(fake.updates()).toHaveLength(1);
  });

  it('sends nothing from a closing replica and no longer hands it out', async () => {
    const fake = createFakeDocChannel({ data: {} });
    const live = await fake.channel.open(REQ);
    live.close();
    // Before the parent answers the close: the replica is still alive, but it is no longer the editor's.
    expect(live.doc.isDestroyed).toBe(false);
    expect(fake.channel.live(live.docKey)).toBeUndefined();
    localEdit(live, 'title', 'late');
    expect(fake.updates()).toHaveLength(0);
  });

  it('reopens the newest held replica when a refusal holds the old one in its close window too', async () => {
    const fake = createFakeDocChannel({ data: { title: 'A' } });
    const first = await fake.channel.open(REQ);
    const nextKey = fake.replace(first.docKey, { data: { title: 'reset' } });
    const next = fake.channel.live(nextKey);
    if (!next) throw new Error('doc.replaced built no replica');
    // The binding moved: the old replica closes, and a refusal arrives before the parent answers that close.
    first.close();
    fake.channel.receive('live.status', SIZE_REFUSED);
    await delivered();
    expect([first.held, next.held]).toEqual([true, true]);
    expect(await fake.channel.open(REQ)).toBe(next);
  });

  it('owes nothing after the port closes', async () => {
    const fake = createFakeDocChannel({ data: {} });
    const live = await fake.channel.open(REQ);
    localEdit(live, 'title', 'mine');
    // Emitted in the same tick as the edit: the parent has it before any port can close.
    expect(fake.updates()).toHaveLength(1);
    expect(serializeDoc(fake.parent(live.docKey)).data).toEqual({ title: 'mine' });
  });

  it('keeps a refused replica through rebind and unmount', async () => {
    const fake = createFakeDocChannel({ data: { title: 'A' } }, { flush: async () => ({ ok: true }) });
    const view = mountLiveDoc(fake.channel);
    await act(delivered);
    const first = readyLive(view.seen.state);
    localEdit(first, 'title', 'huge');
    act(() => {
      fake.channel.receive('live.status', SIZE_REFUSED);
    });
    expect(first.held).toBe(true);
    expect(fake.held()).toEqual([
      { docKey: first.docKey, held: true, message: 'This change is too large to keep. Copy it out before reloading' },
    ]);
    let nextKey = '';
    act(() => {
      nextKey = fake.replace(first.docKey, { data: { title: 'reset' } });
    });
    await act(delivered);
    expect(readyLive(view.seen.state)).toBe(first);
    fake.parentEdit(nextKey, (doc) => doc.getMap('data').set('title', 'remote'));
    expect(first.doc.getMap('data').get('title')).toBe('huge');
    expect(await flushLive()).toEqual({
      ok: false,
      message: 'This change is too large to keep. Copy it out before reloading',
    });
    expect(anyHeld()).toBe(true);
    view.unmount();
    expect(first.doc.isDestroyed).toBe(false);
    expect(fake.closes()).toEqual([]);
    const again = mountLiveDoc(fake.channel);
    await act(delivered);
    expect(readyLive(again.seen.state)).toBe(first);
    expect(heldContent(first.docKey)).toEqual({ data: { title: 'huge' } });
    const fragment = await fake.channel.open({ kind: 'data', id: 'd2', locale: 'en' });
    expect(fragment.held).toBe(true);
  });

  it('reports held work to the host when a write throws', async () => {
    const fake = createFakeDocChannel({ data: {} });
    const live = await fake.channel.open(REQ);
    live.hold('This change could not be applied. Copy your changes, then reload the page.');
    expect(fake.held()).toEqual([
      {
        docKey: live.docKey,
        held: true,
        message: 'This change could not be applied. Copy your changes, then reload the page.',
      },
    ]);
    localEdit(live, 'title', 'after');
    expect(fake.updates()).toHaveLength(0);
  });
});
