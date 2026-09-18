/**
 * Astro middleware entrypoint for the recursive preview build.
 *
 * `addMiddleware({ entrypoint: '@conloca/cloud-astro/site-middleware' })` in
 * the integration resolves to this module, so it must export `onRequest` —
 * Astro's middleware contract. The verdict/render logic lives in
 * `./preview/site-middleware.ts`, which is env-free and unit-testable; this
 * file binds it to the runtime env resolution and to the site's own build
 * graph: `astro:content` and the routing-config virtual module only resolve
 * here, so the collection-backed baseline is constructed here and injected as
 * a seam.
 *
 * Mounted ONLY inside the preview build (see `integration.ts`), never in the
 * site's production build.
 */

import { getCollection } from 'astro:content';
import baked from 'virtual:conloca-preview-opts';
import routingConfig from 'virtual:conloca-routing-config';
import { createCollectionBackedContentAPI } from '@conloca/astro-cms';
import type { ContentAPI } from '@conloca/content-api';
import { resolveEndpointFetch, resolveFromBaked } from './preview/_resolve-opts.js';
import {
  createPreviewSiteMiddleware,
  type PreviewMiddlewareContext,
  type PreviewMiddlewareNext,
} from './preview/site-middleware.js';
import { untagWorkerdProcess } from './preview/workerd-shim.js';

// At Cloudflare Worker start-up, before any render: workerd's nodejs_compat
// process can masquerade as Node's, sending Astro down a streaming branch whose
// body the Cloudflare Workers Response cannot consume — every on-demand page then renders as the
// literal string "[object Object]". See the shim's doc for the full chain.
untagWorkerdProcess();

// One baseline per process: the built collections are immutable at runtime,
// and constructing the collection-backed reader walks every collection.
let baselinePromise: Promise<ContentAPI> | undefined;
function baselineApi(): Promise<ContentAPI> {
  baselinePromise ??= createCollectionBackedContentAPI({
    getCollection: (name) => getCollection(name),
    routing: routingConfig,
  });
  return baselinePromise;
}

export async function onRequest(context: PreviewMiddlewareContext, next: PreviewMiddlewareNext): Promise<Response> {
  const handler = createPreviewSiteMiddleware(() => resolveFromBaked(baked, (name) => process.env[name]), {
    baselineApi,
    site: routingConfig.siteName,
    locale: routingConfig.locale,
    fetchFn: await resolveEndpointFetch(),
  });
  return handler(context, next);
}
