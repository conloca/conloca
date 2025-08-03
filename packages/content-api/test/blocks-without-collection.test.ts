import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { FileSystemContentAPI } from '../src/filesystem-content-api';

describe('FileSystemContentAPI - blocks without collection subdirectory', () => {
  let tempDir: string;
  let api: FileSystemContentAPI;
  let testId = 0;

  beforeEach(async () => {
    testId++;
    tempDir = join(import.meta.dir, `.test-blocks-no-collection-${testId}-${Date.now()}`);
    await rm(tempDir, { recursive: true, force: true });
    await mkdir(tempDir, { recursive: true });
    await mkdir(join(tempDir, 'blocks'), { recursive: true });
  });

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test('should handle MDX blocks directly in blocks/ directory', async () => {
    // Create an MDX block directly in blocks/ without a collection subdirectory
    const mdxContent = `---
title: Direct Block
category: test
description: A block directly in blocks directory
---

# Direct Block Content

This block is not in a collection subdirectory.`;

    await writeFile(join(tempDir, 'blocks/direct-block.mdx'), mdxContent);

    // Create the API
    api = await FileSystemContentAPI.create({
      contentRoot: tempDir,
    });

    // List all content
    const manifests = Array.from(api.listAllContent());
    expect(manifests).toHaveLength(1);

    const manifest = manifests[0];
    expect(manifest.kind).toBe('block');
    expect(manifest.type).toBe('mdx');
    expect(manifest.locales).toHaveProperty('en');

    // Try to load the content
    const content = await api.getLocalized(manifest.id, 'en');
    expect(content).toBeTruthy();
    expect(content?.localized.meta.title).toBe('Direct Block');
    expect(content?.localized.content.mdx).toContain('# Direct Block Content');
  });

  test('should handle blocks with locale suffix directly in blocks/ directory', async () => {
    // Create an MDX block with locale suffix
    const mdxContent = `---
title: Localized Block
category: test
---

# Localized Content`;

    await writeFile(join(tempDir, 'blocks/localized-block.en.mdx'), mdxContent);

    // Create the API - this will move the file to general collection
    api = await FileSystemContentAPI.create({
      contentRoot: tempDir,
    });

    // List all content
    const manifests = Array.from(api.listAllContent());
    expect(manifests).toHaveLength(1);

    const manifest = manifests[0];
    expect(manifest.kind).toBe('block');
    expect(manifest.type).toBe('mdx');
    expect(manifest.locales).toHaveProperty('en');

    // Try to load the content
    const content = await api.getLocalized(manifest.id, 'en');
    expect(content).toBeTruthy();
    expect(content?.localized.meta.title).toBe('Localized Block');
  });

  test('verify command should work with blocks directly in blocks/ directory', async () => {
    // This simulates the exact scenario from the user's example
    const mdxContent = `---
title: Welcome Hero
category: headers
description: A hero section for the welcome page
---

# Build Better Websites with Ligma CMS

Experience the power of visual editing with **Puck** and the flexibility of **MDX** content blocks.

- 🎨 Visual page building
- 📝 MDX content blocks
- 🌍 Multi-language support
- 🚀 Git-based workflow

Get started by exploring the CMS at \`/__cms\`.`;

    await writeFile(join(tempDir, 'blocks/welcome-hero.mdx'), mdxContent);

    // Create the API
    api = await FileSystemContentAPI.create({
      contentRoot: tempDir,
    });

    // Simulate what the verify command does
    let contentCount = 0;
    let errorCount = 0;
    const errors: string[] = [];

    for (const manifest of api.listAllContent()) {
      contentCount++;

      for (const locale of Object.keys(manifest.locales)) {
        try {
          const content = await api.getLocalized(manifest.id, locale);
          if (!content) {
            errorCount++;
            errors.push(`Failed to load content ${manifest.id} for locale ${locale}`);
          }
        } catch (error) {
          errorCount++;
          errors.push(`Error loading ${manifest.id} (${locale}): ${error}`);
        }
      }
    }

    expect(errorCount).toBe(0);
    expect(contentCount).toBe(1);
    expect(errors).toHaveLength(0);
  });

  test('should use default locale from sites.json when renaming files', async () => {
    // Create sites.json with a custom default locale
    const sitesConfig = {
      sites: {},
      globalLocales: ['fr', 'en', 'es'],
    };
    await writeFile(join(tempDir, 'sites.json'), JSON.stringify(sitesConfig, null, 2));

    // Create an MDX block without locale suffix
    const mdxContent = `---
title: French Block
category: test
---

# Contenu en français`;

    await writeFile(join(tempDir, 'blocks/french-block.mdx'), mdxContent);

    // Create the API
    api = await FileSystemContentAPI.create({
      contentRoot: tempDir,
    });

    // List all content
    const manifests = Array.from(api.listAllContent());
    expect(manifests).toHaveLength(1);

    const manifest = manifests[0];
    expect(manifest.kind).toBe('block');
    expect(manifest.type).toBe('mdx');
    // Should use 'fr' as the default locale from sites.json
    expect(manifest.locales).toHaveProperty('fr');
    expect(manifest.locales).not.toHaveProperty('en');

    // Try to load the content
    const content = await api.getLocalized(manifest.id, 'fr');
    expect(content).toBeTruthy();
    expect(content?.localized.meta.title).toBe('French Block');
  });
});
