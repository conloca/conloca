import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { COMPONENT_MANIFEST_LIMITS, JsonBudgetExceeded, measureJson } from '../src/component-vocabulary.js';

const manifestPath = resolve(import.meta.dirname, '../package.json');
test('the shared vocabulary policy has a public package export', () => {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  expect(manifest.private).not.toBe(true);
  expect(manifest.exports['./component-vocabulary']).toEqual({
    types: './dist/component-vocabulary.d.ts',
    import: './dist/component-vocabulary.js',
    default: './dist/component-vocabulary.js',
  });
});

test('canonical public limits retain exact UTF-8 boundary behavior', () => {
  const value = { title: 'é😀', enabled: true };
  const bytes = new TextEncoder().encode(JSON.stringify(value)).byteLength;
  expect(COMPONENT_MANIFEST_LIMITS).toEqual({ bytes: 4_000_000, nodes: 100_000, depth: 64 });
  expect(measureJson(value, { bytes, nodes: 10, depth: 3 }).bytes).toBe(bytes);
  expect(() => measureJson(value, { bytes: bytes - 1, nodes: 10, depth: 3 })).toThrow(JsonBudgetExceeded);
});
