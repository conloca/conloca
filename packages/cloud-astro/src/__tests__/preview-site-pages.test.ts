import { beforeAll, describe, expect, it } from 'bun:test';
import { previewBranchSlug } from '@conloca/content-api/editor-host';
import { generateKeyPair, type JWTVerifyGetKey, SignJWT } from 'jose';
import type { PreviewMiddlewareOptions } from '../preview/middleware.js';
import { createPreviewSiteMiddleware, type PreviewMiddlewareContext } from '../preview/site-middleware.js';
import { NO_SITE_PAGES, type SitePageSource } from '../preview/site-pages.js';

// Decision 2: a page the site itself prerendered (no CMS entry) stays inside a d8 preview: served from its
// published bytes with the banner and links kept under the route, or sent out to the clean URL when unreadable.

const ISSUER = 'https://cms.example.test';
const AUDIENCE = 'conloca-preview';
const slug = previewBranchSlug('feature/x');
let signingKey: CryptoKey;
let getKey: JWTVerifyGetKey;

beforeAll(async () => {
  const pair = await generateKeyPair('RS256', { extractable: true });
  signingKey = pair.privateKey;
  getKey = () => Promise.resolve(pair.publicKey);
});

async function mintJwt(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ org: 'acme', repo: 'acme/site', site_id: 'website', branch: 'feature/x', scope: 'preview' })
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuedAt(now)
    .setExpirationTime(now + 300)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .sign(signingKey);
}

const d8 =
  (base = '/') =>
  (): PreviewMiddlewareOptions => ({
    saasEndpoint: ISSUER,
    saasIssuer: ISSUER,
    saasAudience: AUDIENCE,
    repo: 'acme/site',
    siteId: 'website',
    branch: 'feature/x',
    base,
    getKey,
    mode: 'd8',
  });

async function context(path: string, pass = true, root = ''): Promise<PreviewMiddlewareContext> {
  const url = `https://site.test${root}/_conloca/preview/${slug}${path}`;
  const headers: Record<string, string> = pass ? { cookie: `__Secure-conloca_preview_${slug}=${await mintJwt()}` } : {};
  return { request: new Request(url, { headers }), locals: {}, url: new URL(url) };
}

const PUBLISHED = '<!doctype html><html><head></head><body>PUBLISHED <a href="/blog/one">b</a></body></html>';

/** A fake source listing `/contact` and `/blog/one` (or `pages`); records every call. */
function source(
  read: () => Response | null = () => new Response(PUBLISHED, { headers: { 'content-type': 'text/html' } }),
  pages = new Set(['/contact', '/blog/one']),
) {
  const calls: string[] = [];
  const sitePages: SitePageSource = {
    async has(page) {
      calls.push(`has ${page}`);
      return pages.has(page);
    },
    async read(page) {
      calls.push(`read ${page}`);
      return read();
    },
  };
  return { sitePages, calls };
}

function middleware(sitePages: SitePageSource, statuses: Response[], base = '/') {
  const fetchFn = Object.assign(
    async () => {
      const status = statuses.shift();
      if (status === undefined) throw new Error('unexpected endpoint call');
      return status;
    },
    { preconnect: fetch.preconnect },
  );
  return createPreviewSiteMiddleware(d8(base), {
    baselineApi: async () => {
      throw new Error('a site page never builds the CMS baseline');
    },
    site: 'default',
    locale: 'en',
    fetchFn,
    baked: { trailingSlash: 'ignore', buildFormat: 'directory', domains: [] },
    sitePages,
  });
}

const neverNext = async (): Promise<Response> => {
  throw new Error('next() must not run for a site page');
};

describe('site-authored pages under d8', () => {
  it.each(['/contact', '/blog/one'])('serves %s from its published bytes with the banner and Exit', async (path) => {
    const { sitePages, calls } = source();
    const response = await middleware(sitePages, [new Response(null, { status: 304 })])(
      await context(path),
      neverNext,
      slug,
    );
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(html).toContain('PUBLISHED');
    expect(html).toContain(`"exitPath":"/_conloca/preview/${slug}/__exit"`);
    expect(html).toContain(`href="/_conloca/preview/${slug}/blog/one"`);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('x-robots-tag')).toBe('noindex');
    expect(calls).toEqual([`has ${path}`, `read ${path}`]);
  });

  it('answers an ended share link with its page, never reading the site page', async () => {
    const { sitePages, calls } = source();
    const response = await middleware(sitePages, [
      Response.json({ error: 'grant-revoked', sharedBy: 'Ana' }, { status: 410 }),
    ])(await context('/contact'), neverNext, slug);
    expect(response.status).toBe(410);
    expect(await response.text()).toContain('This preview link was turned off');
    expect(calls.filter((call) => call.startsWith('read'))).toEqual([]);
  });

  it.each<[string, () => Response | null]>([
    ['null', () => null],
    ['a 404', () => new Response('missing', { status: 404 })],
  ])('sends the visitor out to the clean URL when read returns %s', async (_, read) => {
    const { sitePages } = source(read);
    const response = await middleware(sitePages, [new Response(null, { status: 304 })])(
      await context('/contact'),
      neverNext,
      slug,
    );
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/contact');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('x-robots-tag')).toBe('noindex');
  });

  it.each<[string, Response]>([
    ['a non-200', new Response(PUBLISHED, { status: 500, headers: { 'content-type': 'text/html' } })],
    ['not HTML', new Response('{}', { headers: { 'content-type': 'application/json' } })],
  ])('sends the visitor out when the page read is %s', async (_, page) => {
    const { sitePages } = source(() => page);
    const response = await middleware(sitePages, [new Response(null, { status: 304 })])(
      await context('/contact'),
      neverNext,
      slug,
    );
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/contact');
  });

  it("drops production's encoding, length, cookie and validators from the rewritten page", async () => {
    const { sitePages } = source(
      () =>
        new Response(PUBLISHED, {
          headers: {
            'content-type': 'text/html; charset=utf-8',
            'content-encoding': 'gzip',
            'content-length': '12',
            'set-cookie': 'session=prod; Path=/',
            etag: '"abc"',
            age: '30',
          },
        }),
    );
    const response = await middleware(sitePages, [new Response(null, { status: 304 })])(
      await context('/contact'),
      neverNext,
      slug,
    );
    for (const name of ['content-encoding', 'content-length', 'set-cookie', 'etag', 'age']) {
      expect(response.headers.get(name)).toBeNull();
    }
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(response.headers.get('x-robots-tag')).toBe('noindex');
    expect(await response.text()).toContain(`href="/_conloca/preview/${slug}/blog/one"`);
  });

  it("follows the branch's redirect over a site page", async () => {
    const { sitePages, calls } = source();
    const response = await middleware(sitePages, [
      new Response(null, { status: 302, headers: { location: '/moved' } }),
    ])(await context('/contact'), neverNext, slug);
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(`/_conloca/preview/${slug}/moved`);
    expect(calls).toEqual([]);
  });

  it('serves the site page when page-status calls it deleted (no CMS entry)', async () => {
    const { sitePages } = source();
    const response = await middleware(sitePages, [new Response(null, { status: 404 })])(
      await context('/contact'),
      neverNext,
      slug,
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('PUBLISHED');
  });

  it('looks the page up and sends it out with the base included', async () => {
    const { sitePages, calls } = source(() => null, new Set(['/docs/contact']));
    const response = await middleware(sitePages, [new Response(null, { status: 304 })], '/docs/')(
      await context('/contact', true, '/docs'),
      neverNext,
      slug,
    );
    expect(calls).toEqual(['has /docs/contact', 'read /docs/contact']);
    expect(response.headers.get('location')).toBe('/docs/contact');
  });

  it('sends a page outside NO_SITE_PAGES through the CMS render', async () => {
    let rendered = false;
    const response = await middleware(NO_SITE_PAGES, [new Response(null, { status: 304 })])(
      await context('/contact'),
      async () => {
        rendered = true;
        return new Response('cms', { headers: { 'content-type': 'text/plain' } });
      },
      slug,
    );
    expect(rendered).toBe(true);
    expect(await response.text()).toBe('cms');
  });

  it('gives a request with no pass the landing page, before asking about site pages', async () => {
    const { sitePages, calls } = source();
    const response = await middleware(sitePages, [])(await context('/contact', false), neverNext, slug);
    expect(await response.text()).toContain('Log in to edit');
    expect(calls).toEqual([]);
  });
});
