/**
 * Tests for FileSystemReaderBackend — the filesystem adapter that drives
 * ContentIndex.indexAll for filesystem-backed deployments.
 *
 * Conformance scope:
 *   1. Glob filtering — the default '**\/*.{vxjson,mdx,json}' plus caller overrides.
 *   2. Path normalisation — paths emitted relative to contentRoot, forward slashes.
 *   3. Header copying — yielded headers are independent buffers (not aliasing the
 *      reusable pool); mutating one yielded header must not corrupt the next.
 *   4. Errors-as-data — FS-level failures surface as { ok: false, reason, ... }
 *      with `reason` derived from errno (ENOENT → not-found, EACCES → permission-denied,
 *      anything else → io-error).
 *   5. readPath behavior — returns null for ENOENT (race-against-deletion), bytes otherwise.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileSystemReaderBackend } from '../src/filesystem-reader-backend.js';

describe('FileSystemReaderBackend', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'fs-backend-'));
  });

  afterEach(async () => {
    // Restore permissions on any files we may have chmodded so cleanup works.
    try {
      await chmod(root, 0o755);
    } catch {
      // ignore
    }
    await rm(root, { recursive: true, force: true });
  });

  describe('listContentPaths', () => {
    it('streams files matching the default glob with forward-slash paths relative to contentRoot', async () => {
      await mkdir(join(root, 'shop/pages'), { recursive: true });
      await writeFile(join(root, 'shop/pages/a.en.vxjson'), '{ "v": 1 }');
      await writeFile(join(root, 'shop/pages/b.en.vxjson'), '{ "v": 2 }');
      await mkdir(join(root, 'fragments/hero'), { recursive: true });
      await writeFile(join(root, 'fragments/hero/welcome.en.mdx'), '---\ntitle: Hi\n---\nbody');

      const backend = new FileSystemReaderBackend({ contentRoot: root });
      const collected: string[] = [];
      for await (const result of backend.listContentPaths()) {
        if (result.ok) collected.push(result.path);
      }

      expect(collected).toContain('shop/pages/a.en.vxjson');
      expect(collected).toContain('shop/pages/b.en.vxjson');
      expect(collected).toContain('fragments/hero/welcome.en.mdx');
      // No backslashes even when run on Windows — verify forward-slash invariant.
      for (const path of collected) {
        expect(path).not.toContain('\\');
      }
    });

    it('honours a caller-supplied glob override', async () => {
      await mkdir(join(root, 'shop/pages'), { recursive: true });
      await writeFile(join(root, 'shop/pages/page.en.vxjson'), '{}');
      await mkdir(join(root, 'fragments/hero'), { recursive: true });
      await writeFile(join(root, 'fragments/hero/welcome.en.mdx'), '---\n---\n');

      const backend = new FileSystemReaderBackend({ contentRoot: root });
      const onlyMdx: string[] = [];
      for await (const result of backend.listContentPaths({ glob: '**/*.mdx' })) {
        if (result.ok) onlyMdx.push(result.path);
      }

      expect(onlyMdx).toEqual(['fragments/hero/welcome.en.mdx']);
    });

    it('honours headerBytes — header.length never exceeds the requested size', async () => {
      await mkdir(join(root, 'shop/pages'), { recursive: true });
      const bytes = `{"id":"x","meta":{"title":"${'A'.repeat(8000)}"},"content":{}}`;
      await writeFile(join(root, 'shop/pages/big.en.vxjson'), bytes);

      const backend = new FileSystemReaderBackend({ contentRoot: root });
      for await (const result of backend.listContentPaths({ headerBytes: 128 })) {
        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error('unreachable');
        expect(result.header.byteLength).toBe(128);
        expect(result.complete).toBe(false);
        expect(result.size).toBe(Buffer.byteLength(bytes));
      }
    });

    it('marks complete=true when header covers the full blob', async () => {
      await mkdir(join(root, 'shop/pages'), { recursive: true });
      await writeFile(join(root, 'shop/pages/tiny.en.vxjson'), '{}');

      const backend = new FileSystemReaderBackend({ contentRoot: root });
      for await (const result of backend.listContentPaths({ headerBytes: 4096 })) {
        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error('unreachable');
        expect(result.complete).toBe(true);
        expect(result.header.byteLength).toBe(2);
      }
    });

    it('yields independent buffers — mutating one header does not poison the next', async () => {
      await mkdir(join(root, 'shop/pages'), { recursive: true });
      await writeFile(join(root, 'shop/pages/a.en.vxjson'), 'AAAAAAAA');
      await writeFile(join(root, 'shop/pages/b.en.vxjson'), 'BBBBBBBB');

      // batchSize=1 forces the buffer pool to contain a single buffer that
      // would be reused for both files. A backend that yields a slice of the
      // pooled buffer would have its first-yielded header overwritten by the
      // second read; this test catches that aliasing bug.
      const backend = new FileSystemReaderBackend({ contentRoot: root, batchSize: 1 });
      const headers: { path: string; bytes: Uint8Array }[] = [];
      for await (const result of backend.listContentPaths()) {
        if (!result.ok) throw new Error(`unexpected error: ${result.message}`);
        headers.push({ path: result.path, bytes: result.header });
      }

      expect(headers).toHaveLength(2);

      // Mutate the first yielded header; the second must still equal its source.
      headers[0].bytes[0] = 0;
      const second = headers[1];
      const decoded = new TextDecoder().decode(second.bytes);
      expect(decoded).toMatch(/^(AAAAAAAA|BBBBBBBB)$/);
      // And the first should reflect our mutation (we are holding the yielded copy).
      expect(headers[0].bytes[0]).toBe(0);
    });

    it('reports EACCES as { ok: false, reason: permission-denied } on POSIX', async () => {
      // Windows file ACLs don't honour chmod the same way; skip on win32.
      if (process.platform === 'win32') return;
      await mkdir(join(root, 'shop/pages'), { recursive: true });
      const filePath = join(root, 'shop/pages/locked.en.vxjson');
      await writeFile(filePath, '{}');
      await chmod(filePath, 0o000);

      try {
        const backend = new FileSystemReaderBackend({ contentRoot: root });
        const results: Array<{ ok: false; reason: string; path: string } | { ok: true; path: string }> = [];
        for await (const result of backend.listContentPaths()) {
          if (result.ok) {
            results.push({ ok: true, path: result.path });
          } else {
            results.push({ ok: false, reason: result.reason, path: result.path });
          }
        }
        const failure = results.find((r) => !r.ok && r.path === 'shop/pages/locked.en.vxjson');
        // Some sandboxes elevate to root and chmod 000 still readable; skip cleanly.
        if (!failure) return;
        if (failure.ok) throw new Error('unreachable');
        expect(failure.reason).toBe('permission-denied');
      } finally {
        // Restore so afterEach can clean up.
        await chmod(filePath, 0o644).catch(() => {});
      }
    });
  });

  describe('readPath', () => {
    it('returns null when the path no longer exists', async () => {
      const backend = new FileSystemReaderBackend({ contentRoot: root });
      const bytes = await backend.readPath('does/not/exist.vxjson');
      expect(bytes).toBeNull();
    });

    it('returns the full bytes for an existing path', async () => {
      await mkdir(join(root, 'data/posts'), { recursive: true });
      await writeFile(join(root, 'data/posts/hello.en.json'), '{"hello":"world"}');

      const backend = new FileSystemReaderBackend({ contentRoot: root });
      const bytes = await backend.readPath('data/posts/hello.en.json');
      expect(bytes).not.toBeNull();
      if (bytes === null) throw new Error('unreachable');
      expect(new TextDecoder().decode(bytes)).toBe('{"hello":"world"}');
    });
  });
});
