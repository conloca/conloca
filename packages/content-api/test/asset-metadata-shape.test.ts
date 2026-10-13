import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as store from '../src/asset-metadata-store.js';

let project: string;
let roots: store.MetadataRoots;
beforeEach(async () => {
  project = await mkdtemp(join(tmpdir(), 'metadata-shape-'));
  roots = { assetsPath: join(project, 'assets'), contentRoot: join(project, 'content') };
  await mkdir(roots.assetsPath);
  await mkdir(join(roots.contentRoot, '.asset-metadata'), { recursive: true });
});
afterEach(async () => {
  await rm(project, { recursive: true, force: true });
});
const record = () => join(roots.contentRoot, '.asset-metadata', 'hero.png.json');
const invalid = [
  null,
  false,
  42,
  'not metadata',
  [],
  ['tag'],
  { alt: 5 },
  { alt: null },
  { tags: 'tag' },
  { tags: [1] },
  { tags: [null] },
  { uploadedAt: false },
  { uploadedBy: {} },
  { originalName: [] },
];

describe('syntactically valid JSON is not necessarily asset metadata', () => {
  for (const value of invalid) {
    const bytes = JSON.stringify(value);
    test(`read tolerates malformed record ${bytes} without exposing it`, async () => {
      await writeFile(record(), bytes);
      expect(await store.read(roots, 'hero.png')).toBeUndefined();
      expect(await store.readFolder(roots, '/')).toEqual(new Map());
    });
    test(`update refuses malformed record ${bytes} without changing its bytes`, async () => {
      await writeFile(record(), bytes);
      await expect(store.update(roots, 'hero.png', { alt: 'Replacement' })).rejects.toThrow(/unreadable|damaged/i);
      expect(await readFile(record(), 'utf8')).toBe(bytes);
    });
  }
  test('unknown extension fields and empty valid records survive ordinary updates', async () => {
    await writeFile(record(), JSON.stringify({ extension: { revision: 3 } }));
    await store.update(roots, 'hero.png', { tags: ['safe'] });
    expect(JSON.parse(await readFile(record(), 'utf8'))).toEqual({ extension: { revision: 3 }, tags: ['safe'] });
    await writeFile(record(), '{}');
    expect(await store.update(roots, 'hero.png', { alt: '' })).toEqual({ alt: '' });
  });
});

describe('legacy migration validates before writing any records', () => {
  for (const value of [null, false, 42, 'manifest', [], { 'hero.png': null }, { 'hero.png': { tags: 'invalid' } }]) {
    test(`rejects malformed legacy manifest ${JSON.stringify(value)}`, async () => {
      const bytes = JSON.stringify(value);
      const path = join(roots.assetsPath, '.asset-manifest.json');
      await writeFile(path, bytes);
      await expect(store.migrateLegacyManifest(roots)).rejects.toThrow(/manifest|metadata/i);
      expect(await readFile(path, 'utf8')).toBe(bytes);
      expect(await readdir(join(roots.contentRoot, '.asset-metadata'))).toEqual([]);
    });
  }
});
