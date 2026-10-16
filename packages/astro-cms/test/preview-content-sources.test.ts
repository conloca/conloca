import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ContentAPI, ContentManifest, GlobalFilters, LocalizedEntry } from '@conloca/content-api';
import { createContentAPI } from '@conloca/content-api/reader';
import { pageMetaSchema } from '@conloca/content-api/schemas';
import type { LoaderContext } from 'astro/loaders';
import { z } from 'zod';
import { createCollectionBackedContentAPI } from '../src/handlers/collection-content-api.js';
import { createCollectionContentSource, createReaderContentSource } from '../src/handlers/page-render-core.js';
import { conlocaLoader } from '../src/loader.js';
import type { ResolvedRoutingConfig } from '../src/types.js';

// Preview render path: the reader source projects a ContentAPI (a host's own
// reader) into the same record shape the collection source produces, and the
// collection-backed ContentAPI reconstructs that ContentAPI surface from Astro
// collections.

const routing = (routes: ResolvedRoutingConfig['routes']): ResolvedRoutingConfig =>
  ({ enabled: true, locale: 'en', siteName: 'default', fallback: '404', routes }) as ResolvedRoutingConfig;

/** A minimal ContentAPI stand-in exposing just the reader-source surface. */
function fakeApi(manifests: ContentManifest[], localized: Record<string, LocalizedEntry>): ContentAPI {
  return {
    *listAllContent(filters?: GlobalFilters) {
      for (const manifest of manifests) {
        if (filters?.collection !== undefined && manifest.collection !== filters.collection) continue;
        if (filters?.kind !== undefined && manifest.kind !== filters.kind) continue;
        yield manifest;
      }
    },
    async getLocalized(id: string, locale: string) {
      return localized[`${id} ${locale}`] ?? null;
    },
  } as unknown as ContentAPI;
}

describe('createReaderContentSource', () => {
  test('projects manifest + per-locale content into records carrying the draft puckData', async () => {
    const manifest: ContentManifest = {
      id: 'home',
      type: 'puck',
      kind: 'page',
      collection: 'pages',
      locales: {
        en: { locale: 'en', pathname: '/', etag: 'e', created: 'c', modified: 'm', meta: { title: 'Home' } },
      },
    };
    const api = fakeApi([manifest], {
      'home en': {
        id: 'home',
        type: 'puck',
        kind: 'page',
        collection: 'pages',
        localized: {
          locale: 'en',
          pathname: '/',
          etag: 'e',
          created: 'c',
          modified: 'm',
          meta: { title: 'Home' },
          content: { puckData: { root: {}, content: [{ type: 'Text', props: { text: 'DRAFT' } }] } },
        },
      },
    });
    const [record] = await createReaderContentSource(api, { schemas: {} }).listEntries('pages');
    expect(record).toMatchObject({ id: 'home', locale: 'en', pathname: '/', title: 'Home' });
    expect((record.puckData as { content: { props: { text: string } }[] }).content[0].props.text).toBe('DRAFT');
  });

  test('maps the synthetic fragments collection to a kind:fragment query and skips mdx pages', async () => {
    const seen: unknown[] = [];
    const api = {
      *listAllContent(filters: { collection?: string; kind?: string }) {
        seen.push(filters);
        // A page whose type is mdx must be skipped by the reader (external renderer).
        yield {
          id: 'mdx-page',
          type: 'mdx',
          kind: 'page',
          collection: 'pages',
          locales: {
            en: { locale: 'en', pathname: '/x', etag: 'e', created: 'c', modified: 'm', meta: { title: 'X' } },
          },
        } satisfies ContentManifest;
      },
      async getLocalized() {
        return null;
      },
    } as unknown as ContentAPI;
    const source = createReaderContentSource(api, { schemas: {} });
    expect(await source.listEntries('__conloca_fragments')).toEqual([]);
    expect(seen).toContainEqual({ kind: 'fragment' });
    // The mdx page is filtered out entirely.
    expect(await source.listEntries('pages')).toEqual([]);
  });
});

describe('createReaderContentSource — render-locale scoping', () => {
  const twoLocaleManifest: ContentManifest = {
    id: 'home',
    type: 'puck',
    kind: 'page',
    collection: 'pages',
    locales: {
      en: { locale: 'en', pathname: '/', etag: 'e', created: 'c', modified: 'm', meta: { title: 'Home' } },
      de: { locale: 'de', pathname: '/de', etag: 'e', created: 'c', modified: 'm', meta: { title: 'Start' } },
    },
  };
  const entryFor = (locale: string): LocalizedEntry => ({
    id: 'home',
    type: 'puck',
    kind: 'page',
    collection: 'pages',
    localized: {
      locale,
      pathname: locale === 'en' ? '/' : '/de',
      etag: 'e',
      created: 'c',
      modified: 'm',
      meta: { title: locale === 'en' ? 'Home' : 'Start' },
      content: { puckData: { root: {}, content: [] } },
    },
  });

  test('fetches only the render locale when one is given (every consumer filters to it anyway)', async () => {
    // Each getLocalized is one read against the host's reader; shaping
    // locales the consumers immediately filter out is wasted work.
    const fetched: string[] = [];
    const api = fakeApi([twoLocaleManifest], { 'home en': entryFor('en'), 'home de': entryFor('de') });
    const inner = api.getLocalized.bind(api);
    api.getLocalized = (id: string, locale: string) => {
      fetched.push(locale);
      return inner(id, locale);
    };
    const records = await createReaderContentSource(api, { renderLocale: 'en', schemas: {} }).listEntries('pages');
    expect(records.map((record) => record.locale)).toEqual(['en']);
    expect(fetched).toEqual(['en']);
  });

  test('keeps shaping every locale when no render locale is given', async () => {
    const api = fakeApi([twoLocaleManifest], { 'home en': entryFor('en'), 'home de': entryFor('de') });
    const records = await createReaderContentSource(api, { schemas: {} }).listEntries('pages');
    expect(records.map((record) => record.locale).sort()).toEqual(['de', 'en']);
  });
});

describe('createReaderContentSource — the collection schema runs on preview records', () => {
  // A host collection mounted on conlocaLoader with a schema of its own: a
  // coerced date and a defaulted field, beside the core publishAt coercion.
  const schema = z.looseObject({
    ...pageMetaSchema.shape,
    eventDate: z.coerce.date(),
    badge: z.string().default('new'),
  });

  function writeContentRoot(meta: Record<string, unknown>): string {
    const root = mkdtempSync(join(tmpdir(), 'conloca-preview-parse-'));
    writeFileSync(
      join(root, 'sites.json'),
      JSON.stringify({ sites: { shop: { locales: ['en'], defaultLocale: 'en' } }, globalLocales: ['en'] }),
    );
    const pagesDir = join(root, 'shop', 'pages');
    mkdirSync(pagesDir, { recursive: true });
    writeFileSync(
      join(pagesDir, 'launch.en.vxjson'),
      JSON.stringify({
        id: 'vx-launch000001',
        type: 'puck',
        site: 'shop',
        collection: 'pages',
        created: '2026-09-01T00:00:00.000Z',
        modified: '2026-09-02T00:00:00.000Z',
        publishAt: '2026-09-08T00:00:00.000Z',
        meta: { title: 'Launch', pathname: '/launch', ...meta },
        content: { puckData: { root: {}, content: [] } },
      }),
    );
    return root;
  }

  /** The build's records: conlocaLoader run with Astro's parseData standing in as this schema's parse. */
  async function builtRecords(root: string): Promise<Record<string, unknown>[]> {
    const stored: { data: unknown }[] = [];
    const context = {
      collection: 'pages',
      store: {
        clear() {},
        keys: () => stored.map((_, index) => String(index)),
        set(entry: { data: unknown }) {
          stored.push(entry);
        },
      },
      parseData: async ({ data }: { data: Record<string, unknown> }) => schema.parseAsync(data),
      generateDigest: (value: unknown) => String(value),
      logger: { info() {} },
    } as unknown as LoaderContext;
    await conlocaLoader({ collection: 'pages', contentRoot: root, site: 'shop', kind: 'page' }).load(context);
    return createCollectionContentSource({ getCollection: async () => stored, isDev: false }).listEntries('pages');
  }

  test('a preview record carries the same values as the built one: Dates, defaults applied', async () => {
    const root = writeContentRoot({ eventDate: '2026-10-01' });
    try {
      const built = await builtRecords(root);
      const api = await createContentAPI({ contentRoot: root });
      const previewed = await createReaderContentSource(api, { schemas: { pages: schema } }).listEntries('pages');

      expect(previewed).toEqual(built);
      const [record] = previewed;
      expect(record.eventDate).toBeInstanceOf(Date);
      expect((record.eventDate as Date).toISOString()).toBe('2026-10-01T00:00:00.000Z');
      expect(record.publishAt).toBeInstanceOf(Date);
      expect((record.publishAt as Date).toISOString()).toBe('2026-09-08T00:00:00.000Z');
      expect(record.badge).toBe('new');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('a draft the collection schema rejects fails the render, as it would fail the build', async () => {
    const root = writeContentRoot({ eventDate: 'not a date' });
    try {
      const api = await createContentAPI({ contentRoot: root });
      const source = createReaderContentSource(api, { schemas: { pages: schema } });
      await expect(source.listEntries('pages')).rejects.toThrow(/vx-launch000001.*"pages"/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('a collection with no declared schema passes its records through as the reader gives them', async () => {
    const root = writeContentRoot({ eventDate: '2026-10-01' });
    try {
      const api = await createContentAPI({ contentRoot: root });
      const [record] = await createReaderContentSource(api, { schemas: {} }).listEntries('pages');
      expect(record.eventDate).toBe('2026-10-01');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('an entry served from the build-parsed baseline is handed out as built, not parsed again', async () => {
    // A data schema may change a value's type; parsing its output again rejects it.
    const prices = z.looseObject({
      id: z.string(),
      locale: z.string(),
      name: z.string(),
      data: z.object({ price: z.string().transform(Number) }),
    });
    const built = prices.parse({ id: 'item', locale: 'en', name: 'item', data: { price: '12' } });
    const api = await createCollectionBackedContentAPI({
      getCollection: async (collection) => (collection === 'prices' ? [{ data: built }] : []),
      routing: routing({
        pages: { pattern: '/[...slug]', collection: 'pages', dataBindings: { collections: ['prices'] } } as never,
      }),
    });
    const records = await createReaderContentSource(api, { schemas: { prices } }).listEntries('prices');
    expect(records).toEqual([built]);
  });
});

describe('createCollectionBackedContentAPI', () => {
  const config = routing({ pages: { pattern: '/[...slug]', collection: 'pages' } as never });

  test('reconstructs a manifest + localized content from flattened collection records', async () => {
    const api = await createCollectionBackedContentAPI({
      getCollection: async (collection) =>
        collection === 'pages'
          ? [{ data: { id: 'home', locale: 'en', pathname: '/', title: 'Home', puckData: { content: [] } } }]
          : [],
      routing: config,
    });

    const manifests = [...api.listAllContent({ collection: 'pages' })];
    expect(manifests).toHaveLength(1);
    expect(manifests[0]).toMatchObject({ id: 'home', kind: 'page', type: 'puck', collection: 'pages' });
    expect(manifests[0].locales.en?.pathname).toBe('/');

    const localized = await api.getLocalized('home', 'en');
    expect(localized?.localized.content.puckData).toEqual({ content: [] });
    expect(localized?.localized.meta.title).toBe('Home');
  });

  test('routes the synthetic fragments collection through a kind:fragment listing', async () => {
    const api = await createCollectionBackedContentAPI({
      getCollection: async (collection) =>
        collection === '__conloca_fragments'
          ? [{ data: { id: 'welcome', locale: 'en', name: 'welcome', mdx: '# Hi' } }]
          : [],
      routing: config,
    });
    const fragments = [...api.listAllContent({ kind: 'fragment' })];
    expect(fragments.map((manifest) => manifest.id)).toEqual(['welcome']);
    expect((await api.getLocalized('welcome', 'en'))?.localized.content.mdx).toBe('# Hi');
  });

  test('rejects writes (read-only)', async () => {
    const api = await createCollectionBackedContentAPI({ getCollection: async () => [], routing: config });
    const result = await api.createContent({} as never);
    expect(result.success).toBe(false);
  });
});
