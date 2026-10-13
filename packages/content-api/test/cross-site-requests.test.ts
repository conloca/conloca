import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { FileSystemContentAPI } from '../src/filesystem-content-api.js';
import { createContentAPIRouter } from '../src/middleware.js';
import { ErrorCodes } from '../src/types.js';
import { testTempDir } from './test-temp-dir.js';

/**
 * Requests another website makes to the content routes while the developer has it open.
 *
 * The routes run on the developer's own machine while the dev server is up, and write into the
 * project. They answered every origin with `Access-Control-Allow-Origin: *`, so any page open in
 * the browser could read the drafts and send writes, and a plain cross-site form post (which needs
 * no permission from the server at all) wrote a file. The editor calls the routes from the dev
 * server's own origin; a write the browser marks as coming from another site is now refused, and
 * no response grants another origin access.
 */
describe('requests from another website to the content routes', () => {
  let root: string;
  let router: ReturnType<typeof createContentAPIRouter>;

  beforeEach(async () => {
    FileSystemContentAPI.clearCaches();
    root = testTempDir('cross-site');
    const contentRoot = join(root, 'content');
    await mkdir(contentRoot, { recursive: true });
    await writeFile(
      join(contentRoot, 'sites.json'),
      JSON.stringify({ sites: { shop: { locales: ['en'], defaultLocale: 'en' } }, globalLocales: ['en'] }),
    );
    const api = await FileSystemContentAPI.create({ contentRoot, canvasDir: join(root, 'canvas') });
    router = createContentAPIRouter(api, { assetsPath: join(root, 'assets'), contentRoot });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const fragment = JSON.stringify({
    kind: 'fragment',
    type: 'mdx',
    collection: 'general',
    name: 'hero',
    locales: { en: { meta: { title: 'Hero' }, content: { mdx: '# Hero' } } },
  });

  /** A POST /content the way a browser sends it, with the headers it adds on its own. */
  function post(headers: Record<string, string>, contentType = 'application/json') {
    return router.fetch(
      new Request('http://localhost/content', {
        method: 'POST',
        headers: { Host: 'localhost:4321', 'Content-Type': contentType, ...headers },
        body: fragment,
      }),
    );
  }

  async function contentFiles(): Promise<string[]> {
    return (await readdir(join(root, 'content'), { recursive: true })).sort();
  }

  test('refuses a write the browser marks as cross-site, 403, and writes nothing', async () => {
    // What a hidden form on another website sends: no permission is asked first.
    const response = await post({ Origin: 'https://attacker.example', 'Sec-Fetch-Site': 'cross-site' }, 'text/plain');

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: {
        code: ErrorCodes.FORBIDDEN,
        message: 'Refused a write another website sent through the browser',
      },
    });
    expect(await contentFiles()).toEqual(['sites.json']);
  });

  test('refuses a write from another site on the same domain, 403', async () => {
    const response = await post({ Origin: 'https://blog.localhost:4321', 'Sec-Fetch-Site': 'same-site' });

    expect(response.status).toBe(403);
    expect(await contentFiles()).toEqual(['sites.json']);
  });

  test('refuses a write whose origin is not the dev server, when the browser does not say where it came from', async () => {
    // Browsers older than the Sec-Fetch-Site header still send the page's origin.
    const response = await post({ Origin: 'https://attacker.example' });

    expect(response.status).toBe(403);
    expect(await contentFiles()).toEqual(['sites.json']);
  });

  test('refuses a write through every write route, not only POST /content', async () => {
    const crossSite = { Host: 'localhost:4321', Origin: 'https://attacker.example', 'Sec-Fetch-Site': 'cross-site' };
    const writes: [method: string, path: string][] = [
      ['PUT', '/content/vx-any?locale=en'],
      ['PATCH', '/content/vx-any?locale=en'],
      ['DELETE', '/content/vx-any'],
      ['POST', '/content/batch'],
      ['POST', '/shop/move'],
      ['POST', '/git/commit'],
      ['POST', '/git/push'],
      ['POST', '/git/pull'],
      ['POST', '/assets/upload'],
      ['POST', '/assets/import-url'],
      ['POST', '/assets/move'],
      ['POST', '/assets/folders'],
      ['PATCH', '/assets/meta/hero.png'],
      ['DELETE', '/assets/meta/hero.png'],
    ];
    for (const [method, path] of writes) {
      const response = await router.fetch(
        new Request(`http://localhost${path}`, { method, headers: crossSite, body: method === 'DELETE' ? null : '{}' }),
      );
      expect({ method, path, status: response.status }).toEqual({ method, path, status: 403 });
    }
  });

  test('gives another origin no access to the answers, not even to read', async () => {
    const preflight = await router.fetch(
      new Request('http://localhost/content', {
        method: 'OPTIONS',
        headers: {
          Host: 'localhost:4321',
          Origin: 'https://attacker.example',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'content-type',
        },
      }),
    );
    const read = await router.fetch(
      new Request('http://localhost/content', {
        headers: { Host: 'localhost:4321', Origin: 'https://attacker.example', 'Sec-Fetch-Site': 'cross-site' },
      }),
    );

    expect(preflight.headers.get('Access-Control-Allow-Origin')).toBeNull();
    expect(read.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  test('accepts a write from the dev server itself', async () => {
    const response = await post({ Origin: 'http://localhost:4321', 'Sec-Fetch-Site': 'same-origin' });

    expect(response.status).toBe(201);
    expect(await contentFiles()).toContain('fragments/general/hero.en.mdx');
  });

  test('accepts a write from the dev server behind a custom host and port', async () => {
    const response = await router.fetch(
      new Request('http://localhost/content', {
        method: 'POST',
        headers: { Host: 'shop.test:8443', Origin: 'https://shop.test:8443', 'Content-Type': 'application/json' },
        body: fragment,
      }),
    );

    expect(response.status).toBe(201);
  });

  test('accepts a write from a script or tool that is not a browser', async () => {
    // No Origin and no Sec-Fetch-Site: nothing a website can make a browser send.
    const response = await post({});

    expect(response.status).toBe(201);
  });
});
