/**
 * Backend-agnostic source of content blob bytes.
 *
 * The implementation shipped here is `FileSystemReaderBackend` — it wraps
 * fast-glob + node:fs open/read. Another backend can supply the bytes by
 * implementing the same interface.
 *
 * The index hydrator (`ContentIndex.indexAll`) consumes this interface and
 * never knows which backend produced the bytes. The interface is deliberately
 * backend-agnostic: no filesystem types, no platform storage types, no Node `Buffer`.
 * Only `Uint8Array` and the discriminated `BackendReadResult` flow through it,
 * so the same hydrator code runs on any JavaScript runtime.
 */
export interface ContentReaderBackend {
  /**
   * Stream the set of content paths matching the optional glob, attaching up
   * to `headerBytes` (default 4096) of each blob's bytes plus a `complete`
   * flag set when the buffer holds the entire blob.
   *
   * The header is enough to parse VXJSON manifest metadata and MDX
   * frontmatter without a second read, so the hydrator never has to call
   * `readPath` for index construction.
   *
   * Errors per item are reported as a `BackendReadResult` with `ok: false` —
   * never thrown — so a single corrupt file doesn't abort the whole stream.
   */
  listContentPaths(opts?: { glob?: string; headerBytes?: number }): AsyncIterable<BackendReadResult>;

  /**
   * Read the full bytes of a content path. Returns null if the path no
   * longer exists (race against deletion is acceptable).
   */
  readPath(path: string): Promise<Uint8Array | null>;
}

/**
 * Discriminated union for per-item results from `listContentPaths`.
 * `ok: true` carries the header bytes plus size/complete metadata; `ok: false`
 * carries an errno-derived reason and a human-readable message.
 */
export type BackendReadResult =
  | {
      ok: true;
      path: string;
      size: number;
      header: Uint8Array; // length <= size; complete === true ⇒ length === size
      complete: boolean;
    }
  | {
      ok: false;
      path: string;
      reason: 'not-found' | 'permission-denied' | 'corrupt-header' | 'io-error';
      message: string;
    };
