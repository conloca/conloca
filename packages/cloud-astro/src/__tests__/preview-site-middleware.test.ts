import { beforeAll, describe, expect, it, spyOn } from 'bun:test';
import { readFile } from 'node:fs/promises';
import type { ContentAPI } from '@conloca/content-api';
import { generateKeyPair, type JWTVerifyGetKey, SignJWT } from 'jose';
import type { PreviewMiddlewareOptions } from '../preview/middleware.js';
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

const SECRET = 'abcdef1234567890';
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

async function mintJwt(scope: 'preview' | 'editor' = 'preview'): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ org: 'acme', repo: 'site', branch: 'feature/x', scope })
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuedAt(now)
    .setExpirationTime(now + 300)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .sign(signingKey);
}

function opts(): PreviewMiddlewareOptions {
  return { secret: SECRET, saasEndpoint: ISSUER, saasIssuer: ISSUER, saasAudience: AUDIENCE, getKey };
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
    const context = contextFor('https://site.test/blog', `conloca_preview_${SECRET}=${badJwt}`);

    const response = await onRequest(context, next);

    expect(context.locals.conlocaPreview).toBeUndefined();
    expect(await response.text()).toBe(NEXT_BODY);
  });

  it('rejects a signed editor-scope JWT before any draft read', async () => {
    const jwt = await mintJwt('editor');
    const fetchSpy = makeFetch([]);
    const onRequest = createPreviewSiteMiddleware(opts, seams(fetchSpy.fn));
    const context = contextFor('https://site.test/blog', `conloca_preview_${SECRET}=${jwt}`);

    const response = await onRequest(context, next);

    expect(fetchSpy.calls).toHaveLength(0);
    expect(context.locals.conlocaPreview).toBeUndefined();
    expect(context.locals.contentApi).toBeUndefined();
    expect(await response.text()).toBe(NEXT_BODY);
  });

  it('returns the init redirect when a token arrives in the query param', async () => {
    const jwt = await mintJwt();
    const onRequest = createPreviewSiteMiddleware(opts, seams());
    const context = contextFor(`https://site.test/blog?conloca_preview_${SECRET}=${jwt}`);

    const response = await onRequest(context, next);

    expect(response.status).toBe(302);
    expect(response.headers.get('set-cookie')).toContain('conloca_preview_');
  });

  it('canonicalizes a valid cookie on the literal secret-prefixed URL to the clean path', async () => {
    const jwt = await mintJwt();
    const onRequest = createPreviewSiteMiddleware(opts, seams());
    const context = contextFor(`https://site.test/conloca_preview_${SECRET}/blog`, `conloca_preview_${SECRET}=${jwt}`);

    const response = await onRequest(context, next);

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/blog');
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
    const context = contextFor('https://site.test/blog', `conloca_preview_${SECRET}=${jwt}`);

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

  it('normalizes a trailing slash out of the page-status path (site nav links carry them)', async () => {
    const jwt = await mintJwt();
    const fetchSpy = makeFetch([new Response(null, { status: 304 })]);
    const onRequest = createPreviewSiteMiddleware(opts, seams(fetchSpy.fn));
    const context = contextFor('https://site.test/faq/', `conloca_preview_${SECRET}=${jwt}`);

    await onRequest(context, htmlNext('published'));

    expect(String(fetchSpy.calls[0].input)).toBe(`${ISSUER}/preview/page-status/faq?locale=en&site=default`);
  });

  it('serves the ordinary render without a banner on "unchanged", still noindexed', async () => {
    const jwt = await mintJwt();
    const fetchSpy = makeFetch([new Response(null, { status: 304 })]);
    const onRequest = createPreviewSiteMiddleware(opts, seams(fetchSpy.fn));
    const context = contextFor('https://site.test/blog', `conloca_preview_${SECRET}=${jwt}`);

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
    const context = contextFor('https://site.test/old', `conloca_preview_${SECRET}=${jwt}`);

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
    const context = contextFor('https://site.test/gone', `conloca_preview_${SECRET}=${jwt}`);

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

describe('createPreviewSiteMiddleware — endpoint degradation', () => {
  it('serves published bytes with preview headers when page-status answers 5xx', async () => {
    // An endpoint mid-deploy must not take the whole site down for a
    // visitor holding a (HttpOnly, unremovable) preview cookie. Degrade to
    // the ordinary render — the documented fail-open stance.
    const jwt = await mintJwt();
    const fetchSpy = makeFetch([new Response('deploying', { status: 503 })]);
    const onRequest = createPreviewSiteMiddleware(opts, seams(fetchSpy.fn));
    const context = contextFor('https://site.test/blog', `conloca_preview_${SECRET}=${jwt}`);

    const response = await onRequest(context, htmlNext('published body'));

    const html = await response.text();
    expect(html).toContain('published body');
    expect(html).not.toContain('conloca-preview-banner');
    expect(context.locals.contentApi).toBeUndefined();
    expect(response.headers.get('x-robots-tag')).toContain('noindex');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });

  it('serves published bytes when the page-status transport itself rejects', async () => {
    const jwt = await mintJwt();
    const rejecting = (() => Promise.reject(new Error('connection reset'))) as unknown as typeof fetch;
    const onRequest = createPreviewSiteMiddleware(opts, seams(rejecting));
    const context = contextFor('https://site.test/blog', `conloca_preview_${SECRET}=${jwt}`);

    const response = await onRequest(context, htmlNext('published body'));

    expect(await response.text()).toContain('published body');
    expect(response.headers.get('x-robots-tag')).toContain('noindex');
  });
});

describe('createPreviewSiteMiddleware — unconfigured runtime', () => {
  it('passes through instead of throwing when the preview env is missing', async () => {
    // The middleware also runs at BUILD time while Astro prerenders pages,
    // where the deployer's runtime env vars do not exist yet — and on any
    // deployment where preview was never configured. Throwing there breaks the
    // site's build or the site itself over a feature it may not even use. The
    // secret-prefixed entry route still fails loudly, because reaching it
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
    // The warning sends the reader to a README section, which has to exist.
    const section = /README "([^"]+)"/.exec(warning)?.[1];
    const readme = await readFile(new URL('../../README.md', import.meta.url), 'utf8');
    expect(readme.split('\n').filter((line) => line.startsWith('## '))).toContain(`## ${section}`);
  });
});
