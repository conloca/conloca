import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import spaConfig from 'virtual:conloca-config';
import { contentOptions, getDataCollection, getPagesByPrefix } from 'virtual:conloca-page-api';
import routingConfig from 'virtual:conloca-routing-config';
import {
  type CFAccessResult,
  createContentAPI,
  createContentAPIRouter,
  FileSystemContentAPI,
  validateCFAccessRequest,
} from '@conloca/content-api/node';
import type { APIRoute } from 'astro';
import { SPA_MIME_TYPES } from './mime-types.js';
import { isPathWithinBase } from './path-validation.js';
import { safeJsonStringify } from './safe-json-stringify.js';
import type { DataCollectionEntry, DataContext, PageReference, ResolvedRoutingConfig } from './types.js';

export { SPA_MIME_TYPES } from './mime-types.js';

/**
 * Read mdxPages-related options from build-time env vars. Empty/missing
 * values yield no field at all (so the spread is a no-op when mdxPages is
 * not configured), which keeps mdx-page support dormant.
 */
/**
 * Read the top-level locales options from build-time env vars.
 * `CONLOCA_LOCALES` is inlined as a JS array (or `null`) by Vite's
 * `define`; `CONLOCA_DEFAULT_LOCALE` is a string (or `''`). When neither
 * is set, returns an empty object so the spread is a no-op and the
 * content-api falls back to sites.json (the existing behavior).
 */
function localesFromEnv(): { availableLocales?: string[]; defaultLocale?: string } {
  const list = import.meta.env.CONLOCA_LOCALES as readonly string[] | null | undefined;
  const defaultLocale = import.meta.env.CONLOCA_DEFAULT_LOCALE as string | undefined;
  return {
    ...(Array.isArray(list) && list.length > 0 ? { availableLocales: [...list] } : {}),
    ...(typeof defaultLocale === 'string' && defaultLocale ? { defaultLocale } : {}),
  };
}

function mdxPagesOptionsFromEnv(): {
  mdxPagesRoot?: string;
  mdxPagesLocaleStrategy?: 'directory' | 'suffix';
  mdxPagesDefaultLocale?: string;
  mdxPagesSite?: string;
} {
  const root = import.meta.env.CONLOCA_MDX_PAGES_ROOT;
  if (!root) return {};
  const localeStrategy = import.meta.env.CONLOCA_MDX_PAGES_LOCALE_STRATEGY;
  const defaultLocale = import.meta.env.CONLOCA_MDX_PAGES_DEFAULT_LOCALE;
  const site = import.meta.env.CONLOCA_MDX_PAGES_SITE;
  return {
    mdxPagesRoot: root,
    ...(localeStrategy === 'directory' || localeStrategy === 'suffix'
      ? { mdxPagesLocaleStrategy: localeStrategy }
      : {}),
    ...(defaultLocale ? { mdxPagesDefaultLocale: defaultLocale } : {}),
    ...(site ? { mdxPagesSite: site } : {}),
  };
}

// Get the path to the cms-spa package by resolving its package.json
const require = createRequire(import.meta.url);
const cmsSpaPath = dirname(require.resolve('@conloca/cms-spa/package.json'));

/**
 * Unified CMS handler - single entry point for all CMS routes.
 *
 * This handler:
 * 1. Validates CF Access authentication ONCE at the top
 * 2. Routes to appropriate sub-handler based on path:
 *    - /api/data-context -> handleDataContext()
 *    - /api/* -> handleContentApi()
 *    - /* -> handleSpa()
 *
 * Benefits:
 * - Single authentication check prevents security gaps
 * - New routes automatically inherit auth protection
 * - Easier to audit security
 */
export const ALL: APIRoute = async ({ params, request }) => {
  // Step 1: Validate CF Access ONCE
  const cfResult = await validateCFAccessRequest(request);
  if (!cfResult.valid && cfResult.required) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Step 2: Route based on path
  const pathArray = params.path;
  const path = Array.isArray(pathArray) ? pathArray.join('/') : pathArray || '';

  // Route to appropriate handler
  if (path.startsWith('api/data-context')) {
    return handleDataContext(request);
  }

  if (path.startsWith('api/')) {
    return handleContentApi(request, cfResult);
  }

  return handleSpa(params, request);
};

// ============================================================================
// SPA Handler (from spa-handler.ts)
// ============================================================================

/**
 * Generate HTML for dev mode that loads cms-spa source through Vite.
 * This ensures React is resolved from Vite's pre-bundled deps, not from the cms-spa bundle.
 */
function generateDevHtml(config: typeof spaConfig): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Conloca CMS</title>
  <link rel="stylesheet" href="${config.basename}/main.css" />
  <script type="module" src="${config.basename}/site-styles.js"></script>
  <script>
    // Configure UI with plugin options
    window.__UI_CONFIG__ = ${safeJsonStringify(config)};
  </script>
  <script type="module" src="${config.basename}/schemas-entry.js"></script>
  <script type="module" src="${config.basename}/puck-entry.js"></script>
  <script type="module" src="${config.basename}/content-listener.js"></script>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="${config.basename}/cms-spa-entry.js"></script>
</body>
</html>`;
}

/**
 * Load the HTML at runtime (production only)
 */
async function loadIndexHtml(): Promise<string> {
  const spaDir = join(cmsSpaPath, 'dist/spa');
  const { readdir } = await import('node:fs/promises');
  const files = await readdir(spaDir);
  const htmlFile = files.find((f) => f.startsWith('index.') && f.endsWith('.html'));

  if (!htmlFile) {
    throw new Error('No index.html found in @conloca/cms-spa dist/spa');
  }

  const htmlPath = join(spaDir, htmlFile);
  const html = await readFile(htmlPath, 'utf-8');

  return html;
}

/**
 * Handle SPA requests - serve CMS admin interface
 */
async function handleSpa(params: { path?: string | string[] }, request: Request): Promise<Response> {
  // The path parameter is an array for [...path] routes
  const pathArray = params.path;
  const path = Array.isArray(pathArray) ? pathArray.join('/') : pathArray || '';

  // For the root path or any path without an extension, serve the HTML
  if (!path || !path.includes('.')) {
    try {
      let html: string;

      // In dev mode, generate HTML that loads source through Vite
      // In production, load the pre-built HTML from cms-spa dist
      if (import.meta.env.DEV) {
        html = generateDevHtml(spaConfig);
      } else {
        html = await loadIndexHtml();
        // Inject CMS configuration and load virtual modules
        const configScript = `
        <script>
          // Configure UI with plugin options
          window.__UI_CONFIG__ = ${safeJsonStringify(spaConfig)};
        </script>
        <script type="module" src="${spaConfig.basename}/site-styles.js"></script>
        <script type="module" src="${spaConfig.basename}/schemas-entry.js"></script>
        <script type="module" src="${spaConfig.basename}/puck-entry.js"></script>
        <script type="module" src="${spaConfig.basename}/content-listener.js"></script>
      `;
        // Inject the script at the top to ensure config is available first
        html = html.replace('<head>', `<head>${configScript}`);
      }

      return new Response(html, {
        headers: {
          'Content-Type': 'text/html',
          'Cache-Control': 'no-store, must-revalidate',
          'X-HMR': 'spa-page',
        },
      });
    } catch (error) {
      console.error('Error loading CMS HTML:', error);
      return new Response('CMS build not found. Run nx build @conloca/astro-cms', {
        status: 500,
        headers: { 'Content-Type': 'text/plain' },
      });
    }
  }

  // For asset requests, serve them from the cms-spa dist/spa directory
  try {
    const spaBase = join(cmsSpaPath, 'dist/spa');
    const assetPath = join(spaBase, path);

    if (!isPathWithinBase(spaBase, assetPath)) {
      console.warn('[security] Path traversal attempt blocked:', path);
      return new Response('Forbidden', { status: 403 });
    }

    const content = await readFile(assetPath);

    // Determine content type from extension map with octet-stream fallback
    const ext = path.substring(path.lastIndexOf('.'));
    const contentType = SPA_MIME_TYPES[ext] ?? 'application/octet-stream';

    return new Response(content as BodyInit, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': import.meta.env.DEV ? 'no-store, must-revalidate' : 'public, max-age=31536000',
      },
    });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}

// ============================================================================
// Data Context Handler (from data-context-handler.ts)
// ============================================================================

/**
 * Handle DataContext API requests - returns data bindings for CMS editor
 */
async function handleDataContext(request: Request): Promise<Response> {
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
      ...localesFromEnv(),
      ...mdxPagesOptionsFromEnv(),
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

    if (hasCollections && routeConfig.dataBindings?.collections) {
      for (const collectionName of routeConfig.dataBindings.collections) {
        try {
          const bindingLocale = routeConfig.dataBindings.locale ?? locale;
          collections[collectionName] = await getDataCollection(collectionName, bindingLocale);
        } catch {
          collections[collectionName] = [];
        }
      }
    }

    if (hasPages && routeConfig.dataBindings?.pages) {
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
}

function jsonResponse(data: object): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ============================================================================
// Content API Handler (from content-api-handler.ts)
// ============================================================================

/**
 * Handle Content API requests - delegates to Hono router
 */
async function handleContentApi(request: Request, cfResult: CFAccessResult): Promise<Response> {
  const contentRoot = import.meta.env.CONLOCA_CONTENT_ROOT || './content';
  const canvasDir = import.meta.env.CONLOCA_CANVAS_DIR || './canvas';

  // FileSystemContentAPI.create() handles caching internally
  const contentApi = await FileSystemContentAPI.create({
    contentRoot,
    canvasDir,
    ...localesFromEnv(),
    ...mdxPagesOptionsFromEnv(),
  });

  // Create the Hono router with assets and content root for git operations
  const assetsPath = import.meta.env.CONLOCA_ASSETS_PATH || '';
  const app = createContentAPIRouter(contentApi, { ...(assetsPath && { assetsPath }), contentRoot });

  // Extract the path after the API base
  const url = new URL(request.url);
  // Find where /api/ appears in the pathname
  const apiIndex = url.pathname.indexOf('/api/');
  if (apiIndex === -1) {
    return new Response('Invalid API path', { status: 400 });
  }
  const basePath = url.pathname.substring(0, apiIndex + 4); // Include '/api'
  const path = url.pathname.substring(basePath.length) || '/';

  // Pass user to Hono via headers for downstream use (needed for git commit attribution)
  const headers = new Headers(request.headers);
  if (cfResult.user) {
    if (cfResult.user.email) {
      headers.set('X-CF-User-Email', cfResult.user.email);
    }
    if (cfResult.user.sub) {
      headers.set('X-CF-User-Sub', cfResult.user.sub);
    }
  }

  // Create a new request with the correct path for Hono
  // Note: duplex option is required for Node.js fetch when sending a body
  // but not in the TypeScript RequestInit type
  const honoRequest = new Request(new URL(path + url.search, 'http://localhost').href, {
    method: request.method,
    headers,
    body: request.body,
    ...(request.body && { duplex: 'half' }),
  } as RequestInit);

  // Let Hono handle the request
  const response = await app.fetch(honoRequest);

  // Return the Hono response
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
