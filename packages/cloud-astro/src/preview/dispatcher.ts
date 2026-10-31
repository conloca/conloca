/**
 * The dispatcher a static site runs on Cloudflare Workers when draft previews are served next to it (D3). Cloudflare
 * runs it only on the paths `wrangler.jsonc` lists in `run_worker_first`, the preview route and the site's on-demand
 * routes, so a visitor to any other page never starts it. Under the route it answers the exit itself, counts every
 * other request against a per-IP rate limit, refuses a request with no code and no pass before the preview server
 * is loaded, serves published bytes to scripts and, once their pass verifies, to pages the preview build prerendered,
 * and hands draft pages to
 * the preview server at their own path with the branch slug in a request header only it sets.
 */

import { branchOfPreviewSlug } from '@conloca/content-api/editor-host';
import { injectPreviewBanner } from './banner.js';
import { parseCookieValues } from './cookie.js';
import { applyPreviewHeaders, PREVIEW_CACHE_HEADERS } from './headers.js';
import { renderNoPreviewLanding, renderPreviewUnavailable } from './landing.js';
import { handlePreviewRequest, type PreviewContext, type PreviewMiddlewareOptions } from './middleware.js';
import {
  normalizeTrailingSlash,
  PREVIEW_CODE_PARAM,
  PREVIEW_SLUG_HEADER,
  previewRoutePrefix,
  previewScope,
} from './preview-path.js';

/** What the exit route needs to answer without the preview server: the build's own repository, site and branch. */
export interface DispatcherExit {
  repo: string;
  siteId: string;
  branch: string;
  audience: string;
  /** The issuer every pass must name, when the integration options name one. */
  issuer?: string;
}

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
  exit: DispatcherExit | null;
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

/**
 * `value` under the preview route when it names a page of this site, else null (left as it is). It is resolved
 * against `page`, the unprefixed URL the page was rendered for, so `../x` and `?q` keep their meaning. Files, built
 * assets, the image endpoint, `/_conloca/` and other sites stay where they are.
 */
export function previewHref(
  value: string,
  page: URL,
  route: string,
  root: string,
  hosts: ReadonlySet<string>,
): string | null {
  if (value === '' || value.startsWith('#')) return null;
  let target: URL;
  try {
    target = new URL(value, page);
  } catch {
    return null;
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') return null;
  const own = target.host === page.host;
  if (!own && !hosts.has(target.hostname)) return null;
  const { pathname } = target;
  if (root !== '' && pathname !== root && !pathname.startsWith(`${root}/`)) return null;
  const rest = pathname.slice(root.length) || '/';
  if (rest.startsWith('/_conloca/') || rest.startsWith('/_astro/') || rest === '/_image') return null;
  const last = rest.slice(rest.lastIndexOf('/') + 1);
  if (last.includes('.') && !last.endsWith('.html')) return null;
  const moved = `${route}${rest}${target.search}${target.hash}`;
  return own ? moved : `${target.origin}${moved}`;
}

/** A navigation, the only request that may receive draft HTML; without Sec-Fetch-*, one that asks for HTML. */
function isNavigation(request: Request): boolean {
  const mode = request.headers.get('sec-fetch-mode');
  if (mode !== null) return mode === 'navigate';
  return (request.headers.get('accept') ?? '').includes('text/html');
}

/**
 * `srcset` with each candidate URL that `move` answers for replaced, everything else kept byte for byte; null when none
 * moved. A URL runs to the next whitespace, as the HTML parser reads it, so a `data:` URL's commas stay inside it.
 */
function movedSrcset(value: string, move: (href: string) => string | null): string | null {
  let out = '';
  let rest = value;
  let moved = false;
  while (rest !== '') {
    const gap = /^[\s,]*/u.exec(rest)?.[0] ?? '';
    const token = /^\S*/u.exec(rest.slice(gap.length))?.[0] ?? '';
    const commas = /,*$/u.exec(token)?.[0] ?? '';
    const href = token.slice(0, token.length - commas.length);
    rest = rest.slice(gap.length + token.length);
    // Descriptors (`1x`, `400w`) run to the next comma, unless the URL already ended at one.
    const descriptor = commas === '' ? (/^[^,]*/u.exec(rest)?.[0] ?? '') : '';
    rest = rest.slice(descriptor.length);
    const target = href === '' ? null : move(href);
    if (target !== null) moved = true;
    out += `${gap}${target ?? href}${commas}${descriptor}`;
  }
  return moved ? out : null;
}

function linkRewriter(page: URL, route: string, root: string, hosts: ReadonlySet<string>): HTMLRewriter {
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
  exit: DispatcherExit,
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

  /** The exit route, from the build's own values: the probe never waits for the preview server. */
  async function exit(url: URL, slug: string | undefined): Promise<Response> {
    if (config.exit === null) {
      // No label: Conloca reads "no preview server" and says so, instead of minting a link to a 503 page.
      return new Response(null, { status: 302, headers: { location: config.base, ...PREVIEW_CACHE_HEADERS } });
    }
    const verdict = await handlePreviewRequest(new Request(`${url.origin}${prefix}/__exit${url.search}`), {
      saasEndpoint: config.endpoint,
      saasAudience: config.exit.audience,
      repo: config.exit.repo,
      siteId: config.exit.siteId,
      branch: config.exit.branch,
      base: config.base,
      mode: 'd3',
      ...(slug === undefined ? {} : { slug }),
    });
    // The exit branch always answers a response; anything else would be a bug in this call, so fail closed.
    return verdict.kind === 'response'
      ? applyPreviewHeaders(verdict.response)
      : applyPreviewHeaders(new Response(null, { status: 302, headers: { location: config.base } }));
  }

  /** An entry answer (a redirect or Conloca's own page): headers and `Location` only, never its HTML. */
  function finishEntry(answer: Response, page: URL, route: string): Response {
    const out = applyPreviewHeaders(answer);
    const location = out.headers.get('location');
    const moved = location === null ? null : previewHref(location, page, route, root, hosts);
    if (moved !== null) out.headers.set('location', moved);
    return out;
  }

  /** The draft answer with the route put back on its location and links. */
  async function finish(
    answer: Response,
    page: URL,
    route: string,
    published: Pick<PreviewContext, 'branch' | 'grant'> | null,
  ): Promise<Response> {
    const out = finishEntry(answer, page, route);
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

      if (url.pathname !== prefix && !url.pathname.startsWith(`${prefix}/`)) {
        // `<base>_image` is listed for draft pages only (the live site's pages are prerendered), so it is the
        // preview's to pay for: it counts against the preview route's limit.
        if (url.pathname === `${root}/_image` && !(await withinLimit(request, env)))
          return renderTooManyPreviewRequests();
        // The site's own on-demand routes (and, with not_found_handling "none", its misses): unprefixed, no draft
        // context, and no catch: production fails loudly here. A failed preview build ships with a null server only
        // when the site lists nothing beyond the prefix (`finishD3Build`), so this fallback is never a live API route.
        return loadServer === null ? env.ASSETS.fetch(request) : forward(loadServer, url, undefined);
      }
      const [first = '', ...rest] = url.pathname.slice(prefix.length + 1).split('/');
      // The probe, and a page's own exit: answered here, never counted, never loading the server.
      if (first === '__exit' && rest.length === 0) return exit(url, undefined);
      const branch = branchOfPreviewSlug(first);
      if (branch !== null && rest.length === 1 && rest[0] === '__exit') return exit(url, first);

      // Every other request under the route counts, `__status` included, before any other work.
      if (!(await withinLimit(request, env))) return renderTooManyPreviewRequests();
      const entering = url.searchParams.has(PREVIEW_CODE_PARAM);
      const inner = branch === null ? `${root}/${[first, ...rest].join('/')}` : `${root}/${rest.join('/')}`;
      const route = branch === null ? prefix : previewScope('d3', config.base, first).route;
      const { exit: baked } = config;
      if (loadServer === null || baked === null) {
        const page = renderPreviewUnavailable({ retryHref: `${url.pathname}${url.search}`, exitHref: config.base });
        return applyPreviewHeaders(new Response(page.body, { status: 503, headers: page.headers }));
      }
      // Under the route a preview server that throws (a Node-only import, a render error) answers
      // "Preview couldn't load the draft", never Cloudflare's own error page.
      const guarded = async (target: URL, slug: string | undefined): Promise<Response> => {
        try {
          return await forward(loadServer, target, slug);
        } catch (error) {
          console.error('@conloca/cloud-astro: the preview server failed', error);
          const page = renderPreviewUnavailable({
            retryHref: `${url.pathname}${url.search}`,
            exitHref: `${route}/__exit?to=${encodeURIComponent(inner)}`,
          });
          return applyPreviewHeaders(new Response(page.body, { status: 503, headers: page.headers }));
        }
      };
      const landing = () =>
        applyPreviewHeaders(renderNoPreviewLanding({ pathname: inner, saasEndpoint: config.endpoint }));

      if (branch === null) {
        // A slugless entry link: the preview server exchanges the code and takes the slug from the pass.
        if (!entering) return landing();
        return finishEntry(await guarded(url, undefined), url, prefix);
      }
      const scope = previewScope('d3', config.base, first);
      const cookie = request.headers.get('cookie');
      const holds =
        parseCookieValues(cookie, scope.pass).length > 0 ||
        (scope.grant !== null && parseCookieValues(cookie, scope.grant).length > 0);
      // Refused before the preview server loads: a request with no credential never pays for its start-up.
      if (!entering && !holds) return landing();
      const page = new URL(`${inner}${url.search}`, url.origin);
      if (entering) {
        // The adapter serves a prerendered page from the static files before any middleware runs, so the code goes
        // to the preview build's entry route (`<prefix>/[...path]`, always on demand), as under D2.
        const entry = new URL(`${prefix}${inner.slice(root.length)}${url.search}`, url.origin);
        return finishEntry(await guarded(entry, first), page, scope.route);
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
          passOptions(config, baked, env, first),
        );
        if (verdict.kind !== 'preview')
          return finishEntry(verdict.kind === 'response' ? verdict.response : landing(), page, scope.route);
        return finish(await env.ASSETS.fetch(new Request(page.href, { headers })), page, scope.route, verdict.ctx);
      }
      return finish(await guarded(page, first), page, scope.route, null);
    },
  };
}
