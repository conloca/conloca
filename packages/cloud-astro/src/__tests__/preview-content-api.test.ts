import { describe, expect, it } from 'bun:test';
import type {
  BatchResult,
  ContentAPI,
  ContentEntry,
  ContentManifest,
  CreateContentInput,
  CreateResult,
  DeleteLocaleInput,
  DeleteResult,
  FindOptions,
  Fragments,
  GlobalFilters,
  LocalizedEntry,
  Site,
  SitesConfig,
  UpdateLocaleInput,
  UpdateResult,
} from '@conloca/content-api';
import { PreviewContentAPI } from '../preview/content-api.js';

type FetchInput = Parameters<typeof fetch>[0];

import type { PreviewContext } from '../preview/middleware.js';

type ContentAPIData = ContentAPI['data'];

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ctx: PreviewContext = { branch: 'feature/x', org: 'acme', repo: 'site', jwt: 'tok' };
const ENDPOINT = 'https://cms.example.test';
const KEY_PAGE_1_EN = 'page-1 en';

function makeBaseline(initial: { localized?: Map<string, LocalizedEntry>; content?: Map<string, ContentEntry> } = {}): {
  api: ContentAPI;
  localizedCalls: { id: string; locale: string }[];
  contentCalls: string[];
} {
  const localizedCalls: { id: string; locale: string }[] = [];
  const contentCalls: string[] = [];
  const localized = initial.localized ?? new Map<string, LocalizedEntry>();
  const content = initial.content ?? new Map<string, ContentEntry>();
  const fragmentsFacade: Fragments = makeFacade<Fragments>('baseline.fragments');
  const dataFacade: ContentAPIData = makeFacade<ContentAPIData>('baseline.data');
  const api: ContentAPI = {
    fragments: fragmentsFacade,
    data: dataFacade,
    sitesConfig: { sites: {}, globalLocales: ['en'] },
    async getContent(id) {
      contentCalls.push(id);
      return content.get(id) ?? null;
    },
    async getLocalized(id, locale) {
      localizedCalls.push({ id, locale });
      return localized.get(`${id} ${locale}`) ?? null;
    },
    async createContent() {
      throw new Error('baseline.createContent should not be called from preview reader');
    },
    async updateLocalized() {
      throw new Error('baseline.updateLocalized should not be called from preview reader');
    },
    async deleteContent() {
      throw new Error('baseline.deleteContent should not be called from preview reader');
    },
    async deleteLocalized() {
      throw new Error('baseline.deleteLocalized should not be called from preview reader');
    },
    getSite(): Site | null {
      return null;
    },
    *listAllContent(_filters?: GlobalFilters): Generator<ContentManifest> {
      yield* [];
    },
    *findUntranslatedContent(_targetLocale: string, _options?: FindOptions): Generator<ContentManifest> {
      yield* [];
    },
    async batchUpdate(): Promise<BatchResult> {
      throw new Error('baseline.batchUpdate should not be called from preview reader');
    },
    async getContentAsBuffer() {
      throw new Error('baseline.getContentAsBuffer should not be called from preview reader');
    },
  };
  return { api, localizedCalls, contentCalls };
}

/**
 * Builds a no-op facade for `Fragments`/`Data`. The preview reader does not call
 * any of these facade methods in any test; touching one means we have to
 * extend the fake, but the existing tests should be enough to keep the
 * surface honest.
 *
 * The `as unknown as T` here is a test-fixture-only escape valve: `Fragments`
 * and `Data` are classes with `private` fields, so structural typing cannot
 * prove a Proxy satisfies them. The Proxy's `get` trap throws on every
 * access other than `__label`, so any code path that reads a facade method
 * fails at runtime — the cast cannot hide a real bug, only document the
 * test's intent. Matches the precedent in `integration.test.ts`.
 */
function makeFacade<T>(label: string): T {
  return new Proxy(
    { __label: label },
    {
      get(_target, prop) {
        if (prop === '__label') return label;
        throw new Error(`facade ${label}.${String(prop)} should not be called from preview reader tests`);
      },
    },
  ) as unknown as T;
}

function makeManifest(id: string, locale: string): ContentManifest {
  return {
    id,
    type: 'puck',
    kind: 'page',
    site: 'main',
    collection: 'pages',
    locales: {
      [locale]: {
        locale,
        etag: 'baseline.etag',
        created: '2024-01-01T00:00:00.000Z',
        modified: '2024-01-01T00:00:00.000Z',
        meta: { title: 'Baseline' },
      },
    },
  };
}

function makeLocalized(id: string, locale: string, title: string): LocalizedEntry {
  return {
    id,
    type: 'puck',
    kind: 'page',
    site: 'main',
    collection: 'pages',
    localized: {
      locale,
      etag: `etag.${title}`,
      created: '2024-01-01T00:00:00.000Z',
      modified: '2024-01-01T00:00:00.000Z',
      meta: { title },
      content: { puckData: { title } },
    },
  };
}

function makeFetch(responses: Response[]): {
  fn: typeof fetch;
  calls: { input: FetchInput; init?: RequestInit }[];
} {
  const calls: { input: FetchInput; init?: RequestInit }[] = [];
  const queue = [...responses];
  const fn = ((input: FetchInput, init?: RequestInit) => {
    calls.push({ input, init });
    const next = queue.shift();
    if (!next) {
      throw new Error(`unexpected fetch call: ${String(input)} (queue exhausted)`);
    }
    return Promise.resolve(next);
  }) as typeof fetch;
  return { fn, calls };
}

// ---------------------------------------------------------------------------
// PreviewContentAPI — getLocalized
// ---------------------------------------------------------------------------

describe('PreviewContentAPI.getLocalized', () => {
  it('issues GET /preview/content/{id}/{locale} with Bearer auth from the preview JWT', async () => {
    const baseline = makeBaseline();
    const localized = makeLocalized('page-1', 'en', 'Edited');
    const fetchSpy = makeFetch([new Response(JSON.stringify(localized), { status: 200 })]);
    const reader = new PreviewContentAPI({
      saasEndpoint: ENDPOINT,
      ctx,
      baselineApi: baseline.api,
      fetchFn: fetchSpy.fn,
    });

    const result = await reader.getLocalized('page-1', 'en');

    expect(result).not.toBeNull();
    expect(String(fetchSpy.calls[0].input)).toBe(`${ENDPOINT}/preview/content/page-1/en`);
    expect(fetchSpy.calls[0].init?.headers).toMatchObject({ authorization: 'Bearer tok' });
  });

  it('returns the embedded payload without issuing a fetch when one is supplied for this id/locale', async () => {
    const baseline = makeBaseline();
    const embedded = makeLocalized('page-1', 'en', 'Embedded');
    const fetchSpy = makeFetch([]);
    const reader = new PreviewContentAPI({
      saasEndpoint: ENDPOINT,
      ctx,
      baselineApi: baseline.api,
      fetchFn: fetchSpy.fn,
      embeddedPayloads: new Map([[KEY_PAGE_1_EN, embedded]]),
    });

    const result = await reader.getLocalized('page-1', 'en');

    expect(result).toEqual(embedded);
    expect(fetchSpy.calls).toHaveLength(0);
    expect(baseline.localizedCalls).toHaveLength(0);
  });

  it('fetches each id/locale at most once per instance (request-scoped memoization)', async () => {
    // The render enumerates the same entries repeatedly (page listing, fragment
    // listing, dependency reads); every duplicate would be another round trip
    // to the endpoint against the Cloudflare Workers subrequest budget. The instance lives
    // for one request, so memoizing introduces no long-lived cache.
    const baseline = makeBaseline();
    const localized = makeLocalized('page-1', 'en', 'Edited');
    const fetchSpy = makeFetch([new Response(JSON.stringify(localized), { status: 200 })]);
    const reader = new PreviewContentAPI({
      saasEndpoint: ENDPOINT,
      ctx,
      baselineApi: baseline.api,
      fetchFn: fetchSpy.fn,
    });

    const [first, second] = await Promise.all([
      reader.getLocalized('page-1', 'en'),
      reader.getLocalized('page-1', 'en'),
    ]);
    const third = await reader.getLocalized('page-1', 'en');

    expect(first).toEqual(localized);
    expect(second).toEqual(localized);
    expect(third).toEqual(localized);
    expect(fetchSpy.calls).toHaveLength(1);
  });

  it('does not memoize a failed fetch (a later read may retry)', async () => {
    const baseline = makeBaseline();
    const localized = makeLocalized('page-1', 'en', 'Edited');
    const fetchSpy = makeFetch([
      new Response(null, { status: 500 }),
      new Response(JSON.stringify(localized), { status: 200 }),
    ]);
    const reader = new PreviewContentAPI({
      saasEndpoint: ENDPOINT,
      ctx,
      baselineApi: baseline.api,
      fetchFn: fetchSpy.fn,
    });

    await expect(reader.getLocalized('page-1', 'en')).rejects.toThrow('500');
    await expect(reader.getLocalized('page-1', 'en')).resolves.toEqual(localized);
    expect(fetchSpy.calls).toHaveLength(2);
  });

  it('falls back to baselineApi.getLocalized on a 304 response (dependency unchanged in branch)', async () => {
    const baselineEntry = makeLocalized('page-1', 'en', 'Baseline');
    const baseline = makeBaseline({ localized: new Map([[KEY_PAGE_1_EN, baselineEntry]]) });
    const fetchSpy = makeFetch([new Response(null, { status: 304 })]);
    const reader = new PreviewContentAPI({
      saasEndpoint: ENDPOINT,
      ctx,
      baselineApi: baseline.api,
      fetchFn: fetchSpy.fn,
    });

    const result = await reader.getLocalized('page-1', 'en');

    expect(result).toEqual(baselineEntry);
    expect(baseline.localizedCalls).toEqual([{ id: 'page-1', locale: 'en' }]);
  });

  it('returns null on a 404 response (content deleted in branch)', async () => {
    const baseline = makeBaseline();
    const fetchSpy = makeFetch([new Response(null, { status: 404 })]);
    const reader = new PreviewContentAPI({
      saasEndpoint: ENDPOINT,
      ctx,
      baselineApi: baseline.api,
      fetchFn: fetchSpy.fn,
    });

    const result = await reader.getLocalized('page-1', 'en');

    expect(result).toBeNull();
    expect(baseline.localizedCalls).toHaveLength(0);
  });

  it('throws a descriptive error on a non-2xx, non-304, non-404 response', async () => {
    const baseline = makeBaseline();
    const fetchSpy = makeFetch([new Response(null, { status: 500 })]);
    const reader = new PreviewContentAPI({
      saasEndpoint: ENDPOINT,
      ctx,
      baselineApi: baseline.api,
      fetchFn: fetchSpy.fn,
    });

    await expect(reader.getLocalized('page-1', 'en')).rejects.toThrow(/preview fetch.*page-1\/en.*500/u);
  });
});

// ---------------------------------------------------------------------------
// PreviewContentAPI — getContent (manifest envelope + per-locale walks)
// ---------------------------------------------------------------------------

describe('PreviewContentAPI.getContent', () => {
  it('returns null when the baseline has no manifest for the id', async () => {
    const baseline = makeBaseline();
    const fetchSpy = makeFetch([]);
    const reader = new PreviewContentAPI({
      saasEndpoint: ENDPOINT,
      ctx,
      baselineApi: baseline.api,
      fetchFn: fetchSpy.fn,
    });

    const result = await reader.getContent('does-not-exist');

    expect(result).toBeNull();
    expect(fetchSpy.calls).toHaveLength(0);
  });

  it('walks each manifest locale through the preview reads', async () => {
    const manifest = makeManifest('page-1', 'en');
    const enLocale = manifest.locales.en;
    if (!enLocale) throw new Error('test fixture invariant: en locale present');
    const content: ContentEntry = {
      ...manifest,
      locales: {
        en: { ...enLocale, content: { puckData: { title: 'Baseline en' } } },
      },
    };
    const baseline = makeBaseline({ content: new Map([['page-1', content]]) });
    const edited = makeLocalized('page-1', 'en', 'Edited');
    const fetchSpy = makeFetch([new Response(JSON.stringify(edited), { status: 200 })]);
    const reader = new PreviewContentAPI({
      saasEndpoint: ENDPOINT,
      ctx,
      baselineApi: baseline.api,
      fetchFn: fetchSpy.fn,
    });

    const result = await reader.getContent('page-1');

    expect(result).not.toBeNull();
    expect(result?.locales.en?.content).toEqual({ puckData: { title: 'Edited' } });
    expect(fetchSpy.calls).toHaveLength(1);
  });

  it('renders a branch-only page using every locale from the loaded branch manifest', async () => {
    const branchManifest = manifestOf('new-on-branch');
    branchManifest.locales.fr = {
      locale: 'fr',
      pathname: '/nouvelle-page',
      etag: 'fr-etag',
      created: 'c',
      modified: 'm',
      meta: { title: 'Nouvelle page' },
    };
    const fetchSpy = makeFetch([
      manifestsResponse([branchManifest]),
      new Response(JSON.stringify(makeLocalized('new-on-branch', 'en', 'Draft en')), { status: 200 }),
      new Response(JSON.stringify(makeLocalized('new-on-branch', 'fr', 'Draft fr')), { status: 200 }),
    ]);
    const baseline = makeBaseline();
    const reader = new PreviewContentAPI({
      saasEndpoint: ENDPOINT,
      ctx,
      baselineApi: baseline.api,
      fetchFn: fetchSpy.fn,
    });

    await reader.loadBranchManifests();
    const result = await reader.getContent('new-on-branch');

    expect(Object.keys(result?.locales ?? {}).sort()).toEqual(['en', 'fr']);
    expect(result?.locales.en?.content).toEqual({ puckData: { title: 'Draft en' } });
    expect(result?.locales.fr?.content).toEqual({ puckData: { title: 'Draft fr' } });
    expect(baseline.contentCalls).toHaveLength(0);
    expect(fetchSpy.calls.map(({ input }) => String(input))).toEqual([
      `${ENDPOINT}/preview/manifests`,
      `${ENDPOINT}/preview/content/new-on-branch/en`,
      `${ENDPOINT}/preview/content/new-on-branch/fr`,
    ]);
  });

  it('keeps a branch-deleted production page absent after the branch listing is loaded', async () => {
    const productionManifest = manifestOf('deleted-on-branch');
    const enLocale = productionManifest.locales.en;
    if (!enLocale) throw new Error('test fixture invariant: en locale present');
    const baseline = makeBaseline({
      content: new Map([
        [
          'deleted-on-branch',
          {
            ...productionManifest,
            locales: { en: { ...enLocale, content: { puckData: { title: 'Published' } } } },
          },
        ],
      ]),
    });
    const fetchSpy = makeFetch([manifestsResponse([manifestOf('existing')])]);
    const reader = new PreviewContentAPI({
      saasEndpoint: ENDPOINT,
      ctx,
      baselineApi: baseline.api,
      fetchFn: fetchSpy.fn,
    });

    await reader.loadBranchManifests();
    const result = await reader.getContent('deleted-on-branch');

    expect(result).toBeNull();
    expect(baseline.contentCalls).toHaveLength(0);
    expect(fetchSpy.calls).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// PreviewContentAPI — write-side surface
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// listAllContent — the branch's own manifest listing, not the build baseline.
// The baseline is a snapshot of the LAST PRODUCTION BUILD, so it cannot know
// about a page created on the branch and still contains pages the branch
// deleted. Listing must come from the branch — the baseline is the fallback
// for unchanged DEPENDENCIES, never the source of the page set.
// ---------------------------------------------------------------------------

function manifestOf(id: string): ContentManifest {
  return {
    id,
    type: 'puck',
    kind: 'page',
    collection: 'pages',
    locales: {
      en: { locale: 'en', pathname: `/${id}`, etag: 'e', created: 'c', modified: 'm', meta: { title: id } },
    },
  };
}

function manifestsResponse(manifests: ContentManifest[]): Response {
  return new Response(JSON.stringify(manifests), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

/** A baseline whose listing is the last build: `existing` and `deleted-on-branch`. */
function baselineWithListing(ids: string[]): ContentAPI {
  const { api } = makeBaseline();
  return {
    ...api,
    *listAllContent(filters?: GlobalFilters): Generator<ContentManifest> {
      for (const id of ids) {
        const manifest = manifestOf(id);
        if (filters?.collection !== undefined && manifest.collection !== filters.collection) continue;
        yield manifest;
      }
    },
  };
}

describe('PreviewContentAPI.listAllContent', () => {
  it('lists a page that exists only on the branch', async () => {
    const fetchSpy = makeFetch([manifestsResponse([manifestOf('existing'), manifestOf('new-on-branch')])]);
    const reader = new PreviewContentAPI({
      saasEndpoint: ENDPOINT,
      ctx,
      baselineApi: baselineWithListing(['existing']),
      fetchFn: fetchSpy.fn,
    });

    await reader.loadBranchManifests();
    const ids = [...reader.listAllContent()].map((manifest) => manifest.id);

    expect(ids).toContain('new-on-branch');
    expect(String(fetchSpy.calls[0].input)).toBe(`${ENDPOINT}/preview/manifests`);
    expect(fetchSpy.calls[0].init?.headers).toMatchObject({ authorization: 'Bearer tok' });
  });

  it('drops a page the branch deleted even though the last build still ships it', async () => {
    const reader = new PreviewContentAPI({
      saasEndpoint: ENDPOINT,
      ctx,
      baselineApi: baselineWithListing(['existing', 'deleted-on-branch']),
      fetchFn: makeFetch([manifestsResponse([manifestOf('existing')])]).fn,
    });

    await reader.loadBranchManifests();
    const ids = [...reader.listAllContent()].map((manifest) => manifest.id);

    expect(ids).toEqual(['existing']);
  });

  it('falls back to the baseline listing when the branch listing is unreachable', async () => {
    const reader = new PreviewContentAPI({
      saasEndpoint: ENDPOINT,
      ctx,
      baselineApi: baselineWithListing(['existing']),
      fetchFn: makeFetch([new Response('upstream down', { status: 502 })]).fn,
    });

    await reader.loadBranchManifests();
    const ids = [...reader.listAllContent()].map((manifest) => manifest.id);

    expect(ids).toEqual(['existing']);
  });

  it('serves a full listing pass with zero content fetches when the embedded map covers it', async () => {
    // The render core enumerates EVERY listed manifest × locale through
    // getLocalized (astro-cms page-render-core listEntries). When page-status
    // embedded the whole changed set, that pass must cost exactly ONE fetch —
    // the listing itself — proving the N+1 is gone end to end, not just at
    // the decode boundary.
    const manifests = [manifestOf('page-a'), manifestOf('page-b')];
    const embedded = new Map([
      ['page-a en', makeLocalized('page-a', 'en', 'Draft A')],
      ['page-b en', makeLocalized('page-b', 'en', 'Draft B')],
    ]);
    const fetchSpy = makeFetch([manifestsResponse(manifests)]);
    const baseline = makeBaseline();
    const reader = new PreviewContentAPI({
      saasEndpoint: ENDPOINT,
      ctx,
      baselineApi: baseline.api,
      fetchFn: fetchSpy.fn,
      embeddedPayloads: embedded,
    });

    await reader.loadBranchManifests();
    const records: string[] = [];
    for (const manifest of reader.listAllContent()) {
      for (const locale of Object.keys(manifest.locales)) {
        const entry = await reader.getLocalized(manifest.id, locale);
        if (entry) records.push(`${entry.id}:${entry.localized.meta.title}`);
      }
    }

    expect(records.sort()).toEqual(['page-a:Draft A', 'page-b:Draft B']);
    expect(fetchSpy.calls).toHaveLength(1);
    expect(String(fetchSpy.calls[0].input)).toBe(`${ENDPOINT}/preview/manifests`);
    expect(baseline.localizedCalls).toHaveLength(0);
  });
});

describe('PreviewContentAPI write methods', () => {
  it('rejects createContent — preview SSR is read-only', async () => {
    const baseline = makeBaseline();
    const reader = new PreviewContentAPI({ saasEndpoint: ENDPOINT, ctx, baselineApi: baseline.api });
    const input: CreateContentInput = { kind: 'page', site: 'main', collection: 'pages', type: 'puck', locales: {} };
    const result: CreateResult = await reader.createContent(input);
    expect(result.success).toBe(false);
    expect(result.reason).toBe('write_error');
  });

  it('rejects updateLocalized — preview SSR is read-only', async () => {
    const baseline = makeBaseline();
    const reader = new PreviewContentAPI({ saasEndpoint: ENDPOINT, ctx, baselineApi: baseline.api });
    const input: UpdateLocaleInput = { id: 'page-1', locale: 'en', data: {}, etag: 'x' };
    const result: UpdateResult = await reader.updateLocalized(input);
    expect(result.success).toBe(false);
    expect(result.reason).toBe('write_error');
  });

  it('rejects deleteContent — preview SSR is read-only', async () => {
    const baseline = makeBaseline();
    const reader = new PreviewContentAPI({ saasEndpoint: ENDPOINT, ctx, baselineApi: baseline.api });
    const result: DeleteResult = await reader.deleteContent('page-1', 'x');
    expect(result.success).toBe(false);
  });

  it('rejects deleteLocalized — preview SSR is read-only', async () => {
    const baseline = makeBaseline();
    const reader = new PreviewContentAPI({ saasEndpoint: ENDPOINT, ctx, baselineApi: baseline.api });
    const input: DeleteLocaleInput = { id: 'page-1', locale: 'en', etag: 'x' };
    const result: DeleteResult = await reader.deleteLocalized(input);
    expect(result.success).toBe(false);
  });

  it('rejects batchUpdate — preview SSR is read-only', async () => {
    const baseline = makeBaseline();
    const reader = new PreviewContentAPI({ saasEndpoint: ENDPOINT, ctx, baselineApi: baseline.api });
    const result: BatchResult = await reader.batchUpdate([{ id: 'page-1', locale: 'en', data: {}, etag: 'x' }]);
    expect(result.success).toBe(false);
    expect(result.failed).toBe(1);
    expect(result.updated).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// PreviewContentAPI — read-only delegations
// ---------------------------------------------------------------------------

describe('PreviewContentAPI read-only delegations', () => {
  it('exposes the baseline `sitesConfig` (preview build ships static collection data)', () => {
    const baseline = makeBaseline();
    const sitesConfig: SitesConfig = {
      sites: { main: { locales: ['en'], defaultLocale: 'en' } },
      globalLocales: ['en'],
    };
    const baselineApi: ContentAPI = { ...baseline.api, sitesConfig };
    const reader = new PreviewContentAPI({ saasEndpoint: ENDPOINT, ctx, baselineApi });
    expect(reader.sitesConfig).toEqual(sitesConfig);
  });

  it('satisfies the ContentAPI interface (compile-time contract pin)', () => {
    const baseline = makeBaseline();
    const reader: ContentAPI = new PreviewContentAPI({ saasEndpoint: ENDPOINT, ctx, baselineApi: baseline.api });
    expect(typeof reader.getLocalized).toBe('function');
    expect(typeof reader.getContent).toBe('function');
  });
});
