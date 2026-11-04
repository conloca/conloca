import { beforeAll, describe, expect, it, spyOn } from 'bun:test';
import { readFile } from 'node:fs/promises';
import type { ContentAPI } from '@conloca/content-api';
import { previewBranchSlug } from '@conloca/content-api/editor-host';
import { generateKeyPair, type JWTVerifyGetKey, SignJWT } from 'jose';
import type { PreviewMiddlewareOptions } from '../preview/middleware.js';
import { PREVIEW_COOKIE_NAME, PREVIEW_QUERY_PARAM } from '../preview/preview-path.js';
import {
  createPreviewSiteMiddleware,
  type PreviewMiddlewareContext,
  type PreviewRenderSeams,
} from '../preview/site-middleware.js';

// ---------------------------------------------------------------------------
// The site-wide middleware is the SERVING SURFACE of preview: it validates the
// cookie, asks the endpoint for the page's render-graph status, installs the
// branch reader on locals, lets the site's own route render via next(), and
// stamps the banner + robots/cache headers on the response. Without it the
// preview cookie is sent on every same-origin request and nothing reads it.
// ---------------------------------------------------------------------------

const ISSUER = 'https://cms.example.test';
const AUDIENCE = 'conloca-preview';

let signingKey: CryptoKey;
let getKey: JWTVerifyGetKey;

beforeAll(async () => {
  const pair = await generateKeyPair('RS256', { extractable: true });
  signingKey = pair.privateKey;
  const pub = pair.publicKey;
  getKey = () => Promise.resolve(pub);
});

async function mintJwt(scope: 'preview' | 'editor' = 'preview', claims: Record<string, string> = {}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ org: 'acme', repo: 'acme/site', site_id: 'website', branch: 'feature/x', scope, ...claims })
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuedAt(now)
    .setExpirationTime(now + 300)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .sign(signingKey);
}

function opts(): PreviewMiddlewareOptions {
  return {
    saasEndpoint: ISSUER,
    saasIssuer: ISSUER,
    saasAudience: AUDIENCE,
    repo: 'acme/site',
    siteId: 'website',
    branch: 'feature/x',
    base: '/',
    getKey,
  };
}

function fakeBaseline(): ContentAPI {
  return {
    fragments: {} as ContentAPI['fragments'],
    data: {} as ContentAPI['data'],
    sitesConfig: { sites: {}, globalLocales: ['en'] },
    async getContent() {
      return null;
    },
    async getLocalized() {
      return null;
    },
    async createContent() {
      return { success: false, reason: 'write_error', error: new Error('baseline is read-only') };
    },
    async updateLocalized() {
      return { success: false, reason: 'write_error', error: new Error('baseline is read-only') };
    },
    async deleteContent() {
      return { success: false, reason: 'delete_error', error: new Error('baseline is read-only') };
    },
    async deleteLocalized() {
      return { success: false, reason: 'delete_error', error: new Error('baseline is read-only') };
    },
    getSite() {
      return null;
    },
    *listAllContent() {
      yield* [];
    },
    *findUntranslatedContent() {
      yield* [];
    },
    async batchUpdate() {
      return { operations: [], success: true, failed: 0, updated: 0 };
    },
    async getContentAsBuffer() {
      return null;
    },
  };
}

type FetchInput = Parameters<typeof fetch>[0];

function makeFetch(responses: Response[]): {
  fn: typeof fetch;
  calls: { input: FetchInput; init?: RequestInit }[];
} {
  const calls: { input: FetchInput; init?: RequestInit }[] = [];
  const queue = [...responses];
  const fn = ((input: FetchInput, init?: RequestInit) => {
    calls.push({ input, init });
    const nextResponse = queue.shift();
    if (!nextResponse) {
      throw new Error(`unexpected fetch: ${String(input)} (queue exhausted)`);
    }
    return Promise.resolve(nextResponse);
  }) as typeof fetch;
  return { fn, calls };
}

function seams(fetchFn?: typeof fetch): PreviewRenderSeams {
  return {
    baselineApi: async () => fakeBaseline(),
    site: 'default',
    locale: 'en',
    fetchFn,
  };
}

function contextFor(url: string, cookie?: string): PreviewMiddlewareContext {
  return {
    request: new Request(url, cookie ? { headers: { cookie } } : undefined),
    locals: {},
    url: new URL(url),
  };
}

const NEXT_BODY = 'ordinary page';
const next = async () => new Response(NEXT_BODY);

function htmlNext(body: string): () => Promise<Response> {
  return async () =>
    new Response(`<!doctype html><html><head></head><body>${body}</body></html>`, {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
}

const changed = () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
const emptyListing = () => new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });

describe('createPreviewSiteMiddleware — credential handling', () => {
  it('passes an uncredentialed visitor straight through to the ordinary page', async () => {
    const onRequest = createPreviewSiteMiddleware(opts, seams());
    const context = contextFor('https://site.test/blog');

    const response = await onRequest(context, next);

    // Fail open: the preview deployment still serves the normal site.
    expect(context.locals.conlocaPreview).toBeUndefined();
    expect(await response.text()).toBe(NEXT_BODY);
  });

  it('passes through when the cookie carries a token it cannot verify', async () => {
    const foreign = await generateKeyPair('RS256', { extractable: true });
    const now = Math.floor(Date.now() / 1000);
    const badJwt = await new SignJWT({ org: 'a', repo: 'b', branch: 'c' })
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuedAt(now)
      .setExpirationTime(now + 300)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .sign(foreign.privateKey);
    const onRequest = createPreviewSiteMiddleware(opts, seams());
    const context = contextFor('https://site.test/blog', `${PREVIEW_COOKIE_NAME}=${badJwt}`);

    const response = await onRequest(context, next);

    expect(context.locals.conlocaPreview).toBeUndefined();
    expect(await response.text()).toBe(NEXT_BODY);
  });

  it('rejects a signed editor-scope JWT before any draft read', async () => {
    const jwt = await mintJwt('editor');
    const fetchSpy = makeFetch([]);
    const onRequest = createPreviewSiteMiddleware(opts, seams(fetchSpy.fn));
    const context = contextFor('https://site.test/blog', `${PREVIEW_COOKIE_NAME}=${jwt}`);

    const response = await onRequest(context, next);

    expect(fetchSpy.calls).toHaveLength(0);
    expect(context.locals.conlocaPreview).toBeUndefined();
    expect(context.locals.contentApi).toBeUndefined();
    expect(await response.text()).toBe(NEXT_BODY);
  });

  it('returns the init redirect when a token arrives in the query param', async () => {
    const jwt = await mintJwt();
    const onRequest = createPreviewSiteMiddleware(opts, seams());
    const context = contextFor(`https://site.test/blog?${PREVIEW_QUERY_PARAM}=${jwt}`);

    const response = await onRequest(context, next);

    expect(response.status).toBe(302);
    expect(response.headers.get('set-cookie')).toContain(`${PREVIEW_COOKIE_NAME}=`);
  });

  it('canonicalizes a valid cookie on the fixed preview path to the clean path', async () => {
    const jwt = await mintJwt();
    const onRequest = createPreviewSiteMiddleware(opts, seams());
    const context = contextFor('https://site.test/_conloca/preview/about', `${PREVIEW_COOKIE_NAME}=${jwt}`);

    const response = await onRequest(context, next);

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/about');
  });

  it('does not re-run when a preview render is already in flight', async () => {
    const onRequest = createPreviewSiteMiddleware(() => {
      throw new Error('resolveOpts must not be called when a context already exists');
    }, seams());
    const context = contextFor('https://site.test/blog');
    context.locals.conlocaPreview = { branch: 'b', org: 'o', repo: 'r', jwt: 'j' };

    expect(await (await onRequest(context, next)).text()).toBe(NEXT_BODY);
  });
});

describe('createPreviewSiteMiddleware — verdict rendering', () => {
  it('renders the draft through the site route on "changed": reader installed, banner injected, headers stamped', async () => {
    const jwt = await mintJwt();
    const fetchSpy = makeFetch([changed(), emptyListing()]);
    const onRequest = createPreviewSiteMiddleware(opts, seams(fetchSpy.fn));
    const context = contextFor('https://site.test/blog', `${PREVIEW_COOKIE_NAME}=${jwt}`);

    const response = await onRequest(context, htmlNext('draft body'));

    expect(context.locals.conlocaPreview?.branch).toBe('feature/x');
    // The branch reader is installed BEFORE the route renders — this is the
    // seam astro-cms's page handler branches on.
    expect(context.locals.contentApi).toBeDefined();
    const html = await response.text();
    expect(html).toContain('draft body');
    expect(html).toContain('conloca-preview');
    expect(html).toContain('noindex');
    expect(response.headers.get('x-robots-tag')).toContain('noindex');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    // The page-status call carries the routing config's site/locale.
    expect(String(fetchSpy.calls[0].input)).toBe(`${ISSUER}/preview/page-status/blog?locale=en&site=default`);
  });

  it('points the banner exit link at the fixed exit route', async () => {
    const jwt = await mintJwt();
    const fetchSpy = makeFetch([changed(), emptyListing()]);
    const onRequest = createPreviewSiteMiddleware(opts, seams(fetchSpy.fn));
    const context = contextFor('https://site.test/blog', `${PREVIEW_COOKIE_NAME}=${jwt}`);

    const html = await (await onRequest(context, htmlNext('draft body'))).text();

    expect(html).toContain('"exitPath":"/_conloca/preview/__exit"');
  });

  it.each([
    [
      'https://editor.example.test/edit?repo=acme%2Fsite',
      'https://editor.example.test/edit?repo=acme%2Fsite&share=%2Fguide',
    ],
    ['https://editor.example.test/edit', 'https://editor.example.test/edit?share=%2Fguide'],
  ])('links Share to the page under the base when the editor address is %s', async (editorUrl, shareUrl) => {
    const jwt = await mintJwt('preview', { editor_url: editorUrl });
    const onRequest = createPreviewSiteMiddleware(
      () => ({ ...opts(), base: '/docs/' }),
      seams(makeFetch([changed(), emptyListing()]).fn),
    );
    const context = contextFor('https://site.test/docs/guide', `${PREVIEW_COOKIE_NAME}=${jwt}`);

    const html = await (await onRequest(context, htmlNext('draft body'))).text();

    expect(html).toContain(`"shareUrl":"${shareUrl}"`);
  });

  it('normalizes a trailing slash out of the page-status path (site nav links carry them)', async () => {
    const jwt = await mintJwt();
    const fetchSpy = makeFetch([new Response(null, { status: 304 })]);
    const onRequest = createPreviewSiteMiddleware(opts, seams(fetchSpy.fn));
    const context = contextFor('https://site.test/faq/', `${PREVIEW_COOKIE_NAME}=${jwt}`);

    await onRequest(context, htmlNext('published'));

    expect(String(fetchSpy.calls[0].input)).toBe(`${ISSUER}/preview/page-status/faq?locale=en&site=default`);
  });

  it('serves the ordinary render without a banner on "unchanged", still noindexed', async () => {
    const jwt = await mintJwt();
    const fetchSpy = makeFetch([new Response(null, { status: 304 })]);
    const onRequest = createPreviewSiteMiddleware(opts, seams(fetchSpy.fn));
    const context = contextFor('https://site.test/blog', `${PREVIEW_COOKIE_NAME}=${jwt}`);

    const response = await onRequest(context, htmlNext('published body'));

    const html = await response.text();
    expect(html).toContain('published body');
    expect(html).not.toContain('conloca-preview-banner');
    expect(context.locals.contentApi).toBeUndefined();
    expect(response.headers.get('x-robots-tag')).toContain('noindex');
  });

  it('issues a 302 on the "redirect" verdict', async () => {
    const jwt = await mintJwt();
    const fetchSpy = makeFetch([new Response(null, { status: 302, headers: { location: '/moved' } })]);
    const onRequest = createPreviewSiteMiddleware(opts, seams(fetchSpy.fn));
    const context = contextFor('https://site.test/old', `${PREVIEW_COOKIE_NAME}=${jwt}`);

    const response = await onRequest(context, next);

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/moved');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });

  it('lets the site\'s not-found flow answer a "deleted" page (reader installed, redirect passes through)', async () => {
    const jwt = await mintJwt();
    // page-status 404 = branch deleted the page. The branch listing (empty
    // here) no longer contains it, so the site's handler runs its not-found
    // fallback — a 307 the middleware passes through with preview headers.
    const fetchSpy = makeFetch([new Response(null, { status: 404 }), emptyListing()]);
    const onRequest = createPreviewSiteMiddleware(opts, seams(fetchSpy.fn));
    const context = contextFor('https://site.test/gone', `${PREVIEW_COOKIE_NAME}=${jwt}`);

    const response = await onRequest(context, async () => {
      // The reader must be installed so the render reflects the deletion.
      expect(context.locals.contentApi).toBeDefined();
      return new Response(null, { status: 307, headers: { location: '/404' } });
    });

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('/404');
    expect(response.headers.get('x-robots-tag')).toContain('noindex');
  });
});

describe('createPreviewSiteMiddleware — shared caches', () => {
  it('varies its redirects on the cookie and keeps them out of CDN caches', async () => {
    const jwt = await mintJwt();
    const canonical = await createPreviewSiteMiddleware(opts, seams())(
      contextFor('https://site.test/_conloca/preview/blog', `${PREVIEW_COOKIE_NAME}=${jwt}`),
      next,
    );
    const moved = await createPreviewSiteMiddleware(
      opts,
      seams(makeFetch([new Response(null, { status: 302, headers: { location: '/moved' } })]).fn),
    )(contextFor('https://site.test/old', `${PREVIEW_COOKIE_NAME}=${jwt}`), next);
    for (const response of [canonical, moved]) {
      expect(response.status).toBe(302);
      expect(response.headers.get('vary')).toBe('Cookie');
      expect(response.headers.get('cdn-cache-control')).toBe('no-store');
      expect(response.headers.get('cache-control')).toBe('private, no-store');
    }
  });
});

describe('createPreviewSiteMiddleware — the draft cannot be loaded', () => {
  it('shows the retry page, never the published page, when page-status answers 5xx', async () => {
    const jwt = await mintJwt();
    const fetchSpy = makeFetch([new Response('deploying', { status: 503 })]);
    const onRequest = createPreviewSiteMiddleware(opts, seams(fetchSpy.fn));
    const context = contextFor('https://site.test/blog?tab=2', `${PREVIEW_COOKIE_NAME}=${jwt}`);
    let rendered = false;

    const response = await onRequest(context, async () => {
      rendered = true;
      return new Response('published body');
    });

    const html = await response.text();
    expect(rendered).toBe(false);
    expect(response.status).toBe(503);
    expect(html).toContain("Preview couldn't load the draft");
    // Retry reloads this page; Exit leaves preview, since the visitor can't remove the HttpOnly cookie.
    expect(html).toContain('<a class="btn primary" href="/blog?tab=2">Retry</a>');
    expect(html).toContain('href="/_conloca/preview/__exit?to=%2Fblog"');
    expect(html).not.toContain('published body');
    expect(response.headers.get('x-robots-tag')).toBe('noindex');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('vary')).toBe('Cookie');
  });

  it.each([
    ['the page-status transport rejects', () => Promise.reject(new Error('connection reset'))],
    ['page-status answers 401', async () => new Response(null, { status: 401 })],
  ] as const)('shows the retry page when %s', async (_reason, fetchImpl) => {
    const jwt = await mintJwt();
    // Bun's `typeof fetch` carries `preconnect`; the middleware never calls it.
    const fetchFn = Object.assign(fetchImpl, { preconnect: fetch.preconnect });
    const onRequest = createPreviewSiteMiddleware(opts, seams(fetchFn));
    const context = contextFor('https://site.test/blog', `${PREVIEW_COOKIE_NAME}=${jwt}`);

    const response = await onRequest(context, htmlNext('published body'));

    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('published body');
  });

  it('keeps the Retry link same-origin when the path starts with //', async () => {
    const jwt = await mintJwt();
    const fetchSpy = makeFetch([new Response('deploying', { status: 503 })]);
    const onRequest = createPreviewSiteMiddleware(opts, seams(fetchSpy.fn));
    const context = contextFor('https://site.test//evil.test/x', `${PREVIEW_COOKIE_NAME}=${jwt}`);

    const response = await onRequest(context, htmlNext('published body'));

    expect(await response.text()).toContain('<a class="btn primary" href="/evil.test/x">Retry</a>');
  });
});

describe('createPreviewSiteMiddleware — unconfigured runtime', () => {
  it('passes through instead of throwing when the preview env is missing', async () => {
    // The middleware also runs at BUILD time while Astro prerenders pages,
    // where the deployer's runtime env vars do not exist yet — and on any
    // deployment where preview was never configured. Throwing there breaks the
    // site's build or the site itself over a feature it may not even use. The
    // preview entry route still fails loudly, because reaching it
    // means someone explicitly asked for a preview.
    const onRequest = createPreviewSiteMiddleware(() => {
      throw new Error('missing required env var CONLOCA_SAAS_ENDPOINT');
    }, seams());
    const context = contextFor('https://site.test/blog');
    const warn = spyOn(console, 'warn').mockImplementation(() => undefined);

    const response = await onRequest(context, next);
    const warning = warn.mock.calls.map((args) => String(args[0])).join('\n');
    warn.mockRestore();

    expect(await response.text()).toBe(NEXT_BODY);
    expect(context.locals.conlocaPreview).toBeUndefined();
    // It asks for a rebuild with the preview build opted in, never for opting out.
    expect(warning).toContain('rebuild with previewBuild given as an object');
    expect(warning).not.toContain('previewBuild: false');
    // The warning sends the reader to a README section, which has to exist.
    const section = /README "([^"]+)"/.exec(warning)?.[1];
    const readme = await readFile(new URL('../../README.md', import.meta.url), 'utf8');
    expect(readme.split('\n').filter((line) => line.startsWith('## '))).toContain(`## ${section}`);
  });
});

describe('createPreviewSiteMiddleware — ended share links', () => {
  it.each([
    ['grant-expired', 'This preview link has expired', 'Ask Ana for a new link.', 'View the live site'],
    [
      'grant-revoked',
      'This preview link was turned off',
      'Ana or a workspace admin turned it off.',
      'View the live site',
    ],
    ['draft-published', 'This draft was published', 'Its changes are on the live site now.', 'View live'],
    ['draft-discarded', 'This draft was discarded', 'Its changes were thrown away', 'View the live site'],
  ])(
    'answers %s with its own page and an exit to the live page, never the published bytes',
    async (kind, heading, text, link) => {
      const { fn } = makeFetch([Response.json({ error: kind, sharedBy: 'Ana' }, { status: 410 })]);
      const onRequest = createPreviewSiteMiddleware(opts, seams(fn));
      const response = await onRequest(
        contextFor('https://site.test/pricing', `${PREVIEW_COOKIE_NAME}=${await mintJwt()}`),
        htmlNext('PUBLISHED'),
      );
      const html = await response.text();
      expect(response.status).toBe(410);
      expect(html).toContain(heading);
      expect(html).toContain(text);
      expect(html).toContain(`>${link}</a>`);
      expect(html).toContain('href="/_conloca/preview/__exit?to=%2Fpricing"');
      expect(html).not.toContain('PUBLISHED');
      expect(response.headers.get('cache-control')).toBe('private, no-store');
    },
  );

  it('shows a sharer name with markup as text', async () => {
    const { fn } = makeFetch([
      Response.json({ error: 'grant-expired', sharedBy: '<img src=x onerror=alert(1)>' }, { status: 410 }),
    ]);
    const onRequest = createPreviewSiteMiddleware(opts, seams(fn));
    const html = await (
      await onRequest(contextFor('https://site.test/', `${PREVIEW_COOKIE_NAME}=${await mintJwt()}`), next)
    ).text();
    expect(html).toContain('Ask &lt;img src=x onerror=alert(1)&gt; for a new link.');
    expect(html).not.toContain('<img');
  });
});

describe('createPreviewSiteMiddleware — D2 media', () => {
  it('leaves draft refs alone: D2 serves no media route', async () => {
    const jwt = await mintJwt();
    const listing = new Response(JSON.stringify([{ id: 'p', meta: { image: '/api/v1/assets/serve/a.png' } }]), {
      status: 200,
    });
    const context = contextFor('https://site.test/blog', `${PREVIEW_COOKIE_NAME}=${jwt}`);
    await createPreviewSiteMiddleware(opts, seams(makeFetch([changed(), listing]).fn))(context, htmlNext('draft'));
    expect(JSON.stringify([...(context.locals.contentApi?.listAllContent() ?? [])])).not.toContain('__media');
  });
});

const d3 = (): PreviewMiddlewareOptions => ({ ...opts(), mode: 'd3' });

describe('createPreviewSiteMiddleware — D3', () => {
  const slug = previewBranchSlug('feature/x');
  function d3Context(cookie: string, named: boolean): PreviewMiddlewareContext {
    const headers = new Headers({ cookie });
    if (named) headers.set('conloca-preview-slug', slug);
    return {
      request: new Request('https://site.test/blog', { headers }),
      locals: {},
      url: new URL('https://site.test/blog'),
    };
  }

  it('serves the live page with no draft context when the dispatcher named no slug', async () => {
    const jwt = await mintJwt();
    const fetchSpy = makeFetch([]);
    const context = d3Context(`__Secure-conloca_preview_${slug}=${jwt}`, false);
    const response = await createPreviewSiteMiddleware(d3, seams(fetchSpy.fn))(context, next);
    expect(await response.text()).toBe(NEXT_BODY);
    expect(context.locals.conlocaPreview).toBeUndefined();
    expect(fetchSpy.calls).toEqual([]);
  });

  it('points the banner at the slug exit and names the page path', async () => {
    const jwt = await mintJwt();
    const onRequest = createPreviewSiteMiddleware(d3, seams(makeFetch([changed(), emptyListing()]).fn));
    const html = await (
      await onRequest(d3Context(`__Secure-conloca_preview_${slug}=${jwt}`, true), htmlNext('draft'))
    ).text();
    expect(html).toContain(`"exitPath":"/_conloca/preview/${slug}/__exit"`);
    expect(html).toContain('"path":"/blog"');
  });

  it('hands the baked media to the branch reader under the slug route', async () => {
    const jwt = await mintJwt();
    const listing = new Response(JSON.stringify([{ id: 'p', meta: { image: '/api/v1/assets/serve/a.png' } }]), {
      status: 200,
    });
    const context = d3Context(`__Secure-conloca_preview_${slug}=${jwt}`, true);
    const withMedia = {
      ...seams(makeFetch([changed(), listing]).fn),
      baked: { media: { refBase: '/assets', deployed: [] } },
    };
    await createPreviewSiteMiddleware(d3, withMedia)(context, htmlNext('draft'));
    expect(JSON.stringify([...(context.locals.contentApi?.listAllContent() ?? [])])).toContain(
      `/_conloca/preview/${slug}/__media/a.png`,
    );
  });

  it('moves draft refs to the slug route when the build baked no media', async () => {
    const jwt = await mintJwt();
    const listing = new Response(JSON.stringify([{ id: 'p', meta: { image: '/api/v1/assets/serve/a.png' } }]), {
      status: 200,
    });
    const context = d3Context(`__Secure-conloca_preview_${slug}=${jwt}`, true);
    await createPreviewSiteMiddleware(d3, seams(makeFetch([changed(), listing]).fn))(context, htmlNext('draft'));
    expect(JSON.stringify([...(context.locals.contentApi?.listAllContent() ?? [])])).toContain(
      `/_conloca/preview/${slug}/__media/a.png`,
    );
  });

  it('a slug with an invalid pass gets the landing page', async () => {
    // A pass the dispatcher saw (it forwards on any cookie) that doesn't verify: expired, a foreign key, a planted value.
    const foreign = await generateKeyPair('RS256', { extractable: true });
    const now = Math.floor(Date.now() / 1000);
    const planted = await new SignJWT({
      org: 'acme',
      repo: 'acme/site',
      site_id: 'website',
      branch: 'feature/x',
      scope: 'preview',
    })
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuedAt(now)
      .setExpirationTime(now + 300)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .sign(foreign.privateKey);
    const fetchSpy = makeFetch([]);
    const response = await createPreviewSiteMiddleware(d3, seams(fetchSpy.fn))(
      d3Context(`__Secure-conloca_preview_${slug}=${planted}`, true),
      next,
    );
    const body = await response.text();
    expect(body).not.toBe(NEXT_BODY);
    expect(body).toContain('Log in to edit');
    expect(fetchSpy.calls).toEqual([]);
  });

  it("a slug with only another branch's pass gets the landing page", async () => {
    // The default branch's server admits feature/y's pass through served_by, but not under feature/x's slug.
    const other = await mintJwt('preview', { branch: 'feature/y', served_by: 'feature/x' });
    const response = await createPreviewSiteMiddleware(d3, seams(makeFetch([]).fn))(
      d3Context(`__Secure-conloca_preview_${slug}=${other}`, true),
      next,
    );
    expect(await response.text()).toContain('Log in to edit');
  });
});

const d8 = (): PreviewMiddlewareOptions => ({ ...opts(), mode: 'd8' });
const d8Seams = (fetchFn: typeof fetch): PreviewRenderSeams => ({
  ...seams(fetchFn),
  baked: { trailingSlash: 'ignore', buildFormat: 'directory', domains: [] },
});

describe('createPreviewSiteMiddleware — D8', () => {
  const slug = previewBranchSlug('feature/x');
  const prefixed = (path: string) => `https://site.test/_conloca/preview/${slug}${path}`;
  async function d8Context(path: string, headers: Record<string, string> = {}): Promise<PreviewMiddlewareContext> {
    const url = prefixed(path);
    return {
      request: new Request(url, {
        headers: { cookie: `__Secure-conloca_preview_${slug}=${await mintJwt()}`, ...headers },
      }),
      locals: {},
      url: new URL(url),
    };
  }

  it('renders at the clean page path before next(), keeping the request and Exit prefixed', async () => {
    const context = await d8Context('/fr/about');
    let seen: string | undefined;
    const response = await createPreviewSiteMiddleware(d8, d8Seams(makeFetch([changed(), emptyListing()]).fn))(
      context,
      async () => {
        seen = context.url.pathname;
        return htmlNext('draft')();
      },
      slug,
    );
    expect(seen).toBe('/fr/about/');
    expect(context.request.url).toBe(prefixed('/fr/about'));
    const html = await response.text();
    expect(html).toContain(`"exitPath":"/_conloca/preview/${slug}/__exit"`);
    expect(html).toContain('"path":"/fr/about"');
  });

  it('mutates the path before anything can read currentLocale', async () => {
    const reads: string[] = [];
    const plain = await d8Context('/fr/about');
    const context = {
      ...plain,
      get currentLocale() {
        reads.push(plain.url.pathname);
        return 'fr';
      },
    };
    await createPreviewSiteMiddleware(d8, d8Seams(makeFetch([changed(), emptyListing()]).fn))(
      context,
      async () => {
        expect(context.currentLocale).toBe('fr');
        return htmlNext('draft')();
      },
      slug,
    );
    expect(reads).toEqual(['/fr/about/']);
  });

  it('ignores a conloca-preview-slug header: the slug comes only from the path', async () => {
    const context = await d8Context('/fr/about', { 'conloca-preview-slug': previewBranchSlug('other') });
    const fetchSpy = makeFetch([]);
    const response = await createPreviewSiteMiddleware(d8, d8Seams(fetchSpy.fn))(context, next);
    // No slug argument: the header does not stand in for it, so nothing previews.
    expect(await response.text()).toBe(NEXT_BODY);
    expect(context.locals.conlocaPreview).toBeUndefined();
    expect(fetchSpy.calls).toEqual([]);
  });

  it('retries the prefixed path when page-status fails', async () => {
    const context = await d8Context('/fr/about');
    const response = await createPreviewSiteMiddleware(
      d8,
      d8Seams(makeFetch([new Response('deploying', { status: 503 })]).fn),
    )(context, next, slug);
    const html = await response.text();
    expect(html).toContain(`<a class="btn primary" href="/_conloca/preview/${slug}/fr/about">Retry</a>`);
    expect(html).toContain(`href="/_conloca/preview/${slug}/__exit?to=%2Ffr%2Fabout"`);
  });

  it('keeps the draft links under the preview route, and leaves D3 links alone', async () => {
    const d8Html = await (
      await createPreviewSiteMiddleware(d8, d8Seams(makeFetch([changed(), emptyListing()]).fn))(
        await d8Context('/fr/about'),
        htmlNext('<a href="/contact">c</a>'),
        slug,
      )
    ).text();
    expect(d8Html).toContain(`href="/_conloca/preview/${slug}/contact"`);

    const headers = new Headers({ cookie: `__Secure-conloca_preview_${slug}=${await mintJwt()}` });
    headers.set('conloca-preview-slug', slug);
    const d3Html = await (
      await createPreviewSiteMiddleware(d3, seams(makeFetch([changed(), emptyListing()]).fn))(
        {
          request: new Request('https://site.test/blog', { headers }),
          locals: {},
          url: new URL('https://site.test/blog'),
        },
        htmlNext('<a href="/contact">c</a>'),
      )
    ).text();
    expect(d3Html).toContain('<a href="/contact">c</a>');
  });

  it("keeps an unchanged page's links under the preview route, without a banner", async () => {
    const html = await (
      await createPreviewSiteMiddleware(d8, d8Seams(makeFetch([new Response(null, { status: 304 })]).fn))(
        await d8Context('/fr/about'),
        htmlNext('<a href="/contact">c</a>'),
        slug,
      )
    ).text();
    expect(html).toContain(`href="/_conloca/preview/${slug}/contact"`);
    expect(html).not.toContain('conloca-preview-banner');
  });

  it('keeps a page-status redirect under the preview route', async () => {
    const response = await createPreviewSiteMiddleware(
      d8,
      d8Seams(makeFetch([new Response(null, { status: 302, headers: { location: '/moved' } })]).fn),
    )(await d8Context('/old'), next, slug);
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(`/_conloca/preview/${slug}/moved`);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });

  it.each([
    ['/404', `/_conloca/preview/${slug}/404`],
    ['https://elsewhere.test/x', 'https://elsewhere.test/x'],
  ] as const)("moves the site's own redirect to %s under the route only when same-site", async (location, expected) => {
    const response = await createPreviewSiteMiddleware(d8, d8Seams(makeFetch([changed(), emptyListing()]).fn))(
      await d8Context('/gone'),
      async () => new Response(null, { status: 307, headers: { location } }),
      slug,
    );
    expect(response.headers.get('location')).toBe(expected);
  });

  it('moves links under a non-root base', async () => {
    const url = `https://site.test/docs/_conloca/preview/${slug}/guide`;
    const context: PreviewMiddlewareContext = {
      request: new Request(url, { headers: { cookie: `__Secure-conloca_preview_${slug}=${await mintJwt()}` } }),
      locals: {},
      url: new URL(url),
    };
    const html = await (
      await createPreviewSiteMiddleware(
        () => ({ ...d8(), base: '/docs/' }),
        d8Seams(makeFetch([changed(), emptyListing()]).fn),
      )(context, htmlNext('<a href="/docs/contact">c</a>'), slug)
    ).text();
    expect(context.url.pathname).toBe('/docs/guide/');
    expect(html).toContain(`href="/docs/_conloca/preview/${slug}/contact"`);
  });

  it('renders under the path slug when a header names another branch', async () => {
    const context = await d8Context('/fr/about', { 'conloca-preview-slug': previewBranchSlug('other') });
    const html = await (
      await createPreviewSiteMiddleware(d8, d8Seams(makeFetch([changed(), emptyListing()]).fn))(
        context,
        htmlNext('draft'),
        slug,
      )
    ).text();
    expect(html).toContain(`"exitPath":"/_conloca/preview/${slug}/__exit"`);
    expect(context.url.pathname).toBe('/fr/about/');
  });
});
