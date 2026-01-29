import { contentOptions, getDataCollection, getPagesByPrefix } from 'virtual:conloca-page-api';
import routingConfig from 'virtual:conloca-routing-config';
import { createContentAPI, validateCFAccessRequest } from '@conloca/content-api/node';
import type { APIRoute } from 'astro';
import type { DataCollectionEntry, DataContext, PageReference, ResolvedRoutingConfig } from '../types.js';

/**
 * API endpoint that returns DataContext for a given page ID.
 *
 * The CMS editor (React SPA) cannot call Astro's getCollection() or access
 * virtual modules directly. This endpoint bridges that gap by reusing the
 * same data-fetching logic from page-handler.astro.
 *
 * GET /__cms/api/data-context?pageId={id}
 *
 * Returns { dataContext } for pages with data bindings, or {} for pages without.
 */
export const GET: APIRoute = async ({ request }) => {
  // Validate CF Access (matches content-api-handler.ts pattern)
  const cfResult = await validateCFAccessRequest(request);
  if (!cfResult.valid && cfResult.required) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const url = new URL(request.url);
    const pageId = url.searchParams.get('pageId');

    if (!pageId) {
      return jsonResponse({});
    }

    const config = routingConfig as ResolvedRoutingConfig;
    if (!config.enabled) {
      return jsonResponse({});
    }

    // Find which route this page belongs to by loading the page manifest
    // and matching its collection against route configs
    const contentApi = await createContentAPI({
      contentRoot: contentOptions.contentRoot,
      canvasDir: contentOptions.canvasDir,
    });

    const locale = contentOptions.locale;

    // Get the page manifest to determine its collection
    const content = await contentApi.getContent(pageId);
    if (!content) {
      return jsonResponse({});
    }
    const pageCollection = content.collection || 'pages';

    // Find the route whose collection matches this page
    const routeEntry = Object.entries(config.routes).find(
      ([, routeConfig]) => routeConfig.collection === pageCollection,
    );

    if (!routeEntry) {
      return jsonResponse({});
    }

    const [, routeConfig] = routeEntry;
    const hasCollections = routeConfig.dataBindings?.collections?.length;
    const hasPages = routeConfig.dataBindings?.pages?.prefix;

    if (!hasCollections && !hasPages) {
      return jsonResponse({});
    }

    // Build DataContext using the same logic as page-handler.astro
    const collections: Record<string, DataCollectionEntry[]> = {};
    let pages: PageReference[] | undefined;

    if (hasCollections) {
      for (const collectionName of routeConfig.dataBindings.collections) {
        try {
          const bindingLocale = routeConfig.dataBindings.locale ?? locale;
          collections[collectionName] = await getDataCollection(collectionName, bindingLocale);
        } catch {
          collections[collectionName] = [];
        }
      }
    }

    if (hasPages) {
      try {
        const pagesConfig = routeConfig.dataBindings.pages;
        pages = await getPagesByPrefix(pagesConfig.prefix, {
          sort: pagesConfig.sort,
          limit: pagesConfig.limit,
        });
      } catch {
        pages = [];
      }
    }

    const dataContext: DataContext = {
      collections,
      pages,
      locale: routeConfig.dataBindings.locale ?? locale,
      siteName: contentOptions.siteName,
    };

    return jsonResponse({ dataContext });
  } catch {
    return jsonResponse({});
  }
};

function jsonResponse(data: object): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
