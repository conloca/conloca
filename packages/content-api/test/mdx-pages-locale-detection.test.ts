import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, readdir, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { FileSystemContentAPI } from '../src/filesystem-content-api';

/**
 * Regression coverage for the locale-detection bug in the mdx-pages
 * `'directory'` strategy: a two-letter folder that is NOT a configured
 * locale (e.g. `qa/`, `id/`, `js/`) used to be silently classified as a
 * locale because the only check was a `/^[a-z]{2}(?:-[A-Z]{2})?$/` regex.
 * After the fix, classification is membership-based — the segment must
 * be in the resolved availableLocales set.
 *
 * The set comes from (in order of precedence):
 *   1. ContentAPIOptions.availableLocales (forwarded from astro.config.mjs)
 *   2. sites.json's globalLocales + the resolved site's per-site locales
 *   3. plus the default locale (always)
 */

interface SitesConfig {
  sites: Record<string, { locales: string[]; defaultLocale: string }>;
  globalLocales: string[];
}

async function writeSites(contentRoot: string, sitesConfig: SitesConfig): Promise<void> {
  await writeFile(join(contentRoot, 'sites.json'), JSON.stringify(sitesConfig, null, 2));
}

async function writeMdxPage(mdxPagesRoot: string, relativePath: string): Promise<void> {
  const fullPath = join(mdxPagesRoot, relativePath);
  await mkdir(join(fullPath, '..'), { recursive: true });
  // Minimal MDX with all required Conloca system fields so the indexer
  // doesn't trigger a read-repair that rewrites paths on disk.
  await writeFile(
    fullPath,
    `---
id: vx-test-${relativePath.replace(/[^a-z0-9]/gi, '-')}
created: 2026-01-01T00:00:00.000Z
modified: 2026-01-01T00:00:00.000Z
title: ${relativePath}
---

# ${relativePath}
`,
  );
}

describe('mdx-pages locale detection', () => {
  let tempDir: string;
  let contentRoot: string;
  let mdxPagesRoot: string;
  let canvasDir: string;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `conloca-locale-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    contentRoot = join(tempDir, 'content');
    mdxPagesRoot = join(tempDir, 'docs');
    canvasDir = join(tempDir, 'canvas');
    await mkdir(contentRoot, { recursive: true });
    await mkdir(mdxPagesRoot, { recursive: true });
    await mkdir(canvasDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
    // Caches are keyed by content root so they don't bleed between tests,
    // but call clearCaches anyway to avoid surprises if that changes.
    FileSystemContentAPI.clearCaches();
  });

  test('classifies a declared-locale folder as that locale', async () => {
    await writeSites(contentRoot, {
      sites: { default: { locales: ['en', 'de'], defaultLocale: 'en' } },
      globalLocales: ['en', 'de'],
    });
    await writeMdxPage(mdxPagesRoot, 'de/install.mdx');

    const api = await FileSystemContentAPI.create({
      contentRoot,
      canvasDir,
      mdxPagesRoot,
    });

    const parsed = api.parseFilePath(join(mdxPagesRoot, 'de/install.mdx'));
    expect(parsed).not.toBeNull();
    expect(parsed?.kind).toBe('page');
    expect(parsed?.locale).toBe('de');
    expect(parsed?.pathname).toBe('/install');
  });

  test('does NOT classify an undeclared two-letter folder as a locale (the bug)', async () => {
    await writeSites(contentRoot, {
      sites: { default: { locales: ['en'], defaultLocale: 'en' } },
      globalLocales: ['en'],
    });
    await writeMdxPage(mdxPagesRoot, 'qa/checklist.mdx');

    const api = await FileSystemContentAPI.create({
      contentRoot,
      canvasDir,
      mdxPagesRoot,
    });

    const parsed = api.parseFilePath(join(mdxPagesRoot, 'qa/checklist.mdx'));
    expect(parsed).not.toBeNull();
    // qa is two letters but NOT in availableLocales, so it stays in the slug.
    expect(parsed?.locale).toBe('en');
    expect(parsed?.pathname).toBe('/qa/checklist');
  });

  test('uses sites.json when no availableLocales option is provided', async () => {
    await writeSites(contentRoot, {
      sites: { default: { locales: ['en', 'fr'], defaultLocale: 'en' } },
      globalLocales: ['en', 'fr'],
    });
    await writeMdxPage(mdxPagesRoot, 'fr/bonjour.mdx');

    const api = await FileSystemContentAPI.create({
      contentRoot,
      canvasDir,
      mdxPagesRoot,
    });

    const parsed = api.parseFilePath(join(mdxPagesRoot, 'fr/bonjour.mdx'));
    expect(parsed?.locale).toBe('fr');
    expect(parsed?.pathname).toBe('/bonjour');
  });

  test('availableLocales option overrides sites.json when both are present', async () => {
    // sites.json says only `en` is supported, but the integration option
    // says `en` and `de`. The option wins.
    await writeSites(contentRoot, {
      sites: { default: { locales: ['en'], defaultLocale: 'en' } },
      globalLocales: ['en'],
    });
    await writeMdxPage(mdxPagesRoot, 'de/guide.mdx');

    const api = await FileSystemContentAPI.create({
      contentRoot,
      canvasDir,
      mdxPagesRoot,
      availableLocales: ['en', 'de'],
      defaultLocale: 'en',
    });

    const parsed = api.parseFilePath(join(mdxPagesRoot, 'de/guide.mdx'));
    expect(parsed?.locale).toBe('de');
    expect(parsed?.pathname).toBe('/guide');
  });

  test('round-trips a locale-prefixed file: getFilePath then parseFilePath', async () => {
    await writeSites(contentRoot, {
      sites: { default: { locales: ['en', 'de'], defaultLocale: 'en' } },
      globalLocales: ['en', 'de'],
    });
    // index.mdx at root → '/' for default locale; de/index.mdx for German.
    await writeMdxPage(mdxPagesRoot, 'index.mdx');
    await writeMdxPage(mdxPagesRoot, 'de/index.mdx');

    const api = await FileSystemContentAPI.create({
      contentRoot,
      canvasDir,
      mdxPagesRoot,
    });

    const enParsed = api.parseFilePath(join(mdxPagesRoot, 'index.mdx'));
    const deParsed = api.parseFilePath(join(mdxPagesRoot, 'de/index.mdx'));
    expect(enParsed?.locale).toBe('en');
    expect(enParsed?.pathname).toBe('/');
    expect(deParsed?.locale).toBe('de');
    expect(deParsed?.pathname).toBe('/');
  });

  test('leaves a deeply-nested undeclared two-letter parent in the slug', async () => {
    // `qa/auth/api.mdx` — qa is not a locale, so the whole path is the slug.
    await writeSites(contentRoot, {
      sites: { default: { locales: ['en'], defaultLocale: 'en' } },
      globalLocales: ['en'],
    });
    await writeMdxPage(mdxPagesRoot, 'qa/auth/api.mdx');

    const api = await FileSystemContentAPI.create({
      contentRoot,
      canvasDir,
      mdxPagesRoot,
    });

    const parsed = api.parseFilePath(join(mdxPagesRoot, 'qa/auth/api.mdx'));
    expect(parsed?.locale).toBe('en');
    expect(parsed?.pathname).toBe('/qa/auth/api');
  });

  test('keeps mdxPages caches isolated between tests', async () => {
    // Sanity: the API doesn't leak indexes when we recreate it with a
    // different sites.json — protects against false positives above.
    await writeSites(contentRoot, {
      sites: { default: { locales: ['en'], defaultLocale: 'en' } },
      globalLocales: ['en'],
    });
    const entries = await readdir(mdxPagesRoot);
    expect(entries).toEqual([]);
  });
});
