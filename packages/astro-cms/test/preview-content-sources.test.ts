import { describe, expect, test } from 'bun:test';
import type { ContentAPI, ContentManifest, GlobalFilters, LocalizedEntry } from '@conloca/content-api';
import { createCollectionBackedContentAPI } from '../src/handlers/collection-content-api.js';
import { createReaderContentSource } from '../src/handlers/page-render-core.js';
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
    const [record] = await createReaderContentSource(api).listEntries('pages');
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
    const source = createReaderContentSource(api);
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
    const records = await createReaderContentSource(api, 'en').listEntries('pages');
    expect(records.map((record) => record.locale)).toEqual(['en']);
    expect(fetched).toEqual(['en']);
  });

  test('keeps shaping every locale when no render locale is given', async () => {
    const api = fakeApi([twoLocaleManifest], { 'home en': entryFor('en'), 'home de': entryFor('de') });
    const records = await createReaderContentSource(api).listEntries('pages');
    expect(records.map((record) => record.locale).sort()).toEqual(['de', 'en']);
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
