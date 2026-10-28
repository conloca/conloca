import { describe, expect, mock, test } from 'bun:test';
import { APIClientError, ErrorCodes, StaleWriteError } from '@conloca/content-api-client';
import { FakePort, fakePortPair } from '../../test/fake-ports.js';
import { ContentWriteRefusedError } from '../write-access.js';
import {
  decodeWireError,
  decodeWireValue,
  encodeWireError,
  encodeWireValue,
  openFrameChannel,
  RpcError,
} from './channel.js';

/** Drains queued microtasks (port deliveries and their answers); a zero-delay macrotask, not a timed wait. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A port that clones what it posts, so a value a real port cannot clone throws here too. */
class CloningPort extends FakePort {
  override postMessage(data: unknown): void {
    structuredClone(data);
    // oxlint-disable-next-line unicorn/require-post-message-target-origin -- a port's postMessage has no target origin.
    super.postMessage(data);
  }
}

function cloningPair(): [FakePort, CloningPort] {
  const a = new FakePort();
  const b = new CloningPort();
  a.peer = b;
  b.peer = a;
  return [a, b];
}

function roundTrip(error: unknown): Error {
  return decodeWireError(structuredClone(encodeWireError(error)));
}

describe('a frame channel between two ports', () => {
  test('a call reaches the other side and its value comes back', async () => {
    const [a, b] = fakePortPair();
    const page = openFrameChannel(a, {});
    openFrameChannel(b, { call: async (method, args) => ({ method, args }) });
    expect(await page.call('getContent', ['id-1'])).toEqual({ method: 'getContent', args: ['id-1'] });
  });

  test('concurrent calls on both sides settle independently', async () => {
    const [a, b] = fakePortPair();
    const page = openFrameChannel(a, { call: async (method) => `page answers ${method}` });
    const parent = openFrameChannel(b, { call: async (method) => `parent answers ${method}` });
    const [fromParent, fromPage] = await Promise.all([page.call('getContent'), parent.call('flush')]);
    expect(fromParent).toBe('parent answers getContent');
    expect(fromPage).toBe('page answers flush');
  });

  test('a side without a call handler answers method_not_allowed', async () => {
    const [a, b] = fakePortPair();
    const page = openFrameChannel(a, {});
    openFrameChannel(b, {});
    const error = await page.call('getGitStatus').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RpcError);
    expect(error).toMatchObject({ code: 'method_not_allowed' });
  });

  test('events and control messages reach their handlers; unknown shapes reach only malformed', async () => {
    const [a, b] = fakePortPair();
    const event = mock((_name: string, _payload: unknown) => {});
    const control = mock((_message: unknown) => {});
    const call = mock(async () => undefined);
    const malformed = mock((_data: unknown) => {});
    openFrameChannel(a, { event, control, call, malformed });
    const parent = openFrameChannel(b, {});

    parent.emit('editor.dirty', { dirty: true });
    parent.post({ kind: 'ready' });
    await settle();
    expect(event).toHaveBeenCalledTimes(1);
    expect(event).toHaveBeenCalledWith('editor.dirty', { dirty: true });
    expect(control).toHaveBeenCalledTimes(1);
    expect(control).toHaveBeenCalledWith({ kind: 'ready' });

    a.dispatchEvent(new MessageEvent('message', { data: { kind: 'surprise' } }));
    a.dispatchEvent(new MessageEvent('message', { data: 'x' }));
    a.dispatchEvent(new MessageEvent('message', { data: { kind: 'call', id: 'x' } }));
    a.dispatchEvent(new MessageEvent('message', { data: { kind: 'init', initialPath: '//elsewhere' } }));
    a.dispatchEvent(new MessageEvent('message', { data: { kind: 'result', id: 1, ok: false, error: { name: 1 } } }));
    await settle();
    expect(malformed).toHaveBeenCalledTimes(5);
    expect(event).toHaveBeenCalledTimes(1);
    expect(control).toHaveBeenCalledTimes(1);
    expect(call).not.toHaveBeenCalled();
  });

  test('a result for an id nobody asked for is ignored', async () => {
    const [a] = fakePortPair();
    const malformed = mock((_data: unknown) => {});
    openFrameChannel(a, { malformed });
    a.dispatchEvent(new MessageEvent('message', { data: { kind: 'result', id: 99, ok: true, value: 1 } }));
    await settle();
    expect(malformed).not.toHaveBeenCalled();
  });

  test('close drops pending calls and stops delivery', async () => {
    const [a, b] = fakePortPair();
    const event = mock((_name: string, _payload: unknown) => {});
    const page = openFrameChannel(a, { event });
    let answer: ((value: unknown) => void) | undefined;
    const parent = openFrameChannel(b, { call: () => new Promise((resolve) => (answer = resolve)) });

    let settled = false;
    page.call('getContent').then(
      () => (settled = true),
      () => (settled = true),
    );
    await settle();
    page.close();
    answer?.('late');
    parent.emit('editor.dirty', { dirty: true });
    await settle();
    expect(settled).toBe(false);
    expect(event).not.toHaveBeenCalled();
    expect(a.closed).toBe(true);
  });

  test('a result that cannot be sent still answers the caller with an error', async () => {
    const [a, b] = cloningPair();
    const page = openFrameChannel(a, {});
    openFrameChannel(b, { call: async () => ({ render: () => 'not cloneable' }) });
    const error = await page.call('getContent').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({ message: expect.stringMatching(/^Result of getContent could not be sent/) });
  });

  test('a call that cannot be sent rejects instead of throwing, and later calls still work', async () => {
    const [a, b] = cloningPair();
    const parent = openFrameChannel(b, {});
    openFrameChannel(a, { call: async (method) => method });
    const unsent = parent.call('createContent', [() => 'not cloneable']);
    expect(unsent).toBeInstanceOf(Promise);
    expect(await unsent.catch((e: unknown) => e)).toBeInstanceOf(Error);
    expect(await parent.call('getContent')).toBe('getContent');
  });

  test('an event or control message that cannot be sent goes to sendFailed instead of throwing', () => {
    const port = new FakePort();
    const refusal = new DOMException('could not be cloned', 'DataCloneError');
    port.postMessage = () => {
      throw refusal;
    };
    const sendFailed = mock((_error: unknown) => {});
    const channel = openFrameChannel(port, { sendFailed });
    expect(() => channel.emit('editor.dirty', { dirty: true })).not.toThrow();
    expect(() => channel.post({ kind: 'ready' })).not.toThrow();
    expect(sendFailed.mock.calls).toEqual([[refusal], [refusal]]);
  });
});

describe('errors that cross the channel', () => {
  test('a stale write keeps its class and current etag', () => {
    const decoded = roundTrip(
      new StaleWriteError({ code: ErrorCodes.STALE_WRITE, message: 'Changed elsewhere', currentEtag: 'e2' }),
    );
    expect(decoded).toBeInstanceOf(StaleWriteError);
    expect(decoded).toBeInstanceOf(APIClientError);
    expect(decoded instanceof StaleWriteError && decoded.currentEtag).toBe('e2');
    expect(decoded.message).toBe('Changed elsewhere');
  });

  test('an API error keeps code and details; a refused write keeps method and refusal; a channel error keeps its code', () => {
    const api = roundTrip(new APIClientError('Not found', ErrorCodes.CONTENT_NOT_FOUND, { id: 'x' }));
    expect(api).toBeInstanceOf(APIClientError);
    expect(api).not.toBeInstanceOf(StaleWriteError);
    expect(api.message).toBe('Not found');
    expect(api instanceof APIClientError && api.code).toBe(ErrorCodes.CONTENT_NOT_FOUND);
    expect(api instanceof APIClientError && api.details).toEqual({ id: 'x' });

    const refused = roundTrip(new ContentWriteRefusedError('createContent', { reason: 'Read only' }));
    expect(refused).toBeInstanceOf(ContentWriteRefusedError);
    expect(refused.message).toBe('Read only');
    expect(refused instanceof ContentWriteRefusedError && refused.method).toBe('createContent');
    expect(refused instanceof ContentWriteRefusedError && refused.refusal).toEqual({ reason: 'Read only' });

    const channel = roundTrip(new RpcError('Too many calls', 'rate_limited'));
    expect(channel).toBeInstanceOf(RpcError);
    expect(channel.name).toBe('RpcError');
    expect(channel.message).toBe('Too many calls');
    expect(channel instanceof RpcError && channel.code).toBe('rate_limited');
  });

  test('any other error becomes a plain Error with the same name and message; a thrown string becomes an Error', () => {
    const typeError = roundTrip(new TypeError('Bad input'));
    expect(typeError.constructor).toBe(Error);
    expect(typeError.name).toBe('TypeError');
    expect(typeError.message).toBe('Bad input');

    const thrown = roundTrip('boom');
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown.name).toBe('Error');
    expect(thrown.message).toBe('boom');
  });

  test('Error instances inside a result value are rebuilt; Blobs and Files pass untouched', () => {
    const blob = new Blob(['x']);
    const file = new File(['y'], 'y.txt');
    const encoded = encodeWireValue({
      success: false,
      error: new Error('Create failed'),
      file: blob,
      upload: file,
      list: [new Error('a')],
    });
    const value = decodeWireValue(structuredClone(encoded));
    if (typeof value !== 'object' || value === null) throw new Error('the value did not come back as an object');
    const error = 'error' in value ? value.error : undefined;
    const list = 'list' in value ? value.list : undefined;
    expect(error).toBeInstanceOf(Error);
    expect(error).toHaveProperty('message', 'Create failed');
    expect(list).toEqual([new Error('a')]);
    expect(Array.isArray(list) && list[0]).toBeInstanceOf(Error);
    expect(decodeWireValue(encodeWireValue(blob))).toBe(blob);
    expect(decodeWireValue(encodeWireValue(file))).toBe(file);
    expect(decodeWireValue(encodeWireValue({ file: blob, upload: file }))).toEqual({ file: blob, upload: file });
  });

  test('a call handler that throws a StaleWriteError rejects the caller with a StaleWriteError', async () => {
    const [a, b] = fakePortPair();
    const page = openFrameChannel(a, {});
    openFrameChannel(b, {
      call: async () => {
        throw new StaleWriteError({ code: ErrorCodes.STALE_WRITE, message: 'Changed elsewhere', currentEtag: 'e3' });
      },
    });
    const error = await page.call('updateContent', ['id-1']).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(StaleWriteError);
    expect(error instanceof StaleWriteError && error.currentEtag).toBe('e3');
  });
});
