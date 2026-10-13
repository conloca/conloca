import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { FileSystemContentAPI } from '../src/filesystem-content-api.js';
import { InMemoryContentAPI } from '../src/in-memory-content-api.js';
import { createContentAPIRouter } from '../src/middleware.js';
import { ErrorCodes } from '../src/types.js';
import { assertDefined, getCreatedId } from './test-helpers.js';
import { testTempDir } from './test-temp-dir.js';

/**
 * Changing a page's path through page settings (PUT or PATCH /content/:id) or a move.
 *
 * A page's path names its file, content/<site>/<collection>/<path>.<locale>.vxjson, and a new
 * path was checked only against the exact path of another page. '/../../../x' wrote the page
 * outside the content folder, and '/team/' took the file of the page at '/team'. A new path
 * now passes the create's check: it is tidied, or refused as `invalid_pathname`, and another
 * page's path is refused as `pathname_taken`, before anything is written.
 */
describe("changing a page's path through the content-API router", () => {
  let root: string;
  let api: FileSystemContentAPI;
  let router: ReturnType<typeof createContentAPIRouter>;
  let aboutId: string;
  let teamId: string;

  beforeEach(async () => {
    FileSystemContentAPI.clearCaches();
    root = testTempDir('page-path-change');
    const contentRoot = join(root, 'content');
    await mkdir(contentRoot, { recursive: true });
    await writeFile(
      join(contentRoot, 'sites.json'),
      JSON.stringify({ sites: { shop: { locales: ['en'], defaultLocale: 'en' } }, globalLocales: ['en'] }),
    );
    api = await FileSystemContentAPI.create({ contentRoot, canvasDir: join(root, 'canvas') });
    router = createContentAPIRouter(api);
    aboutId = await createPage('/about', 'About');
    teamId = await createPage('/team', 'Team');
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function createPage(pathname: string, title: string): Promise<string> {
    const created = await api.createContent({
      kind: 'page',
      site: 'shop',
      collection: 'pages',
      type: 'puck',
      locales: { en: { pathname, meta: { title }, content: { puckData: { root: {} } } } },
    });
    return getCreatedId(created);
  }

  async function currentEtag(id: string): Promise<string> {
    const current = await api.getLocalized(id, 'en');
    assertDefined(current, `page ${id} should be readable`);
    return current.localized.etag;
  }

  type Way = 'PUT' | 'PATCH' | 'move';

  /** Give the About page `pathname` the way page settings (PUT, PATCH) or a move sends it. */
  async function changePath(way: Way, pathname: string) {
    const etag = await currentEtag(aboutId);
    const request =
      way === 'move'
        ? new Request('http://localhost/shop/move', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: aboutId, pathname, locale: 'en', etag }),
          })
        : new Request(`http://localhost/content/${aboutId}?${new URLSearchParams({ locale: 'en', etag })}`, {
            method: way,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pathname, meta: { title: 'About' } }),
          });
    const response = await router.fetch(request);
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

  // '/index' is stored as index.en.vxjson, the file of the page at '/', and 'team/index' reads
  // back as '/team'.
  const indexRefusal = 'Path cannot end in `/index`: `/index` is the home page and `/blog/index` is `/blog`';

  const pageFiles = ['content/shop/pages/about.en.vxjson', 'content/shop/pages/team.en.vxjson', 'content/sites.json'];

  for (const way of ['PUT', 'PATCH', 'move'] as const) {
    const refusedAs = way === 'move' ? { moved: false } : { success: false };

    test(`${way} refuses a malformed path as invalid_pathname, 400, and writes nothing`, async () => {
      const malformed: [pathname: string, why: string][] = [
        ['/../../../escaped', 'Path cannot contain `.` or `..` segments'],
        ['/our team', 'Path cannot contain spaces'],
        ['/index', indexRefusal],
        ['/team/index', indexRefusal],
      ];
      for (const [pathname, why] of malformed) {
        const { status, body } = await changePath(way, pathname);

        expect(status).toBe(400);
        expect(body).toMatchObject({
          ...refusedAs,
          reason: 'invalid_pathname',
          error: { code: ErrorCodes.INVALID_PATHNAME, message: `Invalid pathname for locale en: ${why}` },
        });
        expect(await filesUnderRoot()).toEqual(pageFiles);
        expect(api.getSite('shop')?.getByPathname('/about', 'en')?.id).toBe(aboutId);
      }
    });

    test(`${way} refuses another page's path written with a trailing slash, 409, and leaves that page's file`, async () => {
      const teamFile = await readFile(join(root, 'content/shop/pages/team.en.vxjson'), 'utf-8');

      const { status, body } = await changePath(way, '/team/');

      expect(status).toBe(409);
      expect(body).toMatchObject({
        ...refusedAs,
        reason: way === 'move' ? 'already_exists' : 'pathname_taken',
        error: { code: ErrorCodes.PATHNAME_TAKEN, message: 'Pathname /team already exists' },
      });
      expect(await readFile(join(root, 'content/shop/pages/team.en.vxjson'), 'utf-8')).toBe(teamFile);
      expect(await filesUnderRoot()).toEqual(pageFiles);
      expect(api.getSite('shop')?.getByPathname('/team', 'en')?.id).toBe(teamId);
    });

    test(`${way} moves the page to a free path, tidied`, async () => {
      const { status } = await changePath(way, 'contact/');

      expect(status).toBe(200);
      expect(await filesUnderRoot()).toEqual([
        'content/shop/pages/contact.en.vxjson',
        'content/shop/pages/team.en.vxjson',
        'content/sites.json',
      ]);
      expect(api.getSite('shop')?.getByPathname('/contact', 'en')?.id).toBe(aboutId);
    });
  }

  test('a batch update refuses a path ending in index and writes nothing', async () => {
    const operations = [{ id: aboutId, locale: 'en', etag: await currentEtag(aboutId), data: { pathname: '/index' } }];
    const response = await router.fetch(
      new Request('http://localhost/content/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operations }),
      }),
    );

    expect(response.status).toBe(207);
    expect(await response.json()).toMatchObject({ success: false, failed: 1, updated: 0 });
    expect(await filesUnderRoot()).toEqual(pageFiles);
  });

  for (const way of ['PUT', 'PATCH'] as const) {
    test(`${way} answers another page's exact path as pathname_taken, 409`, async () => {
      const { status, body } = await changePath(way, '/team');

      expect(status).toBe(409);
      expect(body).toMatchObject({
        success: false,
        reason: 'pathname_taken',
        error: { code: ErrorCodes.PATHNAME_TAKEN, message: 'Pathname /team already exists' },
      });
    });

    test(`${way} refuses an emptied path as invalid_pathname rather than skipping it`, async () => {
      const { status, body } = await changePath(way, '');

      expect(status).toBe(400);
      expect(body).toMatchObject({
        success: false,
        reason: 'invalid_pathname',
        error: { code: ErrorCodes.INVALID_PATHNAME, message: 'Invalid pathname for locale en: Path is required' },
      });
      expect(api.getSite('shop')?.getByPathname('/about', 'en')?.id).toBe(aboutId);
    });
  }
});

/** The in-memory backend, which the editor's own tests run against, checks a new path the same way. */
describe("changing a page's path in the in-memory backend", () => {
  async function aboutPage() {
    const api = new InMemoryContentAPI({
      sites: { shop: { locales: ['en'], defaultLocale: 'en' } },
      globalLocales: ['en'],
    });
    const create = (pathname: string, title: string) =>
      api.createContent({
        kind: 'page',
        site: 'shop',
        collection: 'pages',
        type: 'puck',
        locales: { en: { pathname, meta: { title }, content: { puckData: { root: {} } } } },
      });
    const aboutId = getCreatedId(await create('/about', 'About'));
    await create('/team', 'Team');
    const changePath = async (pathname: string) => {
      const current = await api.getLocalized(aboutId, 'en');
      assertDefined(current, 'the About page should be readable');
      return api.updateLocalized({ id: aboutId, locale: 'en', data: { pathname }, etag: current.localized.etag });
    };
    return { api, aboutId, changePath };
  }

  test('refuses a malformed path as invalid_pathname and another page path as pathname_taken', async () => {
    const { changePath } = await aboutPage();

    expect(await changePath('/../escaped')).toMatchObject({ success: false, reason: 'invalid_pathname' });
    expect(await changePath('/team/')).toMatchObject({ success: false, reason: 'pathname_taken' });
    expect(await changePath('/index')).toMatchObject({ success: false, reason: 'invalid_pathname' });
  });

  test('stores a free path tidied', async () => {
    const { api, aboutId, changePath } = await aboutPage();

    expect(await changePath('contact/')).toMatchObject({ success: true });
    expect((await api.getLocalized(aboutId, 'en'))?.localized.pathname).toBe('/contact');
  });
});
