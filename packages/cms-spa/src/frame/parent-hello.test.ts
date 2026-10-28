import { afterEach, describe, expect, test } from 'bun:test';
import { awaitParentHello, type HelloWindow } from './parent-hello.js';
import { HELLO_TYPE } from './protocol.js';

type ChildWindow = HelloWindow & Pick<EventTarget, 'dispatchEvent'>;

const PAGE = { repo: 'acme/site', siteId: 'default' };
const GOOD_ORIGIN = 'https://acme.example.com';
const GOOD_HELLO = { type: HELLO_TYPE, protocols: { min: 1, max: 1 } };
const accept = (origin: string) => origin === GOOD_ORIGIN;
const opened: MessagePort[] = [];

/** A child window whose parent and top are the test window, so a hello can come from its parent. */
function childWindow(): ChildWindow {
  const target = new EventTarget();
  return {
    parent: window,
    top: window,
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
    dispatchEvent: target.dispatchEvent.bind(target),
  } satisfies ChildWindow;
}

/** Dispatches a hello into `win` over a fresh channel; `replies` collects what the page posts back on it, `closed` whether the page closed it. */
function sendHello(
  win: ChildWindow,
  overrides: { data?: unknown; origin?: string; source?: MessageEventSource; extraPorts?: MessagePort[] } = {},
) {
  const { port1, port2 } = new MessageChannel();
  opened.push(port1, port2);
  const replies: unknown[] = [];
  const sent = { replies, port: port2, closed: false };
  port1.addEventListener('message', (event) => sent.replies.push(event.data));
  port1.addEventListener('close', () => {
    sent.closed = true;
  });
  port1.start();
  win.dispatchEvent(
    new MessageEvent('message', {
      data: overrides.data ?? GOOD_HELLO,
      origin: overrides.origin ?? GOOD_ORIGIN,
      source: overrides.source ?? window,
      ports: [port2, ...(overrides.extraPorts ?? [])],
    }),
  );
  return sent;
}

// Real ports deliver on a later task; proving a message never arrives needs a real wait.
const settle = () => Bun.sleep(10);

/** Whether `promise` is still unsettled after the ports had their chance to deliver. */
async function isPending(promise: Promise<unknown>): Promise<boolean> {
  const settled = promise.then(
    () => false,
    () => false,
  );
  return Promise.race([settled, settle().then(() => true)]);
}

afterEach(() => {
  for (const port of opened.splice(0)) port.close();
});

describe('the editor page accepting its parent', () => {
  test('a hello from the parent with an accepted origin gets accepted with the page identity and hands over the port', async () => {
    const win = childWindow();
    const accepted = awaitParentHello(win, accept, PAGE);
    const { replies, port } = sendHello(win);
    expect(await accepted).toBe(port);
    await settle();
    expect(replies).toEqual([{ kind: 'accepted', protocol: 1, repo: 'acme/site', siteId: 'default' }]);
  });

  test('only the first good hello is accepted', async () => {
    const win = childWindow();
    const accepted = awaitParentHello(win, accept, PAGE);
    const first = sendHello(win);
    await accepted;
    const second = sendHello(win);
    await settle();
    expect(first.replies).toHaveLength(1);
    expect(second.replies).toEqual([]);
  });

  test('a hello from another origin gets origin-rejected and the page keeps listening', async () => {
    const win = childWindow();
    const accepted = awaitParentHello(win, accept, PAGE);
    const rejected = sendHello(win, { origin: 'https://other.example.org' });
    expect(await isPending(accepted)).toBe(true);
    expect(rejected.replies).toEqual([{ kind: 'nack', code: 'origin-rejected' }]);
    const good = sendHello(win);
    expect(await accepted).toBe(good.port);
  });

  test('a hello outside the page protocol gets unsupported-protocol with the page version, its port closes and the page stops', async () => {
    const win = childWindow();
    const accepted = awaitParentHello(win, accept, PAGE);
    const refused = sendHello(win, { data: { type: HELLO_TYPE, protocols: { min: 2, max: 3 } } });
    await Promise.resolve(expect(accepted).rejects.toThrow('unsupported-protocol'));
    const later = sendHello(win);
    await settle();
    expect(refused.replies).toEqual([{ kind: 'nack', code: 'unsupported-protocol', page: 1 }]);
    expect(refused.closed).toBe(true);
    expect(later.replies).toEqual([]);
  });

  test('hellos not from the parent, from a nested frame, without exactly one port, or of another type are ignored', async () => {
    const win = childWindow();
    const accepted = awaitParentHello(win, accept, PAGE);
    const nested = { ...win, top: null };
    const nestedAccepted = awaitParentHello(nested, accept, PAGE);
    const stray = new MessageChannel();
    opened.push(stray.port1, stray.port2);
    const ignored = [
      sendHello(win, { source: stray.port1 }),
      sendHello(win, { extraPorts: [stray.port2] }),
      sendHello(win, { data: { type: 'other', protocols: { min: 1, max: 1 } } }),
      sendHello(win, { data: { type: HELLO_TYPE, protocols: { min: '1', max: 1 } } }),
      sendHello(win, { data: { type: HELLO_TYPE } }),
    ];
    win.dispatchEvent(
      new MessageEvent('message', { data: GOOD_HELLO, origin: GOOD_ORIGIN, source: window, ports: [] }),
    );
    expect(await isPending(accepted)).toBe(true);
    for (const { replies } of ignored) expect(replies).toEqual([]);

    const good = sendHello(win);
    expect(await accepted).toBe(good.port);
    expect(await isPending(nestedAccepted)).toBe(true);
  });
});
