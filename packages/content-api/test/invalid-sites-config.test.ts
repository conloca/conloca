import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { FileSystemContentAPI } from '../src/filesystem-content-api';

describe('FileSystemContentAPI - Invalid sites.json handling', () => {
  let tempDir: string;
  let contentRoot: string;
  let canvasDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'conloca-test-'));
    contentRoot = join(tempDir, 'content');
    canvasDir = join(tempDir, 'canvas');

    // Create the directories
    await mkdir(contentRoot, { recursive: true });
    await mkdir(canvasDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('should handle empty object in sites.json', async () => {
    // Create sites.json with empty object
    await writeFile(join(contentRoot, 'sites.json'), '{}');

    const api = await FileSystemContentAPI.create({ contentRoot, canvasDir });

    // The API should create successfully without crashing
    expect(api).toBeDefined();

    // Try to get a site - should return null for non-existent site
    const site = api.getSite('default');
    expect(site).toBeNull();
  });
  it('should handle sites.json without sites property', async () => {
    // Create sites.json with old format (direct site entries)
    const oldFormat = {
      default: {
        locales: ['en'],
        defaultLocale: 'en',
      },
    };
    await writeFile(join(contentRoot, 'sites.json'), JSON.stringify(oldFormat, null, 2));

    const api = await FileSystemContentAPI.create({ contentRoot, canvasDir });

    // The API should create successfully without crashing
    expect(api).toBeDefined();

    // Try to get a site - should return null since sites property was missing
    const site = api.getSite('default');
    expect(site).toBeNull();
  });

  it('should handle sites.json without globalLocales', async () => {
    // Create sites.json without globalLocales
    const missingGlobalLocales = {
      sites: {
        default: {
          locales: ['en'],
          defaultLocale: 'en',
        },
      },
    };
    await writeFile(join(contentRoot, 'sites.json'), JSON.stringify(missingGlobalLocales, null, 2));

    const api = await FileSystemContentAPI.create({ contentRoot, canvasDir });

    // The API should create successfully without crashing
    expect(api).toBeDefined();

    // Should be able to get the site since sites property exists
    const site = api.getSite('default');
    expect(site).toBeDefined();
  });

  it('should handle malformed JSON in sites.json', async () => {
    // Create sites.json with invalid JSON
    await writeFile(join(contentRoot, 'sites.json'), '{ invalid json }');

    const api = await FileSystemContentAPI.create({ contentRoot, canvasDir });

    // The API should create successfully without crashing
    expect(api).toBeDefined();

    // Try to get a site - should return null
    const site = api.getSite('default');
    expect(site).toBeNull();
  });

  it('should log warnings for invalid structures', async () => {
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (msg: string) => warnings.push(msg);

    try {
      // Test empty object
      await writeFile(join(contentRoot, 'sites.json'), '{}');
      await FileSystemContentAPI.create({ contentRoot, canvasDir });

      expect(warnings.some((w) => w.includes('invalid structure'))).toBe(true);
      expect(warnings.some((w) => w.includes("Expected 'sites' property"))).toBe(true);
    } finally {
      console.warn = originalWarn;
    }
  });
});
