import { describe, expect, test } from 'bun:test';
import type { Config } from '@puckeditor/core';
import { type ComponentType, createElement } from 'react';
import {
  buildDataContext,
  createCollectionContentSource,
  getDataCollectionEntries,
  getPageEntries,
  getPagesByPrefix,
  loadMdxComponents,
  normalizePathname,
  type PageContentSource,
  pageNotFoundResponse,
  resolvePuckData,
} from '../src/handlers/page-render-core.js';
import { resolveRouteConfig } from '../src/lib/routing-config.js';
import type { DataContext, ResolvedRoutingConfig } from '../src/types.js';

// The extracted render core is pinned two ways: the
// before/after `astro build` byte-diff of example/website-with-cms proves the
// production render is unchanged, and these unit tests pin the pure logic.

/** A fake {@link PageContentSource} over an in-memory collection map. */
function sourceOf(byCollection: Record<string, Record<string, unknown>[]>): PageContentSource {
  return {
    listEntries: async (collection) => byCollection[collection] ?? [],
  };
}

const routingConfig = (routes: ResolvedRoutingConfig['routes']): ResolvedRoutingConfig =>
  ({ enabled: true, locale: 'en', siteName: 'default', fallback: '404', routes }) as ResolvedRoutingConfig;

describe('normalizePathname', () => {
  // Site nav links carry trailing slashes ('/faq/') while entry pathnames are
  // canonical ('/faq'); the SSR fallback matches by exact string equality, so
  // both sides must normalize through this one helper.
  test('strips a trailing slash', () => {
    expect(normalizePathname('/faq/')).toBe('/faq');
  });

  test('strips repeated trailing slashes', () => {
    expect(normalizePathname('/a/b///')).toBe('/a/b');
  });

  test('keeps the root pathname as /', () => {
    expect(normalizePathname('/')).toBe('/');
  });

  test('leaves canonical pathnames untouched', () => {
    expect(normalizePathname('/about')).toBe('/about');
  });
});

describe('createCollectionContentSource', () => {
  test('projects Astro entries onto their `.data` records', async () => {
    const source = createCollectionContentSource({
      getCollection: async () => [{ data: { id: 'a', locale: 'en' } }, { data: { id: 'b', locale: 'en' } }],
      isDev: false,
    });
    expect(await source.listEntries('pages')).toEqual([
      { id: 'a', locale: 'en' },
      { id: 'b', locale: 'en' },
    ]);
  });

  test('caches per collection in production (one getCollection call for repeated reads)', async () => {
    let calls = 0;
    const source = createCollectionContentSource({
      getCollection: async () => {
        calls += 1;
        return [{ data: { id: 'a' } }];
      },
      isDev: false,
    });
    await source.listEntries('pages');
    await source.listEntries('pages');
    expect(calls).toBe(1);
  });

  test('re-reads on every call in dev (cache bypassed)', async () => {
    let calls = 0;
    const source = createCollectionContentSource({
      getCollection: async () => {
        calls += 1;
        return [];
      },
      isDev: true,
    });
    await source.listEntries('pages');
    await source.listEntries('pages');
    expect(calls).toBe(2);
  });

  test('treats a missing/empty collection as no entries, not an error', async () => {
    const source = createCollectionContentSource({
      getCollection: async (name) => {
        throw new Error(`The collection "${name}" does not exist or is empty`);
      },
      isDev: false,
    });
    expect(await source.listEntries('ghost')).toEqual([]);
  });
});

describe('getPageEntries', () => {
  test('keeps only published entries of the locale that carry a pathname', async () => {
    const source = sourceOf({
      pages: [
        { id: 'home', locale: 'en', pathname: '/' },
        { id: 'de', locale: 'de', pathname: '/de' },
        { id: 'draft', locale: 'en', pathname: '/draft', publishAt: '2999-01-01' },
        { id: 'nopath', locale: 'en' },
      ],
    });
    const entries = await getPageEntries(source, 'pages', 'en');
    expect(entries.map((entry) => entry.id)).toEqual(['home']);
  });

  test('drops a record without a string id instead of typing it into a PageReference', async () => {
    const source = sourceOf({
      pages: [
        { id: 'home', locale: 'en', pathname: '/' },
        { locale: 'en', pathname: '/no-id' },
        { id: 42, locale: 'en', pathname: '/numeric-id' },
      ],
    });
    const entries = await getPageEntries(source, 'pages', 'en');
    expect(entries.map((entry) => entry.id)).toEqual(['home']);
  });
});

describe('getDataCollectionEntries', () => {
  test('shapes published named entries into id/name/data/meta records', async () => {
    const source = sourceOf({
      testimonials: [
        { id: 't1', locale: 'en', name: 'acme', title: 'Acme', data: { quote: 'Great' } },
        { id: 't2', locale: 'en' /* no name → dropped */ },
      ],
    });
    const entries = await getDataCollectionEntries(source, 'testimonials', 'en');
    expect(entries).toEqual([
      { id: 't1', name: 'acme', data: { quote: 'Great' }, meta: { title: 'Acme', description: undefined } },
    ]);
  });
});

describe('getPagesByPrefix', () => {
  const config = routingConfig({ pages: { pattern: '/[...slug]', collection: 'pages' } as never });

  test('filters by prefix (excluding the prefix root), lists the newest publish date first, never by last edit, and limits', async () => {
    // The Astro page schema hands publishAt over as a Date.
    const scheduledFor = new Date('2024-06-01T00:00:00.000Z');
    const source = sourceOf({
      pages: [
        { id: 'edited', locale: 'en', pathname: '/blog/edited', created: '2024-01-01', modified: '2024-12-01' },
        {
          id: 'scheduled',
          locale: 'en',
          pathname: '/blog/scheduled',
          created: '2024-02-01',
          modified: '2024-02-01',
          publishAt: scheduledFor,
        },
        { id: 'new', locale: 'en', pathname: '/blog/new', created: '2024-05-01', modified: '2024-05-01' },
        { id: 'root', locale: 'en', pathname: '/blog/' },
        { id: 'other', locale: 'en', pathname: '/about' },
      ],
    });
    const pages = await getPagesByPrefix(source, '/blog/', 'en', config, { sort: 'date-desc', limit: 2 });
    expect(pages.map((page) => page.pathname)).toEqual(['/blog/scheduled', '/blog/new']);
    expect(pages[0].timestamps?.published).toEqual(scheduledFor);
  });

  test('peels host meta off the flattened entry without dropping author or tags', async () => {
    const source = sourceOf({
      pages: [
        {
          id: 'a',
          locale: 'en',
          pathname: '/blog/a',
          title: 'A',
          author: 'Jane',
          tags: ['cms'],
          excerpt: 'Hello',
          created: '2026-08-01T00:00:00.000Z',
          modified: '2026-08-02T00:00:00.000Z',
          puckData: { content: [] },
        },
      ],
    });
    const pages = await getPagesByPrefix(source, '/blog/', 'en', config);
    expect(pages).toHaveLength(1);
    expect(pages[0].meta).toMatchObject({ title: 'A', author: 'Jane', tags: ['cms'], excerpt: 'Hello' });
    for (const structural of ['id', 'locale', 'pathname', 'created', 'modified', 'puckData']) {
      expect(pages[0].meta).not.toHaveProperty(structural);
    }
  });

  test('excludes unpublished entries and the listing page without its trailing slash', async () => {
    const source = sourceOf({
      pages: [
        { id: 'a', locale: 'en', pathname: '/blog/a' },
        { id: 'listing', locale: 'en', pathname: '/blog' },
        { id: 'future', locale: 'en', pathname: '/blog/future', publishAt: '2999-01-01T00:00:00.000Z' },
      ],
    });
    const pages = await getPagesByPrefix(source, '/blog/', 'en', config);
    expect(pages.map((page) => page.id)).toEqual(['a']);
  });
});

describe('buildDataContext', () => {
  const config = routingConfig({ pages: resolveRouteConfig({ pattern: '/[...slug]' }) });
  const rendered = { id: 'p', locale: 'en', pathname: '/blog/p', title: 'P', author: 'Ada' };

  test('tells blocks which page they render, with its settings, on a route that binds nothing', async () => {
    const context = await buildDataContext(sourceOf({}), config.routes.pages, config, rendered);

    expect(context.page).toMatchObject({ id: 'p', pathname: '/blog/p', meta: { title: 'P', author: 'Ada' } });
    expect(context).toMatchObject({ collections: {}, locale: 'en', siteName: 'default' });
    expect(context).not.toHaveProperty('pages');
  });

  test('assembles bound collections and pages-by-prefix into a context', async () => {
    const source = sourceOf({
      testimonials: [{ id: 't1', locale: 'en', name: 'acme', data: { quote: 'Hi' } }],
      pages: [{ id: 'p', locale: 'en', pathname: '/blog/p' }],
    });
    const route = {
      pattern: '/[...slug]',
      collection: 'pages',
      dataBindings: { collections: ['testimonials'], pages: { prefix: '/blog/' } },
    } as never;
    const context = await buildDataContext(source, route, config, rendered);
    expect(context.collections.testimonials[0]?.name).toBe('acme');
    expect(context.pages?.map((page) => page.pathname)).toEqual(['/blog/p']);
    expect(context.siteName).toBe('default');
    expect(context.page.id).toBe('p');
  });
});

describe('resolvePuckData', () => {
  test("hands each block's resolver the data context itself", async () => {
    const config: Config = {
      components: {
        Heading: {
          fields: { title: { type: 'text' } },
          render: ({ title }) => createElement('h1', null, title),
          resolveData: (_data, { metadata }) => ({ props: { title: (metadata as DataContext).page.title } }),
        },
      },
    };
    const context: DataContext = {
      collections: {},
      locale: 'en',
      siteName: 'default',
      page: { id: 'p', pathname: '/blog/p', title: 'From settings', collection: 'pages' },
    };

    const resolved = await resolvePuckData(
      { root: { props: {} }, content: [{ type: 'Heading', props: { id: 'heading-1', title: '' } }] },
      config,
      context,
    );

    expect(resolved.content[0]?.props.title).toBe('From settings');
  });
});

describe('loadMdxComponents', () => {
  const okComponent = (() => null) as ComponentType;

  test('evaluates each published fragment via the injected evaluator', async () => {
    const source = sourceOf({
      __conloca_fragments: [{ id: 'welcome', locale: 'en', title: 'Welcome', mdx: '# Hi' }],
    });
    const fragments = await loadMdxComponents(source, 'en', (async () => ({ Component: okComponent })) as never, false);
    expect(fragments).toHaveLength(1);
    expect(fragments[0]).toMatchObject({ id: 'welcome', title: 'Welcome', Component: okComponent });
  });

  test('a fragment with no mdx yields a null-render component (never throws)', async () => {
    const source = sourceOf({ __conloca_fragments: [{ id: 'empty', locale: 'en', title: 'Empty' }] });
    const fragments = await loadMdxComponents(source, 'en', (async () => ({ Component: okComponent })) as never, false);
    expect(fragments).toHaveLength(1);
    // The no-mdx fallback is a function component; ComponentType also covers
    // class components, which are not callable — narrow before invoking.
    const fragment = fragments[0];
    expect(fragment).toBeDefined();
    if (!fragment) throw new Error('test fixture invariant: fragment was not returned');
    expect((fragment.Component as () => unknown)()).toBeNull();
  });
});

describe('pageNotFoundResponse', () => {
  test("'passthrough' answers 404 with a null body so Astro reroutes to the site's /404 route", () => {
    const response = pageNotFoundResponse('passthrough');

    expect(response.status).toBe(404);
    expect(response.body).toBeNull();
  });

  test("'404' answers directly with a bare 404 body", async () => {
    const response = pageNotFoundResponse('404');

    expect(response.status).toBe(404);
    expect(await response.text()).toBe('Page not found');
  });
});
