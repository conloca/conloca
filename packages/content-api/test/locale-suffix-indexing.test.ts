import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { FileSystemContentAPI } from '../src/filesystem-content-api.js';
import type { SitesConfig, VXJSONFile } from '../src/types.js';
import { VXJSON } from '../src/vxjson.js';
import { testTempDir } from './test-temp-dir.js';

const sitesConfig: SitesConfig = {
  sites: { testsite: { locales: ['en', 'en-US'], defaultLocale: 'en' } },
  globalLocales: ['en', 'en-US'],
};

function pageBytes(id: string, title: string): string {
  const file: VXJSONFile = {
    id,
    type: 'puck',
    created: '2026-01-01T00:00:00.000Z',
    modified: '2026-01-02T00:00:00.000Z',
    meta: { title },
    content: { puckData: { root: {} } },
  };
  return VXJSON.serialize(file);
}

describe('locale suffix parsing on index', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = testTempDir('locale-suffix');
    await mkdir(join(tempDir, 'testsite/pages'), { recursive: true });
    await writeFile(join(tempDir, 'sites.json'), JSON.stringify(sitesConfig));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
    FileSystemContentAPI.clearCaches();
  });

  test('a page whose filename carries a region-qualified locale indexes under that locale', async () => {
    await writeFile(join(tempDir, 'testsite/pages/about.en-US.vxjson'), pageBytes('vx-about-enus', 'About'));

    const api = await FileSystemContentAPI.create({ contentRoot: tempDir });

    expect(api.getSite('testsite')?.getByPathname('/about', 'en-US')?.id).toBe('vx-about-enus');
    // It must NOT land under the fallback locale, which is what hid it before.
    expect(api.getSite('testsite')?.getByPathname('/about', 'en')).toBeNull();
  });

  test('a page file with no locale suffix is skipped instead of indexed under a fallback locale', async () => {
    await writeFile(join(tempDir, 'testsite/pages/orphan.vxjson'), pageBytes('vx-orphan', 'Orphan'));
    await writeFile(join(tempDir, 'testsite/pages/about.en.vxjson'), pageBytes('vx-about', 'About'));

    const api = await FileSystemContentAPI.create({ contentRoot: tempDir });
    const ids = Array.from(api.listAllContent()).map((manifest) => manifest.id);

    expect(ids).toContain('vx-about');
    expect(ids).not.toContain('vx-orphan');
  });

  test('a fragment with a region-qualified locale keeps its filename and indexes under that locale', async () => {
    await mkdir(join(tempDir, 'fragments/general'), { recursive: true });
    await writeFile(
      join(tempDir, 'fragments/general/hero.en-US.mdx'),
      [
        '---',
        'title: Hero',
        'id: vx-hero-enus',
        "created: '2026-01-01T00:00:00.000Z'",
        "modified: '2026-01-02T00:00:00.000Z'",
        '---',
        'Hello',
        '',
      ].join('\n'),
    );

    const api = await FileSystemContentAPI.create({ contentRoot: tempDir });

    expect(api.fragments.getByName('general', 'hero', 'en-US')?.id).toBe('vx-hero-enus');
    // The rename repair is for files with NO locale — it must not fire here.
    expect(await readdir(join(tempDir, 'fragments/general'))).toEqual(['hero.en-US.mdx']);
  });

  test('a fragment with a non-locale suffix takes the rename repair instead of indexing under a fake locale', async () => {
    await mkdir(join(tempDir, 'fragments/general'), { recursive: true });
    await writeFile(
      join(tempDir, 'fragments/general/hero.v2.mdx'),
      [
        '---',
        'title: Hero v2',
        'id: vx-hero-v2',
        "created: '2026-01-01T00:00:00.000Z'",
        "modified: '2026-01-02T00:00:00.000Z'",
        '---',
        'Hello',
        '',
      ].join('\n'),
    );

    const api = await FileSystemContentAPI.create({ contentRoot: tempDir });

    // 'v2' is not a locale, so the whole filename is the name and the file
    // gets the missing-locale repair: renamed to carry the default locale.
    expect(await readdir(join(tempDir, 'fragments/general'))).toEqual(['hero.v2.en.mdx']);
    expect(api.fragments.getByName('general', 'hero.v2', 'en')?.id).toBe('vx-hero-v2');
  });

  test('a data entry with an upper-case locale indexes under that locale with its name', async () => {
    await mkdir(join(tempDir, 'data/testimonials'), { recursive: true });
    await writeFile(
      join(tempDir, 'data/testimonials/quote.EN.json'),
      JSON.stringify({
        id: 'vx-quote-en',
        type: 'json',
        created: '2026-01-01T00:00:00.000Z',
        modified: '2026-01-02T00:00:00.000Z',
        meta: { title: 'Quote' },
        data: { body: 'Great' },
      }),
    );

    const api = await FileSystemContentAPI.create({ contentRoot: tempDir });

    expect(api.data.getByName('testimonials', 'quote', 'EN')?.id).toBe('vx-quote-en');
  });

  test('parseFilePath maps an index page to the pathname the indexer filed it under', async () => {
    const file = join(tempDir, 'testsite/pages/index.en.vxjson');
    await writeFile(file, pageBytes('vx-home', 'Home'));

    const api = await FileSystemContentAPI.create({ contentRoot: tempDir });

    expect(api.parseFilePath(file)?.pathname).toBe('/');
    expect(api.getSite('testsite')?.getByPathname('/', 'en')?.id).toBe('vx-home');
  });

  test('reindex removes a deleted index page from the pathname index', async () => {
    const file = join(tempDir, 'testsite/pages/index.en.vxjson');
    await writeFile(file, pageBytes('vx-home', 'Home'));

    const api = await FileSystemContentAPI.create({ contentRoot: tempDir });
    expect(api.getSite('testsite')?.getByPathname('/', 'en')?.id).toBe('vx-home');

    await rm(file);
    const result = await api.reindex([file], { handleDeletions: true });

    expect(result.filesDeleted).toBe(1);
    expect(api.getSite('testsite')?.getByPathname('/', 'en')).toBeNull();
  });
});
