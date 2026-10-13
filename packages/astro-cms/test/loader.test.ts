import { describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LoaderContext } from 'astro/loaders';

import { conlocaLoader } from '../src/loader.js';

describe('conlocaLoader', () => {
  it('refuses to load under a config key that is not its collection', async () => {
    const loader = conlocaLoader({ collection: 'pages', contentRoot: './does-not-matter', kind: 'page' });
    // load() destructures store/parseData/generateDigest/logger off the context
    // but uses none of them before the assertion, so `collection` is the only
    // member this context needs to carry.
    const context = { collection: 'landing' } as LoaderContext;
    await expect(loader.load(context)).rejects.toThrow(/mounted under "landing" but loads "pages"/);
  });

  it('lets the shared fragments loader (no collection) through', async () => {
    // An empty root indexes no content, so the entry loop never runs and only
    // store.clear(), store.keys() and logger.info() are reached.
    const emptyRoot = mkdtempSync(join(tmpdir(), 'conloca-loader-'));
    try {
      const loader = conlocaLoader({ contentRoot: emptyRoot, kind: 'fragment' });
      const context = {
        collection: '__conloca_fragments',
        store: { clear() {}, keys: () => [] },
        logger: { info() {} },
      } as unknown as LoaderContext;
      await expect(loader.load(context)).resolves.toBeUndefined();
    } finally {
      rmSync(emptyRoot, { recursive: true, force: true });
    }
  });

  it('hands parseData the file behind the entry so errors can name it', async () => {
    // Astro reads location.file from parseData's filePath; without it a
    // validation failure names only the opaque content id.
    const root = mkdtempSync(join(tmpdir(), 'conloca-loader-src-'));
    try {
      writeFileSync(
        join(root, 'sites.json'),
        JSON.stringify({ sites: { shop: { locales: ['en'], defaultLocale: 'en' } }, globalLocales: ['en'] }),
      );
      const pagesDir = join(root, 'shop', 'pages');
      mkdirSync(pagesDir, { recursive: true });
      writeFileSync(
        join(pagesDir, 'traced.en.vxjson'),
        JSON.stringify({
          id: 'vx-traced000001',
          type: 'puck',
          site: 'shop',
          collection: 'pages',
          created: '2024-01-01T00:00:00.000Z',
          modified: '2024-01-02T00:00:00.000Z',
          meta: { title: 'Traced', pathname: '/traced' },
          content: { puckData: { root: {} } },
        }),
      );

      const parseDataCalls: { id: string; filePath?: string }[] = [];
      const stored: unknown[] = [];
      const context = {
        collection: 'pages',
        store: {
          clear() {},
          keys: () => stored.map((_, index) => String(index)),
          set(entry: unknown) {
            stored.push(entry);
          },
        },
        parseData: async (input: { id: string; data: Record<string, unknown>; filePath?: string }) => {
          parseDataCalls.push({ id: input.id, filePath: input.filePath });
          return input.data;
        },
        generateDigest: (value: unknown) => String(value),
        logger: { info() {} },
      } as unknown as LoaderContext;

      const loader = conlocaLoader({ collection: 'pages', contentRoot: root, site: 'shop', kind: 'page' });
      await loader.load(context);

      expect(parseDataCalls).toHaveLength(1);
      const { filePath } = parseDataCalls[0];
      expect(filePath).toBeDefined();
      expect(filePath?.endsWith('traced.en.vxjson')).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
