import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileSystemContentAPI, readSitesConfig } from '../src/filesystem-content-api.js';
import type { ContentManifest, SitesConfig } from '../src/types.js';

describe('FileSystemContentAPI - Missing sites.json handling', () => {
  let tempDir: string;
  let contentRoot: string;
  let canvasDir: string;

  beforeEach(async () => {
    // Create temporary directories
    tempDir = join(tmpdir(), `conloca-test-${Date.now()}`);
    contentRoot = join(tempDir, 'content');
    canvasDir = join(tempDir, 'canvas');

    await mkdir(contentRoot, { recursive: true });
    await mkdir(canvasDir, { recursive: true });
  });

  afterEach(async () => {
    // Clean up
    await rm(tempDir, { recursive: true, force: true });
  });

  it('should not crash when sites.json is missing', async () => {
    // Do not create sites.json - it should be missing

    // This should not throw an error
    const api = await FileSystemContentAPI.create({ contentRoot, canvasDir });

    // API should be created successfully
    expect(api).toBeDefined();
  });

  it('should return empty sites config when sites.json is missing', async () => {
    // Do not create sites.json - it should be missing

    const api = await FileSystemContentAPI.create({ contentRoot, canvasDir });

    // Should return empty sites config
    expect(api.sitesConfig).toEqual({ sites: {}, globalLocales: ['en'] });
  });

  it('should log a warning when sites.json is missing', async () => {
    // Mock console.warn to capture the warning
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args.join(' '));
    };

    try {
      // Do not create sites.json - it should be missing
      await FileSystemContentAPI.create({ contentRoot, canvasDir });

      // Should have logged a warning
      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings.some((w) => w.includes('sites.json'))).toBe(true);
      expect(warnings.some((w) => w.includes('missing'))).toBe(true);
    } finally {
      // Restore console.warn
      console.warn = originalWarn;
    }
  });

  it('should allow basic operations with missing sites.json', async () => {
    // Do not create sites.json - it should be missing

    const api = await FileSystemContentAPI.create({ contentRoot, canvasDir });

    // Should be able to call basic methods without crashing
    // sitesConfig should be empty
    expect(api.sitesConfig).toEqual({ sites: {}, globalLocales: ['en'] });

    // Should return empty results for content queries
    const contents: ContentManifest[] = [];
    for (const content of api.listAllContent()) {
      contents.push(content);
    }
    expect(contents).toEqual([]);
  });

  it('should return null when accessing non-existent site', async () => {
    // Do not create sites.json - it should be missing

    const api = await FileSystemContentAPI.create({ contentRoot, canvasDir });

    // Attempting to get a non-existent site should return null
    const site = api.getSite('default');
    expect(site).toBeNull();
  });

  it('reports a malformed sites.json as malformed, not as missing', async () => {
    // Tolerating a malformed file is deliberate ("Handle invalid sites.json gracefully") and is left
    // alone. The diagnosis was not: one catch covered both reading and
    // parsing, so a trailing comma warned that the file was MISSING while
    // naming a path where it plainly sits — and every page silently
    // disappeared from every site.
    await writeFile(join(contentRoot, 'sites.json'), '{ "sites": {}, "globalLocales": ["en"], }');

    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (msg: string) => warnings.push(String(msg));
    try {
      await readSitesConfig(contentRoot);
    } finally {
      console.warn = originalWarn;
    }

    expect(warnings.some((w) => w.includes('not valid JSON'))).toBe(true);
    expect(warnings.some((w) => w.includes('is missing at'))).toBe(false);
  });

  it('degrades to the default config when sites.json parses to null', async () => {
    // `null` is valid JSON, so it sails past the parse catch — and the
    // structure checks then read `.sites` off it and threw, breaking the
    // safe-default contract this function has always kept for a file it
    // cannot use (plugin-spa relies on readSitesConfig never throwing).
    await writeFile(join(contentRoot, 'sites.json'), 'null');

    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (msg: string) => warnings.push(String(msg));
    let config: SitesConfig;
    try {
      config = await readSitesConfig(contentRoot);
    } finally {
      console.warn = originalWarn;
    }

    expect(config).toEqual({ sites: {}, globalLocales: ['en'] });
    expect(warnings.some((w) => w.includes('invalid structure'))).toBe(true);
  });

  it('should not throw error when accessing fragments (special case)', async () => {
    // Do not create sites.json - it should be missing

    const api = await FileSystemContentAPI.create({ contentRoot, canvasDir });

    // fragments are a special case and should work even with empty config
    expect(api.fragments).toBeDefined();
  });
});
