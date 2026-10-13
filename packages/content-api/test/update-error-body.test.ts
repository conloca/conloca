import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { FileSystemContentAPI } from '../src/filesystem-content-api.js';
import { createContentAPIRouter } from '../src/middleware.js';
import { ErrorCodes } from '../src/types.js';
import { assertDefined, getCreatedId } from './test-helpers.js';
import { testTempDir } from './test-temp-dir.js';

/**
 * An update the backend refuses for a reason of its own, such as an emptied title or metadata over
 * 4 KB, answers 500 as before, but with the error envelope a refused create has, so the client can
 * read the backend's message. It used to send the refusal's Error object, which serializes to `{}`,
 * and the editor could only say "API error: 500 Internal Server Error".
 */
describe('the update routes saying why an update failed', () => {
  let root: string;
  let api: FileSystemContentAPI;
  let router: ReturnType<typeof createContentAPIRouter>;
  let pageId: string;

  beforeEach(async () => {
    FileSystemContentAPI.clearCaches();
    root = testTempDir('update-error-body');
    const contentRoot = join(root, 'content');
    await mkdir(contentRoot, { recursive: true });
    await writeFile(
      join(contentRoot, 'sites.json'),
      JSON.stringify({ sites: { shop: { locales: ['en'], defaultLocale: 'en' } }, globalLocales: ['en'] }),
    );
    api = await FileSystemContentAPI.create({ contentRoot, canvasDir: join(root, 'canvas') });
    router = createContentAPIRouter(api);
    pageId = getCreatedId(
      await api.createContent({
        kind: 'page',
        site: 'shop',
        collection: 'pages',
        type: 'puck',
        locales: { en: { pathname: '/about', meta: { title: 'About' }, content: { puckData: { root: {} } } } },
      }),
    );
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function update(method: 'PUT' | 'PATCH', body: string) {
    const current = await api.getLocalized(pageId, 'en');
    assertDefined(current, 'the page should be readable');
    const params = new URLSearchParams({ locale: 'en', etag: current.localized.etag });
    const response = await router.fetch(
      new Request(`http://localhost/content/${pageId}?${params}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body,
      }),
    );
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  }

  for (const method of ['PUT', 'PATCH'] as const) {
    test(`${method} says an emptied title is required`, async () => {
      const { status, body } = await update(method, JSON.stringify({ meta: { title: null } }));

      expect(status).toBe(500);
      expect(body).toMatchObject({
        success: false,
        reason: 'write_error',
        error: { code: ErrorCodes.WRITE_ERROR, message: 'Title is required in metadata' },
      });
      expect((await api.getLocalized(pageId, 'en'))?.localized.meta.title).toBe('About');
    });

    test(`${method} says the metadata is over 4 KB`, async () => {
      const { status, body } = await update(method, JSON.stringify({ meta: { description: 'x'.repeat(5000) } }));

      expect(status).toBe(500);
      expect(body).toMatchObject({ success: false, reason: 'write_error', error: { code: ErrorCodes.WRITE_ERROR } });
      expect((body.error as { message: string }).message).toStartWith('Metadata exceeds 4KB limit');
    });

    test(`${method} says why a body it cannot read failed`, async () => {
      const { status, body } = await update(method, '{not json');

      expect(status).toBe(500);
      expect(body).toMatchObject({ success: false, reason: 'write_error', error: { code: ErrorCodes.WRITE_ERROR } });
      expect((body.error as { message: string }).message).not.toBe('');
    });
  }
});
