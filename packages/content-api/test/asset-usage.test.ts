import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AssetOperations } from '../src/asset-operations.js';
import type { AssetUsage } from '../src/asset-types.js';
import type { ContentAPI } from '../src/content-api.interface.js';
import { FileSystemContentAPI } from '../src/filesystem-content-api.js';
import { InMemoryContentAPI } from '../src/in-memory-content-api.js';
import { createContentAPIRouter } from '../src/middleware.js';
import { testTempDir } from './test-temp-dir.js';

/**
 * The editor's "Used in" list for a picture, asked by its path from the assets root. The editor links
 * a picture as `/assets/<path>`, so `beach.png` at the top is `/assets/beach.png` and the one in
 * `trip` is `/assets/trip/beach.png`. The list used to search file text for the bare name, so it
 * counted any link that merely contained it, in any folder, and never looked at Markdown pages.
 */
describe('which content uses a picture', () => {
  let root: string;

  beforeEach(() => {
    root = testTempDir('asset-usage');
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function usage(api: ContentAPI, path: string, assetRefBase?: string): Promise<AssetUsage[]> {
    const router = createContentAPIRouter(api, {
      assetsPath: join(root, 'assets'),
      contentRoot: join(root, 'content'),
      ...(assetRefBase !== undefined && { assetRefBase }),
    });
    const response = await router.request(`/assets/usage/${path}`);
    expect(response.status).toBe(200);
    return ((await response.json()) as { usage: AssetUsage[] }).usage;
  }

  function store(locales = ['en']): InMemoryContentAPI {
    return new InMemoryContentAPI({
      sites: { default: { locales, defaultLocale: 'en' } },
      globalLocales: locales,
    });
  }

  async function page(api: InMemoryContentAPI, pathname: string, meta: object, puckData: object = {}) {
    await api.createContent({
      kind: 'page',
      site: 'default',
      collection: 'pages',
      type: 'puck',
      locales: { en: { pathname, meta: { title: pathname, ...meta }, content: { puckData } } },
    });
  }

  test('a page whose section shows the picture lists that page and the field', async () => {
    const api = store();
    await page(api, '/beach-day', {}, { content: [{ type: 'Hero', props: { image: '/assets/beach.png' } }] });

    expect(await usage(api, 'beach.png')).toEqual([
      { page: '/beach-day (en)', field: 'content.puckData.content[0].props.image' },
    ]);
  });

  test('a link inside Markdown text counts, in quotes or with a query after it', async () => {
    const api = store();
    await api.createContent({
      kind: 'fragment',
      collection: 'shared',
      type: 'mdx',
      name: 'gallery',
      locales: { en: { meta: { title: 'Gallery' }, content: { mdx: 'Look:\n![Sand](/assets/beach.png)\n' } } },
    });
    await api.createContent({
      kind: 'fragment',
      collection: 'shared',
      type: 'mdx',
      name: 'banner',
      locales: { en: { meta: { title: 'Banner' }, content: { mdx: '<img src="/assets/beach.png?w=200" />' } } },
    });

    expect(await usage(api, 'beach.png')).toEqual([
      { page: 'shared/gallery (en)', field: 'content.mdx' },
      { page: 'shared/banner (en)', field: 'content.mdx' },
    ]);
  });

  test('a data entry counts', async () => {
    const api = store();
    await api.createContent({
      kind: 'data',
      collection: 'authors',
      type: 'json',
      name: 'jo',
      locales: { en: { meta: { title: 'Jo' }, content: { data: { avatar: '/assets/trip/beach.png' } } } },
    });

    expect(await usage(api, 'trip/beach.png')).toEqual([{ page: 'authors/jo (en)', field: 'content.data.avatar' }]);
  });

  test('a link to the picture in a folder is a use of that picture only, not of the one at the top', async () => {
    const api = store();
    await page(api, '/trip-report', { ogImage: '/assets/trip/beach.png' });

    expect(await usage(api, 'trip/beach.png')).toEqual([{ page: '/trip-report (en)', field: 'meta.ogImage' }]);
    expect(await usage(api, 'beach.png')).toEqual([]);
  });

  test('links that only contain the name do not count', async () => {
    const api = store();
    await page(api, '/lookalikes', {
      images: [
        '/assets/my-beach.png',
        '/assets/beach.png.bak',
        '/assets/beach.png/large',
        'https://cdn.example.com/assets/beach.png',
        '/docs/assets/beach.png',
        '/assets/uploads/beach.png',
        'beach.png',
      ],
    });

    expect(await usage(api, 'beach.png')).toEqual([]);
  });

  // A site that serves its media folder at another address, or sets a base, has the editor store
  // that address instead of `/assets`, so only a link under it is a use of the picture.
  test.each([
    ['a media folder of its own', '/media'],
    ['a base', '/docs/assets'],
    ['its media at the top of the site', ''],
  ])('on a site with %s, links under the address it serves media at count', async (_, assetRefBase) => {
    const api = store();
    await page(api, '/shown', { ogImage: `${assetRefBase}/beach.png` });
    await page(api, '/elsewhere', { ogImage: '/other/beach.png' });

    expect(await usage(api, 'beach.png', assetRefBase)).toEqual([{ page: '/shown (en)', field: 'meta.ogImage' }]);
  });

  test('each language that uses the picture is its own row', async () => {
    const api = store(['en', 'nl']);
    await api.createContent({
      kind: 'page',
      site: 'default',
      collection: 'pages',
      type: 'puck',
      locales: {
        en: { pathname: '/beach', meta: { title: 'Beach', ogImage: '/assets/beach.png' }, content: { puckData: {} } },
        nl: { pathname: '/strand', meta: { title: 'Strand', ogImage: '/assets/beach.png' }, content: { puckData: {} } },
      },
    });

    expect(await usage(api, 'beach.png')).toEqual([
      { page: '/beach (en)', field: 'meta.ogImage' },
      { page: '/strand (nl)', field: 'meta.ogImage' },
    ]);
  });

  test('with more than one site, each page names its site, so two home pages tell apart', async () => {
    const api = new InMemoryContentAPI({
      sites: { main: { locales: ['en'], defaultLocale: 'en' }, blog: { locales: ['en'], defaultLocale: 'en' } },
      globalLocales: ['en'],
    });
    for (const site of ['main', 'blog']) {
      await api.createContent({
        kind: 'page',
        site,
        collection: 'pages',
        type: 'puck',
        locales: {
          en: { pathname: '/', meta: { title: site, ogImage: '/assets/logo.png' }, content: { puckData: {} } },
        },
      });
    }

    expect(await usage(api, 'logo.png')).toEqual([
      { page: 'main: / (en)', field: 'meta.ogImage' },
      { page: 'blog: / (en)', field: 'meta.ogImage' },
    ]);
  });

  test('a Markdown page kept outside the content folder counts', async () => {
    const contentRoot = join(root, 'content');
    const mdxPages = join(root, 'docs');
    await mkdir(contentRoot, { recursive: true });
    await mkdir(mdxPages, { recursive: true });
    await writeFile(
      join(contentRoot, 'sites.json'),
      JSON.stringify({ sites: { default: { locales: ['en'], defaultLocale: 'en', mdxPages } }, globalLocales: ['en'] }),
    );
    await writeFile(
      join(mdxPages, 'getting-started.mdx'),
      [
        '---',
        'id: vx-getting-started',
        'created: 2026-01-01T00:00:00.000Z',
        'modified: 2026-01-01T00:00:00.000Z',
        'title: Getting started',
        '---',
        '',
        '![Sand](/assets/beach.png)',
        '',
      ].join('\n'),
    );
    FileSystemContentAPI.clearCaches();
    const api = await FileSystemContentAPI.create({ contentRoot, canvasDir: join(root, 'canvas') });

    expect(await usage(api, 'beach.png')).toEqual([{ page: '/getting-started (en)', field: 'content.mdx' }]);
  });

  // A second lookup on the asset operations matched the bare file name in .vxjson files only, so it
  // disagreed with this list. It was removed once and came back in a bulk change; keep it gone.
  test('the asset operations offer no second lookup that would answer differently', () => {
    expect('getUsage' in AssetOperations.prototype).toBe(false);
  });
});
