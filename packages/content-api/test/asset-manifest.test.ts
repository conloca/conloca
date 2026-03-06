import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AssetManifest } from '../src/asset-manifest';
import type { ManifestEntryData } from '../src/asset-types';

describe('AssetManifest', () => {
  let tempDir: string;
  let manifest: AssetManifest;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `conloca-manifest-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(tempDir, { recursive: true });
    manifest = new AssetManifest(tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('read', () => {
    test('returns empty object when manifest file does not exist', async () => {
      const data = await manifest.read();
      expect(data).toEqual({});
    });

    test('returns parsed JSON when manifest file exists', async () => {
      const expected: Record<string, ManifestEntryData> = {
        'photo.jpg': { alt: 'A photo', width: 100, height: 200 },
      };
      await Bun.write(join(tempDir, '.asset-manifest.json'), JSON.stringify(expected));
      const data = await manifest.read();
      expect(data).toEqual(expected);
    });
  });

  describe('write', () => {
    test('creates manifest file with JSON content', async () => {
      const data: Record<string, ManifestEntryData> = {
        'logo.png': { alt: 'Logo', width: 64, height: 64 },
      };
      await manifest.write(data);
      const raw = await Bun.file(join(tempDir, '.asset-manifest.json')).text();
      expect(JSON.parse(raw)).toEqual(data);
    });
  });

  describe('add', () => {
    test('creates entry in empty manifest', async () => {
      const entry: ManifestEntryData = { alt: 'New image', uploadedAt: '2026-01-01T00:00:00Z' };
      await manifest.add('images/hero.jpg', entry);
      const data = await manifest.read();
      expect(data['images/hero.jpg']).toEqual(entry);
    });

    test('updates existing entry in manifest', async () => {
      await manifest.add('photo.jpg', { alt: 'Original' });
      await manifest.add('photo.jpg', { alt: 'Updated', width: 800 });
      const data = await manifest.read();
      expect(data['photo.jpg']).toEqual({ alt: 'Updated', width: 800 });
    });
  });

  describe('remove', () => {
    test('deletes existing entry and returns true', async () => {
      await manifest.add('photo.jpg', { alt: 'To remove' });
      const removed = await manifest.remove('photo.jpg');
      expect(removed).toBe(true);
      const data = await manifest.read();
      expect(data['photo.jpg']).toBeUndefined();
    });

    test('returns false for non-existent key', async () => {
      const removed = await manifest.remove('nonexistent.jpg');
      expect(removed).toBe(false);
    });
  });

  describe('get', () => {
    test('returns entry data for existing key', async () => {
      const entry: ManifestEntryData = { alt: 'Get me', tags: ['hero', 'banner'] };
      await manifest.add('banner.jpg', entry);
      const result = await manifest.get('banner.jpg');
      expect(result).toEqual(entry);
    });

    test('returns undefined for non-existent key', async () => {
      const result = await manifest.get('missing.jpg');
      expect(result).toBeUndefined();
    });
  });

  describe('getByFilename', () => {
    test('finds entry matching exact filename key', async () => {
      await manifest.add('logo.png', { alt: 'Logo' });
      const result = await manifest.getByFilename('logo.png');
      expect(result).toBeDefined();
      expect(result?.relativePath).toBe('logo.png');
      expect(result?.data.alt).toBe('Logo');
    });

    test('finds entry matching key ending with /filename', async () => {
      await manifest.add('images/photos/sunset.jpg', { alt: 'Sunset' });
      const result = await manifest.getByFilename('sunset.jpg');
      expect(result).toBeDefined();
      expect(result?.relativePath).toBe('images/photos/sunset.jpg');
      expect(result?.data.alt).toBe('Sunset');
    });

    test('returns undefined when no match', async () => {
      await manifest.add('photo.jpg', { alt: 'Photo' });
      const result = await manifest.getByFilename('noexist.jpg');
      expect(result).toBeUndefined();
    });
  });
});
