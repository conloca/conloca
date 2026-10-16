import { describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LoaderContext } from 'astro/loaders';

import { createPageEntryParser } from '../src/internal/entry-validation.js';
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

  describe('parseEntry — validation before the store', () => {
    /** One page whose stored meta the test controls, plus a recording context. */
    function seedPage(meta: Record<string, unknown>, schedule: Record<string, unknown> = {}) {
      const root = mkdtempSync(join(tmpdir(), 'conloca-loader-validate-'));
      writeFileSync(
        join(root, 'sites.json'),
        JSON.stringify({ sites: { shop: { locales: ['en'], defaultLocale: 'en' } }, globalLocales: ['en'] }),
      );
      const pagesDir = join(root, 'shop', 'pages');
      mkdirSync(pagesDir, { recursive: true });
      writeFileSync(
        join(pagesDir, 'checked.en.vxjson'),
        JSON.stringify({
          id: 'vx-checked00001',
          type: 'puck',
          site: 'shop',
          collection: 'pages',
          created: '2024-01-01T00:00:00.000Z',
          modified: '2024-01-02T00:00:00.000Z',
          ...schedule,
          meta: { pathname: '/checked', ...meta },
          content: { puckData: { root: {} } },
        }),
      );
      const stored: { id: string; data: Record<string, unknown> }[] = [];
      const context = {
        collection: 'pages',
        store: {
          clear() {},
          keys: () => stored.map((entry) => entry.id),
          set(entry: { id: string; data: Record<string, unknown> }) {
            stored.push(entry);
          },
        },
        parseData: async (input: { data: Record<string, unknown> }) => input.data,
        generateDigest: (value: unknown) => String(value),
        logger: { info() {} },
      } as unknown as LoaderContext;
      return { root, stored, context };
    }

    it('stores what the generated validators returned — publish dates coerced to Date', async () => {
      const { root, stored, context } = seedPage({ title: 'Checked' }, { publishAt: '2026-01-02T03:04:05.000Z' });
      try {
        const loader = conlocaLoader({
          collection: 'pages',
          contentRoot: root,
          site: 'shop',
          kind: 'page',
          parseEntry: createPageEntryParser(),
        });
        await loader.load(context);
        expect(stored).toHaveLength(1);
        expect(stored[0]?.data.publishAt).toEqual(new Date('2026-01-02T03:04:05.000Z'));
        expect(stored[0]?.data.puckData).toEqual({ root: {} });
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });

    it('fails the load before storing an entry that does not match, naming the entry, file and issue', async () => {
      const { root, stored, context } = seedPage({ title: 42 });
      try {
        const loader = conlocaLoader({
          collection: 'pages',
          contentRoot: root,
          site: 'shop',
          kind: 'page',
          parseEntry: createPageEntryParser(),
        });
        const failure = loader.load(context);
        await expect(failure).rejects.toThrow(/pages entry "vx-checked00001\/en"/);
        await expect(failure).rejects.toThrow(/checked\.en\.vxjson/);
        await expect(failure).rejects.toThrow(/\$input\.title: expected string, received 42/);
        expect(stored).toHaveLength(0);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
  });
});
