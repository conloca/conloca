import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AssetEntry } from '@conloca/content-api';
import { FileSystemContentAPI } from '@conloca/content-api/node';

// The handler reads its build-time config from Astro's virtual modules, which only resolve inside
// an Astro build; the asset routes use none of it.
mock.module('virtual:conloca-config', () => ({ default: {} }));
mock.module('virtual:conloca-page-api', () => ({
  contentOptions: {},
  getDataCollection: async () => [],
  getPagesByPrefix: async () => [],
}));
mock.module('virtual:conloca-routing-config', () => ({ default: {} }));

const { ALL } = await import('../src/cms-handler.js');

/** A 1×1 PNG, so reading an image's details finds real dimensions and caches them. */
const PNG = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='),
  (char) => char.charCodeAt(0),
);

/** Names that differ from the stored filenames, so an entry that lost its uploaded name shows. */
const NAMES = ['Alpha Shot.png', 'Beta Shot.png', 'Gamma Shot.png', 'Delta Shot.png', 'Epsilon Shot.png'];

const HANDLER_ENV = ['CONLOCA_CONTENT_ROOT', 'CONLOCA_CANVAS_DIR', 'CONLOCA_ASSETS_PATH'] as const;

/** Parallel media writes must keep every upload's metadata and merge independent field saves. */
describe('media writes that reach the dev server at the same time', () => {
  let root: string;
  let assetsPath: string;
  const savedEnv: Partial<Record<(typeof HANDLER_ENV)[number], string>> = {};

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'conloca-asset-writes-'));
    const contentRoot = join(root, 'content');
    await mkdir(contentRoot, { recursive: true });
    await writeFile(
      join(contentRoot, 'sites.json'),
      JSON.stringify({ sites: { main: { locales: ['en'], defaultLocale: 'en' } }, globalLocales: ['en'] }),
    );
    for (const key of HANDLER_ENV) savedEnv[key] = process.env[key];
    process.env.CONLOCA_CONTENT_ROOT = contentRoot;
    process.env.CONLOCA_CANVAS_DIR = join(root, 'canvas');
    assetsPath = join(root, 'assets');
    process.env.CONLOCA_ASSETS_PATH = assetsPath;
  });

  afterEach(async () => {
    for (const key of HANDLER_ENV) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    FileSystemContentAPI.clearCaches();
    await rm(root, { recursive: true, force: true });
  });

  /** One request to the CMS API, the way Astro hands it to the catch-all route. */
  function cms(path: string, init?: RequestInit): Promise<Response> {
    const request = new Request(`http://localhost:4321/__cms/api/${path}`, init);
    return ALL({ params: { path: `api/${path.split('?')[0]}` }, request } as never) as Promise<Response>;
  }

  function upload(name: string): Promise<Response> {
    const form = new FormData();
    form.append('file', new File([PNG], name, { type: 'image/png' }));
    return cms('assets/upload', { method: 'POST', body: form });
  }

  test('every image chosen in one Upload dialog keeps its uploaded name and date', async () => {
    const responses = await Promise.all(NAMES.map(upload));
    expect(responses.map((response) => response.status)).toEqual(NAMES.map(() => 201));
    const uploaded = await Promise.all(responses.map(async (response) => (await response.json()) as AssetEntry));

    const saved = await Promise.all(
      uploaded.map(async ({ filename }) => (await (await cms(`assets/meta/${filename}`)).json()) as AssetEntry),
    );
    expect(saved.map(({ originalName, uploadedAt }) => ({ originalName, uploadedAt }))).toEqual(
      uploaded.map(({ originalName, uploadedAt }) => ({ originalName, uploadedAt })),
    );
  });

  test('alt text and tags saved at the same time are both kept', async () => {
    const { filename } = (await (await upload('Hero Shot.png')).json()) as AssetEntry;
    const saveDetails = (body: object) =>
      cms(`assets/meta/${filename}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

    await Promise.all([saveDetails({ alt: 'A hero shot' }), saveDetails({ tags: ['hero'] })]);

    const asset = (await (await cms(`assets/meta/${filename}`)).json()) as AssetEntry;
    expect({ alt: asset.alt, tags: asset.tags }).toEqual({ alt: 'A hero shot', tags: ['hero'] });
  });
});
