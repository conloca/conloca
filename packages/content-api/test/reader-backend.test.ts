import { describe, expect, it } from 'bun:test';
import type { BackendReadResult, ContentReaderBackend } from '../src/reader-backend.js';

// Reference in-memory backend used to verify the shape compiles & iterates correctly.
function makeMemoryBackend(items: Map<string, Uint8Array>): ContentReaderBackend {
  return {
    async *listContentPaths(opts) {
      const headerBytes = opts?.headerBytes ?? 4096;
      for (const [path, bytes] of items) {
        const headerLen = Math.min(bytes.byteLength, headerBytes);
        yield {
          ok: true,
          path,
          size: bytes.byteLength,
          header: bytes.subarray(0, headerLen),
          complete: headerLen === bytes.byteLength,
        };
      }
    },
    async readPath(path) {
      return items.get(path) ?? null;
    },
  };
}

describe('ContentReaderBackend contract', () => {
  it('streams items with header.length <= size', async () => {
    const backend = makeMemoryBackend(new Map([['a.vxjson', new Uint8Array(8000)]]));
    const results: BackendReadResult[] = [];
    for await (const r of backend.listContentPaths({ headerBytes: 1024 })) {
      results.push(r);
    }
    expect(results).toHaveLength(1);
    if (!results[0].ok) throw new Error('expected ok');
    expect(results[0].header.byteLength).toBe(1024);
    expect(results[0].complete).toBe(false);
    expect(results[0].size).toBe(8000);
  });

  it('marks complete=true when header covers full blob', async () => {
    const bytes = new TextEncoder().encode('{"v":1}');
    const backend = makeMemoryBackend(new Map([['small.json', bytes]]));
    for await (const r of backend.listContentPaths({ headerBytes: 4096 })) {
      if (!r.ok) throw new Error('unexpected');
      expect(r.complete).toBe(true);
      expect(r.header.byteLength).toBe(bytes.byteLength);
    }
  });

  it('readPath returns null for unknown paths', async () => {
    const backend = makeMemoryBackend(new Map());
    expect(await backend.readPath('nope.vxjson')).toBeNull();
  });

  // The whole reason this interface is a discriminated union (not the original
  // ContentPathHeader shape) is that per-item read failures must be reportable
  // as data, so a single corrupt or unreadable file doesn't abort an index
  // build over millions of paths. The next two tests pin that invariant.
  it('emits {ok: false, ...} entries inline with successes — stream does not abort', async () => {
    async function* mixedBackend(): AsyncIterable<BackendReadResult> {
      yield {
        ok: true,
        path: 'a.vxjson',
        size: 5,
        header: new Uint8Array([1, 2, 3, 4, 5]),
        complete: true,
      };
      yield {
        ok: false,
        path: 'b.vxjson',
        reason: 'corrupt-header',
        message: 'unexpected EOF parsing VXJSON header at offset 12',
      };
      yield {
        ok: true,
        path: 'c.vxjson',
        size: 2,
        header: new Uint8Array([9, 9]),
        complete: true,
      };
    }
    const results: BackendReadResult[] = [];
    for await (const r of mixedBackend()) results.push(r);
    expect(results).toHaveLength(3);
    expect(results.map((r) => r.path)).toEqual(['a.vxjson', 'b.vxjson', 'c.vxjson']);
    const bad = results[1];
    if (bad.ok) throw new Error('expected ok:false for b.vxjson');
    expect(bad.reason).toBe('corrupt-header');
    expect(bad.message).toContain('VXJSON header');
  });

  it('all four reason literals are valid (compile-time pinning of the union)', () => {
    // Compile-time check: if a future change removes one of the reasons, the
    // narrowing here stops being exhaustive and TS surfaces it. The runtime
    // assertion is trivial — the real test is the type system.
    const reasons: Array<Extract<BackendReadResult, { ok: false }>['reason']> = [
      'not-found',
      'permission-denied',
      'corrupt-header',
      'io-error',
    ];
    expect(reasons).toHaveLength(4);
  });
});
