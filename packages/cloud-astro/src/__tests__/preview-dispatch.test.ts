import { describe, expect, it } from 'bun:test';
import type { LocalizedEntry } from '@conloca/content-api';
import { fetchPageStatus, type PageStatus } from '../preview/_dispatch.js';
import type { PreviewContext } from '../preview/middleware.js';
import { stripPreviewPrefix } from '../preview/preview-path.js';

type FetchInput = Parameters<typeof fetch>[0];

// ---------------------------------------------------------------------------
// Fixtures (kept small — the heavy ContentAPI shape exercising lives in
// preview-content-api.test.ts; here we focus on dispatch decisions).
// ---------------------------------------------------------------------------

const ENDPOINT = 'https://cms.example.test';

function ctx(): PreviewContext {
  return { branch: 'feature/x', org: 'acme', repo: 'site', jwt: 'tok' };
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
      throw new Error(`unexpected fetch: ${String(input)} (queue exhausted)`);
    }
    return Promise.resolve(next);
  }) as typeof fetch;
  return { fn, calls };
}

// ---------------------------------------------------------------------------
// fetchPageStatus — typed decoder over the endpoint's page-status response
// ---------------------------------------------------------------------------

describe('fetchPageStatus', () => {
  it('GETs /preview/page-status/{path} with Bearer auth and returns "unchanged" on 304', async () => {
    const fetchSpy = makeFetch([new Response(null, { status: 304 })]);
    const status = await fetchPageStatus({ saasEndpoint: ENDPOINT, ctx: ctx(), path: '/about', fetchFn: fetchSpy.fn });
    expect(status.kind).toBe('unchanged');
    expect(String(fetchSpy.calls[0].input)).toBe(`${ENDPOINT}/preview/page-status/about`);
    expect(fetchSpy.calls[0].init?.headers).toMatchObject({ authorization: 'Bearer tok' });
  });

  it('threads site and locale into the page-status query when supplied', async () => {
    const fetchSpy = makeFetch([new Response(null, { status: 304 })]);
    await fetchPageStatus({
      saasEndpoint: ENDPOINT,
      ctx: ctx(),
      path: '/about',
      locale: 'en',
      site: 'default',
      fetchFn: fetchSpy.fn,
    });
    expect(String(fetchSpy.calls[0].input)).toBe(`${ENDPOINT}/preview/page-status/about?locale=en&site=default`);
  });

  it("threads the artifact's own build commit into the page-status query", async () => {
    const fetchSpy = makeFetch([new Response(null, { status: 304 })]);
    const build = 'a'.repeat(40);
    await fetchPageStatus({ saasEndpoint: ENDPOINT, ctx: ctx(), path: '/about', build, fetchFn: fetchSpy.fn });
    expect(String(fetchSpy.calls[0].input)).toBe(`${ENDPOINT}/preview/page-status/about?build=${build}`);
  });

  it('returns "deleted" on 404', async () => {
    const fetchSpy = makeFetch([new Response(null, { status: 404 })]);
    const status = await fetchPageStatus({ saasEndpoint: ENDPOINT, ctx: ctx(), path: '/about', fetchFn: fetchSpy.fn });
    expect(status.kind).toBe('deleted');
  });

  it('rewrites 301 to 302 to prevent browser caching of stale preview redirects', async () => {
    const fetchSpy = makeFetch([new Response(null, { status: 301, headers: { location: '/new-home' } })]);
    const status = await fetchPageStatus({
      saasEndpoint: ENDPOINT,
      ctx: ctx(),
      path: '/old-home',
      fetchFn: fetchSpy.fn,
    });
    expect(status.kind).toBe('redirect');
    if (status.kind === 'redirect') expect(status.target).toBe('/new-home');
  });

  it('returns "redirect" verbatim on 302', async () => {
    const fetchSpy = makeFetch([new Response(null, { status: 302, headers: { location: '/elsewhere' } })]);
    const status = await fetchPageStatus({ saasEndpoint: ENDPOINT, ctx: ctx(), path: '/x', fetchFn: fetchSpy.fn });
    expect(status.kind).toBe('redirect');
    if (status.kind === 'redirect') expect(status.target).toBe('/elsewhere');
  });

  it('returns "changed" with embedded payloads when the endpoint bundles them in a 200', async () => {
    const embedded: LocalizedEntry = {
      id: 'page-1',
      type: 'puck',
      kind: 'page',
      site: 'main',
      collection: 'pages',
      localized: {
        locale: 'en',
        etag: 'edited.etag',
        created: '2024-01-01T00:00:00.000Z',
        modified: '2024-01-02T00:00:00.000Z',
        meta: { title: 'Edited' },
        content: { puckData: { title: 'Edited' } },
      },
    };
    const body = JSON.stringify({ embedded: { 'page-1 en': embedded } });
    const fetchSpy = makeFetch([new Response(body, { status: 200, headers: { 'content-type': 'application/json' } })]);
    const status = await fetchPageStatus({ saasEndpoint: ENDPOINT, ctx: ctx(), path: '/about', fetchFn: fetchSpy.fn });
    expect(status.kind).toBe('changed');
    if (status.kind === 'changed') {
      expect(status.embedded.get('page-1 en')).toEqual(embedded);
    }
  });

  it('returns "changed" with an empty embedded map when the endpoint sends a bare 200 (no payloads)', async () => {
    const fetchSpy = makeFetch([new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })]);
    const status = await fetchPageStatus({ saasEndpoint: ENDPOINT, ctx: ctx(), path: '/about', fetchFn: fetchSpy.fn });
    expect(status.kind).toBe('changed');
    if (status.kind === 'changed') expect(status.embedded.size).toBe(0);
  });

  it('decodes the literal page-status body the endpoint answers (contract pin)', async () => {
    // Verbatim copy of the 200 body the endpoint answers when a referenced
    // fragment has been edited on the branch. If either side drifts, this test
    // fails before any integration run does.
    const backendBody = JSON.stringify({
      embedded: {
        'fragment-hero en': {
          id: 'fragment-hero',
          type: 'json',
          kind: 'fragment',
          collection: 'components',
          localized: {
            locale: 'en',
            etag: 'dirty-fragment-hero',
            created: '2026-05-24T00:00:00.000Z',
            modified: '2026-05-24T00:00:00.000Z',
            name: 'fragment-hero',
            meta: { title: 'fragment-hero' },
            content: { data: { heading: 'Draft heading' } },
          },
        },
      },
    });
    const fetchSpy = makeFetch([
      new Response(backendBody, { status: 200, headers: { 'content-type': 'application/json' } }),
    ]);
    const status = await fetchPageStatus({
      saasEndpoint: ENDPOINT,
      ctx: ctx(),
      path: '/page-with-fragment',
      fetchFn: fetchSpy.fn,
    });
    expect(status.kind).toBe('changed');
    if (status.kind === 'changed') {
      const entry = status.embedded.get('fragment-hero en');
      expect(entry?.localized.etag).toBe('dirty-fragment-hero');
      expect(entry?.localized.content).toEqual({ data: { heading: 'Draft heading' } });
    }
  });
});

// ---------------------------------------------------------------------------
// PageStatus union — exhaustive type pin
// ---------------------------------------------------------------------------

describe('PageStatus union', () => {
  it('pins the four spec verdicts as the union members so a stray kind is a type error', () => {
    const kinds: PageStatus['kind'][] = ['unchanged', 'changed', 'deleted', 'redirect'];
    expect(kinds.sort()).toEqual(['changed', 'deleted', 'redirect', 'unchanged']);
  });
});

// ---------------------------------------------------------------------------
// stripPreviewPrefix — defence-in-depth when the SSR handler is reached
// without a rewrite (so astro.originPathname is unset and astro.url.pathname
// still carries the secret prefix).
// ---------------------------------------------------------------------------

describe('stripPreviewPrefix', () => {
  it('strips the leading /conloca_preview_<secret>/ segment', () => {
    expect(stripPreviewPrefix('/conloca_preview_abc123/about')).toBe('/about');
    expect(stripPreviewPrefix('/conloca_preview_abc123/blog/post')).toBe('/blog/post');
  });

  it('returns "/" when the prefix is the only segment', () => {
    expect(stripPreviewPrefix('/conloca_preview_abc123')).toBe('/');
    expect(stripPreviewPrefix('/conloca_preview_abc123/')).toBe('/');
  });

  it('leaves a pathname without the prefix untouched', () => {
    expect(stripPreviewPrefix('/about')).toBe('/about');
    expect(stripPreviewPrefix('/')).toBe('/');
  });

  it('only matches a prefix at the start, not embedded in a deeper segment', () => {
    // A page that happens to mention the preview path mid-tree must not get
    // re-anchored to root — that would leak a different page's content.
    expect(stripPreviewPrefix('/posts/conloca_preview_xxx/about')).toBe('/posts/conloca_preview_xxx/about');
  });
});
