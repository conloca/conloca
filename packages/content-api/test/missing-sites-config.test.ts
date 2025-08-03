import { mkdir, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileSystemContentAPI } from '../src/filesystem-content-api';

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
    console.warn = (...args: any[]) => {
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
    const contents: any[] = [];
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

  it('should not throw error when accessing blocks (special case)', async () => {
    // Do not create sites.json - it should be missing

    const api = await FileSystemContentAPI.create({ contentRoot, canvasDir });

    // blocks is a special case and should work even with empty config
    expect(api.blocks).toBeDefined();
  });
});
