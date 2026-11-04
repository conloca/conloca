/**
 * The d8 draft render, loaded by the front (`./d8-middleware.ts`) only for a navigation that holds a pass: it pulls in
 * `astro:content` and the routing config, which a request off the preview route must never pay for.
 */

import baked from 'virtual:conloca-preview-opts';
import { resolveFromBaked } from './preview/_resolve-opts.js';
import type { D8Context } from './preview/d8-middleware.js';
import type { PreviewMiddlewareOptions } from './preview/middleware.js';
import { createPreviewSiteMiddleware } from './preview/site-middleware.js';
import { assetsSitePages, diskSitePages, functionSitePages, serverDirOf } from './preview/site-page-sources.js';
import { NO_SITE_PAGES, type SitePageSource } from './preview/site-pages.js';
import { previewRenderSeams } from './preview-render-seams.js';

// Always d8: a missing bake must not fall back to the D2 rules.
export function d8Opts(): PreviewMiddlewareOptions {
  return { ...resolveFromBaked(baked, (name) => process.env[name]), mode: 'd8' };
}

// One source per process: each reads its list once.
let sitePagesPromise: Promise<SitePageSource> | undefined;
async function sitePageSource(): Promise<SitePageSource> {
  const where = baked.sitePages;
  const base = baked.base || '/';
  switch (where?.kind) {
    case 'disk':
      return diskSitePages(await serverDirOf(import.meta.url, where.serverEntry), base);
    case 'function':
      return functionSitePages(await serverDirOf(import.meta.url, where.serverEntry), where.origin, fetch);
    case 'assets': {
      // Dynamic: only workerd has this module.
      const { env } = await import(/* @vite-ignore */ 'cloudflare:workers');
      const assets = env.ASSETS;
      return typeof assets === 'object' && assets !== null && 'fetch' in assets && typeof assets.fetch === 'function'
        ? // SAFETY: the Cloudflare adapter binds ASSETS to the static assets Fetcher, checked callable just above.
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- same reason as the SAFETY note.
          assetsSitePages(assets as { fetch(request: Request): Promise<Response> }, base)
        : NO_SITE_PAGES;
    }
    default:
      return NO_SITE_PAGES;
  }
}

export async function render(
  context: D8Context,
  next: () => Promise<Response>,
  slug: string | undefined,
): Promise<Response> {
  sitePagesPromise ??= sitePageSource().catch((error: unknown) => {
    // Without the list, site pages fall to the CMS route; the draft render itself still works.
    console.warn(`[@conloca/cloud-astro] preview can't read the site's own pages: ${String(error)}`);
    return NO_SITE_PAGES;
  });
  const handler = createPreviewSiteMiddleware(d8Opts, {
    ...(await previewRenderSeams()),
    baked,
    sitePages: await sitePagesPromise,
  });
  return handler(context, next, slug);
}
