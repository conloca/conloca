import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { FileSystemContentAPI } from '../src/filesystem-content-api.js';

describe('FileSystemContentAPI - fragments without collection subdirectory', () => {
  let tempDir: string;
  let api: FileSystemContentAPI;
  let testId = 0;

  beforeEach(async () => {
    testId++;
    tempDir = join(import.meta.dir, `.test-fragments-no-collection-${testId}-${Date.now()}`);
    await rm(tempDir, { recursive: true, force: true });
    await mkdir(tempDir, { recursive: true });
    await mkdir(join(tempDir, 'fragments'), { recursive: true });
  });

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test('should handle MDX fragments directly in fragments/ directory', async () => {
    // Create an MDX fragment directly in fragments/ without a collection subdirectory
    const mdxContent = `---
title: Direct Fragment
category: test
description: A fragment directly in fragments directory
---

# Direct Fragment Content

This fragment is not in a collection subdirectory.`;

    await writeFile(join(tempDir, 'fragments/direct-fragment.mdx'), mdxContent);

    // Create the API
    api = await FileSystemContentAPI.create({
      contentRoot: tempDir,
    });

    // List all content
    const manifests = Array.from(api.listAllContent());
    expect(manifests).toHaveLength(1);

    const manifest = manifests[0];
    expect(manifest.kind).toBe('fragment');
    expect(manifest.type).toBe('mdx');
    expect(manifest.locales).toHaveProperty('en');

    // Try to load the content
    const content = await api.getLocalized(manifest.id, 'en');
    expect(content).toBeTruthy();
    expect(content?.localized.meta.title).toBe('Direct Fragment');
    expect(content?.localized.content.mdx).toContain('# Direct Fragment Content');
  });

  test('moves a fragment written straight into fragments/ into the folder the editor saves fragments to', async () => {
    // Every conlocaFragments(...) call in a site's content config declares that
    // folder, so the moved fragment still builds; any other folder name may be
    // one the config never declares, which fails the build.
    await writeFile(join(tempDir, 'fragments/loose.en.mdx'), '---\ntitle: Loose\n---\n\n# Loose');

    api = await FileSystemContentAPI.create({ contentRoot: tempDir });

    expect(await readdir(join(tempDir, 'fragments'))).toEqual(['fragments']);
    expect(await readdir(join(tempDir, 'fragments/fragments'))).toEqual(['loose.en.mdx']);
    expect(api.fragments.collections).toEqual(new Set(['fragments']));
    expect(api.fragments.getByName('fragments', 'loose', 'en')?.locales.en?.meta.title).toBe('Loose');
  });

  test('should handle fragments with locale suffix directly in fragments/ directory', async () => {
    // Create an MDX fragment with locale suffix
    const mdxContent = `---
title: Localized Fragment
category: test
---

# Localized Content`;

    await writeFile(join(tempDir, 'fragments/localized-fragment.en.mdx'), mdxContent);

    // Create the API - this will move the file into fragments/fragments/
    api = await FileSystemContentAPI.create({
      contentRoot: tempDir,
    });

    // List all content
    const manifests = Array.from(api.listAllContent());
    expect(manifests).toHaveLength(1);

    const manifest = manifests[0];
    expect(manifest.kind).toBe('fragment');
    expect(manifest.type).toBe('mdx');
    expect(manifest.locales).toHaveProperty('en');

    // Try to load the content
    const content = await api.getLocalized(manifest.id, 'en');
    expect(content).toBeTruthy();
    expect(content?.localized.meta.title).toBe('Localized Fragment');
  });

  test('verify command should work with fragments directly in fragments/ directory', async () => {
    // This simulates the exact scenario from the user's example
    const mdxContent = `---
title: Welcome Hero
category: headers
description: A hero section for the welcome page
---

# Build Better Websites with Ligma CMS

Experience the power of visual editing with **Puck** and the flexibility of **MDX** content fragments.

- 🎨 Visual page building
- 📝 MDX content fragments
- 🌍 Multi-language support
- 🚀 Git-based workflow

Get started by exploring the CMS at \`/__cms\`.`;

    await writeFile(join(tempDir, 'fragments/welcome-hero.mdx'), mdxContent);

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

    // Create an MDX fragment without locale suffix
    const mdxContent = `---
title: French Fragment
category: test
---

# Contenu en français`;

    await writeFile(join(tempDir, 'fragments/french-fragment.mdx'), mdxContent);

    // Create the API
    api = await FileSystemContentAPI.create({
      contentRoot: tempDir,
    });

    // List all content
    const manifests = Array.from(api.listAllContent());
    expect(manifests).toHaveLength(1);

    const manifest = manifests[0];
    expect(manifest.kind).toBe('fragment');
    expect(manifest.type).toBe('mdx');
    // Should use 'fr' as the default locale from sites.json
    expect(manifest.locales).toHaveProperty('fr');
    expect(manifest.locales).not.toHaveProperty('en');

    // Try to load the content
    const content = await api.getLocalized(manifest.id, 'fr');
    expect(content).toBeTruthy();
    expect(content?.localized.meta.title).toBe('French Fragment');
  });
});
