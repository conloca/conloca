/**
 * The preview route's request rules, free of any runtime binding: the D3 dispatcher and the d8 front middleware both
 * classify a request, answer the exit and send a failed load to the same retry page with these.
 */

import { IMAGE_EXTENSION_MIME, mediaRefPath } from '@conloca/content-api/draft-media-ref';
import { branchOfPreviewSlug } from '@conloca/content-api/editor-host';
import { parseCookieValues } from './cookie.js';
import { applyPreviewHeaders } from './headers.js';
import { renderPreviewUnavailable } from './landing.js';
import { previewHref } from './links.js';
import { handlePreviewRequest } from './middleware.js';
import { PREVIEW_CODE_PARAM, previewRoutePrefix, previewScope } from './preview-path.js';

/** What the exit route needs to answer without the preview server: the build's own repository, site and branch. */
export interface PreviewExit {
  repo: string;
  siteId: string;
  branch: string;
  audience: string;
  /** The issuer every pass must name, when the integration options name one. */
  issuer?: string;
}

export type PrefixRoute =
  | { kind: 'outside' }
  /** `<prefix>/_image`: where d8 serves Astro's image endpoint; never a slug. */
  | { kind: 'image' }
  | { kind: 'exit'; slug: string | undefined }
  /** The first segment is not a branch slug: an entry link without one, or a stray path. */
  | { kind: 'slugless'; inner: string; entering: boolean }
  | { kind: 'slugged'; slug: string; rest: string[]; inner: string; route: string; page: URL; entering: boolean }
  /** `<prefix>/<slug>/__media/<path>`: an image of the branch, served from the endpoint; `path` raw, query dropped. */
  | { kind: 'media'; slug: string; path: string; route: string };

/** Where a request falls under the preview route; `inner` is the page's own path, base included. */
export function routePrefixed(url: URL, base: string, mode: 'd3' | 'd8'): PrefixRoute {
  const prefix = previewRoutePrefix(base);
  if (url.pathname !== prefix && !url.pathname.startsWith(`${prefix}/`)) return { kind: 'outside' };
  const root = base.replace(/\/+$/u, '');
  const [first = '', ...rest] = url.pathname.slice(prefix.length + 1).split('/');
  if (first === '__exit' && rest.length === 0) return { kind: 'exit', slug: undefined };
  if (first === '_image' && rest.length === 0) return { kind: 'image' };
  const entering = url.searchParams.has(PREVIEW_CODE_PARAM);
  if (branchOfPreviewSlug(first) === null)
    return { kind: 'slugless', inner: `${root}/${[first, ...rest].join('/')}`, entering };
  if (rest.length === 1 && rest[0] === '__exit') return { kind: 'exit', slug: first };
  if (rest.length > 1 && rest[0] === '__media') {
    return { kind: 'media', slug: first, path: rest.slice(1).join('/'), route: previewScope(mode, base, first).route };
  }
  const inner = `${root}/${rest.join('/')}`;
  return {
    kind: 'slugged',
    slug: first,
    rest,
    inner,
    route: previewScope(mode, base, first).route,
    page: new URL(`${inner}${url.search}`, url.origin),
    entering,
  };
}

/** Whether the request carries the slug's pass or share grant cookie, before anything checks it. */
export function holdsPreviewCredential(cookie: string | null, mode: 'd3' | 'd8', base: string, slug: string): boolean {
  const scope = previewScope(mode, base, slug);
  return (
    parseCookieValues(cookie, scope.pass).length > 0 ||
    (scope.grant !== null && parseCookieValues(cookie, scope.grant).length > 0)
  );
}

/** The exit route, from the build's own values: the probe never waits for the preview server. */
export async function answerExit(
  url: URL,
  slug: string | undefined,
  exit: PreviewExit | null,
  base: string,
  endpoint: string,
  mode: 'd3' | 'd8',
): Promise<Response> {
  if (exit === null) {
    // No label: Conloca reads "no preview server" and says so, instead of minting a link to a 503 page.
    return applyPreviewHeaders(new Response(null, { status: 302, headers: { location: base } }));
  }
  const verdict = await handlePreviewRequest(
    new Request(`${url.origin}${previewRoutePrefix(base)}/__exit${url.search}`),
    {
      saasEndpoint: endpoint,
      saasAudience: exit.audience,
      repo: exit.repo,
      siteId: exit.siteId,
      branch: exit.branch,
      base,
      mode,
      ...(slug === undefined ? {} : { slug }),
    },
  );
  // The exit branch always answers a response; anything else would be a bug in this call, so fail closed.
  return verdict.kind === 'response'
    ? applyPreviewHeaders(verdict.response)
    : applyPreviewHeaders(new Response(null, { status: 302, headers: { location: base } }));
}

/** "Preview couldn't load the draft": the answer when there is no preview server, or it failed. */
export function previewUnavailable(retryHref: string, exitHref: string): Response {
  const page = renderPreviewUnavailable({ retryHref, exitHref });
  return applyPreviewHeaders(new Response(page.body, { status: 503, headers: page.headers }));
}

/** An entry answer (a redirect or Conloca's own page) with the preview headers applied and `Location` fixed up. */
export function finishEntry(
  answer: Response,
  page: URL,
  route: string,
  root: string,
  hosts: ReadonlySet<string>,
): Response {
  const out = applyPreviewHeaders(answer);
  const location = out.headers.get('location');
  const moved = location === null ? null : previewHref(location, page, route, root, hosts);
  if (moved !== null) out.headers.set('location', moved);
  return out;
}

function notFound(): Response {
  return applyPreviewHeaders(new Response(null, { status: 404 }));
}

/** A branch SVG opened at this same-origin URL must run no script: no sniffing, a sandboxed resource-free document. */
const MEDIA_LOCKDOWN = {
  'x-content-type-options': 'nosniff',
  'content-security-policy': "default-src 'none'; sandbox",
};

/** A JWT's shape: three base64url parts. */
const JWT_SHAPE = /^[\w-]+\.[\w-]+\.[\w-]+$/u;

/**
 * A branch image, read from the endpoint with the slug's pass. Anything but the image its path names (no pass, a path
 * that is no image ref, a revoked grant, a page, a failing endpoint) is a bodiless 404: refused bytes never reach the page.
 */
export async function serveDraftMedia(
  request: Request,
  route: Extract<PrefixRoute, { kind: 'media' }>,
  base: string,
  endpoint: string,
  fetchFn: typeof fetch,
): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') return notFound();
  const path = mediaRefPath(`/m/${route.path}`, '/m');
  const extension = path?.slice(path.lastIndexOf('.') + 1).toLowerCase() ?? '';
  const mime = Object.hasOwn(IMAGE_EXTENSION_MIME, extension) ? IMAGE_EXTENSION_MIME[extension] : undefined;
  // D3 and d8 name the slug's pass alike. A planted `__Secure-` cookie can come first (`cookie.ts`), so two are tried.
  const passes = parseCookieValues(request.headers.get('cookie'), previewScope('d8', base, route.slug).pass)
    .filter((value) => JWT_SHAPE.test(value))
    .slice(0, 2);
  if (path === undefined || mime === undefined) return notFound();
  const ifNoneMatch = request.headers.get('if-none-match');
  for (const pass of passes) {
    let upstream: Response;
    try {
      // oxlint-disable-next-line no-await-in-loop -- the second pass is read only when the first is refused.
      upstream = await fetchFn(`${endpoint}/preview/media/${path}`, {
        headers: { authorization: `Bearer ${pass}`, ...(ifNoneMatch === null ? {} : { 'if-none-match': ifNoneMatch }) },
        redirect: 'manual',
      });
    } catch (error) {
      console.error('@conloca/cloud-astro: the draft media read failed', error);
      return notFound();
    }
    const etag = upstream.headers.get('etag');
    const headers = new Headers(MEDIA_LOCKDOWN);
    if (etag !== null) headers.set('etag', etag);
    if (upstream.status === 304) return applyPreviewHeaders(new Response(null, { status: 304, headers }));
    const type = upstream.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
    if (upstream.status === 200 && type === mime) {
      headers.set('content-type', mime);
      return applyPreviewHeaders(new Response(upstream.body, { status: 200, headers }));
    }
    // oxlint-disable-next-line no-await-in-loop -- as above.
    await upstream.body?.cancel().catch(() => undefined);
  }
  return notFound();
}

/**
 * Astro's image endpoint never reaches the media route (Cloudflare's passthrough reads a local `href` from the static
 * assets only), so an `href` under the route's `__media/` is sent there, where the pass is checked.
 */
export function mediaImageRedirect(url: URL, base: string, mode: 'd3' | 'd8'): Response | null {
  const href = url.searchParams.get('href');
  if (href === null || !href.startsWith('/') || href.startsWith('//')) return null;
  const target = URL.parse(href, url.origin);
  if (target === null || target.origin !== url.origin || routePrefixed(target, base, mode).kind !== 'media')
    return null;
  return applyPreviewHeaders(new Response(null, { status: 302, headers: { location: target.pathname } }));
}
