/**
 * The d8 front: the middleware a d8 site runs on every request. Off the preview route it returns `next()` before
 * anything else runs; under it, the exit, the landing page, entry links and non-navigation requests are answered here,
 * and only a navigation that holds a pass loads the draft render. A render that fails to load or throws answers
 * "Preview couldn't load the draft", never the host's error page.
 */

import { type BakedPreviewOpts, resolveEndpointFetch, resolveFromBaked } from './_resolve-opts.js';
import { applyPreviewHeaders } from './headers.js';
import { renderNoPreviewLanding } from './landing.js';
import { isNavigation } from './links.js';
import { handlePreviewRequest, type PreviewMiddlewareOptions } from './middleware.js';
import {
  answerExit,
  finishEntry,
  holdsPreviewCredential,
  mediaImageRedirect,
  previewUnavailable,
  routePrefixed,
  serveDraftMedia,
} from './prefix-router.js';
import { previewRoutePrefix } from './preview-path.js';
import type { PreviewMiddlewareContext } from './site-middleware.js';

export interface D8Context {
  request: Request;
  url: URL;
  isPrerendered: boolean;
  /** Astro's `locals`: the draft render puts the preview context and the branch reader here. */
  locals: PreviewMiddlewareContext['locals'];
}

export interface D8RenderModule {
  render(context: D8Context, next: () => Promise<Response>, slug: string | undefined): Promise<Response>;
}

export interface D8Deps {
  loadRender: () => Promise<D8RenderModule>;
  env: (name: string) => string | undefined;
  fetchFn?: typeof fetch;
}

export function createD8Middleware(baked: BakedPreviewOpts, deps: D8Deps) {
  const base = baked.base || '/';
  const prefix = previewRoutePrefix(base);
  const root = base.replace(/\/+$/u, '');
  const hosts = new Set(baked.domains ?? []);

  return async (context: D8Context, next: () => Promise<Response>): Promise<Response> => {
    if (context.isPrerendered) return next();
    const { request, url } = context;
    const at = routePrefixed(url, base, 'd8');
    // `<prefix>/_image` is Astro's image endpoint: the pass cookie's path never covers it, so there is nothing to check.
    // Its answer still carries the preview headers: Cloudflare's passthrough endpoint sets none of its own.
    if (at.kind === 'outside') return next();
    if (at.kind === 'image') return mediaImageRedirect(url, base, 'd8') ?? applyPreviewHeaders(await next());
    if (at.kind === 'exit') {
      let opts: PreviewMiddlewareOptions | null = null;
      try {
        opts = resolveFromBaked(baked, deps.env);
      } catch {
        // Unbaked: answered without a label, so Conloca reads "no preview server".
      }
      const exit =
        opts === null
          ? null
          : { repo: opts.repo, siteId: opts.siteId, branch: opts.branch, audience: opts.saasAudience };
      // A failing label still answers a 302 off the route, never the host's error page.
      return answerExit(url, at.slug, exit, base, opts?.saasEndpoint ?? '', 'd8').catch(() =>
        applyPreviewHeaders(new Response(null, { status: 302, headers: { location: base } })),
      );
    }

    if (at.kind === 'media') {
      try {
        const opts = resolveFromBaked(baked, deps.env);
        const fetchFn = deps.fetchFn ?? (await resolveEndpointFetch()) ?? fetch;
        return await serveDraftMedia(request, at, base, opts.saasEndpoint, fetchFn);
      } catch (error) {
        // An `<img>` gets no retry page: a bodiless 404.
        console.error('@conloca/cloud-astro: the draft media read failed', error);
        return applyPreviewHeaders(new Response(null, { status: 404 }));
      }
    }

    const { inner, entering } = at;
    const slug = at.kind === 'slugged' ? at.slug : undefined;
    const route = at.kind === 'slugged' ? at.route : prefix;
    const page = at.kind === 'slugged' ? at.page : url;
    try {
      const opts = resolveFromBaked(baked, deps.env);
      const landing = () =>
        applyPreviewHeaders(renderNoPreviewLanding({ pathname: inner, saasEndpoint: opts.saasEndpoint }));
      if (entering) {
        // The entry rules read the page under the bare route; a slugless entry takes its slug from the pass.
        const entry = new Request(new URL(`${prefix}${inner.slice(root.length)}${url.search}`, url.origin).href, {
          headers: request.headers,
        });
        const verdict = await handlePreviewRequest(entry, {
          ...opts,
          mode: 'd8',
          ...(slug === undefined ? {} : { slug }),
          onMiss: 'landing',
          fetchFn: deps.fetchFn ?? (await resolveEndpointFetch()),
        });
        if (verdict.kind !== 'preview')
          return finishEntry(verdict.kind === 'response' ? verdict.response : landing(), page, route, root, hosts);
      } else if (slug === undefined || !holdsPreviewCredential(request.headers.get('cookie'), 'd8', base, slug)) {
        // Refused before the render loads: a request with no credential never pays for its start-up.
        return landing();
      }
      // Scripts and images never read drafts, whatever the entry decided: they get the published bytes at the clean URL.
      if (!isNavigation(request)) {
        return applyPreviewHeaders(
          new Response(null, { status: 302, headers: { location: `${page.pathname}${page.search}` } }),
        );
      }
      return applyPreviewHeaders(await (await deps.loadRender()).render(context, next, slug));
    } catch (error) {
      console.error('@conloca/cloud-astro: the preview render failed', error);
      return previewUnavailable(`${url.pathname}${url.search}`, `${route}/__exit?to=${encodeURIComponent(inner)}`);
    }
  };
}
