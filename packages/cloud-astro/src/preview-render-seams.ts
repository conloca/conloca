/**
 * The render seams a preview render takes from the site's own build graph: `astro:content` and the routing-config
 * virtual module only resolve there, so the D2/D3 site middleware and the d8 render both build them here.
 */

import { getCollection } from 'astro:content';
import routingConfig from 'virtual:conloca-routing-config';
import { createCollectionBackedContentAPI } from '@conloca/astro-cms';
import type { ContentAPI } from '@conloca/content-api';
import { resolveEndpointFetch } from './preview/_resolve-opts.js';
import type { PreviewRenderSeams } from './preview/site-middleware.js';

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

export async function previewRenderSeams(): Promise<PreviewRenderSeams> {
  return {
    baselineApi,
    site: routingConfig.siteName,
    locale: routingConfig.locale,
    fetchFn: await resolveEndpointFetch(),
  };
}
