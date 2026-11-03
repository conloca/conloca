/**
 * The dispatcher a static site runs on Cloudflare Workers when draft previews are served next to it (D3). Cloudflare
 * runs it only on the paths `wrangler.jsonc` lists in `run_worker_first`, the preview route and the site's on-demand
 * routes, so a visitor to any other page never starts it. Under the route it answers the exit itself, counts every
 * other request against a per-IP rate limit, refuses a request with no code and no pass before the preview server
 * is loaded, serves published bytes to scripts and, once their pass verifies, to pages the preview build prerendered,
 * and hands draft pages to
 * the preview server at their own path with the branch slug in a request header only it sets.
 */

import { injectPreviewBanner } from './banner.js';
import { applyPreviewHeaders } from './headers.js';
import { renderNoPreviewLanding } from './landing.js';
import { isNavigation, movedSrcset, previewHref } from './links.js';
import { handlePreviewRequest, type PreviewContext, type PreviewMiddlewareOptions } from './middleware.js';
import {
  answerExit,
  finishEntry,
  holdsPreviewCredential,
  type PreviewExit,
  previewUnavailable,
  routePrefixed,
} from './prefix-router.js';
import { normalizeTrailingSlash, PREVIEW_CODE_PARAM, PREVIEW_SLUG_HEADER, previewRoutePrefix } from './preview-path.js';

/** What the build writes next to the dispatcher (`.conloca/dispatcher/dispatcher.json`). */
export interface DispatcherConfig {
  /** Astro's `base`. */
  base: string;
  /** The editor endpoint the landing page sends a visitor to. */
  endpoint: string;
  /** Pages the preview build prerendered, as request paths without a trailing slash: their published bytes are the preview. */
  prerendered: string[];
  /** Hosts sites.json declares: links to them are links to this site. */
  domains: string[];
  /** The exit route's values; null when the preview build failed, so the probe reads "no preview server". */
  exit: PreviewExit | null;
}

/** A Cloudflare Workers rate-limit binding, as the dispatcher calls it. */
export interface PreviewLimiter {
  limit(input: { key: string }): Promise<{ success: boolean }>;
}

export interface DispatcherEnv {
  ASSETS: { fetch(request: Request): Promise<Response> };
  /** wrangler.jsonc `ratelimits`, written by `conloca connect` on the Paid plan: 60 requests per 10 s per key. Absent on Free. */
  conlocaPreviewLimit?: PreviewLimiter;
  /** The same overrides the preview server reads (`resolveFromBaked`), so both check a pass alike. */
  CONLOCA_SAAS_ENDPOINT?: string;
  CONLOCA_SAAS_ISSUER?: string;
  CONLOCA_SAAS_AUDIENCE?: string;
  /** A binding that reaches the endpoint when a plain fetch by hostname can't. */
  CONLOCA_SAAS?: { fetch(input: Request | string | URL, init?: RequestInit): Promise<Response> };
}

const TOO_MANY =
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Too many preview requests</title></head>' +
  '<body><p>Too many preview requests — try again in a few seconds.</p></body></html>';

/** The answer over the preview route's rate limit: the limit's window is 10 s. */
export function renderTooManyPreviewRequests(): Response {
  return applyPreviewHeaders(
    new Response(TOO_MANY, {
      status: 429,
      headers: { 'content-type': 'text/html; charset=utf-8', 'retry-after': '10' },
    }),
  );
}

/** The limit's key for a client address: IPv4 whole, IPv6 by its /64, since one host holds a whole /64. */
export function limitKey(ip: string | null): string {
  if (ip === null || ip === '') return 'unknown';
  if (!ip.includes(':')) return ip;
  const [head = '', tail] = ip.split('::');
  const left = head === '' ? [] : head.split(':');
  const right = tail === undefined || tail === '' ? [] : tail.split(':');
  const zeros = Array.from({ length: Math.max(0, 8 - left.length - right.length) }, () => '0');
  const groups = tail === undefined ? left : [...left, ...zeros, ...right];
  return `${groups
    .slice(0, 4)
    .map((group) => group.toLowerCase().replace(/^0+(?=.)/u, ''))
    .join(':')}::/64`;
}

/**
 * Whether this request is within the preview route's limit. A D3 site on the Free plan has no binding (on Free a
 * blocked request still counts against the daily quota, so a limiter adds nothing), and a limiter that
 * fails at run time must not take every preview down with it, so both are served.
 */
async function withinLimit(request: Request, env: DispatcherEnv): Promise<boolean> {
  const limiter = env.conlocaPreviewLimit;
  if (limiter === undefined) return true;
  try {
    return (await limiter.limit({ key: limitKey(request.headers.get('cf-connecting-ip')) })).success;
  } catch {
    return true;
  }
}

export interface PreviewServerModule {
  default: { fetch(request: Request, env: unknown, ctx: unknown): Promise<Response> };
}

/** The element surface the rewriter touches; the runtime's own type is wider. */
interface Attributes {
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
}

export function linkRewriter(page: URL, route: string, root: string, hosts: ReadonlySet<string>): HTMLRewriter {
  // A `<base href>` changes what relative links resolve against for every link after it.
  let resolveAgainst = page;
  const move = (element: Attributes, name: string): boolean => {
    const value = element.getAttribute(name);
    const moved = value === null ? null : previewHref(value, resolveAgainst, route, root, hosts);
    if (moved !== null) element.setAttribute(name, moved);
    return moved !== null;
  };
  return new HTMLRewriter()
    .on('base[href]', {
      element(element) {
        const value = element.getAttribute('href');
        if (value !== null && URL.canParse(value, page.href)) resolveAgainst = new URL(value, page);
        move(element, 'href');
      },
    })
    .on('a[href], area[href]', {
      element(element) {
        // Astro's prefetch would spend the visitor's 60 requests per 10 s on links they never open.
        if (move(element, 'href')) element.setAttribute('data-astro-prefetch', 'false');
      },
    })
    .on('form[action]', {
      element(element) {
        move(element, 'action');
      },
    })
    .on('[srcset]', {
      element(element) {
        const value = element.getAttribute('srcset');
        const moved =
          value === null ? null : movedSrcset(value, (href) => previewHref(href, resolveAgainst, route, root, hosts));
        if (moved !== null) element.setAttribute('srcset', moved);
      },
    });
}

/** How the dispatcher checks a pass: with the values the preview build baked, and the overrides its server reads. */
function passOptions(
  config: DispatcherConfig,
  exit: PreviewExit,
  env: DispatcherEnv,
  slug: string,
): PreviewMiddlewareOptions {
  const binding = env.CONLOCA_SAAS;
  const issuer = env.CONLOCA_SAAS_ISSUER || exit.issuer;
  return {
    saasEndpoint: env.CONLOCA_SAAS_ENDPOINT || config.endpoint,
    saasAudience: env.CONLOCA_SAAS_AUDIENCE || exit.audience,
    ...(issuer ? { saasIssuer: issuer } : {}),
    repo: exit.repo,
    siteId: exit.siteId,
    branch: exit.branch,
    base: config.base,
    mode: 'd3',
    slug,
    onMiss: 'landing',
    // `preconnect` only satisfies the type: jose calls the function alone.
    ...(binding === undefined
      ? {}
      : {
          fetchFn: Object.assign((input: Request | string | URL, init?: RequestInit) => binding.fetch(input, init), {
            preconnect: fetch.preconnect,
          }),
        }),
  };
}

export function createDispatcher(config: DispatcherConfig, loadServer: (() => Promise<PreviewServerModule>) | null) {
  const prefix = previewRoutePrefix(config.base);
  const root = config.base.replace(/\/+$/u, '');
  const prerendered = new Set(config.prerendered);
  const hosts = new Set(config.domains);

  /** The draft answer with the route put back on its location and links. */
  async function finish(
    answer: Response,
    page: URL,
    route: string,
    published: Pick<PreviewContext, 'branch' | 'grant'> | null,
  ): Promise<Response> {
    const out = finishEntry(answer, page, route, root, hosts);
    if (!(out.headers.get('content-type') ?? '').includes('text/html')) return out;
    const rewriter = linkRewriter(page, route, root, hosts);
    if (published === null) return rewriter.transform(out);
    // A page the preview build prerendered: the preview server never saw it, so its banner goes in here.
    out.headers.delete('content-length');
    const html = injectPreviewBanner(
      await out.text(),
      // The pass's own context: a share viewer sees who shared the draft and when the link expires.
      published,
      undefined,
      `${route}/__exit`,
      undefined,
      page.pathname,
    );
    return rewriter.transform(new Response(html, out));
  }

  return {
    async fetch(request: Request, env: DispatcherEnv, ctx: unknown): Promise<Response> {
      const url = new URL(request.url);
      const headers = new Headers(request.headers);
      // The preview server trusts this header; only this module may set it.
      headers.delete(PREVIEW_SLUG_HEADER);
      const forward = async (load: () => Promise<PreviewServerModule>, target: URL, slug: string | undefined) => {
        if (slug !== undefined) headers.set(PREVIEW_SLUG_HEADER, slug);
        const body = request.method === 'GET' || request.method === 'HEAD' ? null : await request.arrayBuffer();
        const forwarded = new Request(target.href, { method: request.method, headers, body, redirect: 'manual' });
        return (await load()).default.fetch(forwarded, env, ctx);
      };

      let at = routePrefixed(url, config.base, 'd3');
      if (at.kind === 'outside') {
        // `<base>_image` is listed for draft pages only (the live site's pages are prerendered), so it is the
        // preview's to pay for: it counts against the preview route's limit.
        if (url.pathname === `${root}/_image` && !(await withinLimit(request, env)))
          return renderTooManyPreviewRequests();
        // The site's own on-demand routes (and, with not_found_handling "none", its misses): unprefixed, no draft
        // context, and no catch: production fails loudly here. A failed preview build ships with a null server only
        // when the site lists nothing beyond the prefix (`finishD3Build`), so this fallback is never a live API route.
        return loadServer === null ? env.ASSETS.fetch(request) : forward(loadServer, url, undefined);
      }
      // The probe, and a page's own exit: answered here, never counted, never loading the server.
      if (at.kind === 'exit') return answerExit(url, at.slug, config.exit, config.base, config.endpoint, 'd3');
      // D3's image endpoint is `<base>_image`: under the route `_image` is a stray path, as any other slugless one.
      if (at.kind === 'image')
        at = { kind: 'slugless', inner: `${root}/_image`, entering: url.searchParams.has(PREVIEW_CODE_PARAM) };

      // Every other request under the route counts, `__status` included, before any other work.
      if (!(await withinLimit(request, env))) return renderTooManyPreviewRequests();
      const { inner, entering } = at;
      const route = at.kind === 'slugged' ? at.route : prefix;
      const { exit: baked } = config;
      if (loadServer === null || baked === null) return previewUnavailable(`${url.pathname}${url.search}`, config.base);
      // Under the route a preview server that throws (a Node-only import, a render error) answers
      // "Preview couldn't load the draft", never Cloudflare's own error page.
      const guarded = async (target: URL, slug: string | undefined): Promise<Response> => {
        try {
          return await forward(loadServer, target, slug);
        } catch (error) {
          console.error('@conloca/cloud-astro: the preview server failed', error);
          return previewUnavailable(`${url.pathname}${url.search}`, `${route}/__exit?to=${encodeURIComponent(inner)}`);
        }
      };
      const landing = () =>
        applyPreviewHeaders(renderNoPreviewLanding({ pathname: inner, saasEndpoint: config.endpoint }));

      if (at.kind === 'slugless') {
        // A slugless entry link: the preview server exchanges the code and takes the slug from the pass.
        if (!entering) return landing();
        return finishEntry(await guarded(url, undefined), url, prefix, root, hosts);
      }
      const { slug, page } = at;
      // Refused before the preview server loads: a request with no credential never pays for its start-up.
      if (!entering && !holdsPreviewCredential(request.headers.get('cookie'), 'd3', config.base, slug))
        return landing();
      if (entering) {
        // The adapter serves a prerendered page from the static files before any middleware runs, so the code goes
        // to the preview build's entry route (`<prefix>/[...path]`, always on demand), as under D2.
        const entry = new URL(`${prefix}${inner.slice(root.length)}${url.search}`, url.origin);
        return finishEntry(await guarded(entry, slug), page, route, root, hosts);
      }
      if (!isNavigation(request)) {
        // Scripts never read drafts: a fetch under the route gets published bytes.
        return applyPreviewHeaders(await env.ASSETS.fetch(new Request(page.href, { headers })));
      }
      if (prerendered.has(normalizeTrailingSlash(inner))) {
        // The preview server never sees a prerendered page, so its pass is checked here, as the server checks every
        // other: one that fails gets the landing page (or the share link's renewal), never the banner.
        const verdict = await handlePreviewRequest(
          new Request(page.href, { headers }),
          passOptions(config, baked, env, slug),
        );
        if (verdict.kind !== 'preview')
          return finishEntry(verdict.kind === 'response' ? verdict.response : landing(), page, route, root, hosts);
        return finish(await env.ASSETS.fetch(new Request(page.href, { headers })), page, route, verdict.ctx);
      }
      return finish(await guarded(page, slug), page, route, null);
    },
  };
}
