import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { ContentAPI } from './content-api.interface';
import { localesOf } from './content-utils';
import type { APIError, ContentManifest, ErrorCode, FindOptions, GlobalFilters } from './types';
import { ErrorCodes } from './types';

/**
 * Helper to create standardized error responses
 */
function errorResponse(code: ErrorCode, message: string, details?: any): APIError {
  return {
    error: {
      code,
      message,
      ...(details && { details }),
    },
  };
}

/**
 * Helper to log and create error responses for unexpected errors
 */
function logAndCreateErrorResponse(error: unknown, code: ErrorCode, message: string, details?: any): APIError {
  console.error(`[Content API] ${message}:`, error);
  return errorResponse(code, message, details);
}

/**
 * Create REST API router using Hono
 * Implements the ID-based API specification from implementation-plan.md
 */
export function createContentAPIRouter(api: ContentAPI) {
  const app = new Hono();

  // Enable CORS for CMS access
  app.use('/*', cors());

  // GET /content/collections - List all collections across all sites
  app.get('/content/collections', async (c) => {
    try {
      const allCollections = new Set<string>();

      // Get collections from blocks
      const blockCollections = api.blocks.collections;
      blockCollections.forEach((c) => allCollections.add(c));

      // Get collections from all sites
      for (const siteName of Object.keys(api.sitesConfig.sites)) {
        const site = api.getSite(siteName);
        if (site) {
          const siteCollections = site.collections;
          siteCollections.forEach((c) => allCollections.add(c));
        }
      }

      return c.json({
        collections: Array.from(allCollections).sort(),
      });
    } catch (error) {
      return c.json(logAndCreateErrorResponse(error, ErrorCodes.INTERNAL_ERROR, 'Failed to list collections'), 500);
    }
  });

  // GET /content - List all content with optional filters
  app.get('/content', async (c) => {
    const kind = c.req.query('kind'); // 'block' or 'page'
    const site = c.req.query('site');
    const collection = c.req.query('collection');
    const locales = c.req.query('locales'); // comma-separated
    const type = c.req.query('type'); // 'puck' or 'mdx'
    const published = c.req.query('published');
    const localization = c.req.query('localization'); // 'complete', 'partial', 'one'
    const missingLocales = c.req.query('missingLocales'); // comma-separated

    try {
      const filters: any = {};

      // Pass all filters to the API - let it handle the logic
      if (kind) filters.kind = kind;
      if (site) filters.site = site;
      if (collection) filters.collection = collection;
      if (locales) filters.locales = locales.split(',').map((l) => l.trim());
      if (type) filters.type = type;
      if (published !== undefined) filters.published = published === 'true';
      if (localization) filters.localization = localization;
      if (missingLocales) filters.missingLocales = missingLocales.split(',').map((l) => l.trim());

      const items = Array.from(api.listAllContent(filters));
      return c.json({ items, total: items.length });
    } catch (error) {
      return c.json(logAndCreateErrorResponse(error, ErrorCodes.INTERNAL_ERROR, 'Failed to list content'), 500);
    }
  });

  // GET /content/:id - Get all locales for content ID
  app.get('/content/:id', async (c) => {
    const id = c.req.param('id');

    try {
      const content = await api.getContent(id);

      if (!content) {
        return c.json(errorResponse(ErrorCodes.CONTENT_NOT_FOUND, 'Content not found', { id }), 404);
      }

      return c.json(content);
    } catch (error) {
      return c.json(logAndCreateErrorResponse(error, ErrorCodes.FETCH_ERROR, 'Failed to fetch content'), 500);
    }
  });

  // GET /content/:id/:locale - Get specific locale only
  app.get('/content/:id/:locale', async (c) => {
    const id = c.req.param('id');
    const locale = c.req.param('locale');

    try {
      const content = await api.getLocalized(id, locale);

      if (!content) {
        return c.json(errorResponse(ErrorCodes.CONTENT_NOT_FOUND, 'Content not found', { id }), 404);
      }

      // Set ETag header
      c.header('ETag', content.localized.etag);

      return c.json(content);
    } catch (error) {
      return c.json(logAndCreateErrorResponse(error, ErrorCodes.FETCH_ERROR, 'Failed to fetch localized content'), 500);
    }
  });

  // POST /content - Create new content
  app.post('/content', async (c) => {
    try {
      const data = await c.req.json();
      const result = await api.createContent(data);

      if (!result.success) {
        if (result.reason === 'already_exists') {
          return c.json(result, 409);
        }
        if (result.reason === 'pathname_taken') {
          return c.json(result, 409);
        }
        if (result.reason === 'metadata_too_large') {
          return c.json(result, 400);
        }
        return c.json(result, 500);
      }

      return c.json(result, 201);
    } catch (error) {
      console.error('[Content API] Failed to create content:', error);
      return c.json(
        {
          success: false,
          reason: 'write_error',
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        500,
      );
    }
  });

  // PUT /content/:id - Update content (full update)
  app.put('/content/:id', async (c) => {
    const id = c.req.param('id');
    const locale = c.req.query('locale');
    const etag = c.req.query('etag') || '';

    if (!locale) {
      return c.json(
        errorResponse(ErrorCodes.MISSING_REQUIRED_FIELD, 'locale query parameter is required', { field: 'locale' }),
        400,
      );
    }

    try {
      const data = await c.req.json();
      const result = await api.updateLocalized({ id, locale, data, etag });

      if (!result.success) {
        if (result.reason === 'stale_write') {
          return c.json(
            errorResponse(ErrorCodes.STALE_WRITE, 'Content has been modified since you last loaded it', {
              currentEtag: result.currentEtag,
            }),
            412,
          );
        }
        if (result.reason === 'not_found') {
          return c.json(errorResponse(ErrorCodes.CONTENT_NOT_FOUND, 'Content not found', { id }), 404);
        }
        return c.json(result, 500);
      }

      // Set ETag header
      c.header('ETag', result.etag);

      return c.json(result);
    } catch (error) {
      console.error('[Content API] Failed to update content:', error);
      return c.json(
        {
          success: false,
          reason: 'write_error',
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        500,
      );
    }
  });

  // PATCH /content/:id - Partial update
  app.patch('/content/:id', async (c) => {
    const id = c.req.param('id');
    const locale = c.req.query('locale');
    const etag = c.req.query('etag') || '';

    if (!locale) {
      return c.json(
        errorResponse(ErrorCodes.MISSING_REQUIRED_FIELD, 'locale query parameter is required', { field: 'locale' }),
        400,
      );
    }

    try {
      const data = await c.req.json();
      const result = await api.updateLocalized({ id, locale, data, etag });

      if (!result.success) {
        if (result.reason === 'stale_write') {
          return c.json(
            errorResponse(ErrorCodes.STALE_WRITE, 'Content has been modified since you last loaded it', {
              currentEtag: result.currentEtag,
            }),
            412,
          );
        }
        if (result.reason === 'not_found') {
          return c.json(errorResponse(ErrorCodes.CONTENT_NOT_FOUND, 'Content not found', { id }), 404);
        }
        return c.json(result, 500);
      }

      // Set ETag header
      c.header('ETag', result.etag);

      return c.json(result);
    } catch (error) {
      console.error('[Content API] Failed to patch content:', error);
      return c.json(
        {
          success: false,
          reason: 'write_error',
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        500,
      );
    }
  });

  // DELETE /content/:id - Delete content (entire entry or specific locale)
  app.delete('/content/:id', async (c) => {
    const id = c.req.param('id');
    const locale = c.req.query('locale');
    const ifMatch = c.req.header('If-Match') || '';

    try {
      let result;

      if (locale) {
        // Delete specific locale
        result = await api.deleteLocalized({ id, locale, etag: ifMatch });
      } else {
        // Delete entire content entry
        result = await api.deleteContent(id, ifMatch);
      }

      if (!result.success) {
        if (result.reason === 'not_found') {
          return c.json(
            {
              success: false,
              error: 'Content not found',
            },
            404,
          );
        }
        if (result.reason === 'stale_write') {
          return c.json(
            {
              success: false,
              reason: result.reason,
              currentEtag: result.currentEtag,
              message: 'Content has been modified',
            },
            412,
          );
        }
        return c.json(result, 500);
      }

      return c.json({ success: true });
    } catch (error) {
      console.error('[Content API] Failed to delete content:', error);
      return c.json(
        {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        500,
      );
    }
  });

  // ===== Data Routes =====
  // NOTE: These routes MUST come before /:site/* routes to avoid being captured by them

  // GET /data/collections - List all data collections (must be before /data/:name)
  app.get('/data/collections', async (c) => {
    try {
      const collections = api.data.collections;
      return c.json({
        collections: Array.from(collections).sort(),
      });
    } catch (error) {
      return c.json(
        logAndCreateErrorResponse(error, ErrorCodes.INTERNAL_ERROR, 'Failed to list data collections'),
        500,
      );
    }
  });

  // GET /data/name-available - Check if data name is available
  app.get('/data/name-available', async (c) => {
    const name = c.req.query('name');
    const collection = c.req.query('collection');
    const excludeId = c.req.query('excludeId');

    if (!name) {
      return c.json(
        errorResponse(ErrorCodes.MISSING_REQUIRED_FIELD, 'name query parameter is required', { field: 'name' }),
        400,
      );
    }

    if (!collection) {
      return c.json(
        errorResponse(ErrorCodes.MISSING_REQUIRED_FIELD, 'collection query parameter is required', {
          field: 'collection',
        }),
        400,
      );
    }

    try {
      const available = api.data.isNameAvailable(collection, name, excludeId);
      if (available) {
        return c.json({ available: true });
      }

      const existing = api.data.getByName(collection, name);
      return c.json({
        available: false,
        existingId: existing?.id,
      });
    } catch (error) {
      return c.json(
        logAndCreateErrorResponse(error, ErrorCodes.INTERNAL_ERROR, 'Failed to check data name availability'),
        500,
      );
    }
  });

  // GET /data - List data entries
  app.get('/data', async (c) => {
    const collection = c.req.query('collection');
    const locale = c.req.query('locale');

    try {
      const filters: GlobalFilters = { kind: 'data' };
      if (collection) filters.collection = collection;
      if (locale) filters.locales = [locale];

      const items = Array.from(api.listAllContent(filters));
      return c.json({ items, total: items.length });
    } catch (error) {
      return c.json(logAndCreateErrorResponse(error, ErrorCodes.INTERNAL_ERROR, 'Failed to list data entries'), 500);
    }
  });

  // GET /data/:name - Get data entry by name
  app.get('/data/:name', async (c) => {
    const name = c.req.param('name');
    const collection = c.req.query('collection');
    const locale = c.req.query('locale');

    if (!collection) {
      return c.json(
        errorResponse(ErrorCodes.MISSING_REQUIRED_FIELD, 'collection query parameter is required', {
          field: 'collection',
        }),
        400,
      );
    }

    try {
      const dataEntry = api.data.getByName(collection, name, locale);

      if (!dataEntry) {
        return c.json(errorResponse(ErrorCodes.CONTENT_NOT_FOUND, 'Data entry not found', { name, collection }), 404);
      }

      // If locale specified and provided, filter the response
      if (locale && dataEntry.locales[locale]) {
        return c.json({
          ...dataEntry,
          locales: { [locale]: dataEntry.locales[locale] },
        });
      }

      return c.json(dataEntry);
    } catch (error) {
      return c.json(logAndCreateErrorResponse(error, ErrorCodes.FETCH_ERROR, 'Failed to fetch data entry'), 500);
    }
  });

  // GET /:site/collections - Get collections for a site
  app.get('/:site/collections', async (c) => {
    const site = c.req.param('site');

    try {
      if (site === 'blocks') {
        // Use the efficient collections getter for blocks
        const collections = Array.from(api.blocks.collections).sort();
        return c.json({ collections });
      }
      // Use the efficient collections getter for sites
      const siteObj = api.getSite(site);
      if (!siteObj) {
        return c.json(errorResponse(ErrorCodes.SITE_NOT_FOUND, `Site '${site}' not found`, { site }), 404);
      }
      const collections = Array.from(siteObj.collections).sort();
      return c.json({ collections });
    } catch (error) {
      return c.json(errorResponse(ErrorCodes.SITE_NOT_FOUND, `Site '${site}' not found`, { site }), 404);
    }
  });

  // GET /:site/pages - Get pages for a site (not valid for blocks)
  app.get('/:site/pages', async (c) => {
    const site = c.req.param('site');
    const locale = c.req.query('locale');

    try {
      if (site === 'blocks') {
        return c.json(
          errorResponse(
            ErrorCodes.INVALID_REQUEST,
            'Blocks do not have pages. Use /content?kind=block to list blocks.',
          ),
          400,
        );
      }

      const siteObj = api.getSite(site);
      if (!siteObj) {
        return c.json(errorResponse(ErrorCodes.SITE_NOT_FOUND, `Site '${site}' not found`, { site }), 404);
      }

      // Use listContent with locales filter
      const items = Array.from(siteObj.listContent(locale ? { locales: [locale] } : {}));
      const result = { items, total: items.length };
      return c.json(result);
    } catch (error) {
      return c.json(
        logAndCreateErrorResponse(error, ErrorCodes.INTERNAL_ERROR, `Failed to list pages for site '${site}'`, {
          site,
        }),
        500,
      );
    }
  });

  // GET /:site/pathname-available - Check if pathname is available
  app.get('/:site/pathname-available', async (c) => {
    const site = c.req.param('site');
    const pathname = c.req.query('pathname');
    const locale = c.req.query('locale') || 'en';
    const excludeId = c.req.query('excludeId');

    if (!pathname) {
      return c.json(
        errorResponse(ErrorCodes.MISSING_REQUIRED_FIELD, 'pathname query parameter is required', { field: 'pathname' }),
        400,
      );
    }

    try {
      if (site === 'blocks') {
        return c.json(
          errorResponse(
            ErrorCodes.INVALID_REQUEST,
            'Blocks do not have pathnames. This endpoint is only for page content.',
          ),
          400,
        );
      }

      // Use the optimized pathname index via site.isPathnameAvailable
      const siteObj = api.getSite(site);
      if (!siteObj) {
        return c.json(errorResponse(ErrorCodes.SITE_NOT_FOUND, `Site '${site}' not found`, { site }), 404);
      }
      const available = siteObj.isPathnameAvailable(pathname, locale, excludeId);

      if (available) {
        return c.json({ available: true });
      }

      // Get the conflicting content ID if pathname is taken
      const existingId = siteObj.getPathnameConflict(pathname, locale, excludeId);

      return c.json({
        available: false,
        existingId,
      });
    } catch (error) {
      return c.json(
        logAndCreateErrorResponse(error, ErrorCodes.INTERNAL_ERROR, 'Failed to check pathname availability'),
        500,
      );
    }
  });

  // GET /blocks - Shorthand for all blocks
  app.get('/blocks', async (c) => {
    const collection = c.req.query('collection');
    const locale = c.req.query('locale');

    try {
      const filters: any = { kind: 'block' };
      if (collection) filters.collection = collection;
      if (locale) filters.locales = [locale];

      const items = Array.from(api.listAllContent(filters));
      return c.json({ items, total: items.length });
    } catch (error) {
      return c.json(logAndCreateErrorResponse(error, ErrorCodes.INTERNAL_ERROR, 'Failed to list blocks'), 500);
    }
  });

  // GET /blocks/name-available - Check if block name is available
  app.get('/blocks/name-available', async (c) => {
    const name = c.req.query('name');
    const collection = c.req.query('collection') || 'components';
    const locale = c.req.query('locale') || 'en';
    const excludeId = c.req.query('excludeId');

    if (!name) {
      return c.json(
        errorResponse(ErrorCodes.MISSING_REQUIRED_FIELD, 'name query parameter is required', { field: 'name' }),
        400,
      );
    }

    try {
      // Check block name availability through listing
      const existing = Array.from(
        api.listAllContent({
          kind: 'block',
          collection: collection,
          locales: [locale],
        }),
      );

      let taken: ContentManifest | undefined;
      for (const item of existing) {
        for (const localeVersion of localesOf(item)) {
          if (localeVersion.name === name) {
            taken = item;
            break;
          }
        }
      }

      // If no existing block, name is available
      if (!taken) {
        return c.json({ available: true });
      }

      // If existing block has same ID as excludeId, name is available
      // (useful when editing existing block)
      if (excludeId && taken.id === excludeId) {
        return c.json({ available: true });
      }

      // Otherwise, name is taken
      return c.json({
        available: false,
        existingId: taken.id,
      });
    } catch (error) {
      return c.json(
        logAndCreateErrorResponse(error, ErrorCodes.INTERNAL_ERROR, 'Failed to check block name availability'),
        500,
      );
    }
  });

  // GET /blocks/:name - Get block by name
  app.get('/blocks/:name', async (c) => {
    const name = c.req.param('name');
    const collection = c.req.query('collection') || 'components';
    const locale = c.req.query('locale');

    try {
      const block = api.blocks.getByName(collection, name, locale);

      if (!block) {
        return c.json(errorResponse(ErrorCodes.CONTENT_NOT_FOUND, 'Block not found', { name, collection }), 404);
      }

      // If locale specified and provided, filter the response
      if (locale && block.locales[locale]) {
        return c.json({
          ...block,
          locales: { [locale]: block.locales[locale] },
        });
      }

      return c.json(block);
    } catch (error) {
      return c.json(logAndCreateErrorResponse(error, ErrorCodes.FETCH_ERROR, 'Failed to fetch block'), 500);
    }
  });

  // POST /:site/move - Move page to new pathname
  app.post('/:site/move', async (c) => {
    const site = c.req.param('site');

    try {
      const { id, pathname, locale, etag } = await c.req.json();

      if (!id || !pathname || !locale || !etag) {
        return c.json(
          errorResponse(ErrorCodes.MISSING_REQUIRED_FIELD, 'id, pathname, locale, and etag are required'),
          400,
        );
      }

      const siteObj = api.getSite(site);
      if (!siteObj) {
        return c.json(errorResponse(ErrorCodes.SITE_NOT_FOUND, `Site '${site}' not found`, { site }), 404);
      }

      // First check if the pathname is available
      const existing = siteObj.getByPathname(pathname, locale);
      if (existing && existing.id !== id) {
        return c.json(
          {
            moved: false,
            reason: 'already_exists',
            ...errorResponse(ErrorCodes.PATHNAME_TAKEN, 'Pathname already taken', { existingId: existing.id }),
          },
          409,
        );
      }

      // Get current content to track previous pathname
      const current = await api.getLocalized(id, locale);
      if (!current) {
        return c.json(
          { moved: false, ...errorResponse(ErrorCodes.CONTENT_NOT_FOUND, 'Content not found', { id }) },
          404,
        );
      }

      const previousPathname = current.localized.pathname;

      // Update with new pathname using updateLocalized for etag validation
      const updateResult = await api.updateLocalized({
        id,
        locale,
        data: {
          pathname: pathname,
          meta: current.localized.meta,
        },
        etag: etag,
      });

      if (!updateResult.success) {
        if (updateResult.reason === 'stale_write') {
          return c.json(
            {
              moved: false,
              reason: 'stale_write',
              currentEtag: updateResult.currentEtag,
              message: 'Content has been modified',
            },
            412,
          );
        }
        if (updateResult.reason === 'not_found') {
          return c.json(
            { moved: false, ...errorResponse(ErrorCodes.CONTENT_NOT_FOUND, 'Content not found', { id }) },
            404,
          );
        }
        return c.json({ moved: false, ...errorResponse(ErrorCodes.WRITE_ERROR, 'Update failed') }, 500);
      }

      return c.json({
        moved: true,
        previousPathname: previousPathname,
        etag: updateResult.etag,
      });
    } catch (error) {
      return c.json(logAndCreateErrorResponse(error, ErrorCodes.INTERNAL_ERROR, 'Failed to move page'), 500);
    }
  });

  // GET /untranslated/:locale - Find untranslated content
  app.get('/untranslated/:targetLocale', async (c) => {
    const targetLocale = c.req.param('targetLocale');
    const excludeSites = c.req
      .query('excludeSites')
      ?.split(',')
      .map((s) => s.trim())
      .filter((s) => s);
    const includeUnpublished = c.req.query('includeUnpublished') === 'true';

    try {
      const options: FindOptions = {
        ...(excludeSites?.length && { excludeSites }),
        ...(includeUnpublished && { includeUnpublished }),
      };

      const items = Array.from(api.findUntranslatedContent(targetLocale, options));
      return c.json({ items, total: items.length });
    } catch (error) {
      return c.json(
        logAndCreateErrorResponse(error, ErrorCodes.INTERNAL_ERROR, 'Failed to find untranslated content'),
        500,
      );
    }
  });

  // GET /sites - Get sites configuration
  app.get('/sites', async (c) => {
    try {
      const config = api.sitesConfig;
      return c.json(config);
    } catch (error) {
      return c.json(
        logAndCreateErrorResponse(error, ErrorCodes.FETCH_ERROR, 'Failed to fetch sites configuration'),
        500,
      );
    }
  });

  // POST /content/batch - Batch update operations
  app.post('/content/batch', async (c) => {
    try {
      const { operations } = await c.req.json();
      const result = await api.batchUpdate(operations);

      if (!result.success) {
        return c.json(result, 207); // Multi-status
      }

      return c.json(result);
    } catch (error) {
      console.error('[Content API] Failed to batch update:', error);
      return c.json(
        {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        500,
      );
    }
  });

  return app;
}

/**
 * Create middleware for backwards compatibility with existing code
 * This wraps the Hono app to work with Node.js IncomingMessage/ServerResponse
 */
export function createContentMiddleware(contentApi: ContentAPI) {
  const app = createContentAPIRouter(contentApi);

  // Convert Hono app to Node.js middleware
  return async (req: any, res: any, next: () => void) => {
    const url = new URL(req.url!, `http://${req.headers.host}`);

    // Only handle API routes (base path depends on context)
    const basePath = url.pathname.startsWith('/__cms/api') ? '/__cms/api' : '/__conloca/api';
    if (!url.pathname.startsWith(basePath)) {
      return next();
    }

    // Strip the base path to match Hono routes
    const path = url.pathname.replace(basePath, '');

    // Create a Request object for Hono
    const request = new Request(`http://localhost${path}${url.search}`, {
      method: req.method,
      headers: req.headers,
      body: ['GET', 'HEAD'].includes(req.method!) ? undefined : await readBody(req),
    });

    // Handle with Hono
    const response = await app.fetch(request);

    // Copy response headers
    response.headers.forEach((value, key) => {
      res.setHeader(key, value);
    });

    // Set status code
    res.statusCode = response.status;

    // Send response body
    const body = await response.text();
    res.end(body);
  };
}

// Helper to read request body
function readBody(req: any): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(new Uint8Array(chunk)));
    req.on('end', () => {
      const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
      const combined = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.length;
      }
      resolve(Buffer.from(combined).toString());
    });
    req.on('error', reject);
  });
}
