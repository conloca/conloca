import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ContentAPI } from '../src/content-api.interface.js';
import { FileSystemContentAPI } from '../src/filesystem-content-api.js';
import { InMemoryContentAPI } from '../src/in-memory-content-api.js';
import { createContentAPIRouter } from '../src/middleware.js';
import { type CreateContentInput, ErrorCodes } from '../src/types.js';

interface MappedError {
  error?: { code?: string; message?: string; details?: { field?: string } };
}

async function postContent(app: ReturnType<typeof createContentAPIRouter>, body: unknown) {
  return app.fetch(
    new Request('http://localhost/content', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

/**
 * A ContentAPI stub whose createContent always fails with the given reason.
 * Used for failure reasons the in-memory API cannot be coaxed into producing.
 */
function routerRejectingWith(reason: string, message: string, field?: string) {
  return createContentAPIRouter({
    createContent: async () => ({ success: false, reason, error: new Error(message), field }),
  } as unknown as ContentAPI);
}

describe('POST /content error mapping', () => {
  let app: ReturnType<typeof createContentAPIRouter>;

  beforeEach(() => {
    const api: ContentAPI = new InMemoryContentAPI({
      sites: {
        shop: { locales: ['en', 'nl'], defaultLocale: 'en' },
      },
      globalLocales: ['en', 'nl'],
    });
    app = createContentAPIRouter(api);
  });

  describe('a request the caller can fix', () => {
    test('returns 400, not 500, when the site is missing on a page', async () => {
      const res = await postContent(app, {
        kind: 'page',
        collection: 'pages',
        type: 'puck',
        locales: { en: { pathname: '/x', meta: { title: 'X' }, content: { puckData: {} } } },
      });

      expect(res.status).toBe(400);
    });

    test('names the offending field so a caller can fix the request', async () => {
      const res = await postContent(app, {
        kind: 'page',
        collection: 'pages',
        type: 'puck',
        locales: { en: { pathname: '/x', meta: { title: 'X' }, content: { puckData: {} } } },
      });
      const body = (await res.json()) as MappedError;

      expect(body.error?.code).toBe(ErrorCodes.MISSING_REQUIRED_FIELD);
      expect(body.error?.details?.field).toBe('site');
      expect(body.error?.message).toBe('Site is required for pages');
    });

    test('returns 400 naming the site when the site does not exist', async () => {
      const res = await postContent(app, {
        kind: 'page',
        site: 'nope',
        collection: 'pages',
        type: 'puck',
        locales: { en: { pathname: '/x', meta: { title: 'X' }, content: { puckData: {} } } },
      });
      const body = (await res.json()) as MappedError;

      expect(res.status).toBe(400);
      expect(body.error?.details?.field).toBe('site');
      expect(body.error?.message).toBe('Site nope not found');
    });

    test('returns 400 naming the pathname when a page locale has none', async () => {
      const res = await postContent(app, {
        kind: 'page',
        site: 'shop',
        collection: 'pages',
        type: 'puck',
        locales: { en: { meta: { title: 'X' }, content: { puckData: {} } } },
      });
      const body = (await res.json()) as MappedError;

      expect(res.status).toBe(400);
      expect(body.error?.code).toBe(ErrorCodes.MISSING_REQUIRED_FIELD);
      expect(body.error?.details?.field).toBe('pathname');
    });

    test('names sites.json as the problem when no sites are configured', async () => {
      const res = await postContent(
        routerRejectingWith(
          'no_sites_configured',
          'No sites are configured. Create content/sites.json, or run `conloca init <directory> <site-name>`.',
          'site',
        ),
        {},
      );
      const body = (await res.json()) as MappedError;

      expect(res.status).toBe(400);
      expect(body.error?.message).toContain('sites.json');
      expect(body.error?.details?.field).toBe('site');
    });

    test('returns 409 naming the pathname when it is already used as a redirect', async () => {
      const res = await postContent(
        routerRejectingWith('pathname_in_redirects', 'Pathname /old is already in use as a redirect', 'pathname'),
        {},
      );
      const body = (await res.json()) as MappedError;

      expect(res.status).toBe(409);
      expect(body.error?.details?.field).toBe('pathname');
    });
  });

  describe('mappings that already worked', () => {
    test('still maps a duplicate pathname to 409', async () => {
      const page = {
        kind: 'page',
        site: 'shop',
        collection: 'pages',
        type: 'puck',
        locales: { en: { pathname: '/dup', meta: { title: 'X' }, content: { puckData: {} } } },
      };
      await postContent(app, page);

      const res = await postContent(app, page);

      expect(res.status).toBe(409);
    });

    test('still maps an invalid fragment name to 400', async () => {
      const res = await postContent(app, {
        kind: 'fragment',
        collection: 'heroes',
        type: 'mdx',
        name: 'not a valid name!',
        locales: { en: { meta: { title: 'X' }, content: { mdx: '# X' } } },
      });

      expect(res.status).toBe(400);
    });
  });

  describe('failures the caller cannot fix', () => {
    test('reserves 500 for genuinely unexpected failures', async () => {
      const res = await postContent(routerRejectingWith('write_error', 'ENOSPC'), {});
      const body = (await res.json()) as MappedError;

      expect(res.status).toBe(500);
      expect(body.error?.code).toBe(ErrorCodes.WRITE_ERROR);
    });

    test('reserves 500 for a reason the router does not recognise', async () => {
      const res = await postContent(routerRejectingWith('disk_on_fire', 'ENOSPC'), {});

      expect(res.status).toBe(500);
    });
  });
});

/**
 * A brand-new project has no sites.json at all. Reads tolerate that, but a page
 * write into such a root cannot succeed, so the failure must name the file
 * rather than blame the `site` value the caller passed.
 */
describe('creating a page in a content root with no sites.json', () => {
  let tempDir: string;
  let api: ContentAPI;

  const page: CreateContentInput = {
    kind: 'page',
    site: 'main',
    collection: 'pages',
    type: 'puck',
    locales: { en: { pathname: '/x', meta: { title: 'X' }, content: { puckData: {} } } },
  };

  beforeEach(async () => {
    tempDir = join(tmpdir(), `create-no-sites-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const contentRoot = join(tempDir, 'content');
    const canvasDir = join(tempDir, 'canvas');
    await mkdir(contentRoot, { recursive: true });
    await mkdir(canvasDir, { recursive: true });
    api = await FileSystemContentAPI.create({ contentRoot, canvasDir });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test('names the file the caller has to create', async () => {
    const result = await api.createContent(page);

    expect(result.success).toBe(false);
    expect(result.reason).toBe('no_sites_configured');
    expect(result.error?.message).toContain('sites.json');
  });

  test('still lets reads work on the same empty content root', async () => {
    expect([...api.listAllContent()]).toEqual([]);
  });
});
