import { describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type PageWriteError, writePage } from '../src/lib/page-write.js';

const VALID_SITES = JSON.stringify({
  sites: { default: { locales: ['en'], defaultLocale: 'en' } },
  globalLocales: ['en'],
});
const NO_SITES = JSON.stringify({ sites: {}, globalLocales: ['en'] });
const SITE_WITHOUT_DEFAULT_LOCALE = JSON.stringify({
  sites: { default: { locales: ['en'] } },
  globalLocales: ['en'],
});

async function makeContentRoot(prefix: string, sites = VALID_SITES): Promise<{ dir: string; contentRoot: string }> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  const contentRoot = join(dir, 'content');
  await Bun.write(join(contentRoot, 'sites.json'), sites);
  return { dir, contentRoot };
}

describe('writePage', () => {
  test('writes an empty Puck page in the default locale and reports its file', async () => {
    const { dir, contentRoot } = await makeContentRoot('conloca-page-write-');
    try {
      const result = await writePage({
        contentRoot,
        site: 'default',
        collection: 'pages',
        pathname: '/about',
        title: 'About',
      });
      expect(result.id).toMatch(/^vx-[A-Za-z0-9_-]{8}$/);
      expect(result.pathname).toBe('/about');
      expect(result.filePath).toBe(join(contentRoot, 'default', 'pages', 'about.en.vxjson'));
      const parsed = JSON.parse(await readFile(result.filePath, 'utf-8'));
      expect(parsed.meta.title).toBe('About');
      expect(parsed.content.puckData).toEqual({ root: {}, content: [], zones: {} });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("'/' lands in index.<locale>.vxjson and custom Puck data is kept", async () => {
    const { dir, contentRoot } = await makeContentRoot('conloca-page-write-home-');
    try {
      const puckData = { root: {}, content: [{ type: 'Heading', props: { id: 'Heading-1', text: 'Hi' } }], zones: {} };
      const result = await writePage({
        contentRoot,
        site: 'default',
        collection: 'pages',
        pathname: '/',
        title: 'Home',
        puckData,
      });
      expect(result.filePath).toBe(join(contentRoot, 'default', 'pages', 'index.en.vxjson'));
      const parsed = JSON.parse(await readFile(result.filePath, 'utf-8'));
      expect(parsed.content.puckData).toEqual(puckData);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('rejects an unknown site with a field-tagged error', async () => {
    const { dir, contentRoot } = await makeContentRoot('conloca-page-write-site-');
    try {
      await expect(
        writePage({ contentRoot, site: 'blog', collection: 'pages', pathname: '/x', title: 'X' }),
      ).rejects.toMatchObject({ reason: 'unknown_site', field: 'site' } satisfies Partial<PageWriteError>);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('rejects a pathname without a leading slash', async () => {
    const { dir, contentRoot } = await makeContentRoot('conloca-page-write-path-');
    try {
      await expect(
        writePage({ contentRoot, site: 'default', collection: 'pages', pathname: 'about', title: 'X' }),
      ).rejects.toMatchObject({
        reason: 'missing_leading_slash',
        field: 'pathname',
      } satisfies Partial<PageWriteError>);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('rejects a site that has no defaultLocale', async () => {
    const { dir, contentRoot } = await makeContentRoot('conloca-page-write-nolocale-', SITE_WITHOUT_DEFAULT_LOCALE);
    try {
      await expect(
        writePage({ contentRoot, site: 'default', collection: 'pages', pathname: '/x', title: 'X' }),
      ).rejects.toMatchObject({ reason: 'no_default_locale', field: 'site' } satisfies Partial<PageWriteError>);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('tells an empty sites.json apart from an unknown site', async () => {
    const { dir, contentRoot } = await makeContentRoot('conloca-page-write-nosites-', NO_SITES);
    try {
      await expect(
        writePage({ contentRoot, site: 'default', collection: 'pages', pathname: '/x', title: 'X' }),
      ).rejects.toMatchObject({ reason: 'no_sites_configured', field: 'site' } satisfies Partial<PageWriteError>);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('reports a refused write when the pathname is already taken', async () => {
    const { dir, contentRoot } = await makeContentRoot('conloca-page-write-dup-');
    try {
      await writePage({ contentRoot, site: 'default', collection: 'pages', pathname: '/about', title: 'About' });
      // The content API tags no input field for a taken pathname, so the
      // reason is all a caller gets to branch on.
      await expect(
        writePage({ contentRoot, site: 'default', collection: 'pages', pathname: '/about', title: 'About' }),
      ).rejects.toMatchObject({ reason: 'write_failed' } satisfies Partial<PageWriteError>);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
