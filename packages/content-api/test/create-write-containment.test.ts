import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { FileSystemContentAPI } from '../src/filesystem-content-api.js';
import { createContentAPIRouter } from '../src/middleware.js';
import { ErrorCodes } from '../src/types.js';
import { testTempDir } from './test-temp-dir.js';

/**
 * Creating an entry through POST /content.
 *
 * An entry's collection and each of its locales are part of its file path:
 * content/fragments/<collection>/<name>.<locale>.mdx, content/<site>/<collection>/<path>.<locale>.vxjson,
 * or docs/<locale>/<path>.mdx for a page in the site's own MDX folder. Its name and path were
 * checked, but a collection like '../../x' or a locale like '../../x' still put the file outside
 * the content folder. Both are now refused before anything is written.
 */
describe('creating an entry with a malformed collection or locale through POST /content', () => {
  let root: string;
  let router: ReturnType<typeof createContentAPIRouter>;

  beforeEach(async () => {
    FileSystemContentAPI.clearCaches();
    root = testTempDir('create-containment');
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

  async function create(body: Record<string, unknown>) {
    const response = await router.fetch(
      new Request('http://localhost/content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  }

  /** Every file under the test's root folder, the content folder and whatever lies beside it. */
  async function filesUnderRoot(dir = root, prefix = ''): Promise<string[]> {
    const files: string[] = [];
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) files.push(...(await filesUnderRoot(join(dir, entry.name), path)));
      else files.push(path);
    }
    return files.sort();
  }

  const entries = {
    fragment: (collection: string, locale = 'en') => ({
      kind: 'fragment',
      type: 'mdx',
      collection,
      name: 'hero',
      locales: { [locale]: { meta: { title: 'Hero' }, content: { mdx: '# Hero' } } },
    }),
    data: (collection: string, locale = 'en') => ({
      kind: 'data',
      type: 'json',
      collection,
      name: 'hero',
      locales: { [locale]: { meta: { title: 'Hero' }, content: { data: { name: 'hero' } } } },
    }),
    page: (collection: string, locale = 'en') => ({
      kind: 'page',
      type: 'puck',
      site: 'shop',
      collection,
      locales: { [locale]: { pathname: '/hero', meta: { title: 'Hero' }, content: { puckData: { root: {} } } } },
    }),
    'MDX page': (collection: string, locale = 'en') => ({
      kind: 'page',
      type: 'mdx',
      site: 'shop',
      collection,
      locales: { [locale]: { pathname: '/guide', meta: { title: 'Guide' }, content: { mdx: '# Guide' } } },
    }),
  };

  for (const [kind, entry] of Object.entries(entries)) {
    test(`refuses a ${kind} collection that is not a plain folder name as invalid_collection, 400`, async () => {
      const before = await filesUnderRoot();

      for (const collection of ['../../../escaped', '..', 'nested/escaped', 'back\\slash', '']) {
        const { status, body } = await create(entry(collection));

        expect(status).toBe(400);
        expect(body).toMatchObject({
          success: false,
          reason: 'invalid_collection',
          error: {
            code: ErrorCodes.INVALID_REQUEST,
            message: collection
              ? `Invalid collection name: ${collection}. Collection names must contain only alphanumeric characters, hyphens, and underscores.`
              : 'Collection name is required',
            details: { field: 'collection' },
          },
        });
        expect(await filesUnderRoot()).toEqual(before);
      }
    });

    test(`refuses a ${kind} locale that is not a language code as invalid_locale, 400`, async () => {
      const before = await filesUnderRoot();

      for (const locale of ['../../../escaped', '/../../../escaped', 'de/../../escaped', 'english']) {
        const { status, body } = await create(entry('general', locale));

        expect(status).toBe(400);
        expect(body).toMatchObject({
          success: false,
          reason: 'invalid_locale',
          error: {
            code: ErrorCodes.INVALID_LOCALE,
            message: `Invalid locale: ${locale}. A locale is a two-letter language code, optionally with a region, like en or en-US.`,
            details: { field: 'locales' },
          },
        });
        expect(await filesUnderRoot()).toEqual(before);
      }
    });
  }

  test('still creates entries in a plain collection and a language-code locale', async () => {
    for (const entry of Object.values(entries)) {
      expect((await create(entry('general', 'de'))).status).toBe(201);
    }
    expect(await filesUnderRoot()).toEqual([
      'content/data/general/hero.de.json',
      'content/fragments/general/hero.de.mdx',
      'content/shop/general/hero.de.vxjson',
      'content/sites.json',
      'docs/de/guide.mdx',
    ]);
  });
});
