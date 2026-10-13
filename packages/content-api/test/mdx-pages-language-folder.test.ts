import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { FileSystemContentAPI } from '../src/filesystem-content-api.js';
import { createContentAPIRouter } from '../src/middleware.js';
import { type CreateContentInput, ErrorCodes } from '../src/types.js';
import { assertDefined, getCreatedId } from './test-helpers.js';
import { testTempDir } from './test-temp-dir.js';

/**
 * Default-language paths that start with a language code, on a site whose MDX pages live in their
 * own folder (sites.json `mdxPages`).
 *
 * In that folder a page's language is its first folder: the German page at '/x' is docs/de/x.mdx,
 * and a default-language page has no language folder, so '/de/x' in English was written to
 * docs/de/x.mdx too, over the German page, and read back as the German '/x'. Such a path is now
 * refused as `invalid_pathname`, on a create and on a path change. '/de' alone (docs/de.mdx) and
 * pages outside that folder are unaffected.
 */
describe("default-language paths that start with a language code in a site's MDX pages folder", () => {
  let root: string;
  let api: FileSystemContentAPI;
  let router: ReturnType<typeof createContentAPIRouter>;

  beforeEach(async () => {
    FileSystemContentAPI.clearCaches();
    root = testTempDir('mdx-pages-language-folder');
    const contentRoot = join(root, 'content');
    await mkdir(contentRoot, { recursive: true });
    await writeFile(
      join(contentRoot, 'sites.json'),
      JSON.stringify({
        sites: { docs: { locales: ['en', 'de', 'pt-BR'], defaultLocale: 'en', mdxPages: join(root, 'docs') } },
        globalLocales: ['en', 'de', 'pt-BR'],
      }),
    );
    api = await FileSystemContentAPI.create({ contentRoot, canvasDir: join(root, 'canvas') });
    router = createContentAPIRouter(api);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  function page(locale: string, pathname: string, type: 'mdx' | 'puck' = 'mdx'): CreateContentInput {
    return {
      kind: 'page',
      type,
      site: 'docs',
      collection: 'pages',
      locales: {
        [locale]: {
          pathname,
          meta: { title: `${locale} ${pathname}` },
          content: type === 'mdx' ? { mdx: `# ${locale} ${pathname}` } : { puckData: { root: {} } },
        },
      },
    };
  }

  async function create(locale: string, pathname: string, type: 'mdx' | 'puck' = 'mdx') {
    const response = await router.fetch(
      new Request('http://localhost/content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(page(locale, pathname, type)),
      }),
    );
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  }

  async function changePath(way: 'PATCH' | 'move', id: string, pathname: string) {
    const current = await api.getLocalized(id, 'en');
    assertDefined(current, `page ${id} should be readable`);
    const { etag } = current.localized;
    const response = await router.fetch(
      way === 'move'
        ? new Request('http://localhost/docs/move', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, pathname, locale: 'en', etag }),
          })
        : new Request(`http://localhost/content/${id}?${new URLSearchParams({ locale: 'en', etag })}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pathname }),
          }),
    );
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  }

  async function docsFiles(): Promise<string[]> {
    return (await readdir(join(root, 'docs'), { recursive: true })).filter((path) => path.endsWith('.mdx')).sort();
  }

  const refusal = (first: string, kept = first) =>
    `Invalid pathname for locale en: Path cannot start with \`/${first}/\`: the MDX pages folder keeps the ${kept} pages there`;

  test('refuses a new default-language page at such a path, 400, and leaves the German page', async () => {
    const germanId = getCreatedId(await api.createContent(page('de', '/x')));
    const germanFile = await readFile(join(root, 'docs/de/x.mdx'), 'utf-8');

    for (const [pathname, first] of [
      ['/de/x', 'de'],
      ['/en/x', 'en'],
      ['/de/deeper/x', 'de'],
    ]) {
      const { status, body } = await create('en', pathname);

      expect(status).toBe(400);
      expect(body).toMatchObject({
        success: false,
        reason: 'invalid_pathname',
        error: { code: ErrorCodes.INVALID_PATHNAME, message: refusal(first) },
      });
    }
    expect(await docsFiles()).toEqual(['de/x.mdx']);
    expect(await readFile(join(root, 'docs/de/x.mdx'), 'utf-8')).toBe(germanFile);
    expect(api.getSite('docs')?.getByPathname('/x', 'de')?.id).toBe(germanId);
  });

  test('refuses such a path whatever the capitals of its language folder, and leaves the Brazilian page', async () => {
    // Paths are lowercase, and macOS and Windows disks read docs/pt-br/x.mdx as docs/pt-BR/x.mdx.
    const brazilianId = getCreatedId(await api.createContent(page('pt-BR', '/x')));
    const brazilianFile = await readFile(join(root, 'docs/pt-BR/x.mdx'), 'utf-8');

    const { status, body } = await create('en', '/pt-br/x');

    expect(status).toBe(400);
    expect(body).toMatchObject({
      reason: 'invalid_pathname',
      error: { code: ErrorCodes.INVALID_PATHNAME, message: refusal('pt-br', 'pt-BR') },
    });
    expect(await docsFiles()).toEqual(['pt-BR/x.mdx']);
    expect(await readFile(join(root, 'docs/pt-BR/x.mdx'), 'utf-8')).toBe(brazilianFile);
    expect(api.getSite('docs')?.getByPathname('/x', 'pt-BR')?.id).toBe(brazilianId);
  });

  for (const way of ['PATCH', 'move'] as const) {
    test(`${way} refuses moving a default-language page to such a path, 400, and writes nothing`, async () => {
      const guideId = getCreatedId(await api.createContent(page('en', '/guide')));

      const { status, body } = await changePath(way, guideId, '/de/guide');

      expect(status).toBe(400);
      expect(body).toMatchObject({
        reason: 'invalid_pathname',
        error: { code: ErrorCodes.INVALID_PATHNAME, message: refusal('de') },
      });
      expect(await docsFiles()).toEqual(['guide.mdx']);
      expect(api.getSite('docs')?.getByPathname('/guide', 'en')?.id).toBe(guideId);
    });
  }

  test('still takes a path that is only a language code, a translation under its own folder, and other pages', async () => {
    expect((await create('en', '/de')).status).toBe(201);
    expect((await create('de', '/de/x')).status).toBe(201);
    expect((await create('en', '/de/x', 'puck')).status).toBe(201);

    expect(await docsFiles()).toEqual(['de.mdx', 'de/de/x.mdx']);
  });
});
