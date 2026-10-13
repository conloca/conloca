import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SHIM_PATH = join(import.meta.dir, '../src/internal/acorn-default.mjs');

describe('acorn SSR shim', () => {
  test('loads without Node-only APIs so workerd bundles can boot', () => {
    // createRequire(import.meta.url) throws at module scope inside a Workers
    // bundle (import.meta.url is undefined there), so the bundle cannot serve
    // any request. The shim must resolve acorn with a static import.
    const source = readFileSync(SHIM_PATH, 'utf8');

    expect(source).not.toContain('createRequire');
  });

  test('still provides the named and default acorn surface', async () => {
    const shim = await import(SHIM_PATH);

    expect(typeof shim.Parser).toBe('function');
    expect(typeof shim.parse).toBe('function');
    expect(shim.default.Parser).toBe(shim.Parser);
  });
});
