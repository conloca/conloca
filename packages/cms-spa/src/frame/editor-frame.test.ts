import { afterEach, beforeEach, describe, expect, type Mock, spyOn, test } from 'bun:test';
import { type FakePort, fakePortPair } from '../../test/fake-ports.js';
import { notifyEditorDirtyChanged, registerEditorFlushHandler } from '../editor-flush.js';
import type { MediaIssue } from '../media/types.js';
import { THEME_CHANGED_EVENT, THEME_STORAGE_KEY } from '../theme.js';
import { configureUI, getUIConfig } from '../ui-config.js';
import { type FrameChannel, openFrameChannel, RpcError } from './channel.js';
import { connectEditorFrame } from './editor-frame.js';
import type { ControlMessage, Init, PreviewOpenResult, SiteOpenResult } from './protocol.js';
import { RpcContentClient } from './rpc-content-client.js';

const INIT: Init = {
  kind: 'init',
  initialPath: '/pages/abc',
  readOnly: null,
  previewCapability: 'available',
  theme: 'dark',
  mediaEnabled: true,
};

let page: FakePort;
let outer: FrameChannel;
let events: [string, unknown][];
let controls: ControlMessage[];
let calls: [string, unknown[]][];
/** What the parent answers in these tests. */
type Answer = Blob | PreviewOpenResult | SiteOpenResult | MediaIssue | 'branch' | { size: number };
let answers: Map<string, Answer>;
let addWindowListener: Mock<typeof window.addEventListener>;

/** Lets the fake ports hand over what is already posted. */
const delivered = () => new Promise<void>((resolve) => queueMicrotask(resolve));

beforeEach(() => {
  const [pagePort, outerPort] = fakePortPair();
  page = pagePort;
  events = [];
  controls = [];
  calls = [];
  answers = new Map();
  outer = openFrameChannel(outerPort, {
    event: (name, payload) => events.push([name, payload]),
    control: (message) => controls.push(message),
    call: async (method, args) => {
      calls.push([method, args]);
      return answers.get(method);
    },
  });
  // The frame listens on `window` for the page's lifetime; tests take those listeners away again.
  addWindowListener = spyOn(window, 'addEventListener');
});

afterEach(() => {
  for (const [type, listener] of addWindowListener.mock.calls) window.removeEventListener(type, listener);
  addWindowListener.mockRestore();
  outer.close();
  configureUI({ readOnly: undefined });
  localStorage.clear();
});

async function connected(init: Init = INIT) {
  const frame = connectEditorFrame(page);
  outer.post(init);
  return frame;
}

describe('connecting the editor to its parent frame', () => {
  test('waits for init, then offers the config the page mounts with', async () => {
    const { config, init } = await connected();

    expect(init).toEqual(INIT);
    expect(config.contentClient).toBeInstanceOf(RpcContentClient);
    expect(config.previewTab).toBe('parent');
    expect(config.memoryRouter?.initialPath).toBe('/pages/abc');
    expect('readOnly' in config && config.readOnly).toBeUndefined();
    expect(config.previewCapability).toBe('available');
    expect(typeof config.openPreview).toBe('function');
    expect(typeof config.openSiteUrl).toBe('function');
    expect(typeof config.loadMedia).toBe('function');
    expect(config.mediaBridge).toBeDefined();
    expect('locales' in config).toBe(false);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
  });

  test('a later init changes nothing', async () => {
    const frame = await connected();
    outer.post({ ...INIT, initialPath: '/media' });
    await delivered();

    expect(frame.init.initialPath).toBe('/pages/abc');
  });

  test('locales and a refusal in init reach the config', async () => {
    const locales = { list: ['en', 'de'], defaultLocale: 'en' };
    const { config } = await connected({ ...INIT, readOnly: { reason: 'Billing' }, locales });

    expect(config.readOnly).toEqual({ reason: 'Billing' });
    expect(config.locales).toEqual(locales);
  });

  test('without media enabled there is no media bridge and no loader', async () => {
    const { config } = await connected({ ...INIT, mediaEnabled: false });

    expect(config.mediaBridge).toBeUndefined();
    expect(config.loadMedia).toBeUndefined();
  });

  test('init that arrived before connecting is not lost', async () => {
    const { port1, port2 } = new MessageChannel();
    port1.postMessage(INIT);
    // A real port: the message has to be queued on it before anyone listens.
    await Bun.sleep(0);

    const frame = await connectEditorFrame(port2);

    expect(frame.init.initialPath).toBe('/pages/abc');
    port1.close();
    port2.close();
  });

  test('ready, stale and load failures reach the parent', async () => {
    const frame = await connected();
    frame.ready();
    frame.reportStale();
    frame.reportLoadFailed('site', 'boom');
    await delivered();

    expect(controls).toEqual([{ kind: 'ready' }]);
    expect(events).toEqual([
      ['editor.stale', null],
      ['load.failed', { stage: 'site', message: 'boom' }],
    ]);
  });

  test('the parent flushes the open editor and gets its answer', async () => {
    await connected();
    const unregister = registerEditorFlushHandler(async () => ({ ok: false, message: 'Title is required' }));

    expect(await outer.call('editor.flush')).toEqual({ ok: false, message: 'Title is required' });
    unregister();
  });

  test('any other call from the parent is refused', async () => {
    await connected();

    const call = outer.call('getContent', ['abc']);

    await Promise.resolve(expect(call).rejects.toBeInstanceOf(RpcError));
    await Promise.resolve(expect(call).rejects.toMatchObject({ code: 'method_not_allowed' }));
  });

  test('dirty changes are reported once per change', async () => {
    await connected();
    let dirty = false;
    const unregister = registerEditorFlushHandler(async () => ({ ok: true }), { isDirty: () => dirty });
    dirty = true;
    notifyEditorDirtyChanged();
    notifyEditorDirtyChanged();
    dirty = false;
    notifyEditorDirtyChanged();
    unregister();
    await delivered();

    expect(events).toEqual([
      ['editor.dirty', { dirty: true }],
      ['editor.dirty', { dirty: false }],
    ]);
  });

  test('Cmd+S on the page is kept from the browser and sent to the parent', async () => {
    await connected();
    const event = new KeyboardEvent('keydown', { key: 's', metaKey: true, cancelable: true });
    const other = new KeyboardEvent('keydown', { key: 'a', metaKey: true, cancelable: true });
    window.dispatchEvent(event);
    window.dispatchEvent(other);
    await delivered();

    expect(event.defaultPrevented).toBe(true);
    expect(other.defaultPrevented).toBe(false);
    expect(events).toEqual([['shortcut.save', null]]);
  });

  test('route changes go to the parent; parent navigation reaches the router listener', async () => {
    const { config } = await connected();
    const navigated: string[] = [];
    const stop = config.memoryRouter?.subscribe((path) => navigated.push(path));

    config.memoryRouter?.onNavigate('/media?x=1', false);
    outer.emit('route.navigate', { path: '/pages' });
    outer.emit('route.navigate', { path: '//elsewhere.example.com' });
    await delivered();
    stop?.();
    outer.emit('route.navigate', { path: '/media' });
    await delivered();

    expect(events).toEqual([['route.changed', { path: '/media?x=1', replace: false }]]);
    expect(navigated).toEqual(['/pages']);
  });

  test('read-only, preview capability and theme follow the parent', async () => {
    const { config } = await connected();
    configureUI(config);
    let themeEvents = 0;
    const onTheme = () => themeEvents++;
    window.addEventListener(THEME_CHANGED_EVENT, onTheme);

    outer.emit('readOnly.changed', { readOnly: { reason: 'Billing' } });
    outer.emit('previewCapability.changed', { previewCapability: 'unavailable' });
    outer.emit('theme.changed', { theme: 'light' });
    outer.emit('theme.changed', { theme: 'sepia' });
    outer.emit('unknown.event', {});
    await delivered();

    expect(getUIConfig().readOnly?.reason).toBe('Billing');
    expect(getUIConfig().previewCapability).toBe('unavailable');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
    expect(themeEvents).toBe(1);

    outer.emit('readOnly.changed', { readOnly: null });
    await delivered();
    expect(getUIConfig().readOnly).toBeUndefined();
  });

  test('media loads, preview opens and live-site opens are calls to the parent', async () => {
    const { config } = await connected();
    const blob = new Blob(['png']);
    const issue: MediaIssue = { kind: 'blocked', filename: 'hero.png', reason: 'Too large' };
    answers = new Map<string, Answer>([
      ['media.load', blob],
      ['preview.open', { ok: true }],
      ['site.open', { ok: true }],
      ['mediaBridge.getAssetScope', 'branch'],
      ['mediaBridge.getMediaIssue', issue],
    ]);

    expect(await config.loadMedia?.({ route: 'serve', path: 'uploads/hero.png' })).toBe(blob);
    expect(await config.openPreview?.({ path: '/about' })).toEqual({ ok: true });
    await config.openSiteUrl?.({ path: '/about' });
    expect(await config.mediaBridge?.getAssetScope({ filename: 'hero.png' })).toBe('branch');
    expect(await config.mediaBridge?.getMediaIssue({ filename: 'hero.png' })).toEqual(issue);
    expect(calls).toEqual([
      ['media.load', [{ route: 'serve', path: 'uploads/hero.png' }]],
      ['preview.open', [{ path: '/about' }]],
      ['site.open', [{ path: '/about' }]],
      ['mediaBridge.getAssetScope', [{ filename: 'hero.png' }]],
      ['mediaBridge.getMediaIssue', [{ filename: 'hero.png' }]],
    ]);
  });

  test('an answer that is not what the call promises is refused', async () => {
    const { config } = await connected();
    answers = new Map<string, Answer>([
      ['media.load', { size: 3 }],
      ['preview.open', { size: 3 }],
    ]);

    await Promise.resolve(expect(config.loadMedia?.({ route: 'serve', path: 'hero.png' })).rejects.toThrow());
    await Promise.resolve(expect(config.openPreview?.({ path: '/about' })).rejects.toThrow());
    await Promise.resolve(expect(config.mediaBridge?.getMediaIssue({ filename: 'hero.png' })).rejects.toThrow());
  });
});
