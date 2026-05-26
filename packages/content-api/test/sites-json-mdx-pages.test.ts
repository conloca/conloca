import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { FileSystemContentAPI } from '../src/filesystem-content-api';

/**
 * Two behaviors covered:
 *
 * 1. `mdxPages` declared per-site in sites.json is the canonical home for
 *    mdx-type page configuration — the content-api reads it on
 *    `FileSystemContentAPI.create()` without the caller having to pass
 *    `mdxPagesRoot` as an option.
 *
 * 2. When NO site in sites.json declares `mdxPages` (and no caller-provided
 *    `mdxPagesRoot` either), `.mdx` files live alongside `.vxjson` Puck
 *    pages under `{contentRoot}/{site}/{collection}/`. The parser detects
 *    `type:'mdx'` from the file extension, and the round-trip path
 *    computation puts new files at `{basePath}.{locale}.mdx`.
 */

async function writeSitesJson(contentRoot: string, json: unknown): Promise<void> {
  await writeFile(join(contentRoot, 'sites.json'), JSON.stringify(json, null, 2));
}

async function writeMdxPageFile(absoluteDir: string, filename: string, frontmatterId: string): Promise<string> {
  await mkdir(absoluteDir, { recursive: true });
  const filePath = join(absoluteDir, filename);
  await writeFile(
    filePath,
    `---
id: ${frontmatterId}
created: 2026-01-01T00:00:00.000Z
modified: 2026-01-01T00:00:00.000Z
title: ${filename}
---

# Hello from ${filename}
`,
  );
  return filePath;
}

describe('sites.json mdxPages configuration', () => {
  let tempDir: string;
  let contentRoot: string;
  let mdxPages: string;
  let canvasDir: string;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `conloca-mdxpages-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    contentRoot = join(tempDir, 'content');
    mdxPages = join(tempDir, 'docs');
    canvasDir = join(tempDir, 'canvas');
    await mkdir(contentRoot, { recursive: true });
    await mkdir(canvasDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
    FileSystemContentAPI.clearCaches();
  });

  test('reads mdxPages from the site entry in sites.json', async () => {
    await writeSitesJson(contentRoot, {
      sites: {
        default: { locales: ['en'], defaultLocale: 'en', mdxPages },
      },
      globalLocales: ['en'],
    });
    const filePath = await writeMdxPageFile(mdxPages, 'getting-started.mdx', 'vx-gs-mdxroot');

    const api = await FileSystemContentAPI.create({ contentRoot, canvasDir });
    const parsed = api.parseFilePath(filePath);

    expect(parsed).not.toBeNull();
    expect(parsed?.kind).toBe('page');
    expect(parsed?.site).toBe('default');
    expect(parsed?.collection).toBe('pages');
    expect(parsed?.pathname).toBe('/getting-started');
    expect(parsed?.locale).toBe('en');
  });

  test('caller-provided mdxPagesRoot wins over sites.json', async () => {
    const overrideRoot = join(tempDir, 'override');
    await mkdir(overrideRoot, { recursive: true });
    await writeSitesJson(contentRoot, {
      sites: {
        default: { locales: ['en'], defaultLocale: 'en', mdxPages },
      },
      globalLocales: ['en'],
    });
    const filePath = await writeMdxPageFile(overrideRoot, 'override-doc.mdx', 'vx-override-mdxroot');

    const api = await FileSystemContentAPI.create({ contentRoot, canvasDir, mdxPagesRoot: overrideRoot });
    const parsed = api.parseFilePath(filePath);

    expect(parsed).not.toBeNull();
    expect(parsed?.kind).toBe('page');
    expect(parsed?.pathname).toBe('/override-doc');
  });

  test('falls back to pages-next-to-puck when no site declares mdxPages', async () => {
    await writeSitesJson(contentRoot, {
      sites: {
        default: { locales: ['en'], defaultLocale: 'en' },
      },
      globalLocales: ['en'],
    });

    // Drop an mdx page next to where Puck .vxjson pages would live.
    const pagesDir = join(contentRoot, 'default', 'pages');
    const filePath = await writeMdxPageFile(pagesDir, 'about.en.mdx', 'vx-about-fallback');

    const api = await FileSystemContentAPI.create({ contentRoot, canvasDir });
    const parsed = api.parseFilePath(filePath);

    expect(parsed).not.toBeNull();
    expect(parsed?.kind).toBe('page');
    expect(parsed?.site).toBe('default');
    expect(parsed?.collection).toBe('pages');
    expect(parsed?.pathname).toBe('/about');
    expect(parsed?.locale).toBe('en');
  });

  test('fallback path picks up mdx pages in scan + getContent', async () => {
    await writeSitesJson(contentRoot, {
      sites: {
        default: { locales: ['en'], defaultLocale: 'en' },
      },
      globalLocales: ['en'],
    });

    const pagesDir = join(contentRoot, 'default', 'pages');
    await writeMdxPageFile(pagesDir, 'guide.en.mdx', 'vx-guide-fallback');

    const api = await FileSystemContentAPI.create({ contentRoot, canvasDir });
    const content = await api.getContent('vx-guide-fallback');

    expect(content).not.toBeNull();
    expect(content?.kind).toBe('page');
    expect(content?.type).toBe('mdx');
    expect(content?.site).toBe('default');
    expect(content?.collection).toBe('pages');
    expect(content?.locales.en?.pathname).toBe('/guide');
  });

  test('mdx-pages support stays dormant when no mdxPages AND no .mdx pages exist', async () => {
    await writeSitesJson(contentRoot, {
      sites: {
        default: { locales: ['en'], defaultLocale: 'en' },
      },
      globalLocales: ['en'],
    });

    // Only a Puck-format page in the tree.
    const pagesDir = join(contentRoot, 'default', 'pages');
    await mkdir(pagesDir, { recursive: true });
    await writeFile(
      join(pagesDir, 'home.en.vxjson'),
      JSON.stringify(
        {
          id: 'vx-home-puck',
          type: 'puck',
          created: '2026-01-01T00:00:00.000Z',
          modified: '2026-01-01T00:00:00.000Z',
          meta: { title: 'Home' },
          content: { puckData: { content: [], root: { props: {} }, zones: {} } },
        },
        null,
        2,
      ),
    );

    const api = await FileSystemContentAPI.create({ contentRoot, canvasDir });
    const content = await api.getContent('vx-home-puck');

    expect(content).not.toBeNull();
    expect(content?.type).toBe('puck');
  });
});
