import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { FileSystemContentAPI } from '../src/filesystem-content-api.js';
import type { SitesConfig } from '../src/types.js';
import { testTempDir } from './test-temp-dir.js';

describe('Derived fields after reindex', () => {
  let tempDir: string;
  let api: FileSystemContentAPI;

  const sitesConfig: SitesConfig = {
    sites: {
      testsite: {
        locales: ['en', 'fr'],
        defaultLocale: 'en',
      },
    },
    globalLocales: ['en', 'fr'],
  };

  beforeEach(async () => {
    tempDir = testTempDir('derived-fields-test');
    await mkdir(tempDir, { recursive: true });
    await mkdir(join(tempDir, 'testsite/pages'), { recursive: true });
    await mkdir(join(tempDir, 'fragments/components'), { recursive: true });
    await writeFile(join(tempDir, 'sites.json'), JSON.stringify(sitesConfig));

    api = await FileSystemContentAPI.create({ contentRoot: tempDir });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test('pages - pathname is derived from filesystem path after reindex', async () => {
    // Create pages with specific pathnames
    const createResult1 = await api.createContent({
      kind: 'page',
      site: 'testsite',
      collection: 'pages',
      type: 'puck',
      locales: {
        en: {
          pathname: '/about',
          meta: { title: 'About Us' },
          content: { puckData: { root: {} } },
        },
        fr: {
          pathname: '/a-propos',
          meta: { title: 'À Propos' },
          content: { puckData: { root: {} } },
        },
      },
    });

    const createResult2 = await api.createContent({
      kind: 'page',
      site: 'testsite',
      collection: 'pages',
      type: 'puck',
      locales: {
        en: {
          pathname: '/services/consulting',
          meta: { title: 'Consulting Services' },
          content: { puckData: { root: {} } },
        },
      },
    });

    expect(createResult1.success).toBe(true);
    expect(createResult2.success).toBe(true);
    const id1 = createResult1.id!;
    const id2 = createResult2.id!;

    // Create a new API instance to simulate fresh startup with reindexing
    const newApi = await FileSystemContentAPI.create({ contentRoot: tempDir });

    // Verify pathname is correctly derived from filesystem
    const content1 = await newApi.getContent(id1);
    expect(content1).toBeDefined();
    expect(content1!.locales.en.pathname).toBe('/about');
    expect(content1!.locales.fr.pathname).toBe('/a-propos');

    const content2 = await newApi.getContent(id2);
    expect(content2).toBeDefined();
    expect(content2!.locales.en.pathname).toBe('/services/consulting');

    // Also verify with getLocalized
    const en1 = await newApi.getLocalized(id1, 'en');
    expect(en1!.localized.pathname).toBe('/about');

    const fr1 = await newApi.getLocalized(id1, 'fr');
    expect(fr1!.localized.pathname).toBe('/a-propos');

    const en2 = await newApi.getLocalized(id2, 'en');
    expect(en2!.localized.pathname).toBe('/services/consulting');
  });

  test('fragments - name is derived from filesystem path after reindex', async () => {
    // Create fragments with specific names
    const createResult1 = await api.createContent({
      kind: 'fragment',
      collection: 'components',
      type: 'mdx',
      name: 'hero-section',
      locales: {
        en: {
          meta: { title: 'Hero Section' },
          content: { mdx: '# Welcome' },
        },
        fr: {
          meta: { title: 'Section Héro' },
          content: { mdx: '# Bienvenue' },
        },
      },
    });

    const createResult2 = await api.createContent({
      kind: 'fragment',
      collection: 'components',
      type: 'mdx',
      name: 'footer-links',
      locales: {
        en: {
          meta: { title: 'Footer Links' },
          content: { mdx: '- [Home](/)\n- [About](/about)' },
        },
      },
    });

    expect(createResult1.success).toBe(true);
    expect(createResult2.success).toBe(true);
    const id1 = createResult1.id!;
    const id2 = createResult2.id!;

    // Create a new API instance to simulate fresh startup with reindexing
    const newApi = await FileSystemContentAPI.create({ contentRoot: tempDir });

    // Verify name is correctly derived from filesystem
    const content1 = await newApi.getContent(id1);
    expect(content1).toBeDefined();
    expect(content1!.locales.en.name).toBe('hero-section');
    expect(content1!.locales.fr.name).toBe('hero-section');

    const content2 = await newApi.getContent(id2);
    expect(content2).toBeDefined();
    expect(content2!.locales.en.name).toBe('footer-links');

    // Also verify with getLocalized
    const en1 = await newApi.getLocalized(id1, 'en');
    expect(en1!.localized.name).toBe('hero-section');

    const fr1 = await newApi.getLocalized(id1, 'fr');
    expect(fr1!.localized.name).toBe('hero-section');

    const en2 = await newApi.getLocalized(id2, 'en');
    expect(en2!.localized.name).toBe('footer-links');
  });

  test('derived fields are correct even after manual reindex', async () => {
    // Create content
    const pageResult = await api.createContent({
      kind: 'page',
      site: 'testsite',
      collection: 'pages',
      type: 'puck',
      locales: {
        en: {
          pathname: '/manual-test',
          meta: { title: 'Manual Test' },
          content: { puckData: { root: {} } },
        },
      },
    });

    const fragmentResult = await api.createContent({
      kind: 'fragment',
      collection: 'components',
      type: 'mdx',
      name: 'manual-fragment',
      locales: {
        en: {
          meta: { title: 'Manual Fragment' },
          content: { mdx: '# Manual' },
        },
      },
    });

    const pageId = pageResult.id!;
    const fragmentId = fragmentResult.id!;

    // Call reindex manually
    await api.reindex();

    // Verify derived fields are still correct
    const page = await api.getLocalized(pageId, 'en');
    expect(page!.localized.pathname).toBe('/manual-test');

    const fragment = await api.getLocalized(fragmentId, 'en');
    expect(fragment!.localized.name).toBe('manual-fragment');
  });
});
