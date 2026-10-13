import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileSystemContentAPI } from '../src/filesystem-content-api.js';

describe('MDX file parsing', () => {
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
    await mkdir(join(contentRoot, 'fragments', 'headers'), { recursive: true });

    // Create sites.json
    const sitesConfig = {
      sites: {
        default: {
          locales: ['en'],
          defaultLocale: 'en',
        },
      },
      globalLocales: ['en'],
    };
    await writeFile(join(contentRoot, 'sites.json'), JSON.stringify(sitesConfig, null, 2));
  });

  afterEach(async () => {
    // Clean up
    await rm(tempDir, { recursive: true, force: true });
  });

  it('should parse MDX files without locale suffix correctly', async () => {
    // Create an MDX file without locale suffix (like welcome-hero.mdx)
    const mdxContent = `---
title: Welcome Hero
category: headers
description: A hero section for the welcome page
---

# Build Better Websites with Ligma CMS

Experience the power of visual editing with **Puck** and the flexibility of **MDX** content fragments.`;

    await writeFile(join(contentRoot, 'fragments', 'headers', 'welcome-hero.mdx'), mdxContent);

    // This should not throw an error
    const api = await FileSystemContentAPI.create({ contentRoot, canvasDir });

    // API should be created successfully
    expect(api).toBeDefined();
  });

  it('should parse MDX files with locale suffix correctly', async () => {
    // Create an MDX file with locale suffix (like welcome-hero.en.mdx)
    const mdxContent = `---
title: Welcome Hero
category: headers
description: A hero section for the welcome page
---

# Build Better Websites with Ligma CMS

Experience the power of visual editing with **Puck** and the flexibility of **MDX** content fragments.`;

    await writeFile(join(contentRoot, 'fragments', 'headers', 'welcome-hero.en.mdx'), mdxContent);

    // This should not throw an error
    const api = await FileSystemContentAPI.create({ contentRoot, canvasDir });

    // API should be created successfully
    expect(api).toBeDefined();

    // Should be able to find the fragment
    const fragment = api.fragments.getByName('headers', 'welcome-hero', 'en');
    expect(fragment).toBeDefined();
    if (fragment) {
      expect(fragment.locales.en).toBeDefined();
      expect(fragment.locales.en?.meta.title).toBe('Welcome Hero');
    }
  });

  it('should handle MDX files without frontmatter', async () => {
    // Create an MDX file without frontmatter
    const mdxContent = `# Simple MDX Content

This is a simple MDX file without frontmatter.`;

    await writeFile(join(contentRoot, 'fragments', 'headers', 'simple.en.mdx'), mdxContent);

    // This should not throw an error
    const api = await FileSystemContentAPI.create({ contentRoot, canvasDir });

    // API should be created successfully
    expect(api).toBeDefined();
  });
});
