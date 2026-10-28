/**
 * A port pair that hands messages over by reference.
 *
 * Bun's `MessageChannel` turns a `Blob` into a plain object on the way; browsers
 * keep it. Tests that move Blobs or Files use these ports instead.
 */
export class FakePort extends EventTarget {
  peer: FakePort | null = null;
  /** Everything this port posted, in order. */
  readonly sent: unknown[] = [];
  closed = false;

  postMessage(data: unknown): void {
    if (this.closed) return;
    this.sent.push(data);
    const peer = this.peer;
    queueMicrotask(() => {
      if (peer && !peer.closed) peer.dispatchEvent(new MessageEvent('message', { data }));
    });
  }

  start(): void {}

  close(): void {
    this.closed = true;
  }
}

export function fakePortPair(): [FakePort, FakePort] {
  const a = new FakePort();
  const b = new FakePort();
  a.peer = b;
  b.peer = a;
  return [a, b];
}
