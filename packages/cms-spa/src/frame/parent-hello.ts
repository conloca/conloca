import {
  type Accepted,
  EDITOR_HOST_PROTOCOL,
  type EditorHostPageData,
  HELLO_TYPE,
  type Hello,
  type Nack,
} from './protocol.js';

export type HelloWindow = Pick<Window, 'parent' | 'top' | 'addEventListener' | 'removeEventListener'>;

function isHello(data: unknown): data is Hello {
  if (typeof data !== 'object' || data === null || !('type' in data) || !('protocols' in data)) return false;
  const { type, protocols } = data;
  if (type !== HELLO_TYPE || typeof protocols !== 'object' || protocols === null) return false;
  if (!('min' in protocols) || !('max' in protocols)) return false;
  return Number.isInteger(protocols.min) && Number.isInteger(protocols.max);
}

/**
 * Resolves with the port of the first hello from this window's parent whose origin `acceptsOrigin`
 * allows and whose range includes the page's protocol; the answer carries the page's `repo` and
 * `siteId` so the parent can refuse a page that is not the one it framed. A wrong origin is refused
 * and the page keeps listening; a protocol mismatch is refused and rejects. The port is neither
 * started nor given a handler, so messages the parent sends next stay queued for the channel.
 */
export function awaitParentHello(
  win: HelloWindow,
  acceptsOrigin: (origin: string) => boolean,
  page: Pick<EditorHostPageData, 'repo' | 'siteId'>,
): Promise<MessagePort> {
  // Executor form: the package's production lib predates Promise.withResolvers.
  return new Promise((resolve, reject) => {
    const onMessage = (event: MessageEvent) => {
      // Only the top-level parent: a page nested deeper would hand its channel to a frame in between.
      if (!isHello(event.data) || event.source !== win.parent || win.parent !== win.top) return;
      if (event.ports.length !== 1) return;
      const [port] = event.ports;
      if (!acceptsOrigin(event.origin)) {
        port.postMessage({ kind: 'nack', code: 'origin-rejected' } satisfies Nack);
        port.close();
        return;
      }
      win.removeEventListener('message', onMessage);
      const { min, max } = event.data.protocols;
      if (EDITOR_HOST_PROTOCOL < min || EDITOR_HOST_PROTOCOL > max) {
        port.postMessage({ kind: 'nack', code: 'unsupported-protocol', page: EDITOR_HOST_PROTOCOL } satisfies Nack);
        port.close();
        reject(new Error('unsupported-protocol'));
        return;
      }
      port.postMessage({
        kind: 'accepted',
        protocol: EDITOR_HOST_PROTOCOL,
        repo: page.repo,
        siteId: page.siteId,
      } satisfies Accepted);
      resolve(port);
    };
    win.addEventListener('message', onMessage);
  });
}
