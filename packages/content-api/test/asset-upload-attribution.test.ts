import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import * as assetMetadata from '../src/asset-metadata-store.js';
import type { AssetEntry } from '../src/asset-types.js';
import { InMemoryContentAPI } from '../src/in-memory-content-api.js';
import { createContentAPIRouter } from '../src/middleware.js';

/**
 * Who uploaded a picture is an audit trail, and an audit trail anyone can write
 * is worse than none: the upload routes must never take the uploader's name
 * from the request. An upload through conlocaCMS carries no uploader at all;
 * only a host that knows who is signed in sets one.
 */
describe('the uploader is never taken from the request', () => {
  let project: string;
  let assetsPath: string;
  let contentRoot: string;
  const originalFetch = globalThis.fetch;

  beforeEach(async () => {
    project = join(tmpdir(), `conloca-upload-attribution-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    assetsPath = join(project, 'public', 'assets');
    contentRoot = join(project, 'content');
    await mkdir(assetsPath, { recursive: true });
    await mkdir(contentRoot, { recursive: true });
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    await rm(project, { recursive: true, force: true });
  });

  function routes() {
    const api = new InMemoryContentAPI({
      sites: { shop: { locales: ['en'], defaultLocale: 'en' } },
      globalLocales: ['en'],
    });
    return createContentAPIRouter(api, { assetsPath, contentRoot });
  }

  /** Stand in for the network, with the `preconnect` property Bun's `typeof fetch` requires */
  function answerWithImage(): void {
    const mocked = mock(() =>
      Promise.resolve(
        new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), { headers: { 'content-type': 'image/jpeg' } }),
      ),
    );
    (mocked as { preconnect?: () => void }).preconnect = () => {};
    globalThis.fetch = mocked as unknown as typeof fetch;
  }

  test('an upload cannot stamp a name on the picture it sends', async () => {
    const form = new FormData();
    form.append('file', new File([new Uint8Array([1, 2, 3])], 'hero.png', { type: 'image/png' }));
    form.append('alt', 'Our team at work');
    form.append('uploadedBy', 'someone.else@example.com');

    const res = await routes().fetch(new Request('http://localhost/assets/upload', { method: 'POST', body: form }));

    expect(res.status).toBe(201);
    const asset = (await res.json()) as AssetEntry;
    expect(asset.alt).toBe('Our team at work');
    expect(asset.uploadedBy).toBeUndefined();
    expect(await assetMetadata.read({ assetsPath, contentRoot }, 'hero.png')).toEqual({
      alt: 'Our team at work',
      uploadedAt: expect.any(String),
      originalName: 'hero.png',
    });
  });

  test('a URL import cannot stamp a name on the picture it fetches', async () => {
    answerWithImage();

    const res = await routes().fetch(
      new Request('http://localhost/assets/import-url', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: 'https://example.com/photo.jpg', uploadedBy: 'someone.else@example.com' }),
      }),
    );

    expect(res.status).toBe(201);
    const asset = (await res.json()) as AssetEntry;
    expect(asset.uploadedBy).toBeUndefined();
    expect(await assetMetadata.read({ assetsPath, contentRoot }, 'photo.jpg')).toEqual({
      uploadedAt: expect.any(String),
      originalName: 'photo.jpg',
    });
  });
});
