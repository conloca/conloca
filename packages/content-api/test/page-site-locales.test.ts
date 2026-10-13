import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { FileSystemContentAPI } from '../src/filesystem-content-api.js';
import { createContentAPIRouter } from '../src/middleware.js';
import { ErrorCodes } from '../src/types.js';
import { testTempDir } from './test-temp-dir.js';

/**
 * Creating a page in a language its site is not set up for, through POST /content.
 *
 * A page's language is part of its file name, and a site's pages are read back only in the
 * languages sites.json sets up for it. A well-formed but unset-up language used to be written
 * first and answered with a 500 afterwards, and the file it wrote could be another page's file:
 * 'EN' on a macOS or Windows disk is the 'en' file, and in the site's MDX pages folder the page
 * 'fr' '/x' is docs/fr/x.mdx, the English page at '/fr/x'. Such a create is now refused as
 * `invalid_locale` before anything is written.
 */
describe('creating a page in a language its site is not set up for', () => {
  let root: string;
  let router: ReturnType<typeof createContentAPIRouter>;

  beforeEach(async () => {
    FileSystemContentAPI.clearCaches();
    root = testTempDir('page-site-locales');
    const contentRoot = join(root, 'content');
    await mkdir(contentRoot, { recursive: true });
    await writeFile(
      join(contentRoot, 'sites.json'),
      JSON.stringify({
        sites: { shop: { locales: ['en', 'de'], defaultLocale: 'en', mdxPages: join(root, 'docs') } },
        globalLocales: ['en', 'de'],
      }),
    );
    const api = await FileSystemContentAPI.create({ contentRoot, canvasDir: join(root, 'canvas') });
    router = createContentAPIRouter(api);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function create(type: 'mdx' | 'puck', locale: string, pathname: string) {
    const response = await router.fetch(
      new Request('http://localhost/content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'page',
          type,
          site: 'shop',
          collection: 'pages',
          locales: {
            [locale]: {
              pathname,
              meta: { title: `${locale} ${pathname}` },
              content: type === 'mdx' ? { mdx: `# ${locale} ${pathname}` } : { puckData: { root: {} } },
            },
          },
        }),
      }),
    );
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  }

  async function filesIn(folder: string): Promise<string[]> {
    const files = await readdir(join(root, folder), { recursive: true, withFileTypes: true });
    return files
      .filter((entry) => entry.isFile())
      .map((entry) => join(entry.parentPath, entry.name).slice(join(root, folder).length + 1))
      .filter((path) => path !== 'sites.json')
      .sort();
  }

  const refusal = (locale: string) => ({
    success: false,
    reason: 'invalid_locale',
    error: { code: ErrorCodes.INVALID_LOCALE, message: `Invalid locale: ${locale}. Site shop is set up for en, de.` },
  });

  test('refuses a language in other capitals, 400, and leaves the page it names', async () => {
    expect((await create('puck', 'en', '/x')).status).toBe(201);
    const englishFile = await readFile(join(root, 'content/shop/pages/x.en.vxjson'), 'utf-8');

    const { status, body } = await create('puck', 'EN', '/x');

    expect(status).toBe(400);
    expect(body).toMatchObject(refusal('EN'));
    expect(await filesIn('content')).toEqual(['shop/pages/x.en.vxjson']);
    expect(await readFile(join(root, 'content/shop/pages/x.en.vxjson'), 'utf-8')).toBe(englishFile);
  });

  test('refuses a language the site has not set up, 400, and leaves the MDX page whose folder it names', async () => {
    expect((await create('mdx', 'en', '/fr/x')).status).toBe(201);
    const englishFile = await readFile(join(root, 'docs/fr/x.mdx'), 'utf-8');

    const { status, body } = await create('mdx', 'fr', '/x');

    expect(status).toBe(400);
    expect(body).toMatchObject(refusal('fr'));
    expect(await filesIn('docs')).toEqual(['fr/x.mdx']);
    expect(await readFile(join(root, 'docs/fr/x.mdx'), 'utf-8')).toBe(englishFile);
  });

  test('still creates a page in each language the site is set up for', async () => {
    expect((await create('puck', 'de', '/x')).status).toBe(201);
    expect((await create('mdx', 'de', '/y')).status).toBe(201);

    expect(await filesIn('content')).toEqual(['shop/pages/x.de.vxjson']);
    expect(await filesIn('docs')).toEqual(['de/y.mdx']);
  });
});
