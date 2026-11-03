/**
 * Site-wide preview middleware for the recursive preview build — the SERVING
 * SURFACE of draft preview.
 *
 * WHY THIS EXISTS — the fixed preview route is an entry door, not the serving
 * surface. Without this, preview survives exactly one page view: the visitor
 * lands on `/_conloca/preview/about`, clicks a link, and the root-absolute
 * `/blog` the site's template emitted drops the route and silently serves the
 * PUBLISHED page. The preview cookie is already `Path=/`,
 * so the browser is sending the credential on that request — this listens.
 *
 * WHY THE RENDER HAPPENS HERE, VIA `next()` — a middleware rewrite onto the
 * preview route's handler (an earlier design) forced the render through
 * `Astro.rewrite`, whose route matching does not fall through prerendered
 * routes: with two root catch-alls (the CMS pages route on demand, a docs
 * integration's route prerendered) the rewrite matched the prerendered one
 * and threw. Request-level routing — what `next()` continues into — DOES fall
 * through a prerendered dynamic match to the first on-demand route, i.e. the
 * CMS handler for CMS pathnames. So the middleware validates the credential,
 * asks the endpoint for the page's render-graph status, installs the branch
 * reader on `locals.contentApi`, and lets the site's own route render it;
 * the response then gets the banner + robots/cache headers.
 *
 * Mounted only inside the recursive preview build; never in the site's
 * production build. Deliberately fail-open: any request without a valid
 * preview credential passes straight through to the ordinary page.
 */

import type { ContentAPI } from '@conloca/content-api';
import { isSluggedPreviewMode } from '@conloca/content-api/editor-host';
import { fetchPageStatus, isShareEndedKind, type PageStatus } from './_dispatch.js';
import type { BakedPreviewOpts } from './_resolve-opts.js';
import { injectPreviewBanner } from './banner.js';
import { PreviewContentAPI } from './content-api.js';
import { applyPreviewHeaders, PREVIEW_CACHE_HEADERS } from './headers.js';
import { renderPreviewUnavailable, renderShareEnded } from './landing.js';
import { rewritePreviewLinks } from './links.js';
import { handlePreviewRequest, type PreviewContext, type PreviewMiddlewareOptions } from './middleware.js';
import { finishEntry, routePrefixed } from './prefix-router.js';
import {
  cleanPagePath,
  normalizeTrailingSlash,
  PREVIEW_SLUG_HEADER,
  pathUnderBase,
  previewScope,
  stripPreviewPrefix,
} from './preview-path.js';
import { NO_SITE_PAGES, type SitePageSource } from './site-pages.js';

/** The subset of Astro's middleware context this middleware touches. */
export interface PreviewMiddlewareContext {
  request: Request;
  locals: { conlocaPreview?: PreviewContext; contentApi?: ContentAPI };
  url: URL;
}

export type PreviewMiddlewareNext = () => Promise<Response>;

/**
 * Render dependencies the binding entry supplies. A seam object (not module
 * imports) because the collection-backed baseline needs `astro:content` and
 * the routing config — both exist only inside the site's own build graph,
 * which the seams module (`src/preview-render-seams.ts`) is compiled into.
 */
export interface PreviewRenderSeams {
  /** Lazily builds the collection-backed baseline reader. Called per preview render. */
  baselineApi: () => Promise<ContentAPI>;
  /** Site/locale from the routing config, threaded into the page-status call. */
  site?: string;
  locale?: string;
  /**
   * Transport for every endpoint call this middleware makes (JWKS,
   * page-status, content reads). The binding entry supplies a binding's fetch
   * when the Cloudflare Workers runtime exposes the endpoint binding (see
   * `resolveEndpointFetch`), for deployments that cannot reach the endpoint
   * with a plain fetch by hostname.
   */
  fetchFn?: typeof fetch;
  /** D8: the baked routing values the clean page path and the moved links follow. */
  baked?: Pick<BakedPreviewOpts, 'trailingSlash' | 'buildFormat' | 'domains'>;
  /** D8: pages the site prerendered itself, kept inside the preview. Defaults to none. */
  sitePages?: SitePageSource;
}

/**
 * Builds the Astro middleware `onRequest` handler.
 *
 * `resolveOpts` is a thunk so the (throwing) env-var resolution happens per
 * request rather than at module load — a misconfigured runtime should fail the
 * request with a diagnosable error, not prevent the whole site from booting.
 */
export function createPreviewSiteMiddleware(resolveOpts: () => PreviewMiddlewareOptions, seams: PreviewRenderSeams) {
  return async function onRequest(
    context: PreviewMiddlewareContext,
    next: PreviewMiddlewareNext,
    slugFromPath?: string,
  ): Promise<Response> {
    // Already inside a preview render — don't re-run the credential check.
    if (context.locals.conlocaPreview) return next();

    // Resolving the runtime env throws when preview was never configured — and
    // ALSO at build time, where Astro runs middleware while prerendering pages
    // and the deployer's runtime vars do not exist yet. Neither is a reason to
    // break the site's build or the whole site over a feature it may
    // not use, so pass through and warn once. The preview entry route still
    // fails loudly: reaching it means someone explicitly asked to preview.
    let opts: PreviewMiddlewareOptions;
    try {
      opts = resolveOpts();
    } catch (error) {
      warnUnconfiguredOnce(error);
      return next();
    }

    // Under D3 the dispatcher names the requested branch's slug, after stripping any the browser sent. Under D8 the
    // front parses it from the path; D8 trusts no header.
    const slug = opts.mode === 'd3' ? (context.request.headers.get(PREVIEW_SLUG_HEADER) ?? undefined) : slugFromPath;
    const verdict = await handlePreviewRequest(context.request, {
      ...opts,
      ...(slug === undefined ? {} : { slug }),
      // No silent fallback: under the slug, a pass that doesn't verify gets the landing page, never the
      // published page at the draft URL. Only the live site's own requests (no slug) pass through.
      onMiss: slug === undefined ? 'pass-through' : 'landing',
      fetchFn: opts.fetchFn ?? seams.fetchFn,
    });
    if (verdict.kind === 'response') return verdict.response;
    if (verdict.kind !== 'preview') return next();
    // A preview verdict under D3 means the slug was named, so the scope always resolves.
    const exitPath = `${previewScope(opts.mode ?? 'd2', opts.base, slug).route}/__exit`;

    // D8 serves the draft under the route: `rawPath` (captured before the path changes below) keeps the prefix for
    // Retry, `pagePath` is the page's own.
    const rawPath = context.url.pathname;
    const d8 = opts.mode === 'd8' ? routePrefixed(context.url, opts.base, 'd8') : null;
    if (d8 !== null && d8.kind !== 'slugged') return next();
    const pagePath = d8?.inner ?? rawPath;
    const path = normalizeTrailingSlash(stripPreviewPrefix(pagePath, opts.base));
    // D2/D4 with a valid credential on the preview route itself: canonicalize to the clean site path instead of
    // rendering under the route — links, assets and the page lookup all assume clean paths.
    if (!isSluggedPreviewMode(opts.mode ?? 'd2') && stripPreviewPrefix(rawPath, opts.base) !== rawPath) {
      return new Response(null, {
        status: 302,
        headers: { location: path, ...PREVIEW_CACHE_HEADERS },
      });
    }
    // Before anything reads `currentLocale`: the render sees the live page's `Astro.url`, canonical and locale.
    if (d8 !== null) {
      context.url.pathname = cleanPagePath(
        d8.inner,
        seams.baked?.trailingSlash ?? 'ignore',
        seams.baked?.buildFormat ?? 'directory',
      );
    }
    // D8 has no dispatcher: whatever the render answers stays under the route, HTML links and same-site `Location`.
    const root = opts.base.replace(/\/+$/u, '');
    const hosts = new Set(seams.baked?.domains ?? []);
    const stay = (response: Response, html?: string): Response => {
      const init = { status: response.status, headers: response.headers };
      if (d8 === null) return applyPreviewHeaders(html === undefined ? response : new Response(html, init));
      if (html === undefined) return finishEntry(response, d8.page, d8.route, root, hosts);
      return applyPreviewHeaders(new Response(rewritePreviewLinks(html, d8.page, d8.route, root, hosts), init));
    };

    context.locals.conlocaPreview = verdict.ctx;
    // An endpoint failure (5xx mid-deploy, auth envelope, network) must neither
    // 500 the site nor pass published bytes off as the draft: answer with a
    // retry page that also offers Exit, since the visitor can't remove the
    // HttpOnly cookie.
    let status: PageStatus;
    try {
      status = await fetchPageStatus({
        saasEndpoint: opts.saasEndpoint,
        ctx: verdict.ctx,
        path,
        site: seams.site,
        locale: seams.locale,
        build: opts.buildCommit,
        fetchFn: seams.fetchFn,
      });
    } catch (error) {
      console.warn(
        `[@conloca/cloud-astro] preview page-status failed for ${path} — showing the retry page: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
      return renderPreviewUnavailable({
        // Collapse leading slashes: `//evil.test/x` would otherwise be a cross-origin link.
        retryHref: `/${rawPath.replace(/^\/+/u, '')}${context.url.search}`,
        exitHref: `${exitPath}?to=${encodeURIComponent(pagePath)}`,
      });
    }

    if (isShareEndedKind(status.kind) && 'sharedBy' in status) {
      return renderShareEnded(status.kind, {
        sharedBy: status.sharedBy,
        liveHref: `${exitPath}?to=${encodeURIComponent(path)}`,
      });
    }

    // The banner the draft and a site-authored page both carry.
    const banner = (html: string): string => {
      let shareUrl: string | undefined;
      if (verdict.ctx.editorUrl !== undefined) {
        const url = new URL(verdict.ctx.editorUrl);
        url.searchParams.set('share', pathUnderBase(path, opts.base));
        shareUrl = url.toString();
      }
      // The page's own path: under D3 and D8 the address bar holds the route, which Edit and Exit must not carry.
      return injectPreviewBanner(html, verdict.ctx, opts.saasEndpoint, exitPath, shareUrl, pagePath);
    };

    if (status.kind === 'redirect') {
      // Always 302 (fetchPageStatus already downgraded 301) so a stale preview
      // redirect can never be cached by intermediaries.
      return stay(new Response(null, { status: 302, headers: { location: status.target } }));
    }

    // A page the site prerendered itself stays in the preview with its published bytes; unreadable, it goes out.
    const sitePages = seams.sitePages ?? NO_SITE_PAGES;
    if (d8 !== null && (await sitePages.has(path))) {
      const page = await sitePages.read(path);
      const type = page?.headers.get('content-type') ?? '';
      if (page === null || page.status !== 200 || !type.includes('text/html')) {
        return applyPreviewHeaders(
          new Response(null, { status: 302, headers: { location: `${d8.page.pathname}${d8.page.search}` } }),
        );
      }
      // Only the type carries over: production's encoding, length, cookies and validators don't fit the rewritten bytes.
      return stay(new Response(null, { headers: { 'content-type': type } }), banner(await page.text()));
    }

    if (status.kind === 'unchanged') {
      // Production-equivalent bytes: render the ordinary route against the
      // build's own collections. No banner — same delegated semantics as
      // before — but preview responses always carry the robots/cache headers.
      const live = await next();
      const liveHtml = d8 !== null && (live.headers.get('content-type') ?? '').includes('text/html');
      return stay(live, liveHtml ? await live.text() : undefined);
    }

    // 'changed' and 'deleted' both render through the site's own route with
    // the branch reader installed. For 'deleted' the branch listing no longer
    // contains the page, so the site's own not-found flow runs (astro-cms:
    // PAGE_NOT_FOUND → the configured fallback), which is the truthful render
    // of a branch that removed the page.
    const previewApi = new PreviewContentAPI({
      saasEndpoint: opts.saasEndpoint,
      ctx: verdict.ctx,
      baselineApi: await seams.baselineApi(),
      embeddedPayloads: status.kind === 'changed' ? status.embedded : new Map(),
      fetchFn: seams.fetchFn,
    });
    // Prime the branch page listing before the renderer enumerates content:
    // `listAllContent` is synchronous, and a page created on the branch is
    // absent from the build baseline entirely.
    await previewApi.loadBranchManifests();
    context.locals.contentApi = previewApi;

    const rendered = await next();
    const contentType = rendered.headers.get('content-type') ?? '';
    if (!contentType.includes('text/html')) {
      // Redirects (e.g. the not-found fallback) and non-HTML responses pass
      // through with the preview headers only.
      return stay(rendered);
    }
    return stay(rendered, banner(await rendered.text()));
  };
}

/**
 * Warn once per process that the middleware is inert.
 *
 * Once, not per request: this runs on every request in the preview build, and
 * a per-request warning would bury the site's own build/server output.
 */
let warned = false;
function warnUnconfiguredOnce(error: unknown): void {
  if (warned) return;
  warned = true;
  const detail = error instanceof Error ? error.message : String(error);
  console.warn(
    `[@conloca/cloud-astro] draft preview is INERT — ${detail}\n` +
      '  Requests are being served as the ordinary published site.\n' +
      '  The preview server is missing its baked settings: rebuild with previewBuild given as an object ' +
      '(see the cloud-astro README "Draft previews").',
  );
}
