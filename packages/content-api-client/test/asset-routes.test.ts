import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createContentAPIRouter, InMemoryContentAPI } from '@conloca/content-api/node';
import { ContentAPIClient } from '../src/client';

describe('Asset routes with subfolder paths', () => {
  let contentApi: InMemoryContentAPI;
  let client: ContentAPIClient;
  let assetsPath: string;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(async () => {
    originalFetch = globalThis.fetch;

    // Create temp assets directory with a subfolder
    assetsPath = join(tmpdir(), `conloca-asset-test-${Date.now()}`);
    await mkdir(join(assetsPath, 'uploads'), { recursive: true });

    // Create a test image file in the subfolder
    await writeFile(join(assetsPath, 'uploads', 'test-image.png'), Buffer.from('fake-png-data'));
    // Create a root-level file too
    await writeFile(join(assetsPath, 'root-image.png'), Buffer.from('fake-png-data'));

    contentApi = new InMemoryContentAPI({
      sites: { default: { locales: ['en'], defaultLocale: 'en' } },
      globalLocales: ['en'],
    });

    const honoApp = createContentAPIRouter(contentApi, { assetsPath });

    globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const path = url.replace('http://test/__conloca/api', '');
      const request = new Request(`http://localhost${path}`, { ...init, body: init?.body });
      return honoApp.fetch(request);
    };

    client = new ContentAPIClient({ baseUrl: 'http://test/__conloca/api' });

    // Upload files so they appear in the manifest
    const rootForm = new FormData();
    rootForm.append('file', new File([Buffer.from('fake-png-data')], 'root-image.png', { type: 'image/png' }));
    await client.uploadAsset(rootForm);

    const subForm = new FormData();
    subForm.append('file', new File([Buffer.from('fake-png-data')], 'test-image.png', { type: 'image/png' }));
    subForm.append('folder', '/uploads');
    await client.uploadAsset(subForm);
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    await rm(assetsPath, { recursive: true, force: true });
  });

  it('should get metadata for a root-level asset', async () => {
    const asset = await client.getAsset('root-image.png');
    expect(asset).not.toBeNull();
    expect(asset!.filename).toContain('root-image.png');
  });

  it('should get metadata for a subfolder asset', async () => {
    const asset = await client.getAsset('uploads/test-image.png');
    expect(asset).not.toBeNull();
    expect(asset!.filename).toContain('test-image.png');
  });

  it('should delete a root-level asset', async () => {
    const result = await client.deleteAsset('root-image.png');
    expect(result.success).toBe(true);

    // Verify it's gone
    const asset = await client.getAsset('root-image.png');
    expect(asset).toBeNull();
  });

  it('should delete a subfolder asset', async () => {
    const result = await client.deleteAsset('uploads/test-image.png');
    expect(result.success).toBe(true);

    // Verify it's gone
    const asset = await client.getAsset('uploads/test-image.png');
    expect(asset).toBeNull();
  });

  it('should update metadata for a subfolder asset', async () => {
    const updated = await client.updateAssetMetadata('uploads/test-image.png', {
      alt: 'A test image in uploads folder',
      tags: ['test', 'upload'],
    });
    expect(updated.alt).toBe('A test image in uploads folder');
    expect(updated.tags).toEqual(['test', 'upload']);
  });
});
