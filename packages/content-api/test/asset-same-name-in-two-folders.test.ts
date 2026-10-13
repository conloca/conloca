import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { AssetOperations } from '../src/asset-operations.js';
import type { AssetEntry } from '../src/asset-types.js';
import { InMemoryContentAPI } from '../src/in-memory-content-api.js';
import { createContentAPIRouter } from '../src/middleware.js';
import { testTempDir } from './test-temp-dir.js';

/**
 * Two pictures with the same name: `trip/beach.png`, uploaded first, and `beach.png` at the top of
 * the assets folder. Uploading only avoids a clash inside one folder, so this is an ordinary
 * library. A name without a folder is the picture at the top; it used to mean the first manifest
 * entry with that name in any folder, so asking for the top picture reached `trip/beach.png`: its
 * alt text changed and it was the file deleted.
 */
describe('a picture at the top of the assets folder that shares its name with one in a folder', () => {
  let assetsPath: string;
  let contentRoot: string;
  let ops: AssetOperations;

  beforeEach(async () => {
    assetsPath = testTempDir('same-name');
    contentRoot = `${assetsPath}-content`;
    ops = new AssetOperations({ assetsPath, contentRoot });
    const picture = () => new File([new Uint8Array([0x89, 0x50])], 'beach.png', { type: 'image/png' });
    // Upload order is manifest order: the folder's picture is the first entry named beach.png.
    expect((await ops.upload(picture(), { folder: 'trip' })).success).toBe(true);
    expect((await ops.upload(picture())).success).toBe(true);
  });

  afterEach(async () => {
    await Promise.all([
      rm(assetsPath, { recursive: true, force: true }),
      rm(contentRoot, { recursive: true, force: true }),
    ]);
  });

  describe('through AssetOperations', () => {
    test('is the one its name finds', async () => {
      expect((await ops.getAsset('beach.png'))?.folder).toBe('/');
    });

    test('takes the alt text and tags given for its name, and the other keeps none', async () => {
      const result = await ops.updateMetadata('beach.png', { alt: 'Sand and sea', tags: ['home'] });

      expect(result.success && result.asset.folder).toBe('/');
      expect(await ops.getAsset('beach.png')).toMatchObject({ alt: 'Sand and sea', tags: ['home'] });
      expect(await ops.getAsset('beach.png', '/trip')).toMatchObject({ alt: undefined, tags: undefined });
    });

    test('is the file deleted for its name, and the other stays', async () => {
      expect(await ops.delete('beach.png')).toEqual({ success: true });

      expect(existsSync(join(assetsPath, 'beach.png'))).toBe(false);
      expect(existsSync(join(assetsPath, 'trip', 'beach.png'))).toBe(true);
    });

    test('once gone, its name does not reach the picture in the folder', async () => {
      await ops.delete('beach.png');

      expect(await ops.getAsset('beach.png')).toBeUndefined();
      expect(await ops.updateMetadata('beach.png', { alt: 'Lost' })).toEqual({
        success: false,
        reason: 'not-found',
        error: 'Asset not found',
      });
      expect(await ops.delete('beach.png')).toEqual({ success: true });
      expect(await ops.getAsset('beach.png', '/trip')).toMatchObject({ folder: '/trip', alt: undefined });
    });
  });

  describe('through the asset routes, addressed the way the editor sends them', () => {
    async function send(method: string, path: string, body?: unknown): Promise<Response> {
      const router = createContentAPIRouter(new InMemoryContentAPI(), { assetsPath, contentRoot });
      const json =
        body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
      return router.request(`/assets/meta/${path}`, { method, ...json });
    }

    async function meta(path: string): Promise<AssetEntry> {
      return (await (await send('GET', path)).json()) as AssetEntry;
    }

    test('GET of its name answers with it', async () => {
      expect(await meta('beach.png')).toMatchObject({ filename: 'beach.png', folder: '/' });
    });

    test('PATCH of its name changes its alt text only', async () => {
      expect((await send('PATCH', 'beach.png', { alt: 'Sand and sea' })).status).toBe(200);

      expect((await meta('beach.png')).alt).toBe('Sand and sea');
      expect((await meta('trip/beach.png')).alt).toBeUndefined();
    });

    test('PATCH of the folder path changes the other picture only', async () => {
      expect((await send('PATCH', 'trip/beach.png', { alt: 'On the trip' })).status).toBe(200);

      expect((await meta('trip/beach.png')).alt).toBe('On the trip');
      expect((await meta('beach.png')).alt).toBeUndefined();
    });

    test('DELETE of its name deletes its file only', async () => {
      expect((await send('DELETE', 'beach.png')).status).toBe(200);

      expect(existsSync(join(assetsPath, 'beach.png'))).toBe(false);
      expect(existsSync(join(assetsPath, 'trip', 'beach.png'))).toBe(true);
    });
  });
});
