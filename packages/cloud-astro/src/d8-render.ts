/**
 * The d8 draft render, loaded by the front (`./d8-middleware.ts`) only for a navigation that holds a pass: it pulls in
 * `astro:content` and the routing config, which a request off the preview route must never pay for.
 */

import baked from 'virtual:conloca-preview-opts';
import { type BakedPreviewOpts, resolveFromBaked } from './preview/_resolve-opts.js';
import type { D8Context } from './preview/d8-middleware.js';
import type { PreviewMiddlewareOptions } from './preview/middleware.js';
import { createPreviewSiteMiddleware } from './preview/site-middleware.js';
import { NO_SITE_PAGES } from './preview/site-pages.js';
import { previewRenderSeams } from './preview-render-seams.js';

// The shipped virtual-module declaration omits the d8 fields (`domains`, `trailingSlash`, `buildFormat`); read them typed.
const bakedOpts: BakedPreviewOpts = baked;

// Always d8: a missing bake must not fall back to the D2 rules.
export function d8Opts(): PreviewMiddlewareOptions {
  return { ...resolveFromBaked(bakedOpts, (name) => process.env[name]), mode: 'd8' };
}

export async function render(
  context: D8Context,
  next: () => Promise<Response>,
  slug: string | undefined,
): Promise<Response> {
  const handler = createPreviewSiteMiddleware(d8Opts, {
    ...(await previewRenderSeams()),
    baked: bakedOpts,
    sitePages: NO_SITE_PAGES,
  });
  return handler(context, next, slug);
}
