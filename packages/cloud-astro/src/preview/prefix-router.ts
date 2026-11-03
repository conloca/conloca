/**
 * The preview route's request rules, free of any runtime binding: the D3 dispatcher and the d8 front middleware both
 * classify a request, answer the exit and send a failed load to the same retry page with these.
 */

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
  | { kind: 'slugged'; slug: string; rest: string[]; inner: string; route: string; page: URL; entering: boolean };

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
