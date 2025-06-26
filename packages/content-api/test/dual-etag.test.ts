import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdir, readFile, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { parseDualEtag } from '../src/etag-utils';
import { FileSystemContentAPI } from '../src/filesystem-content-api';
import type { ContentAPIOptions, CreateContentInput } from '../src/types';
import { getCreatedId } from './test-helpers';

describe('Dual ETag System', () => {
  const testDir = join(import.meta.dir, 'test-content-dual-etag');
  let api: FileSystemContentAPI;

  beforeAll(async () => {
    // Clean up and create test directory
    await rm(testDir, { recursive: true, force: true });
    await mkdir(testDir, { recursive: true });

    // Create sites.json
    const sitesConfig = {
      sites: {
        example: {
          locales: ['en', 'es'],
          defaultLocale: 'en',
        },
      },
      globalLocales: ['en', 'es'],
    };
    await writeFile(join(testDir, 'sites.json'), JSON.stringify(sitesConfig, null, 2));

    // Create API instance
    const options: ContentAPIOptions = {
      contentRoot: testDir,
    };
    api = await FileSystemContentAPI.create(options);
  });

  afterAll(async () => {
    await rm(testDir, { recursive: true, force: true });
    FileSystemContentAPI.clearCaches();
  });

  it('should generate dual ETags for created content', async () => {
    const createData: CreateContentInput = {
      kind: 'page',
      site: 'example',
      collection: 'pages',
      type: 'puck',
      locales: {
        en: {
          pathname: '/test-page',
          meta: { title: 'Test Page' },
          content: { puckData: { root: { props: {} } } },
        },
      },
    };

    const result = await api.createContent(createData);
    expect(result.success).toBe(true);
    const id = getCreatedId(result);

    const content = await api.getContent(id);
    expect(content).toBeTruthy();
    expect(content?.locales).toBeTruthy();
    expect(content?.locales.en).toBeTruthy();

    if (content?.locales.en) {
      const etag = content.locales.en.etag;

      // Validate ETag format: must be metaHash.contentHash
      expect(typeof etag).toBe('string');
      const parts = etag.split('.');
      expect(parts.length).toBe(2);
      expect(parts[0].length).toBeGreaterThan(0); // meta hash
      expect(parts[1].length).toBeGreaterThan(0); // content hash

      // Validate it parses correctly
      const parsed = parseDualEtag(etag);
      expect(parsed).not.toBeNull();
      expect(parsed?.meta).toBe(parts[0]);
      expect(parsed?.content).toBe(parts[1]);
      expect(parsed?.meta).not.toBe(parsed?.content);

      // Validate ETags are URL-safe base64 (no +, /, or = padding)
      const urlSafeRegex = /^[A-Za-z0-9\-_]+$/;
      expect(parsed!.meta).toMatch(urlSafeRegex);
      expect(parsed!.content).toMatch(urlSafeRegex);

      // Read again - ETag must be stable
      const contentAgain = await api.getContent(id);
      expect(contentAgain?.locales.en.etag).toBe(etag);
    }
  });

  it('should allow metadata updates without content etag changes', async () => {
    // Create content
    const createData: CreateContentInput = {
      kind: 'page',
      site: 'example',
      collection: 'pages',
      type: 'puck',
      locales: {
        en: {
          pathname: '/meta-update-test',
          meta: { title: 'Original Title' },
          content: { puckData: { root: { props: {} } } },
        },
      },
    };

    const createResult = await api.createContent(createData);
    expect(createResult.success).toBe(true);
    const id = getCreatedId(createResult);

    // Get original etags
    const original = await api.getContent(id);
    expect(original).toBeTruthy();

    if (original && original.locales.en) {
      const originalEtag = original.locales.en.etag;
      const originalParsed = parseDualEtag(originalEtag);
      expect(originalParsed).toBeTruthy();

      // Update only metadata
      const updateResult = await api.updateLocalized({
        id: id,
        locale: 'en',
        etag: originalEtag,
        data: {
          meta: { title: 'Updated Title' },
        },
      });

      expect(updateResult.success).toBe(true);

      // Get updated content
      const updated = await api.getContent(id);
      expect(updated).toBeTruthy();

      if (updated && updated.locales.en && originalParsed) {
        const updatedEtag = updated.locales.en.etag;
        const updatedParsed = parseDualEtag(updatedEtag);
        expect(updatedParsed).toBeTruthy();

        if (updatedParsed) {
          // Meta etag should change, content etag should stay the same
          expect(updatedParsed.meta).not.toBe(originalParsed.meta);
          expect(updatedParsed.content).toBe(originalParsed.content);
        }
      }
    }
  });

  it('should allow content updates without metadata etag changes', async () => {
    // Create content
    const createData: CreateContentInput = {
      kind: 'page',
      site: 'example',
      collection: 'pages',
      type: 'puck',
      locales: {
        en: {
          pathname: '/content-update-test',
          meta: { title: 'Test Title' },
          content: { puckData: { root: { props: { id: 'v1' } } } },
        },
      },
    };

    const createResult = await api.createContent(createData);
    expect(createResult.success).toBe(true);
    const id = getCreatedId(createResult);

    // Get original etags
    const original = await api.getContent(id);
    expect(original).toBeTruthy();

    if (original && original.locales.en) {
      const originalEtag = original.locales.en.etag;
      const originalParsed = parseDualEtag(originalEtag);
      expect(originalParsed).toBeTruthy();

      // Update only content - use same modified date to preserve meta etag
      const updateResult = await api.updateLocalized({
        id: id,
        locale: 'en',
        etag: originalEtag,
        data: {
          modified: original.locales.en.modified, // Keep same modified date
          content: { puckData: { root: { props: { id: 'v2' } } } },
        },
      });

      expect(updateResult.success).toBe(true);

      // Get updated content
      const updated = await api.getContent(id);
      expect(updated).toBeTruthy();

      if (updated && updated.locales.en && originalParsed) {
        const updatedEtag = updated.locales.en.etag;
        const updatedParsed = parseDualEtag(updatedEtag);
        expect(updatedParsed).toBeTruthy();

        if (updatedParsed) {
          // Content etag should change, meta etag should stay the same
          expect(updatedParsed.meta).toBe(originalParsed.meta);
          expect(updatedParsed.content).not.toBe(originalParsed.content);
        }
      }
    }
  });

  it('should detect stale writes for metadata updates', async () => {
    // Create content
    const createData: CreateContentInput = {
      kind: 'page',
      site: 'example',
      collection: 'pages',
      type: 'puck',
      locales: {
        en: {
          pathname: '/stale-meta-test',
          meta: { title: 'Original' },
          content: { puckData: { root: {} } },
        },
      },
    };

    const createResult = await api.createContent(createData);
    expect(createResult.success).toBe(true);
    const id = getCreatedId(createResult);

    const original = await api.getContent(id);
    expect(original).toBeTruthy();

    if (original) {
      const originalEtag = original.locales.en.etag;
      const parsed = parseDualEtag(originalEtag);

      // Create a stale etag with wrong meta but correct content
      const staleEtag = `wrongMeta.${parsed?.content}`;

      // Try to update with stale meta etag
      const updateResult = await api.updateLocalized({
        id: id,
        locale: 'en',
        etag: staleEtag,
        data: {
          meta: { title: 'Should Fail' },
        },
      });

      expect(updateResult.success).toBe(false);
      expect(updateResult.reason).toBe('stale_write');
    }
  });

  it('should handle whitespace changes inside JSON strings affecting etags', async () => {
    // Create content with a string that has specific whitespace
    const createData: CreateContentInput = {
      kind: 'page',
      site: 'example',
      collection: 'pages',
      type: 'puck',
      locales: {
        en: {
          pathname: '/string-whitespace-test',
          meta: { title: 'String Test', description: 'Hello world' },
          content: { puckData: { root: { props: { text: 'Hello world' } } } },
        },
      },
    };

    const createResult = await api.createContent(createData);
    expect(createResult.success).toBe(true);
    const id = getCreatedId(createResult);

    const original = await api.getContent(id);
    const originalEtag = original?.locales.en.etag;

    // Update content with whitespace changes inside the JSON string
    const updateResult = await api.updateLocalized({
      id: id,
      locale: 'en',
      etag: originalEtag!,
      data: {
        content: { puckData: { root: { props: { text: 'Hello  world' } } } }, // Extra space inside string
      },
    });

    expect(updateResult.success).toBe(true);

    const updated = await api.getContent(id);
    const updatedEtag = updated?.locales.en.etag;
    const originalParsed = parseDualEtag(originalEtag!);
    const updatedParsed = parseDualEtag(updatedEtag!);

    // Content etag should change because whitespace inside strings matters
    expect(updatedParsed?.content).not.toBe(originalParsed?.content);
  });

  it('should handle whitespace changes without affecting etags', async () => {
    // Create content with compact JSON
    const createData: CreateContentInput = {
      kind: 'page',
      site: 'example',
      collection: 'pages',
      type: 'puck',
      locales: {
        en: {
          pathname: '/whitespace-test',
          meta: { title: 'Whitespace Test', description: 'Testing whitespace' },
          content: { puckData: { root: { props: { items: [1, 2, 3] } } } },
        },
      },
    };

    const createResult = await api.createContent(createData);
    expect(createResult.success).toBe(true);
    const id = getCreatedId(createResult);

    // Read original to find actual structure
    const original = await api.getContent(id);

    // List all files in the test directory to debug
    const glob = await import('fast-glob');
    const files = await glob.default('**/*.vxjson', { cwd: testDir, absolute: true });
    // Find the correct file for this test
    const filePath = files.find((f) => f.includes('whitespace-test'));
    if (!filePath) {
      throw new Error('Could not find whitespace-test file');
    }

    const originalEtag = original?.locales.en.etag;
    if (!originalEtag) {
      throw new Error('Could not get original etag');
    }

    // Read the file to see what's in it
    const fileContent = await Bun.file(filePath).json();

    // Manually reformat the JSON file with different whitespace but preserve key order
    const reformatted = JSON.stringify(fileContent, null, 4);
    await writeFile(filePath, reformatted);

    // Clear cache and recreate API to force re-read
    FileSystemContentAPI.clearCaches();
    api = await FileSystemContentAPI.create({ contentRoot: testDir });

    // Read again
    const afterReformat = await api.getContent(id);
    const afterEtag = afterReformat?.locales.en.etag;

    // ETags should be identical despite whitespace changes
    expect(afterEtag).toBe(originalEtag);
  });

  it('should update modified timestamp when metadata changes', async () => {
    // Create content
    const createData: CreateContentInput = {
      kind: 'page',
      site: 'example',
      collection: 'pages',
      type: 'puck',
      locales: {
        en: {
          pathname: '/modified-timestamp-test',
          meta: { title: 'Original Title', description: 'Test modified timestamp' },
          content: { puckData: { root: { props: {} } } },
        },
      },
    };

    const createResult = await api.createContent(createData);
    expect(createResult.success).toBe(true);
    const id = getCreatedId(createResult);

    // Get original content
    const original = await api.getContent(id);
    expect(original).toBeTruthy();

    if (original && original.locales.en) {
      const originalModified = original.locales.en.modified;
      const originalEtag = original.locales.en.etag;

      // Wait a bit to ensure timestamp will be different
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Update metadata
      const updateResult = await api.updateLocalized({
        id: id,
        locale: 'en',
        etag: originalEtag,
        data: {
          meta: { title: 'Updated Title' },
        },
      });

      expect(updateResult.success).toBe(true);

      // Get updated content
      const updated = await api.getContent(id);
      expect(updated).toBeTruthy();

      if (updated && updated.locales.en) {
        const updatedModified = updated.locales.en.modified;

        // Modified timestamp should have changed
        expect(updatedModified).not.toBe(originalModified);
        expect(new Date(updatedModified).getTime()).toBeGreaterThan(new Date(originalModified).getTime());
      }
    }
  });

  it('should update modified timestamp when content changes', async () => {
    // Create content
    const createData: CreateContentInput = {
      kind: 'page',
      site: 'example',
      collection: 'pages',
      type: 'puck',
      locales: {
        en: {
          pathname: '/content-only-update-test',
          meta: { title: 'Test Title', description: 'Test content-only updates' },
          content: { puckData: { root: { props: { version: 1 } } } },
        },
      },
    };

    const createResult = await api.createContent(createData);
    expect(createResult.success).toBe(true);
    const id = getCreatedId(createResult);

    // Get original content
    const original = await api.getContent(id);
    expect(original).toBeTruthy();

    if (original && original.locales.en) {
      const originalModified = original.locales.en.modified;
      const originalEtag = original.locales.en.etag;

      // Wait a bit to ensure timestamp will be different
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Update only content (not metadata)
      const updateResult = await api.updateLocalized({
        id: id,
        locale: 'en',
        etag: originalEtag,
        data: {
          content: { puckData: { root: { props: { version: 2 } } } },
        },
      });

      expect(updateResult.success).toBe(true);

      // Get updated content
      const updated = await api.getContent(id);
      expect(updated).toBeTruthy();

      if (updated && updated.locales.en) {
        const updatedModified = updated.locales.en.modified;

        // Modified timestamp SHOULD have changed for content updates
        expect(updatedModified).not.toBe(originalModified);
        expect(new Date(updatedModified).getTime()).toBeGreaterThan(new Date(originalModified).getTime());
      }
    }
  });

  it('should update modified timestamp when MDX metadata changes', async () => {
    // Create MDX content
    const createData: CreateContentInput = {
      kind: 'block',
      collection: 'components',
      type: 'mdx',
      name: 'test-mdx-modified',
      locales: {
        en: {
          meta: { title: 'Original MDX Title', description: 'Test MDX modified timestamp' },
          content: { mdx: '# Hello MDX\n\nThis is MDX content.' },
        },
      },
    };

    const createResult = await api.createContent(createData);
    expect(createResult.success).toBe(true);
    const id = getCreatedId(createResult);

    // Get original content
    const original = await api.getContent(id);
    expect(original).toBeTruthy();

    if (original && original.locales.en) {
      const originalModified = original.locales.en.modified;
      const originalEtag = original.locales.en.etag;

      // Wait a bit to ensure timestamp will be different
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Update metadata
      const updateResult = await api.updateLocalized({
        id: id,
        locale: 'en',
        etag: originalEtag,
        data: {
          meta: { title: 'Updated MDX Title' },
        },
      });

      expect(updateResult.success).toBe(true);

      // Get updated content
      const updated = await api.getContent(id);
      expect(updated).toBeTruthy();

      if (updated && updated.locales.en) {
        const updatedModified = updated.locales.en.modified;

        // Modified timestamp should have changed
        expect(updatedModified).not.toBe(originalModified);
        expect(new Date(updatedModified).getTime()).toBeGreaterThan(new Date(originalModified).getTime());

        // Verify metadata was updated
        expect(updated.locales.en.meta.title).toBe('Updated MDX Title');
      }
    }
  });

  it('should produce consistent ETags for identical content', async () => {
    // Create two pages with identical content data
    const identicalData = {
      meta: { title: 'Identical Test', description: 'Same content' },
      content: { puckData: { root: { props: { id: 'test-123' } } } },
    };

    const result1 = await api.createContent({
      kind: 'page',
      site: 'example',
      collection: 'pages',
      type: 'puck',
      locales: {
        en: {
          pathname: '/identical-1',
          ...identicalData,
        },
      },
    });

    const result2 = await api.createContent({
      kind: 'page',
      site: 'example',
      collection: 'pages',
      type: 'puck',
      locales: {
        en: {
          pathname: '/identical-2',
          ...identicalData,
        },
      },
    });

    expect(result1.success).toBe(true);
    expect(result2.success).toBe(true);

    const content1 = await api.getContent(getCreatedId(result1));
    const content2 = await api.getContent(getCreatedId(result2));

    const parsed1 = parseDualEtag(content1!.locales.en.etag);
    const parsed2 = parseDualEtag(content2!.locales.en.etag);

    expect(parsed1).not.toBeNull();
    expect(parsed2).not.toBeNull();

    // Content ETags MUST be identical for identical content
    expect(parsed1!.content).toBe(parsed2!.content);

    // Meta ETags will differ due to different created/modified timestamps
    expect(parsed1!.meta).not.toBe(parsed2!.meta);
  });

  it('should update modified timestamp when MDX content changes', async () => {
    // Create MDX content
    const createData: CreateContentInput = {
      kind: 'block',
      collection: 'components',
      type: 'mdx',
      name: 'test-mdx-content-only',
      locales: {
        en: {
          meta: { title: 'MDX Title', description: 'Test MDX content-only updates' },
          content: { mdx: '# Version 1\n\nInitial content.' },
        },
      },
    };

    const createResult = await api.createContent(createData);
    expect(createResult.success).toBe(true);
    const id = getCreatedId(createResult);

    // Get original content
    const original = await api.getContent(id);
    expect(original).toBeTruthy();

    if (original && original.locales.en) {
      const originalModified = original.locales.en.modified;
      const originalEtag = original.locales.en.etag;

      // Wait a bit to ensure timestamp will be different
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Update only MDX content (not metadata)
      const updateResult = await api.updateLocalized({
        id: id,
        locale: 'en',
        etag: originalEtag,
        data: {
          content: { mdx: '# Version 2\n\nUpdated content.' },
        },
      });

      expect(updateResult.success).toBe(true);

      // Get updated content
      const updated = await api.getContent(id);
      expect(updated).toBeTruthy();

      if (updated && updated.locales.en) {
        const updatedModified = updated.locales.en.modified;

        // Modified timestamp SHOULD have changed for content updates
        expect(updatedModified).not.toBe(originalModified);
        expect(new Date(updatedModified).getTime()).toBeGreaterThan(new Date(originalModified).getTime());

        // Verify content was updated and frontmatter shows new modified date
        expect(updated.locales.en.content.mdx).toContain('Version 2');
        expect(updated.locales.en.content.mdx).toContain(`modified: ${updatedModified}`);
      }
    }
  });

  it('should calculate correct dual ETags for MDX files', async () => {
    const createData: CreateContentInput = {
      kind: 'block',
      collection: 'components',
      type: 'mdx',
      name: 'test-mdx-etags',
      locales: {
        en: {
          meta: { title: 'MDX ETag Test' },
          content: { mdx: '# MDX Content' },
        },
      },
    };

    const result = await api.createContent(createData);
    expect(result.success).toBe(true);
    const id = getCreatedId(result);

    const content = await api.getContent(id);
    expect(content).toBeTruthy();

    if (content && content.locales.en) {
      const etag = content.locales.en.etag;
      const parsed = parseDualEtag(etag);

      expect(parsed).toBeTruthy();
      expect(parsed?.meta).toBeTruthy();
      expect(parsed?.content).toBeTruthy();
      expect(parsed?.meta).not.toBe(parsed?.content);
    }
  });
});
