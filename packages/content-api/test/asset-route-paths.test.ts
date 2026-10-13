import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { FileSystemContentAPI } from '../src/filesystem-content-api.js';
import { createContentAPIRouter } from '../src/middleware.js';
import { ErrorCodes } from '../src/types.js';
import { testTempDir } from './test-temp-dir.js';

/**
 * An asset path in the address that climbs out of the assets folder.
 *
 * The router decodes `%2F` in the path before the routes split it, so `..%2F..%2F.env` reached the
 * assets code as `../../.env`. The containment check refused it and nothing outside the folder was
 * read or deleted, but the error surfaced as a 500 server fault instead of a 400 bad request.
 */
describe('an asset path that climbs out of the assets folder', () => {
  let siteRoot: string;
  let router: ReturnType<typeof createContentAPIRouter>;

  beforeEach(async () => {
    FileSystemContentAPI.clearCaches();
    siteRoot = testTempDir('asset-route-paths');
    const contentRoot = join(siteRoot, 'content');
    const assetsPath = join(siteRoot, 'public', 'assets');
    await mkdir(contentRoot, { recursive: true });
    await mkdir(join(assetsPath, 'a'), { recursive: true });
    await mkdir(join(siteRoot, 'public', 'assets-evil'), { recursive: true });
    await writeFile(join(siteRoot, '.env'), 'API_SECRET=hunter2');
    await writeFile(join(siteRoot, 'public', 'assets-evil', 'x.png'), 'beside the assets folder');
    await writeFile(
      join(contentRoot, 'sites.json'),
      JSON.stringify({ sites: { shop: { locales: ['en'], defaultLocale: 'en' } }, globalLocales: ['en'] }),
    );
    const api = await FileSystemContentAPI.create({ contentRoot, canvasDir: join(siteRoot, 'canvas') });
    router = createContentAPIRouter(api, { assetsPath, contentRoot });
  });

  afterEach(async () => {
    await rm(siteRoot, { recursive: true, force: true });
  });

  const paths = ['..%2F..%2F.env', 'a%2F..%2F..%2Fassets-evil%2Fx.png'];
  const requests = [
    { method: 'GET', route: 'serve' },
    { method: 'GET', route: 'meta' },
    { method: 'PATCH', route: 'meta' },
    { method: 'DELETE', route: 'meta' },
  ];

  for (const { method, route } of requests) {
    test(`${method} /assets/${route} answers 400 INVALID_REQUEST and leaves the file outside alone`, async () => {
      for (const path of paths) {
        const response = await router.fetch(
          new Request(`http://localhost/assets/${route}/${path}`, {
            method,
            headers: { Host: 'localhost:4321', 'Content-Type': 'application/json' },
            body: method === 'PATCH' ? JSON.stringify({ alt: 'Stolen' }) : undefined,
          }),
        );

        expect({ path, status: response.status, body: await response.json() }).toEqual({
          path,
          status: 400,
          body: { error: { code: ErrorCodes.INVALID_REQUEST, message: 'Invalid asset path' } },
        });
      }
      expect(await readFile(join(siteRoot, '.env'), 'utf8')).toBe('API_SECRET=hunter2');
      expect(await readFile(join(siteRoot, 'public', 'assets-evil', 'x.png'), 'utf8')).toBe('beside the assets folder');
    });
  }
});
