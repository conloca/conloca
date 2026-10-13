import { type Context, Hono } from 'hono';
import { type AssetConfig, AssetOperations } from './asset-operations.js';
import { findAssetUsage } from './asset-usage.js';
import type { ContentAPI } from './content-api.interface.js';
import { localesOf, normalizeAndValidatePathname } from './content-utils.js';
import { createGitOperations, type GitAuthor, type GitConfig } from './git-operations.js';
import type {
  APIError,
  ContentManifest,
  CreateResult,
  DeleteResult,
  ErrorCode,
  FindOptions,
  GlobalFilters,
  UpdateResult,
} from './types.js';
import { ErrorCodes } from './types.js';

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

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

/** A reason a create or an update refuses, other than those each route answers itself. */
type Refusal = Exclude<
  NonNullable<CreateResult['reason'] | UpdateResult['reason']>,
  'write_error' | 'stale_write' | 'not_found'
>;

/**
 * How a refused create or update answers, by reason: the error code, the HTTP status and the
 * message when the backend gave none. 409 when another entry has the path or name, or a page
 * redirects from the path; 400 when the caller can fix the input. A caller that can fix it by
 * changing one field is told which one (`details.field`), so none of these falls through to a 500
 * whose only clue is a raw error string.
 */
const refusals: Record<Refusal, { code: ErrorCode; status: 400 | 409; message: string }> = {
  already_exists: { code: ErrorCodes.ALREADY_EXISTS, status: 409, message: 'Content already exists' },
  name_taken: { code: ErrorCodes.NAME_TAKEN, status: 409, message: 'A fragment with that name already exists' },
  pathname_taken: { code: ErrorCodes.PATHNAME_TAKEN, status: 409, message: 'Pathname already taken' },
  pathname_in_redirects: {
    code: ErrorCodes.PATHNAME_TAKEN,
    status: 409,
    message: 'Pathname is already in use as a redirect',
  },
  invalid_name: { code: ErrorCodes.INVALID_REQUEST, status: 400, message: 'Invalid name' },
  invalid_collection: { code: ErrorCodes.INVALID_REQUEST, status: 400, message: 'Invalid collection' },
  invalid_locale: { code: ErrorCodes.INVALID_LOCALE, status: 400, message: 'Invalid locale' },
  invalid_pathname: { code: ErrorCodes.INVALID_PATHNAME, status: 400, message: 'Invalid pathname' },
  metadata_too_large: { code: ErrorCodes.METADATA_TOO_LARGE, status: 400, message: 'Metadata too large' },
  missing_field: { code: ErrorCodes.MISSING_REQUIRED_FIELD, status: 400, message: 'Missing required field' },
  // Site resolution failing, not a bad field: with no sites configured at all, no value the caller
  // could send would satisfy it.
  no_sites_configured: { code: ErrorCodes.INVALID_REQUEST, status: 400, message: 'Site not found' },
  unknown_site: { code: ErrorCodes.INVALID_REQUEST, status: 400, message: 'Site not found' },
};

function refusalOf(reason: string | undefined) {
  return reason !== undefined && Object.hasOwn(refusals, reason) ? refusals[reason as Refusal] : undefined;
}

/**
 * Whether a request is a write another website made the browser send. The routes write into the
 * project, and any page open in the browser can make it send a form post without asking the
 * server first. The browser says where a request comes from: `Sec-Fetch-Site`, or in older
 * browsers the `Origin` of the page, which for the editor is the address it sent the request to
 * (the `Host`). A request with neither did not come from a web page.
 */
function isCrossSiteWrite(c: Context): boolean {
  if (c.req.method === 'GET' || c.req.method === 'HEAD' || c.req.method === 'OPTIONS') return false;
  const fetchSite = c.req.header('Sec-Fetch-Site');
  if (fetchSite !== undefined) return fetchSite !== 'same-origin';
  const origin = c.req.header('Origin');
  if (origin === undefined) return false;
  return !URL.canParse(origin) || new URL(origin).host !== c.req.header('Host');
}

/**
 * Create REST API router using Hono. Routes address content by id rather than
 * by file path, so storage layout stays an implementation detail.
 */
export interface ContentAPIRouterOptions {
  assetsPath?: string;
  assetConfig?: Omit<AssetConfig, 'assetsPath' | 'contentRoot'>;
  /** Content root directory: holds asset metadata records, is scanned for asset usage, and is where git runs */
  contentRoot?: string;
}

export function createContentAPIRouter(api: ContentAPI, options?: ContentAPIRouterOptions) {
  const app = new Hono();

  // The editor calls these routes from the page they are served with, so no other origin is
  // granted access (no CORS headers), and a write another website sends is refused.
  app.use('/*', async (c, next) => {
    if (!isCrossSiteWrite(c)) return next();
    return c.json(errorResponse(ErrorCodes.FORBIDDEN, 'Refused a write another website sent through the browser'), 403);
  });

  // GET /auth/user - Get current authenticated user
  app.get('/auth/user', async (c) => {
    const email = c.req.header('X-CF-User-Email');
    const sub = c.req.header('X-CF-User-Sub');

    if (!email) {
      return c.json({ authenticated: false });
    }

    return c.json({
      authenticated: true,
      user: { email, sub },
    });
  });

  // GET /content/collections - List all collections across all sites
  app.get('/content/collections', async (c) => {
    try {
      const allCollections = new Set<string>();

      // Get collections from fragments
      const fragmentCollections = api.fragments.collections;
      for (const collection of fragmentCollections) {
        allCollections.add(collection);
      }

      // Get collections from all sites
      for (const siteName of Object.keys(api.sitesConfig.sites)) {
        const site = api.getSite(siteName);
        if (site) {
          const siteCollections = site.collections;
          for (const collection of siteCollections) {
            allCollections.add(collection);
          }
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
    const kind = c.req.query('kind'); // 'fragment' or 'page'
    const site = c.req.query('site');
    const collection = c.req.query('collection');
    const locales = c.req.query('locales'); // comma-separated
    const type = c.req.query('type'); // 'puck' or 'mdx'
    const published = c.req.query('published');
    const localization = c.req.query('localization'); // 'complete', 'partial', 'one'
    const missingLocales = c.req.query('missingLocales'); // comma-separated

    try {
      const filters: GlobalFilters = {};

      // Pass all filters to the API - let it handle the logic
      if (kind) filters.kind = kind as GlobalFilters['kind'];
      if (site) filters.site = site;
      if (collection) filters.collection = collection;
      if (locales) filters.locales = locales.split(',').map((l) => l.trim());
      if (type) filters.type = type as GlobalFilters['type'];
      if (published !== undefined) filters.published = published === 'true';
      if (localization) filters.localization = localization as GlobalFilters['localization'];
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
        // Map structured CreateResult failures onto the standard error
        // envelope so the client can decode `error.code` / `error.message`
        // and surface them in the UI. Without the envelope the client falls
        // back to a generic "API error: 500" string and inline error copy
        // like "already exists" never reaches the user.
        const errMessage = (result.error instanceof Error ? result.error.message : undefined) ?? '';
        const fieldDetails = result.field ? { field: result.field } : undefined;
        const refusal = refusalOf(result.reason);
        if (refusal) {
          return c.json(
            { ...result, ...errorResponse(refusal.code, errMessage || refusal.message, fieldDetails) },
            refusal.status,
          );
        }
        return c.json(
          { ...result, ...errorResponse(ErrorCodes.WRITE_ERROR, errMessage || 'Failed to create content') },
          500,
        );
      }

      return c.json(result, 201);
    } catch (error) {
      console.error('[Content API] Failed to create content:', error);
      return c.json(
        {
          success: false,
          reason: 'write_error',
          ...errorResponse(ErrorCodes.WRITE_ERROR, errorMessage(error, 'Failed to create content')),
        },
        500,
      );
    }
  });

  // PUT /content/:id - Update content (full update); PATCH /content/:id - Partial update
  const updateContent = async (c: Context) => {
    const id = c.req.param('id') ?? '';
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
        const refusal = refusalOf(result.reason);
        if (refusal) {
          return c.json(
            { ...result, ...errorResponse(refusal.code, errorMessage(result.error, refusal.message)) },
            refusal.status,
          );
        }
        // The backend's own refusals, such as an emptied title or metadata over 4 KB, carry their
        // message in an Error, which serializes to `{}`: send it as a refused create does.
        return c.json(
          {
            ...result,
            ...errorResponse(ErrorCodes.WRITE_ERROR, errorMessage(result.error, 'Failed to update content')),
          },
          500,
        );
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
          ...errorResponse(ErrorCodes.WRITE_ERROR, errorMessage(error, 'Failed to update content')),
        },
        500,
      );
    }
  };
  app.put('/content/:id', updateContent);
  app.patch('/content/:id', updateContent);

  // DELETE /content/:id - Delete content (entire entry or specific locale)
  app.delete('/content/:id', async (c) => {
    const id = c.req.param('id');
    const locale = c.req.query('locale');
    const ifMatch = c.req.header('If-Match') || '';

    try {
      let result: DeleteResult;

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

      return c.json({
        available: false,
        existingId: api.data.getNameConflict(collection, name, excludeId),
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

  // ===== Asset Routes =====
  // Must be registered BEFORE /:site routes to avoid route conflicts (/:site would match "assets")

  if (options?.assetsPath) {
    // Asset metadata records live under the content root. There is no falling
    // back to the media folder: a site serves it, so a record there is published.
    if (!options.contentRoot) {
      throw new Error('The assetsPath option needs contentRoot as well: asset metadata is kept under the content root');
    }
    const assetOps = new AssetOperations({
      assetsPath: options.assetsPath,
      contentRoot: options.contentRoot,
      ...options.assetConfig,
    });

    // Split a relative asset path into folder and filename
    // e.g. 'uploads/photo.png' → { folder: '/uploads', filename: 'photo.png' }
    // e.g. 'photo.png' → { folder: '/', filename: 'photo.png' }
    function splitAssetPath(relativePath: string): { folder: string; filename: string } {
      const lastSlash = relativePath.lastIndexOf('/');
      if (lastSlash > 0) {
        return { folder: `/${relativePath.slice(0, lastSlash)}`, filename: relativePath.slice(lastSlash + 1) };
      }
      return { folder: '/', filename: relativePath };
    }

    // The router decodes `%2F`, so a path in the address can climb out of the assets folder. The
    // containment check refuses it, and that is the caller's mistake, not a server fault.
    function isPathTraversal(error: unknown): boolean {
      return error instanceof Error && error.message === 'Path traversal detected';
    }

    // POST /assets/move — move assets between folders
    app.post('/assets/move', async (c) => {
      try {
        const { filenames, sourceFolder, targetFolder } = await c.req.json<{
          filenames: string[];
          sourceFolder: string;
          targetFolder: string;
        }>();

        if (!Array.isArray(filenames)) {
          return c.json(errorResponse(ErrorCodes.INVALID_REQUEST, 'filenames must be an array'), 400);
        }
        if (typeof sourceFolder !== 'string') {
          return c.json(errorResponse(ErrorCodes.INVALID_REQUEST, 'sourceFolder is required'), 400);
        }
        if (typeof targetFolder !== 'string') {
          return c.json(errorResponse(ErrorCodes.INVALID_REQUEST, 'targetFolder is required'), 400);
        }

        const result = await assetOps.moveAssets(filenames, sourceFolder, targetFolder);

        if (!result.success) {
          return c.json(errorResponse(ErrorCodes.INVALID_REQUEST, result.error), 400);
        }

        return c.json(result);
      } catch (error) {
        if (isPathTraversal(error)) {
          return c.json(errorResponse(ErrorCodes.INVALID_REQUEST, 'Invalid folder path'), 400);
        }
        return c.json(logAndCreateErrorResponse(error, ErrorCodes.INTERNAL_ERROR, 'Failed to move assets'), 500);
      }
    });

    // POST /assets/upload — multipart form data upload
    app.post('/assets/upload', async (c) => {
      try {
        const body = await c.req.parseBody();
        const file = body.file;
        if (!(file instanceof File)) {
          return c.json(errorResponse(ErrorCodes.INVALID_REQUEST, 'No file provided in "file" field'), 400);
        }

        const alt = typeof body.alt === 'string' ? body.alt : undefined;
        const folder = typeof body.folder === 'string' ? body.folder : undefined;

        // The uploader is deliberately not read from the request: anyone who can
        // reach this route could otherwise put any name on any picture, and an
        // audit trail that anyone can write is worse than no audit trail.
        const result = await assetOps.upload(file, { alt, folder });

        if (!result.success) {
          return c.json(errorResponse(ErrorCodes.ASSET_UPLOAD_FAILED, result.error), 400);
        }

        return c.json(result.asset, 201);
      } catch (error) {
        return c.json(logAndCreateErrorResponse(error, ErrorCodes.ASSET_UPLOAD_FAILED, 'Upload failed'), 500);
      }
    });

    // POST /assets/import-url — import image from URL
    app.post('/assets/import-url', async (c) => {
      try {
        const { url, alt, folder } = await c.req.json<{
          url: string;
          alt?: string;
          folder?: string;
        }>();

        if (!url) {
          return c.json(errorResponse(ErrorCodes.INVALID_REQUEST, 'url is required'), 400);
        }

        // As with /assets/upload: the uploader never comes off the wire
        const result = await assetOps.importFromUrl(url, { alt, folder });

        if (!result.success) {
          return c.json(errorResponse(ErrorCodes.ASSET_UPLOAD_FAILED, result.error), 400);
        }

        return c.json(result.asset, 201);
      } catch (error) {
        return c.json(logAndCreateErrorResponse(error, ErrorCodes.ASSET_UPLOAD_FAILED, 'URL import failed'), 500);
      }
    });

    // GET /assets — list all assets
    app.get('/assets', async (c) => {
      try {
        const assets = await assetOps.list();
        return c.json({ assets });
      } catch (error) {
        return c.json(logAndCreateErrorResponse(error, ErrorCodes.INTERNAL_ERROR, 'Failed to list assets'), 500);
      }
    });

    // GET /assets/folders — list assets and subfolders within a folder
    app.get('/assets/folders', async (c) => {
      try {
        const path = c.req.query('path') || '/';
        const result = await assetOps.listFolder(path);
        return c.json(result);
      } catch (error) {
        if (isPathTraversal(error)) {
          return c.json(errorResponse(ErrorCodes.INVALID_REQUEST, 'Invalid folder path'), 400);
        }
        return c.json(logAndCreateErrorResponse(error, ErrorCodes.INTERNAL_ERROR, 'Failed to list folder'), 500);
      }
    });

    // POST /assets/folders — create a folder
    app.post('/assets/folders', async (c) => {
      try {
        const { path } = await c.req.json<{ path: string }>();

        if (!path) {
          return c.json(errorResponse(ErrorCodes.INVALID_REQUEST, 'path is required'), 400);
        }

        const result = await assetOps.createFolder(path);

        if (!result.success) {
          return c.json(errorResponse(ErrorCodes.INVALID_REQUEST, result.error), 400);
        }

        return c.json({ success: true }, 201);
      } catch (error) {
        return c.json(logAndCreateErrorResponse(error, ErrorCodes.INTERNAL_ERROR, 'Failed to create folder'), 500);
      }
    });

    // GET /assets/folder-tree — get complete folder hierarchy with asset counts
    app.get('/assets/folder-tree', async (c) => {
      try {
        const tree = await assetOps.getFolderTree();
        return c.json({ tree });
      } catch (error) {
        return c.json(logAndCreateErrorResponse(error, ErrorCodes.INTERNAL_ERROR, 'Failed to get folder tree'), 500);
      }
    });

    // GET /assets/usage/:path{.+} — content that links to the asset at this path from the assets root
    app.get('/assets/usage/:path{.+}', async (c) => {
      try {
        const usage = await findAssetUsage(api, c.req.param('path'));
        return c.json({ usage });
      } catch (error) {
        return c.json(logAndCreateErrorResponse(error, ErrorCodes.INTERNAL_ERROR, 'Failed to get asset usage'), 500);
      }
    });

    // GET /assets/serve/:path{.+} — serve actual asset file (supports subfolders)
    app.get('/assets/serve/:path{.+}', async (c) => {
      try {
        const { folder, filename } = splitAssetPath(c.req.param('path'));
        assetOps.getAssetPath(filename, folder);
        const result = await assetOps.readAssetFile(filename, folder);

        if (!result.success) {
          return c.json(errorResponse(ErrorCodes.ASSET_NOT_FOUND, result.error), 404);
        }

        return new Response(new Uint8Array(result.buffer), {
          headers: {
            'Content-Type': result.mimeType,
            'Cache-Control': 'public, max-age=31536000, immutable',
          },
        });
      } catch (error) {
        if (isPathTraversal(error)) {
          return c.json(errorResponse(ErrorCodes.INVALID_REQUEST, 'Invalid asset path'), 400);
        }
        return c.json(logAndCreateErrorResponse(error, ErrorCodes.INTERNAL_ERROR, 'Failed to serve asset'), 500);
      }
    });

    // GET /assets/meta/:path{.+} — get single asset metadata (supports subfolders)
    app.get('/assets/meta/:path{.+}', async (c) => {
      try {
        const { folder, filename } = splitAssetPath(c.req.param('path'));
        assetOps.getAssetPath(filename, folder);
        const asset = await assetOps.getAsset(filename, folder);

        if (!asset) {
          return c.json(errorResponse(ErrorCodes.ASSET_NOT_FOUND, 'Asset not found'), 404);
        }

        return c.json(asset);
      } catch (error) {
        if (isPathTraversal(error)) {
          return c.json(errorResponse(ErrorCodes.INVALID_REQUEST, 'Invalid asset path'), 400);
        }
        return c.json(logAndCreateErrorResponse(error, ErrorCodes.INTERNAL_ERROR, 'Failed to get asset'), 500);
      }
    });

    // PATCH /assets/meta/:path{.+} — update asset metadata (supports subfolders)
    app.patch('/assets/meta/:path{.+}', async (c) => {
      try {
        const { folder, filename } = splitAssetPath(c.req.param('path'));
        assetOps.getAssetPath(filename, folder);
        const { alt, tags } = await c.req.json<{ alt?: string; tags?: string[] }>();

        const result = await assetOps.updateMetadata(filename, { alt, tags }, folder);

        if (!result.success) {
          // A disk problem is not a missing picture: saying 404 sent the editor
          // back to refetch a value it had just failed to store.
          return result.reason === 'not-found'
            ? c.json(errorResponse(ErrorCodes.ASSET_NOT_FOUND, result.error), 404)
            : c.json(errorResponse(ErrorCodes.INTERNAL_ERROR, result.error), 500);
        }

        return c.json(result.asset);
      } catch (error) {
        if (isPathTraversal(error)) {
          return c.json(errorResponse(ErrorCodes.INVALID_REQUEST, 'Invalid asset path'), 400);
        }
        return c.json(logAndCreateErrorResponse(error, ErrorCodes.INTERNAL_ERROR, 'Failed to update asset'), 500);
      }
    });

    // DELETE /assets/meta/:path{.+} — delete asset (supports subfolders)
    app.delete('/assets/meta/:path{.+}', async (c) => {
      try {
        const { folder, filename } = splitAssetPath(c.req.param('path'));
        assetOps.getAssetPath(filename, folder);
        const result = await assetOps.delete(filename, folder);

        if (!result.success) {
          return c.json(errorResponse(ErrorCodes.ASSET_NOT_FOUND, result.error), 404);
        }

        return c.json({ success: true });
      } catch (error) {
        if (isPathTraversal(error)) {
          return c.json(errorResponse(ErrorCodes.INVALID_REQUEST, 'Invalid asset path'), 400);
        }
        return c.json(logAndCreateErrorResponse(error, ErrorCodes.INTERNAL_ERROR, 'Failed to delete asset'), 500);
      }
    });
  }

  // ===== Site Routes =====
  // These use /:site parameter which matches any path segment

  // GET /:site/collections - Get collections for a site
  app.get('/:site/collections', async (c) => {
    const site = c.req.param('site');

    try {
      if (site === 'fragments') {
        // Use the efficient collections getter for fragments
        const collections = Array.from(api.fragments.collections).sort();
        return c.json({ collections });
      }
      // Use the efficient collections getter for sites
      const siteObj = api.getSite(site);
      if (!siteObj) {
        return c.json(errorResponse(ErrorCodes.SITE_NOT_FOUND, `Site '${site}' not found`, { site }), 404);
      }
      const collections = Array.from(siteObj.collections).sort();
      return c.json({ collections });
    } catch {
      return c.json(errorResponse(ErrorCodes.SITE_NOT_FOUND, `Site '${site}' not found`, { site }), 404);
    }
  });

  // GET /:site/pages - Get pages for a site (not valid for fragments)
  app.get('/:site/pages', async (c) => {
    const site = c.req.param('site');
    const locale = c.req.query('locale');

    try {
      if (site === 'fragments') {
        return c.json(
          errorResponse(
            ErrorCodes.INVALID_REQUEST,
            'Fragments do not have pages. Use /content?kind=fragment to list fragments.',
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
      if (site === 'fragments') {
        return c.json(
          errorResponse(
            ErrorCodes.INVALID_REQUEST,
            'Fragments do not have pathnames. This endpoint is only for page content.',
          ),
          400,
        );
      }

      // Defensive: if the pathname shape is malformed, short-circuit with
      // a structured reason instead of a meaningless index lookup. The
      // dialog short-circuits client-side already, so this guards direct
      // API callers (and future clients) from getting a misleading
      // `{ available: true }` for an invalid path.
      const validation = normalizeAndValidatePathname(pathname);
      if (!validation.valid) {
        return c.json({
          available: false,
          reason: 'invalid_pathname',
          message: validation.message,
        });
      }
      const normalized = validation.value;

      // Use the optimized pathname index via site.isPathnameAvailable
      const siteObj = api.getSite(site);
      if (!siteObj) {
        return c.json(errorResponse(ErrorCodes.SITE_NOT_FOUND, `Site '${site}' not found`, { site }), 404);
      }
      const available = siteObj.isPathnameAvailable(normalized, locale, excludeId);

      if (available) {
        return c.json({ available: true });
      }

      // Get the conflicting content ID if pathname is taken
      const existingId = siteObj.getPathnameConflict(normalized, locale, excludeId);

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

  // GET /fragments - Shorthand for all fragments
  app.get('/fragments', async (c) => {
    const collection = c.req.query('collection');
    const locale = c.req.query('locale');

    try {
      const filters: GlobalFilters = { kind: 'fragment' };
      if (collection) filters.collection = collection;
      if (locale) filters.locales = [locale];

      const items = Array.from(api.listAllContent(filters));
      return c.json({ items, total: items.length });
    } catch (error) {
      return c.json(logAndCreateErrorResponse(error, ErrorCodes.INTERNAL_ERROR, 'Failed to list fragments'), 500);
    }
  });

  // GET /fragments/name-available - Check if fragment name is available
  app.get('/fragments/name-available', async (c) => {
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
      // Check fragment name availability through listing
      const existing = Array.from(
        api.listAllContent({
          kind: 'fragment',
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

      // If no existing fragment, name is available
      if (!taken) {
        return c.json({ available: true });
      }

      // If existing fragment has same ID as excludeId, name is available
      // (useful when editing existing fragment)
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
        logAndCreateErrorResponse(error, ErrorCodes.INTERNAL_ERROR, 'Failed to check fragment name availability'),
        500,
      );
    }
  });

  // GET /fragments/:name - Get fragment by name
  app.get('/fragments/:name', async (c) => {
    const name = c.req.param('name');
    const collection = c.req.query('collection') || 'components';
    const locale = c.req.query('locale');

    try {
      const fragment = api.fragments.getByName(collection, name, locale);

      if (!fragment) {
        return c.json(errorResponse(ErrorCodes.CONTENT_NOT_FOUND, 'Fragment not found', { name, collection }), 404);
      }

      // If locale specified and provided, filter the response
      if (locale && fragment.locales[locale]) {
        return c.json({
          ...fragment,
          locales: { [locale]: fragment.locales[locale] },
        });
      }

      return c.json(fragment);
    } catch (error) {
      return c.json(logAndCreateErrorResponse(error, ErrorCodes.FETCH_ERROR, 'Failed to fetch fragment'), 500);
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
        // The update checks the new path as a create does: a malformed one is invalid_pathname, and
        // another page's path written loosely ('/team/') passes the check above but not the update.
        // A move calls a taken path already_exists, as the check above does.
        const refusal = refusalOf(updateResult.reason);
        if (refusal) {
          const reason = updateResult.reason === 'invalid_pathname' ? 'invalid_pathname' : 'already_exists';
          return c.json(
            { moved: false, reason, ...errorResponse(refusal.code, errorMessage(updateResult.error, 'Move refused')) },
            refusal.status,
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

  // ===== Git Routes =====

  /**
   * Get git config from router options or environment variables.
   * contentRoot from router options takes priority over CONTENT_PATH env var.
   * Optional: GIT_BRANCH (defaults to current checked-out branch)
   */
  function getGitConfig(): GitConfig {
    const contentPath = options?.contentRoot || process.env.CONTENT_PATH;
    if (!contentPath) {
      throw new Error('contentRoot option or CONTENT_PATH environment variable is required for git operations');
    }
    return {
      contentPath,
      branch: process.env.GIT_BRANCH,
    };
  }

  // GET /git/status - Get git repository status
  app.get('/git/status', async (c) => {
    try {
      const config = getGitConfig();
      const gitOps = createGitOperations(config);
      const status = await gitOps.getStatus();

      if (!status.isRepo) {
        return c.json(errorResponse(ErrorCodes.GIT_NOT_REPO, 'Repository not accessible'), 400);
      }

      return c.json(status);
    } catch (error) {
      if (error instanceof Error && (error.message.includes('contentRoot') || error.message.includes('CONTENT_PATH'))) {
        return c.json(errorResponse(ErrorCodes.GIT_NOT_REPO, error.message), 400);
      }
      return c.json(logAndCreateErrorResponse(error, ErrorCodes.GIT_STATUS_FAILED, 'Failed to get git status'), 500);
    }
  });

  // POST /git/commit - Commit all changes
  app.post('/git/commit', async (c) => {
    try {
      const body = await c.req.json<{ message?: string }>().catch(() => undefined);

      // Auto-generate message if not provided
      const date = new Date();
      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const defaultMessage = `CMS changes - ${monthNames[date.getMonth()]} ${date.getDate()}`;
      const message = body?.message || defaultMessage;

      // Extract user email from CF Access header for commit attribution
      const userEmail = c.req.header('X-CF-User-Email');
      const author: GitAuthor | undefined = userEmail ? { name: userEmail.split('@')[0], email: userEmail } : undefined;

      const config = getGitConfig();
      const gitOps = createGitOperations(config);
      const result = await gitOps.commitAll(message, author);

      if (!result.success) {
        return c.json(errorResponse(ErrorCodes.GIT_COMMIT_FAILED, result.error || 'Commit failed'), 500);
      }

      return c.json(result);
    } catch (error) {
      if (error instanceof Error && (error.message.includes('contentRoot') || error.message.includes('CONTENT_PATH'))) {
        return c.json(errorResponse(ErrorCodes.GIT_NOT_REPO, error.message), 400);
      }
      return c.json(logAndCreateErrorResponse(error, ErrorCodes.GIT_COMMIT_FAILED, 'Failed to commit changes'), 500);
    }
  });

  // POST /git/push - Push to origin
  app.post('/git/push', async (c) => {
    try {
      const config = getGitConfig();
      const gitOps = createGitOperations(config);
      const result = await gitOps.pushOrigin();

      if (!result.success) {
        return c.json(errorResponse(ErrorCodes.GIT_PUSH_FAILED, result.error || 'Push failed'), 500);
      }

      return c.json(result);
    } catch (error) {
      if (error instanceof Error && (error.message.includes('contentRoot') || error.message.includes('CONTENT_PATH'))) {
        return c.json(errorResponse(ErrorCodes.GIT_NOT_REPO, error.message), 400);
      }
      return c.json(logAndCreateErrorResponse(error, ErrorCodes.GIT_PUSH_FAILED, 'Failed to push to origin'), 500);
    }
  });

  // POST /git/pull - Pull from origin with autostash + rebase
  app.post('/git/pull', async (c) => {
    try {
      const config = getGitConfig();
      const gitOps = createGitOperations(config);
      const result = await gitOps.pull();

      if (!result.success) {
        return c.json(errorResponse(ErrorCodes.GIT_PULL_FAILED, result.error || 'Pull failed'), 500);
      }

      return c.json(result);
    } catch (error) {
      if (error instanceof Error && (error.message.includes('contentRoot') || error.message.includes('CONTENT_PATH'))) {
        return c.json(errorResponse(ErrorCodes.GIT_NOT_REPO, error.message), 400);
      }
      return c.json(logAndCreateErrorResponse(error, ErrorCodes.GIT_PULL_FAILED, 'Failed to pull from origin'), 500);
    }
  });

  return app;
}

/**
 * Create middleware for backwards compatibility with existing code
 * This wraps the Hono app to work with Node.js IncomingMessage/ServerResponse
 */
export function createContentMiddleware(contentApi: ContentAPI, options?: ContentAPIRouterOptions) {
  const app = createContentAPIRouter(contentApi, options);

  // Convert Hono app to Node.js middleware
  return async (req: any, res: any, next: () => void) => {
    const url = new URL(req.url, `http://${req.headers.host}`);

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
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : await readBody(req),
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
