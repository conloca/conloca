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
import { fetchPageStatus, type PageStatus } from './_dispatch.js';
import { injectPreviewBanner } from './banner.js';
import { PreviewContentAPI } from './content-api.js';
import { applyPreviewHeaders } from './headers.js';
import { handlePreviewRequest, type PreviewContext, type PreviewMiddlewareOptions } from './middleware.js';
import { normalizeTrailingSlash, previewRoutePrefix, stripPreviewPrefix } from './preview-path.js';

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
 * which the entry module (`src/site-middleware.ts`) is compiled into.
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
}

/**
 * Builds the Astro middleware `onRequest` handler.
 *
 * `resolveOpts` is a thunk so the (throwing) env-var resolution happens per
 * request rather than at module load — a misconfigured runtime should fail the
 * request with a diagnosable error, not prevent the whole site from booting.
 */
export function createPreviewSiteMiddleware(resolveOpts: () => PreviewMiddlewareOptions, seams: PreviewRenderSeams) {
  return async function onRequest(context: PreviewMiddlewareContext, next: PreviewMiddlewareNext): Promise<Response> {
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

    const verdict = await handlePreviewRequest(context.request, {
      ...opts,
      onMiss: 'pass-through',
      fetchFn: opts.fetchFn ?? seams.fetchFn,
    });
    if (verdict.kind === 'response') return verdict.response;
    if (verdict.kind !== 'preview') return next();

    // A valid credential on the preview route itself: canonicalize to the
    // clean site path instead of rendering under the route — links, assets
    // and the page lookup all assume clean paths.
    const rawPath = context.url.pathname;
    const path = normalizeTrailingSlash(stripPreviewPrefix(rawPath, opts.base));
    if (stripPreviewPrefix(rawPath, opts.base) !== rawPath) {
      return new Response(null, {
        status: 302,
        headers: { location: path, 'cache-control': 'private, no-store' },
      });
    }

    context.locals.conlocaPreview = verdict.ctx;
    // An endpoint failure (5xx mid-deploy, auth envelope, network) must not 500
    // the whole site for a visitor holding the HttpOnly cookie they cannot
    // remove — degrade to published bytes, keeping the preview headers.
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
        `[@conloca/cloud-astro] preview page-status failed for ${path} — serving the published page instead: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
      return applyPreviewHeaders(await next());
    }

    if (status.kind === 'unchanged') {
      // Production-equivalent bytes: render the ordinary route against the
      // build's own collections. No banner — same delegated semantics as
      // before — but preview responses always carry the robots/cache headers.
      return applyPreviewHeaders(await next());
    }

    if (status.kind === 'redirect') {
      // Always 302 (fetchPageStatus already downgraded 301) so a stale preview
      // redirect can never be cached by intermediaries.
      return new Response(null, {
        status: 302,
        headers: { location: status.target, 'cache-control': 'private, no-store' },
      });
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
      return applyPreviewHeaders(rendered);
    }
    const html = injectPreviewBanner(
      await rendered.text(),
      verdict.ctx,
      opts.saasEndpoint,
      `${previewRoutePrefix(opts.base)}/__exit`,
    );
    return applyPreviewHeaders(new Response(html, { status: rendered.status, headers: rendered.headers }));
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
