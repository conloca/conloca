import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AssetUsage } from '@conloca/content-api';
import { FileSystemContentAPI } from '@conloca/content-api/node';

/** The editor config the dev server boots with; each test sets where the site serves its media. */
const editorConfig: { assetRefBase?: string } = {};

// The handler reads its build-time config from Astro's virtual modules, which only resolve inside
// an Astro build.
mock.module('virtual:conloca-config', () => ({ default: editorConfig }));
mock.module('virtual:conloca-page-api', () => ({
  contentOptions: {},
  getDataCollection: async () => [],
  getPagesByPrefix: async () => [],
}));
mock.module('virtual:conloca-routing-config', () => ({ default: {} }));

const { ALL } = await import('../src/cms-handler.js');

const HANDLER_ENV = ['CONLOCA_CONTENT_ROOT', 'CONLOCA_CANVAS_DIR', 'CONLOCA_ASSETS_PATH'] as const;

/** The Media Library's "Used in" list on a site that serves its media folder somewhere other than /assets. */
describe('which pages use a picture, asked through the dev server', () => {
  let root: string;
  let contentRoot: string;
  const savedEnv: Partial<Record<(typeof HANDLER_ENV)[number], string>> = {};

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'conloca-asset-usage-'));
    contentRoot = join(root, 'content');
    await mkdir(contentRoot, { recursive: true });
    await writeFile(
      join(contentRoot, 'sites.json'),
      JSON.stringify({ sites: { main: { locales: ['en'], defaultLocale: 'en' } }, globalLocales: ['en'] }),
    );
    for (const key of HANDLER_ENV) savedEnv[key] = process.env[key];
    process.env.CONLOCA_CONTENT_ROOT = contentRoot;
    process.env.CONLOCA_CANVAS_DIR = join(root, 'canvas');
    process.env.CONLOCA_ASSETS_PATH = join(root, 'public', 'media');
  });

  afterEach(async () => {
    for (const key of HANDLER_ENV) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    delete editorConfig.assetRefBase;
    FileSystemContentAPI.clearCaches();
    await rm(root, { recursive: true, force: true });
  });

  test('finds a page that links the picture under the address the editor stores it at', async () => {
    editorConfig.assetRefBase = '/docs/media';
    const api = await FileSystemContentAPI.create({ contentRoot, canvasDir: join(root, 'canvas') });
    await api.createContent({
      kind: 'page',
      site: 'main',
      collection: 'pages',
      type: 'puck',
      locales: { en: { pathname: '/beach', meta: { title: 'Beach', ogImage: '/docs/media/beach.png' }, content: {} } },
    });

    const request = new Request('http://localhost:4321/__cms/api/assets/usage/beach.png');
    const response = await ALL({ params: { path: 'api/assets/usage/beach.png' }, request } as never);

    expect(((await response.json()) as { usage: AssetUsage[] }).usage).toEqual([
      { page: '/beach (en)', field: 'meta.ogImage' },
    ]);
  });
});
