import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { chmod, mkdir, readdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

import { AssetOperations } from '../src/asset-operations.js';
import { InMemoryContentAPI } from '../src/in-memory-content-api.js';
import { createContentAPIRouter } from '../src/middleware.js';
import { withTimeout } from './test-helpers.js';

/** Create a minimal valid JPEG-like File for upload tests */
function createTestFile(name: string, sizeBytes = 100, type = 'image/jpeg'): File {
  const data = new Uint8Array(sizeBytes);
  return new File([data], name, { type });
}

/** Helper to create a temp dir with unique name */
function makeTempPath(prefix: string): string {
  return join(tmpdir(), `conloca-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

/**
 * PNG signature plus an IHDR chunk carrying the given size — the header bytes a
 * size reader looks at, which is all the production path reads from a file.
 */
function pngBytes(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13); // IHDR data length
  bytes.set([0x49, 0x48, 0x44, 0x52], 12); // 'IHDR'
  view.setUint32(16, width);
  view.setUint32(20, height);
  bytes.set([8, 6, 0, 0, 0], 24); // bit depth, colour type, compression, filter, interlace
  return bytes;
}

describe('AssetOperations', () => {
  let assetsPath: string;
  let contentRoot: string;
  let ops: AssetOperations;

  beforeEach(async () => {
    assetsPath = makeTempPath('asset-ops');
    contentRoot = makeTempPath('asset-ops-content');
    await mkdir(assetsPath, { recursive: true });
    await mkdir(contentRoot, { recursive: true });
    ops = new AssetOperations({ assetsPath, contentRoot });
  });

  afterEach(async () => {
    await rm(assetsPath, { recursive: true, force: true });
    await rm(contentRoot, { recursive: true, force: true });
  });

  describe('getAssetPath (validates subpath security)', () => {
    test('returns resolved path for valid filename in root', () => {
      const path = ops.getAssetPath('photo.jpg');
      expect(path).toBe(join(assetsPath, 'photo.jpg'));
    });

    test('returns resolved path for filename in subfolder', () => {
      const path = ops.getAssetPath('photo.jpg', '/images');
      expect(path).toBe(join(assetsPath, 'images', 'photo.jpg'));
    });

    test('throws Path traversal detected for ../../../etc/passwd', () => {
      expect(() => ops.getAssetPath('../../../etc/passwd')).toThrow('Path traversal detected');
    });

    test('encoded traversal ..%2F is treated as literal (no decode = no traversal)', () => {
      // URL-encoded dots are NOT decoded by path.resolve, so they stay inside assetsPath
      // The caller (Hono router) decodes URLs before passing to validateSubpath
      const path = ops.getAssetPath('..%2F..%2Fetc/passwd');
      expect(path).toContain(assetsPath); // stays within assets
    });

    test('handles leading and trailing slashes correctly', () => {
      const path = ops.getAssetPath('photo.jpg', '/images/');
      expect(path).toBe(join(assetsPath, 'images', 'photo.jpg'));
    });
  });

  describe('upload', () => {
    test('uploads valid jpg file and returns success with AssetEntry', async () => {
      const file = createTestFile('My Photo.jpg', 500);
      const result = await ops.upload(file);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.asset.filename).toBe('my-photo.jpg'); // sanitized
        expect(result.asset.originalName).toBe('My Photo.jpg');
        expect(result.asset.mimeType).toBe('image/jpeg');
        expect(result.asset.size).toBe(500);
        expect(result.asset.folder).toBe('/');
        expect(result.asset.uploadedAt).toBeDefined();
      }
    });

    test('rejects upload of .exe file', async () => {
      const file = createTestFile('malware.exe', 100, 'application/octet-stream');
      const result = await ops.upload(file);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('Invalid format');
      }
    });

    test('accepts upload of .JPG file (case-insensitive)', async () => {
      const file = createTestFile('PHOTO.JPG', 100);
      const result = await ops.upload(file);
      expect(result.success).toBe(true);
    });

    test('rejects file exceeding maxFileSize', async () => {
      const smallOps = new AssetOperations({ assetsPath, contentRoot, maxFileSize: 50 });
      const file = createTestFile('big.jpg', 100);
      const result = await smallOps.upload(file);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('File too large');
      }
    });

    test('accepts file within maxFileSize', async () => {
      const result = await ops.upload(createTestFile('small.jpg', 50));
      expect(result.success).toBe(true);
    });

    test('sanitizes filename: lowercase, spaces to dashes, strip special chars', async () => {
      const file = createTestFile('My Photo (2).jpg', 100);
      const result = await ops.upload(file);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.asset.filename).toBe('my-photo-2.jpg');
      }
    });

    test('resolves filename collision by appending -1, -2', async () => {
      // Upload first file
      await ops.upload(createTestFile('photo.jpg', 100));
      // Upload second file with same name -- should get -1 suffix
      const result = await ops.upload(createTestFile('photo.jpg', 100));
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.asset.filename).toBe('photo-1.jpg');
      }
    });

    test('creates .gitattributes on first upload (LFS setup)', async () => {
      await ops.upload(createTestFile('test.jpg', 100));
      const gitattributes = await readFile(join(assetsPath, '.gitattributes'), 'utf-8');
      expect(gitattributes).toContain('*.jpg filter=lfs diff=lfs merge=lfs -text');
    });

    test('supports folder path in metadata', async () => {
      await mkdir(join(assetsPath, 'photos'), { recursive: true });
      const result = await ops.upload(createTestFile('beach.jpg', 100), { folder: '/photos' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.asset.folder).toBe('/photos');
      }
    });

    test('rejects path traversal in folder metadata', async () => {
      const result = await ops.upload(createTestFile('test.jpg', 100), { folder: '../../etc' });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('Invalid folder path');
      }
    });
  });

  describe('list', () => {
    test('returns empty array when assets dir is empty', async () => {
      const assets = await ops.list();
      expect(assets).toEqual([]);
    });

    test('returns AssetEntry for each image file found', async () => {
      await writeFile(join(assetsPath, 'a.jpg'), new Uint8Array([0xff, 0xd8]));
      await writeFile(join(assetsPath, 'b.png'), new Uint8Array([0x89, 0x50]));
      const assets = await ops.list();
      expect(assets).toHaveLength(2);
      const filenames = assets.map((a) => a.filename).sort();
      expect(filenames).toEqual(['a.jpg', 'b.png']);
    });

    test('skips system files (.DS_Store, .gitkeep)', async () => {
      await writeFile(join(assetsPath, '.DS_Store'), 'system');
      await writeFile(join(assetsPath, '.gitkeep'), '');
      await writeFile(join(assetsPath, 'real.jpg'), new Uint8Array([0xff, 0xd8]));
      const assets = await ops.list();
      expect(assets).toHaveLength(1);
      expect(assets[0].filename).toBe('real.jpg');
    });

    test('skips non-image files', async () => {
      await writeFile(join(assetsPath, 'readme.txt'), 'text');
      await writeFile(join(assetsPath, 'data.json'), '{}');
      await writeFile(join(assetsPath, 'photo.jpg'), new Uint8Array([0xff, 0xd8]));
      const assets = await ops.list();
      expect(assets).toHaveLength(1);
    });

    test('recurses into subdirectories', async () => {
      await mkdir(join(assetsPath, 'sub'), { recursive: true });
      await writeFile(join(assetsPath, 'root.jpg'), new Uint8Array([0xff, 0xd8]));
      await writeFile(join(assetsPath, 'sub', 'nested.png'), new Uint8Array([0x89, 0x50]));
      const assets = await ops.list();
      expect(assets).toHaveLength(2);
      const filenames = assets.map((a) => a.filename).sort();
      expect(filenames).toEqual(['nested.png', 'root.jpg']);
    });
  });

  describe('getAsset', () => {
    test('returns AssetEntry for existing file', async () => {
      await writeFile(join(assetsPath, 'logo.png'), new Uint8Array([0x89, 0x50]));
      const asset = await ops.getAsset('logo.png');
      expect(asset).toBeDefined();
      expect(asset?.filename).toBe('logo.png');
      expect(asset?.mimeType).toBe('image/png');
    });

    test('returns undefined for non-existent file', async () => {
      const asset = await ops.getAsset('nonexistent.jpg');
      expect(asset).toBeUndefined();
    });
  });

  describe('delete', () => {
    test('removes file from disk and manifest', async () => {
      // Upload a file first
      await ops.upload(createTestFile('todelete.jpg', 50));
      const result = await ops.delete('todelete.jpg');
      expect(result.success).toBe(true);
      // Verify file is gone
      const asset = await ops.getAsset('todelete.jpg');
      expect(asset).toBeUndefined();
    });

    test('returns success even if file already deleted (manifest cleanup)', async () => {
      // Just call delete on a non-existent file -- should succeed (cleanup path)
      const result = await ops.delete('already-gone.jpg');
      expect(result.success).toBe(true);
    });
  });

  describe('createFolder', () => {
    test('creates folder on disk', async () => {
      const result = await ops.createFolder('photos');
      expect(result.success).toBe(true);
      // Verify folder exists by writing a file into it
      await writeFile(join(assetsPath, 'photos', 'test.txt'), 'ok');
      const content = await readFile(join(assetsPath, 'photos', 'test.txt'), 'utf-8');
      expect(content).toBe('ok');
    });

    test('returns error for root folder creation attempt', async () => {
      const result = await ops.createFolder('/');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('Cannot create root folder');
      }
    });

    test('refuses a path that names only the assets folder, as typing / for the name gives', async () => {
      for (const path of ['//', '///']) {
        expect(await ops.createFolder(path)).toEqual({ success: false, error: 'Cannot create root folder' });
      }
    });

    test('returns error for path traversal attempt', async () => {
      const result = await ops.createFolder('../../outside');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('Invalid folder path');
      }
    });

    test('refuses a folder name the media library would hide', async () => {
      for (const path of ['/.hidden', '/photos/.cache', '/Thumbs.db', '/desktop.ini', '/.', '/a/../b']) {
        const result = await ops.createFolder(path);
        expect(result).toEqual({
          success: false,
          error: "Folder names can't start with a dot or be a system file name like Thumbs.db",
        });
      }
      for (const name of ['.hidden', 'photos', 'Thumbs.db', 'desktop.ini', 'a', 'b']) {
        expect(existsSync(join(assetsPath, name))).toBe(false);
      }
    });

    test('refuses a folder name that would break the address of its images', async () => {
      for (const name of ['a#b', 'a?b', '50%', 'a\\b']) {
        const result = await ops.createFolder(`/${name}`);
        expect(result).toEqual({ success: false, error: "Folder names can't contain #, ?, % or \\" });
        expect(existsSync(join(assetsPath, name))).toBe(false);
      }
    });

    test('refuses a folder name with a tab or line break, which browsers drop from image addresses', async () => {
      for (const name of ['a\tb', 'a\nb', 'a\rb']) {
        const result = await ops.createFolder(`/${name}`);
        expect(result).toEqual({ success: false, error: "Folder names can't contain tabs or line breaks" });
        expect(existsSync(join(assetsPath, name))).toBe(false);
      }
    });

    test('still creates folders named in non-Latin letters or with spaces', async () => {
      for (const path of ['/Фото', '/My Photos', '/Фото/2026 лето']) {
        expect(await ops.createFolder(path)).toEqual({ success: true });
      }
      const tree = await ops.getFolderTree();
      expect(tree[0].children.map((node) => node.path).sort()).toEqual(['/My Photos', '/Фото']);
      expect(tree[0].children.find((node) => node.path === '/Фото')?.children[0].path).toBe('/Фото/2026 лето');
    });
  });

  describe('listFolder', () => {
    test('lists assets and subfolders in specified folder', async () => {
      await mkdir(join(assetsPath, 'images'), { recursive: true });
      await mkdir(join(assetsPath, 'images', 'sub'), { recursive: true });
      await writeFile(join(assetsPath, 'images', 'pic.jpg'), new Uint8Array([0xff, 0xd8]));
      const listing = await ops.listFolder('/images');
      expect(listing.assets).toHaveLength(1);
      expect(listing.assets[0].filename).toBe('pic.jpg');
      expect(listing.folders).toHaveLength(1);
      expect(listing.folders[0].name).toBe('sub');
    });

    test('returns empty for non-existent folder', async () => {
      const listing = await ops.listFolder('/nonexistent');
      expect(listing.assets).toEqual([]);
      expect(listing.folders).toEqual([]);
    });

    test('blocks path traversal', () => {
      expect(ops.listFolder('/../../etc')).rejects.toThrow('Path traversal detected');
    });

    test('hides the same folders the folder tree hides', async () => {
      for (const name of ['photos', '.hidden', 'Thumbs.db', 'desktop.ini']) {
        await mkdir(join(assetsPath, name), { recursive: true });
      }
      const listing = await ops.listFolder('/');
      const tree = await ops.getFolderTree();
      expect(listing.folders.map((folder) => folder.path)).toEqual(['/photos']);
      expect(tree[0].children.map((node) => node.path)).toEqual(['/photos']);
    });
  });

  describe('readAssetFile', () => {
    test('returns buffer and mimeType for existing file', async () => {
      const content = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
      await writeFile(join(assetsPath, 'test.jpg'), content);
      const result = await ops.readAssetFile('test.jpg');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.mimeType).toBe('image/jpeg');
        expect(result.buffer.length).toBe(4);
      }
    });

    test('returns error for non-existent file', async () => {
      const result = await ops.readAssetFile('missing.jpg');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe('Asset not found');
      }
    });

    test('blocks path traversal via getAssetPath', () => {
      expect(() => ops.getAssetPath('../../../etc/passwd')).toThrow('Path traversal detected');
    });
  });

  describe('image dimensions', () => {
    /** Names plus modification times, so a rewritten file is caught as well as a new one */
    async function snapshotDir(dir: string): Promise<Record<string, number>> {
      const snapshot: Record<string, number> = {};
      for (const name of (await readdir(dir)).sort()) {
        snapshot[name] = (await stat(join(dir, name))).mtimeMs;
      }
      return snapshot;
    }

    /** The manifest write lands well after the listing has returned — wait it out */
    function settle(): Promise<void> {
      return new Promise((resolve) => setTimeout(resolve, 250));
    }

    test('listFolder reports dimensions without touching the assets directory', async () => {
      await writeFile(join(assetsPath, 'photo.png'), pngBytes(1200, 675));
      const before = await snapshotDir(assetsPath);

      const listing = await ops.listFolder('/');
      await settle();

      expect(listing.assets.map((asset) => [asset.filename, asset.width, asset.height])).toEqual([
        ['photo.png', 1200, 675],
      ]);
      expect(await snapshotDir(assetsPath)).toEqual(before);
    });

    test('list reports dimensions without touching the assets directory', async () => {
      await writeFile(join(assetsPath, 'photo.png'), pngBytes(1200, 675));
      const before = await snapshotDir(assetsPath);

      const assets = await ops.list();
      await settle();

      expect(assets.map((asset) => [asset.filename, asset.width, asset.height])).toEqual([['photo.png', 1200, 675]]);
      expect(await snapshotDir(assetsPath)).toEqual(before);
    });

    test('getAsset reports dimensions without touching the assets directory', async () => {
      await writeFile(join(assetsPath, 'photo.png'), pngBytes(1200, 675));
      const before = await snapshotDir(assetsPath);

      const asset = await ops.getAsset('photo.png');
      await settle();

      expect([asset?.width, asset?.height]).toEqual([1200, 675]);
      expect(await snapshotDir(assetsPath)).toEqual(before);
    });

    test('reports the size of the image on disk, not a stale stored one', async () => {
      await writeFile(join(assetsPath, 'photo.png'), pngBytes(1200, 675));
      await writeFile(
        join(assetsPath, '.asset-manifest.json'),
        JSON.stringify({ 'photo.png': { width: 999, height: 111 } }),
      );

      const asset = await ops.getAsset('photo.png');

      expect(asset?.width).toBe(1200);
      expect(asset?.height).toBe(675);
    });
  });

  describe('importFromUrl', () => {
    const originalFetch = globalThis.fetch;

    /** Create a mock fetch with the `preconnect` property required by Bun's `typeof fetch` */
    function mockFetch(impl: (...args: unknown[]) => unknown) {
      const mocked = mock(impl);
      (mocked as { preconnect?: () => void }).preconnect = () => {};
      globalThis.fetch = mocked as unknown as typeof fetch;
    }

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    test('returns error for private IP URL (SSRF blocked)', async () => {
      const result = await ops.importFromUrl('http://127.0.0.1/secret.jpg');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('private/reserved IP address');
      }
    });

    test('returns error for non-http scheme', async () => {
      const result = await ops.importFromUrl('file:///etc/passwd');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('http or https');
      }
    });

    test('returns error when fetch fails (network error)', async () => {
      mockFetch(() => Promise.reject(new Error('Network error')));
      const result = await ops.importFromUrl('https://example.com/image.jpg');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('Failed to fetch URL');
      }
    });

    test('returns error when response not ok (404)', async () => {
      mockFetch(() => Promise.resolve(new Response('Not Found', { status: 404 })));
      const result = await ops.importFromUrl('https://example.com/image.jpg');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('Fetch failed with status 404');
      }
    });

    test('returns error when Content-Length exceeds maxFileSize', async () => {
      const smallOps = new AssetOperations({ assetsPath, contentRoot, maxFileSize: 100 });
      mockFetch(() =>
        Promise.resolve(
          new Response(new Uint8Array(50), {
            status: 200,
            headers: {
              'content-length': '999999',
              'content-type': 'image/jpeg',
            },
          }),
        ),
      );
      const result = await smallOps.importFromUrl('https://example.com/big.jpg');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('Remote file too large');
      }
    });

    test('returns error when actual body exceeds maxFileSize', async () => {
      const smallOps = new AssetOperations({ assetsPath, contentRoot, maxFileSize: 50 });
      // No Content-Length header, but body is bigger than limit
      mockFetch(() =>
        Promise.resolve(
          new Response(new Uint8Array(100), {
            status: 200,
            headers: { 'content-type': 'image/jpeg' },
          }),
        ),
      );
      const result = await smallOps.importFromUrl('https://example.com/stealth-big.jpg');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('Remote file too large');
      }
    });

    test('stops reading an endless body once it passes maxFileSize', async () => {
      const smallOps = new AssetOperations({ assetsPath, contentRoot, maxFileSize: 50 });
      let cancelled = false;
      const endless = new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.enqueue(new Uint8Array(16));
        },
        cancel() {
          cancelled = true;
        },
      });
      mockFetch(() =>
        Promise.resolve(new Response(endless, { status: 200, headers: { 'content-type': 'image/jpeg' } })),
      );
      const result = await smallOps.importFromUrl('https://example.com/endless.jpg');
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toContain('Remote file too large');
      expect(cancelled).toBe(true);
    });

    test('times out a body that stalls after the headers arrive', async () => {
      const slowOps = new AssetOperations({ assetsPath, contentRoot, importTimeoutMs: 50 });
      mockFetch((_url: unknown, init: unknown) => {
        const signal = (init as RequestInit).signal as AbortSignal;
        const stalled = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array(4));
            signal.addEventListener('abort', () => controller.error(signal.reason));
          },
        });
        return Promise.resolve(new Response(stalled, { status: 200, headers: { 'content-type': 'image/jpeg' } }));
      });
      const result = await slowOps.importFromUrl('https://example.com/stalled.jpg');
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toContain('timed out');
    });

    test('succeeds for valid public URL with valid image response', async () => {
      const imageData = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
      mockFetch(() =>
        Promise.resolve(
          new Response(imageData, {
            status: 200,
            headers: { 'content-type': 'image/jpeg' },
          }),
        ),
      );
      const result = await ops.importFromUrl('https://example.com/photo.jpg');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.asset.mimeType).toBe('image/jpeg');
        expect(result.asset.originalName).toBe('photo.jpg');
      }
    });

    test('returns the dimensions of the imported image', async () => {
      mockFetch(() =>
        Promise.resolve(
          new Response(pngBytes(800, 600), {
            status: 200,
            headers: { 'content-type': 'image/png' },
          }),
        ),
      );
      const result = await ops.importFromUrl('https://example.com/remote.png');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.asset.width).toBe(800);
        expect(result.asset.height).toBe(600);
      }
    });

    /** Record every URL the code requests, answering with the given responses in order */
    function mockRedirects(handler: (target: string) => Response): string[] {
      const requested: string[] = [];
      mockFetch((input: unknown) => {
        const target = String(input);
        requested.push(target);
        return Promise.resolve(handler(target));
      });
      return requested;
    }

    /** A 3xx response pointing at `location` */
    function redirectTo(location: string): Response {
      return new Response(null, { status: 302, headers: { location } });
    }

    /** A 200 response carrying a tiny JPEG payload */
    function imageResponse(): Response {
      return new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), {
        status: 200,
        headers: { 'content-type': 'image/jpeg' },
      });
    }

    test('names an image imported by URL after the decoded file name in its address', async () => {
      mockFetch(() => Promise.resolve(imageResponse()));

      // An address keeps its file name percent-encoded: a space as %20, a Cyrillic letter as two %XX escapes
      const spaced = await ops.importFromUrl('https://example.com/My%20Photo.JPG');
      expect(spaced.success).toBe(true);
      if (spaced.success) {
        expect(spaced.asset.filename).toBe('my-photo.jpg');
        expect(spaced.asset.originalName).toBe('My Photo.JPG');
      }

      const cyrillic = await ops.importFromUrl('https://example.com/images/фото.jpg');
      expect(cyrillic.success).toBe(true);
      if (cyrillic.success) {
        expect(cyrillic.asset.filename).toBe('file.jpg');
        expect(cyrillic.asset.originalName).toBe('фото.jpg');
      }
    });

    test('names an image imported by URL after the part of its decoded name that follows the last slash', async () => {
      mockFetch(() => Promise.resolve(imageResponse()));

      // Some storage links hold the whole object path, encoded, in the last part of the address
      const stored = await ops.importFromUrl('https://example.com/v0/b/site/o/images%2FMy%20Photo.jpg?alt=media');
      expect(stored.success).toBe(true);
      if (stored.success) {
        expect(stored.asset.filename).toBe('my-photo.jpg');
        expect(stored.asset.originalName).toBe('My Photo.jpg');
      }

      // The folders a decoded slash or backslash names reach neither the assets folder nor the name the library shows
      for (const [address, name] of [
        ['https://example.com/..%2F..%2Fescape.jpg', 'escape.jpg'],
        ['https://example.com/..%5C..%5Cbackslash.jpg', 'backslash.jpg'],
      ]) {
        const result = await ops.importFromUrl(address);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.asset.filename).toBe(name);
          expect(result.asset.originalName).toBe(name);
        }
        expect(existsSync(join(assetsPath, name))).toBe(true);
      }
    });

    test('imports an image whose decoded name would hold a control character under the name as written', async () => {
      mockFetch(() => Promise.resolve(imageResponse()));
      const result = await ops.importFromUrl('https://example.com/photo%00%0A.jpg');
      expect(result.success).toBe(true);
      if (result.success) expect(result.asset.originalName).toBe('photo%00%0A.jpg');
    });

    test('imports an image whose address holds a malformed escape under the name as written', async () => {
      mockFetch(() => Promise.resolve(imageResponse()));
      const result = await ops.importFromUrl('https://example.com/bad%E0%A4%A.jpg');
      expect(result.success).toBe(true);
      if (result.success) expect(result.asset.originalName).toBe('bad%E0%A4%A.jpg');
    });

    test('refuses a redirect into a loopback address without requesting it', async () => {
      const requested = mockRedirects(() => redirectTo('http://127.0.0.1:8080/secret.jpg'));
      const result = await ops.importFromUrl('https://example.com/photo.jpg');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('private/reserved IP address');
      }
      // The loopback URL was never requested — the guard ran before the hop
      expect(requested).toEqual(['https://example.com/photo.jpg']);
    });

    test('refuses a redirect into the cloud metadata address without requesting it', async () => {
      const requested = mockRedirects(() => redirectTo('http://169.254.169.254/latest/meta-data/'));
      const result = await ops.importFromUrl('https://example.com/photo.jpg');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('private/reserved IP address');
      }
      expect(requested).toEqual(['https://example.com/photo.jpg']);
    });

    test('follows a redirect between public hosts', async () => {
      const requested = mockRedirects((target) =>
        target === 'https://example.com/photo.jpg' ? redirectTo('https://cdn.example.org/photo.jpg') : imageResponse(),
      );
      const result = await ops.importFromUrl('https://example.com/photo.jpg');
      expect(result.success).toBe(true);
      expect(requested).toEqual(['https://example.com/photo.jpg', 'https://cdn.example.org/photo.jpg']);
    });

    test('resolves a relative Location against the current URL and follows it', async () => {
      const requested = mockRedirects((target) =>
        target === 'https://example.com/a/photo.jpg' ? redirectTo('/images/photo.jpg') : imageResponse(),
      );
      const result = await ops.importFromUrl('https://example.com/a/photo.jpg');
      expect(result.success).toBe(true);
      expect(requested).toEqual(['https://example.com/a/photo.jpg', 'https://example.com/images/photo.jpg']);
    });

    test('fails closed once the redirect budget is exhausted', async () => {
      let hop = 0;
      const requested = mockRedirects(() => {
        hop += 1;
        return redirectTo(`https://example.com/hop-${hop}.jpg`);
      });
      const result = await ops.importFromUrl('https://example.com/photo.jpg');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('Too many redirects');
      }
      // Initial request plus the 5 permitted hops
      expect(requested.length).toBe(6);
    });

    test('fails closed on a redirect with no Location header', async () => {
      mockRedirects(() => new Response(null, { status: 302 }));
      const result = await ops.importFromUrl('https://example.com/photo.jpg');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('Location');
      }
    });

    test('fails closed on a redirect with an unparseable Location header', async () => {
      const requested = mockRedirects(() => redirectTo('http://[not-a-url'));
      const result = await ops.importFromUrl('https://example.com/photo.jpg');
      expect(result.success).toBe(false);
      expect(requested).toEqual(['https://example.com/photo.jpg']);
    });

    test('fails closed on a redirect to a non-http scheme', async () => {
      const requested = mockRedirects(() => redirectTo('file:///etc/passwd'));
      const result = await ops.importFromUrl('https://example.com/photo.jpg');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('http or https');
      }
      expect(requested).toEqual(['https://example.com/photo.jpg']);
    });
  });

  describe('moveAssets', () => {
    test('moves file from source to target folder on disk and in manifest', async () => {
      // Create source and target folders
      await mkdir(join(assetsPath, 'source'), { recursive: true });
      await mkdir(join(assetsPath, 'target'), { recursive: true });
      // Create a file in source
      await writeFile(join(assetsPath, 'source', 'photo.jpg'), new Uint8Array([0xff, 0xd8]));
      const result = await ops.moveAssets(['photo.jpg'], '/source', '/target');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.moved).toBe(1);
      }
      // Verify file moved on disk
      const movedContent = await readFile(join(assetsPath, 'target', 'photo.jpg'));
      expect(movedContent).toBeDefined();
    });

    test('returns error for non-existent source folder', async () => {
      await mkdir(join(assetsPath, 'target'), { recursive: true });
      const result = await ops.moveAssets(['photo.jpg'], '/nonexistent', '/target');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('Source folder does not exist');
      }
    });

    test('returns error for non-existent target folder', async () => {
      await mkdir(join(assetsPath, 'source'), { recursive: true });
      const result = await ops.moveAssets(['photo.jpg'], '/source', '/nonexistent');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('Target folder does not exist');
      }
    });

    test('returns error for path traversal in folder paths', async () => {
      const result = await ops.moveAssets(['photo.jpg'], '/../../etc', '/');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('Invalid folder path');
      }
    });
  });

  describe('updateMetadata', () => {
    test('updates alt text in manifest for existing asset', async () => {
      // Upload a file first
      await ops.upload(createTestFile('meta.jpg', 50));
      const result = await ops.updateMetadata('meta.jpg', { alt: 'New alt text' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.asset.alt).toBe('New alt text');
      }
    });

    test('clears alt and tags when the patch sets them to null', async () => {
      // The sidebar saves on blur; a cleared field used to travel as
      // undefined, which JSON.stringify drops from the request body, so the
      // manifest merge kept the old value on exactly the path the editor
      // uses. Null is the wire form of clear, matching content metadata.
      await ops.upload(createTestFile('clearable.jpg', 50));
      await ops.updateMetadata('clearable.jpg', { alt: 'Doomed', tags: ['a', 'b'] });

      const result = await ops.updateMetadata('clearable.jpg', { alt: null, tags: null });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.asset.alt).toBeUndefined();
        expect(result.asset.tags).toBeUndefined();
      }
    });

    test('returns error for non-existent asset', async () => {
      const result = await ops.updateMetadata('nonexistent.jpg', { alt: 'test' });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe('Asset not found');
      }
    });
  });

  describe('resolveFilename collision resolution', () => {
    test('appends incrementing suffix for 3+ collisions', async () => {
      // Upload photo.jpg 3 times -- should produce photo.jpg, photo-1.jpg, photo-2.jpg
      const r1 = await ops.upload(createTestFile('photo.jpg', 100));
      expect(r1.success).toBe(true);
      if (r1.success) expect(r1.asset.filename).toBe('photo.jpg');

      const r2 = await ops.upload(createTestFile('photo.jpg', 100));
      expect(r2.success).toBe(true);
      if (r2.success) expect(r2.asset.filename).toBe('photo-1.jpg');

      const r3 = await ops.upload(createTestFile('photo.jpg', 100));
      expect(r3.success).toBe(true);
      if (r3.success) expect(r3.asset.filename).toBe('photo-2.jpg');
    });

    test('resolves collisions within subfolders', async () => {
      // Create /photos folder, upload beach.jpg to /photos twice
      await mkdir(join(assetsPath, 'photos'), { recursive: true });

      const r1 = await ops.upload(createTestFile('beach.jpg', 100), { folder: '/photos' });
      expect(r1.success).toBe(true);
      if (r1.success) expect(r1.asset.filename).toBe('beach.jpg');

      const r2 = await ops.upload(createTestFile('beach.jpg', 100), { folder: '/photos' });
      expect(r2.success).toBe(true);
      if (r2.success) expect(r2.asset.filename).toBe('beach-1.jpg');
    });

    test('sanitizes AND deduplicates filenames', async () => {
      // Upload "My Photo.jpg" twice -- should produce my-photo.jpg, my-photo-1.jpg
      const r1 = await ops.upload(createTestFile('My Photo.jpg', 100));
      expect(r1.success).toBe(true);
      if (r1.success) expect(r1.asset.filename).toBe('my-photo.jpg');

      const r2 = await ops.upload(createTestFile('My Photo.jpg', 100));
      expect(r2.success).toBe(true);
      if (r2.success) expect(r2.asset.filename).toBe('my-photo-1.jpg');
    });

    test('names an accented Latin upload by its base letters, whatever the Unicode form of the name', async () => {
      // The same visible 'Café' comes as one precomposed letter or as 'e' plus a combining accent (common
      // on macOS); 'Über' is precomposed, and the last name is written in fullwidth letters
      const names = ['Café.png', 'Café.png', 'Über uns.png', 'Ｐｈｏｔｏ.png'];
      const filenames: string[] = [];
      for (const name of names) {
        const result = await ops.upload(createTestFile(name, 100, 'image/png'));
        expect(result.success).toBe(true);
        if (result.success) filenames.push(result.asset.filename);
      }
      expect(filenames).toEqual(['cafe.png', 'cafe-1.png', 'uber-uns.png', 'photo.png']);
    });

    test('keeps an upload named only in non-Latin letters visible in the media library', async () => {
      // Every letter of these names falls outside the kept alphabet: a bare extension would be a hidden
      // dot-file, and the words of a longer name would leave only the dashes between them
      const names = ['фото.png', '照片.PNG', 'мой фото.png', 'фото-кота.png'];
      const filenames: string[] = [];
      for (const name of names) {
        const result = await ops.upload(createTestFile(name, 100, 'image/png'));
        expect(result.success).toBe(true);
        if (result.success) filenames.push(result.asset.filename);
      }
      expect(filenames).toEqual(['file.png', 'file-1.png', 'file-2.png', 'file-3.png']);

      // The library lists every one of them under the name it was uploaded with
      const listing = await ops.listFolder('/');
      const shownNames = Object.fromEntries(listing.assets.map((asset) => [asset.filename, asset.originalName]));
      expect(shownNames).toEqual({
        'file.png': 'фото.png',
        'file-1.png': '照片.PNG',
        'file-2.png': 'мой фото.png',
        'file-3.png': 'фото-кота.png',
      });
    });

    test('keeps every image when several uploads whose names clean alike arrive at once', async () => {
      // The editor sends a multi-file selection as parallel requests, and all three names clean to 'file'
      const uploads = [
        { name: 'фото.png', bytes: new Uint8Array([1, 1, 1]) },
        { name: 'снимок.png', bytes: new Uint8Array([2, 2, 2]) },
        { name: 'картинка.png', bytes: new Uint8Array([3, 3, 3]) },
      ];
      const results = await Promise.all(
        uploads.map(({ name, bytes }) => ops.upload(new File([bytes], name, { type: 'image/png' }))),
      );
      const filenames = results.map((result) => (result.success ? result.asset.filename : result.error));
      expect([...filenames].sort()).toEqual(['file-1.png', 'file-2.png', 'file.png']);

      // Each file holds the bytes of the upload that was given its name, and the library shows that upload's name
      for (const [index, filename] of filenames.entries()) {
        expect(new Uint8Array(await readFile(join(assetsPath, filename)))).toEqual(uploads[index].bytes);
      }
      const listing = await ops.listFolder('/');
      const shownNames = Object.fromEntries(listing.assets.map((asset) => [asset.filename, asset.originalName]));
      expect(shownNames).toEqual(
        Object.fromEntries(filenames.map((filename, index) => [filename, uploads[index].name])),
      );
    });

    test('gives an upload the next name when a broken link holds its name, without writing through the link', async () => {
      await symlink(join(assetsPath, 'missing.png'), join(assetsPath, 'photo.png'));

      const result = await ops.upload(createTestFile('photo.png', 100, 'image/png'));
      expect(result.success).toBe(true);
      if (result.success) expect(result.asset.filename).toBe('photo-1.png');
      expect(existsSync(join(assetsPath, 'missing.png'))).toBe(false);
    });

    test('saves a very long upload name cut to 200 characters, so a second copy still fits with its number', async () => {
      // 254 bytes fit the 255-byte file name limit; the '-1' of a second copy would not
      const longName = `${'a'.repeat(250)}.png`;
      const r1 = await ops.upload(createTestFile(longName, 100, 'image/png'));
      expect(r1.success).toBe(true);
      if (r1.success) {
        expect(r1.asset.filename).toBe(`${'a'.repeat(200)}.png`);
        expect(r1.asset.originalName).toBe(longName);
      }

      const r2 = await ops.upload(createTestFile(longName, 100, 'image/png'));
      expect(r2.success).toBe(true);
      if (r2.success) {
        expect(r2.asset.filename).toBe(`${'a'.repeat(200)}-1.png`);
        expect(r2.asset.originalName).toBe(longName);
      }
    });
  });

  describe('getFolderTree', () => {
    test('returns root node with correct asset count', async () => {
      await writeFile(join(assetsPath, 'a.jpg'), new Uint8Array([0xff]));
      await writeFile(join(assetsPath, 'b.png'), new Uint8Array([0x89]));
      const tree = await ops.getFolderTree();
      expect(tree).toHaveLength(1); // Root node
      expect(tree[0].name).toBe('Root');
      expect(tree[0].path).toBe('/');
      expect(tree[0].assetCount).toBe(2);
    });

    test('returns nested folder structure', async () => {
      await mkdir(join(assetsPath, 'photos'), { recursive: true });
      await mkdir(join(assetsPath, 'photos', 'vacation'), { recursive: true });
      await writeFile(join(assetsPath, 'photos', 'pic.jpg'), new Uint8Array([0xff]));
      await writeFile(join(assetsPath, 'photos', 'vacation', 'beach.jpg'), new Uint8Array([0xff]));
      const tree = await ops.getFolderTree();
      expect(tree[0].children).toHaveLength(1);
      expect(tree[0].children[0].name).toBe('photos');
      expect(tree[0].children[0].assetCount).toBe(1); // pic.jpg
      expect(tree[0].children[0].children).toHaveLength(1);
      expect(tree[0].children[0].children[0].name).toBe('vacation');
      expect(tree[0].children[0].children[0].assetCount).toBe(1); // beach.jpg
    });
  });

  describe('a folder beside the assets folder whose name starts with the same name', () => {
    let besidePath: string;
    let beside: string;

    beforeEach(() => {
      besidePath = `${assetsPath}-evil`;
      beside = `../${basename(besidePath)}`;
    });

    afterEach(async () => {
      await rm(besidePath, { recursive: true, force: true });
    });

    test('an upload into it is refused and writes nothing there', async () => {
      const result = await ops.upload(createTestFile('photo.jpg', 100), { folder: beside });

      expect(result).toEqual({ success: false, error: 'Invalid folder path' });
      expect(existsSync(besidePath)).toBe(false);
    });

    test('creating it as a folder is refused', async () => {
      const result = await ops.createFolder(beside);

      expect(result).toEqual({ success: false, error: 'Invalid folder path' });
      expect(existsSync(besidePath)).toBe(false);
    });

    test('moving an asset into it is refused and the asset stays put', async () => {
      await mkdir(besidePath, { recursive: true });
      await writeFile(join(assetsPath, 'photo.jpg'), new Uint8Array([0xff, 0xd8]));

      const result = await ops.moveAssets(['photo.jpg'], '/', beside);

      expect(result).toEqual({ success: false, error: 'Invalid folder path' });
      expect(existsSync(join(assetsPath, 'photo.jpg'))).toBe(true);
      expect(existsSync(join(besidePath, 'photo.jpg'))).toBe(false);
    });
  });

  describe('a moved filename that is not a plain asset name', () => {
    // The folders were checked, but each moved name was joined onto them unchecked, so a name
    // with `..` in it carried a file into or out of the assets folder.
    let siteRoot: string;
    let siteAssets: string;
    let siteOps: AssetOperations;

    beforeEach(async () => {
      siteRoot = makeTempPath('asset-site');
      siteAssets = join(siteRoot, 'public', 'assets');
      await mkdir(join(siteAssets, 'a', 'b'), { recursive: true });
      await writeFile(join(siteRoot, '.env'), 'API_SECRET=hunter2');
      await writeFile(join(siteAssets, 'pic2.jpg'), new Uint8Array([0xff, 0xd8]));
      siteOps = new AssetOperations({ assetsPath: siteAssets, contentRoot: join(siteRoot, 'content') });
    });

    afterEach(async () => {
      await rm(siteRoot, { recursive: true, force: true });
    });

    test("a name that climbs to the site's own files is refused and the file stays put", async () => {
      const result = await siteOps.moveAssets(['../../.env'], '/', 'a/b');

      expect(result).toEqual({ success: false, error: 'Invalid filename' });
      expect(await readFile(join(siteRoot, '.env'), 'utf8')).toBe('API_SECRET=hunter2');
      expect(existsSync(join(siteAssets, 'a', 'b', '.env'))).toBe(false);
    });

    test('a name that climbs out of the assets folder is refused and the asset stays put', async () => {
      const result = await siteOps.moveAssets(['../pic2.jpg'], 'a', '/');

      expect(result).toEqual({ success: false, error: 'Invalid filename' });
      expect(existsSync(join(siteAssets, 'pic2.jpg'))).toBe(true);
      expect(existsSync(join(siteRoot, 'public', 'pic2.jpg'))).toBe(false);
    });

    test('one such name refuses the whole move, so no other file in it moves either', async () => {
      const result = await siteOps.moveAssets(['pic2.jpg', '../../.env'], '/', 'a/b');

      expect(result).toEqual({ success: false, error: 'Invalid filename' });
      expect(existsSync(join(siteAssets, 'pic2.jpg'))).toBe(true);
      expect(existsSync(join(siteAssets, 'a', 'b', 'pic2.jpg'))).toBe(false);
    });

    test('an empty name, a bare folder step or a name with a folder in it is refused', async () => {
      for (const name of ['', '.', '..', 'b/pic.jpg', '..\\..\\.env']) {
        const result = await siteOps.moveAssets([name], 'a', '/');

        expect({ name, result }).toEqual({ name, result: { success: false, error: 'Invalid filename' } });
      }
      expect(existsSync(join(siteAssets, 'a', 'b'))).toBe(true);
    });

    test("a system file such as the folder's own manifest is refused and stays put", async () => {
      await siteOps.updateMetadata('pic2.jpg', { alt: 'A picture' });

      for (const name of ['.asset-manifest.json', '.DS_Store']) {
        // Per-asset metadata no longer creates the legacy manifest here, so
        // create the exact system file this iteration is proving immovable.
        await writeFile(join(siteAssets, name), '');
        const result = await siteOps.moveAssets([name], '/', 'a');

        expect({ name, result }).toEqual({ name, result: { success: false, error: 'Invalid filename' } });
        expect({ name, exists: existsSync(join(siteAssets, name)) }).toEqual({ name, exists: true });
      }
      expect((await siteOps.getAsset('pic2.jpg'))?.alt).toBe('A picture');
    });

    test('a name that is not a string refuses the whole move before any file moves', async () => {
      // The route passes the request body's names on unchecked, so a JSON body can hold any value.
      for (const filenames of [
        JSON.parse('["pic2.jpg", 1]'),
        JSON.parse('["pic2.jpg", null]'),
        JSON.parse('["pic2.jpg", {}]'),
      ]) {
        const result = await siteOps.moveAssets(filenames, '/', 'a');

        expect(result).toEqual({ success: false, error: 'Invalid filename' });
        expect(existsSync(join(siteAssets, 'pic2.jpg'))).toBe(true);
        expect(existsSync(join(siteAssets, 'a', 'pic2.jpg'))).toBe(false);
      }
    });
  });

  describe('a move onto a name the target folder already has', () => {
    // The move renamed straight over the file already there, and its manifest entry (alt text,
    // tags) was replaced by the moved file's, so the other picture was gone without a word.
    beforeEach(async () => {
      await mkdir(join(assetsPath, 'archive'), { recursive: true });
      await writeFile(join(assetsPath, 'photo.jpg'), 'new photo');
      await writeFile(join(assetsPath, 'other.jpg'), 'other photo');
      await writeFile(join(assetsPath, 'archive', 'photo.jpg'), 'archived photo');
      await ops.updateMetadata('photo.jpg', { alt: 'New photo' }, '/');
      await ops.updateMetadata('photo.jpg', { alt: 'Archived photo' }, '/archive');
    });

    test('is refused, and the file already there keeps its content and alt text', async () => {
      const result = await ops.moveAssets(['photo.jpg'], '/', '/archive');

      expect(result).toEqual({ success: false, error: 'Already in the target folder: photo.jpg' });
      expect(await readFile(join(assetsPath, 'archive', 'photo.jpg'), 'utf8')).toBe('archived photo');
      expect(await readFile(join(assetsPath, 'photo.jpg'), 'utf8')).toBe('new photo');
      expect(await ops.getAsset('photo.jpg', '/archive')).toMatchObject({ alt: 'Archived photo' });
      expect(await ops.getAsset('photo.jpg', '/')).toMatchObject({ alt: 'New photo' });
    });

    test('refuses the whole move, so no other file in it moves either', async () => {
      const result = await ops.moveAssets(['other.jpg', 'photo.jpg'], '/', '/archive');

      expect(result).toEqual({ success: false, error: 'Already in the target folder: photo.jpg' });
      expect(existsSync(join(assetsPath, 'other.jpg'))).toBe(true);
      expect(existsSync(join(assetsPath, 'archive', 'other.jpg'))).toBe(false);
    });

    test('counts a name the target folder has in other capitals as the same name', async () => {
      // A disk that ignores letter case, like the default one on macOS and Windows, keeps both
      // names as one file, so the move would overwrite it there and a checkout of the site could not hold both.
      await writeFile(join(assetsPath, 'Banner.jpg'), 'new banner');
      await writeFile(join(assetsPath, 'archive', 'banner.JPG'), 'archived banner');

      const result = await ops.moveAssets(['Banner.jpg'], '/', '/archive');

      expect(result).toEqual({ success: false, error: 'Already in the target folder: Banner.jpg' });
      expect(await readFile(join(assetsPath, 'archive', 'banner.JPG'), 'utf8')).toBe('archived banner');
      expect(existsSync(join(assetsPath, 'Banner.jpg'))).toBe(true);
    });
  });

  describe('a moved name that is a folder rather than a file', () => {
    // The rename carried the whole folder, but the manifest entries of the assets inside it stayed
    // under their old paths, so every one of them lost its alt text and tags.
    beforeEach(async () => {
      await mkdir(join(assetsPath, 'trip'), { recursive: true });
      await mkdir(join(assetsPath, 'archive'), { recursive: true });
      await writeFile(join(assetsPath, 'trip', 'beach.jpg'), 'beach');
      await writeFile(join(assetsPath, 'photo.jpg'), 'photo');
      await ops.updateMetadata('beach.jpg', { alt: 'Beach' }, '/trip');
    });

    test('is refused, and the folder stays put with its assets and their alt text', async () => {
      const result = await ops.moveAssets(['trip'], '/', '/archive');

      expect(result).toEqual({ success: false, error: 'Not a file: trip' });
      expect(existsSync(join(assetsPath, 'archive', 'trip'))).toBe(false);
      expect((await ops.getAsset('beach.jpg', '/trip'))?.alt).toBe('Beach');
    });

    test('refuses the whole move, so no file in it moves either', async () => {
      const result = await ops.moveAssets(['photo.jpg', 'trip'], '/', '/archive');

      expect(result).toEqual({ success: false, error: 'Not a file: trip' });
      expect(existsSync(join(assetsPath, 'photo.jpg'))).toBe(true);
      expect(existsSync(join(assetsPath, 'archive', 'photo.jpg'))).toBe(false);
    });

    test('a link is refused too, as the listings the editor moves from leave links out', async () => {
      await symlink(join(assetsPath, 'photo.jpg'), join(assetsPath, 'link.jpg'));

      const result = await ops.moveAssets(['link.jpg'], '/', '/archive');

      expect(result).toEqual({ success: false, error: 'Not a file: link.jpg' });
      expect(existsSync(join(assetsPath, 'archive', 'link.jpg'))).toBe(false);
    });
  });
});

/**
 * The interleavings that lose a picture's alt text. Every one of these builds a
 * fresh AssetOperations per "request", because that is what the Astro handler
 * does — the shared-instance versions of these tests passed while the product
 * was broken.
 */
describe('asset metadata survives concurrent editors', () => {
  let assetsPath: string;
  let contentRoot: string;

  beforeEach(async () => {
    assetsPath = makeTempPath('asset-meta');
    contentRoot = makeTempPath('asset-meta-content');
    await mkdir(assetsPath, { recursive: true });
    await mkdir(contentRoot, { recursive: true });
  });

  afterEach(async () => {
    await chmod(assetsPath, 0o755).catch(() => {});
    await rm(assetsPath, { recursive: true, force: true });
    await rm(contentRoot, { recursive: true, force: true });
  });

  /** One AssetOperations per call — the way a request handler builds them */
  function perRequest(): AssetOperations {
    return new AssetOperations({ assetsPath, contentRoot });
  }

  async function seedImage(relativePath: string, width = 1200, height = 675): Promise<void> {
    const full = join(assetsPath, relativePath);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, pngBytes(width, height));
  }

  async function altOf(filename: string, folder = '/'): Promise<string | undefined> {
    return (await perRequest().getAsset(filename, folder))?.alt;
  }

  test('two editors saving two different images keep both alt texts', async () => {
    await seedImage('hero.png');
    await seedImage('logo.png');

    await Promise.all([
      perRequest().updateMetadata('hero.png', { alt: 'editor A: our team at work' }),
      perRequest().updateMetadata('logo.png', { alt: 'editor B: the company mark' }),
    ]);

    expect(await altOf('hero.png')).toBe('editor A: our team at work');
    expect(await altOf('logo.png')).toBe('editor B: the company mark');
  });

  test('browsing a folder while someone saves does not lose the save', async () => {
    for (let i = 0; i < 10; i += 1) await seedImage(`img-${i}.png`);

    const browsing = perRequest().listFolder('/');
    const saving = perRequest().updateMetadata('img-7.png', { alt: 'saved while browsing' });
    await Promise.all([browsing, saving]);

    expect(await altOf('img-7.png')).toBe('saved while browsing');
  });

  test('a recursive listing while someone saves does not lose the save', async () => {
    for (let i = 0; i < 10; i += 1) await seedImage(`img-${i}.png`);

    const browsing = perRequest().list();
    const saving = perRequest().updateMetadata('img-3.png', { alt: 'saved while listing' });
    await Promise.all([browsing, saving]);

    expect(await altOf('img-3.png')).toBe('saved while listing');
  });

  test('a recursive listing carries each subfolder image its own metadata', async () => {
    await seedImage('root.png');
    await seedImage('uploads/deep.png');
    await seedImage('uploads/nested/deeper.png');
    await perRequest().updateMetadata('root.png', { alt: 'at the root' });
    await perRequest().updateMetadata('deep.png', { alt: 'one down' }, '/uploads');
    await perRequest().updateMetadata('deeper.png', { alt: 'two down' }, '/uploads/nested');

    const assets = await perRequest().list();

    expect(new Map(assets.map((asset) => [asset.filename, asset.alt]))).toEqual(
      new Map([
        ['root.png', 'at the root'],
        ['deep.png', 'one down'],
        ['deeper.png', 'two down'],
      ]),
    );
  });

  test('a save never reports success carrying a value it did not store', async () => {
    for (let i = 0; i < 10; i += 1) await seedImage(`img-${i}.png`);

    const [, saved] = await Promise.all([
      perRequest().listFolder('/'),
      perRequest().updateMetadata('img-7.png', { alt: 'what the editor typed' }),
    ]);

    expect(saved.success).toBe(true);
    if (saved.success) {
      expect(saved.asset.alt).toBe('what the editor typed');
    }
    expect(await altOf('img-7.png')).toBe('what the editor typed');
  });

  test('two tabs editing one image on different fields keep both fields', async () => {
    await seedImage('hero.png');

    await Promise.all([
      perRequest().updateMetadata('hero.png', { alt: 'two tabs alt' }),
      perRequest().updateMetadata('hero.png', { tags: ['hero', 'banner'] }),
    ]);

    const asset = await perRequest().getAsset('hero.png');
    expect(asset?.alt).toBe('two tabs alt');
    expect(asset?.tags).toEqual(['hero', 'banner']);
  });

  test('moving images while someone saves does not lose the save', async () => {
    await mkdir(join(assetsPath, 'source'), { recursive: true });
    await mkdir(join(assetsPath, 'target'), { recursive: true });
    await seedImage('source/one.png');
    await seedImage('source/two.png');
    await seedImage('bystander.png');
    await perRequest().updateMetadata('one.png', { alt: 'one' }, '/source');

    const [moved] = await Promise.all([
      perRequest().moveAssets(['one.png', 'two.png'], '/source', '/target'),
      perRequest().updateMetadata('bystander.png', { alt: 'untouched by the move' }),
    ]);

    expect(moved.success).toBe(true);
    expect(await altOf('bystander.png')).toBe('untouched by the move');
    expect(await altOf('one.png', '/target')).toBe('one');
  });

  test('two operating-system processes each saving 25 images keep all 50', async () => {
    for (let i = 0; i < 50; i += 1) await seedImage(`img-${i}.png`);

    const moduleUrl = new URL('../src/asset-operations.ts', import.meta.url).href;
    const scriptPath = `${assetsPath}-saver.ts`;
    await writeFile(
      scriptPath,
      [
        `import { AssetOperations } from ${JSON.stringify(moduleUrl)};`,
        'const [dir, contentRoot, startArg] = process.argv.slice(2);',
        'const start = Number(startArg);',
        'const ops = new AssetOperations({ assetsPath: dir, contentRoot });',
        'await Promise.all(',
        '  Array.from({ length: 25 }, (_, i) => ops.updateMetadata(`img-${start + i}.png`, { alt: `alt ${start + i}` })),',
        ');',
      ].join('\n'),
    );

    try {
      const children = [0, 25].map((start) =>
        Bun.spawn({
          cmd: ['bun', 'run', scriptPath, assetsPath, contentRoot, String(start)],
          stdout: 'pipe',
          stderr: 'pipe',
        }),
      );
      const codes = await Promise.all(children.map((child) => child.exited));
      expect(codes).toEqual([0, 0]);

      const assets = await perRequest().list();
      const alts = new Map(assets.map((asset) => [asset.filename, asset.alt]));
      const missing = Array.from({ length: 50 }, (_, i) => `img-${i}.png`).filter(
        (name) => alts.get(name) !== `alt ${name.slice(4, -4)}`,
      );
      expect(missing).toEqual([]);
    } finally {
      await rm(scriptPath, { force: true });
    }
  });
});

/**
 * A site serves its media folder as it is, dotfiles included, so anything the
 * CMS writes there is published. What a person wrote about a picture is the
 * CMS's own record: it belongs under the content root, which is committed but
 * never served.
 */
describe('asset metadata stays out of the served media folder', () => {
  let project: string;
  let assetsPath: string;
  let contentRoot: string;

  beforeEach(async () => {
    project = makeTempPath('asset-served');
    assetsPath = join(project, 'public', 'assets');
    contentRoot = join(project, 'content');
    await mkdir(assetsPath, { recursive: true });
    await mkdir(contentRoot, { recursive: true });
  });

  afterEach(async () => {
    await rm(project, { recursive: true, force: true });
  });

  function perRequest(): AssetOperations {
    return new AssetOperations({ assetsPath, contentRoot });
  }

  /** Every file below a folder, dotfiles included, as sorted relative paths */
  async function filesUnder(dir: string): Promise<string[]> {
    const files: string[] = [];
    for (const path of await readdir(dir, { recursive: true })) {
      if ((await stat(join(dir, path))).isFile()) files.push(path);
    }
    return files.sort();
  }

  function recordUnderContentRoot(relativePath: string): string {
    return join(contentRoot, '.asset-metadata', `${relativePath}.json`);
  }

  test('an upload and an alt-text save leave nothing but the image in the served folder', async () => {
    const uploaded = await perRequest().upload(new File([pngBytes(10, 20)], 'Hero.png', { type: 'image/png' }), {
      folder: '/uploads',
    });
    expect(uploaded.success).toBe(true);
    const saved = await perRequest().updateMetadata('hero.png', { alt: 'Our team', tags: ['people'] }, '/uploads');
    expect(saved.success).toBe(true);

    // The upload also writes the Git LFS rules for the media folder; that file is the site's, not the CMS's record
    expect((await filesUnder(assetsPath)).filter((path) => path !== '.gitattributes')).toEqual(['uploads/hero.png']);
    expect(JSON.parse(await readFile(recordUnderContentRoot('uploads/hero.png'), 'utf-8'))).toMatchObject({
      alt: 'Our team',
      tags: ['people'],
      originalName: 'Hero.png',
    });
    expect((await perRequest().getAsset('hero.png', '/uploads'))?.alt).toBe('Our team');
  });

  test('migrating a legacy manifest takes it and its backup out of the served folder', async () => {
    await writeFile(join(assetsPath, 'hero.png'), pngBytes(1200, 675));
    await writeFile(
      join(assetsPath, '.asset-manifest.json'),
      JSON.stringify({ 'hero.png': { alt: 'Old alt', uploadedBy: 'someone@example.com' } }),
    );

    const saved = await perRequest().updateMetadata('hero.png', { tags: ['t'] });
    expect(saved.success).toBe(true);

    expect(await filesUnder(assetsPath)).toEqual(['hero.png']);
    expect(JSON.parse(await readFile(recordUnderContentRoot('hero.png'), 'utf-8'))).toEqual({
      alt: 'Old alt',
      uploadedBy: 'someone@example.com',
      tags: ['t'],
    });
  });

  test('a router given a media folder but no content root refuses to start', () => {
    const api = new InMemoryContentAPI({
      sites: { shop: { locales: ['en'], defaultLocale: 'en' } },
      globalLocales: ['en'],
    });

    // Falling back to the media folder would publish every record again
    expect(() => createContentAPIRouter(api, { assetsPath })).toThrow(/assetsPath.*contentRoot/);
  });
});

describe('upgrading an existing .asset-manifest.json', () => {
  let assetsPath: string;
  let contentRoot: string;

  beforeEach(async () => {
    assetsPath = makeTempPath('asset-migrate');
    contentRoot = makeTempPath('asset-migrate-content');
    await mkdir(assetsPath, { recursive: true });
    await mkdir(contentRoot, { recursive: true });
  });

  afterEach(async () => {
    await chmod(assetsPath, 0o755).catch(() => {});
    await rm(assetsPath, { recursive: true, force: true });
    await rm(contentRoot, { recursive: true, force: true });
  });

  function perRequest(): AssetOperations {
    return new AssetOperations({ assetsPath, contentRoot });
  }

  async function seedImage(relativePath: string): Promise<void> {
    const full = join(assetsPath, relativePath);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, pngBytes(1200, 675));
  }

  function recordPath(relativePath: string): string {
    return join(contentRoot, '.asset-metadata', `${relativePath}.json`);
  }

  const legacy = {
    'hero.png': {
      alt: 'Our team at work',
      tags: ['hero', 'people'],
      originalName: 'Our Team At Work.PNG',
      uploadedAt: '2026-01-01T00:00:00.000Z',
      width: 999,
      height: 111,
    },
    'logo.png': { alt: 'The company mark', tags: ['brand'], originalName: 'logo.png' },
    'uploads/deep.png': { alt: 'In a subfolder', uploadedAt: '2026-02-02T00:00:00.000Z' },
  };

  async function seedLegacyManifest(data: unknown = legacy): Promise<string> {
    const raw = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    await writeFile(join(assetsPath, '.asset-manifest.json'), raw);
    return raw;
  }

  test('a save migrates every legacy entry and moves the old file next to the records', async () => {
    await seedImage('hero.png');
    await seedImage('logo.png');
    await seedImage('uploads/deep.png');
    await seedImage('fourth.png');
    const originalBytes = await seedLegacyManifest();

    const result = await perRequest().updateMetadata('fourth.png', { alt: 'the save that triggered it' });
    expect(result.success).toBe(true);

    expect(JSON.parse(await readFile(recordPath('hero.png'), 'utf-8'))).toEqual({
      alt: 'Our team at work',
      tags: ['hero', 'people'],
      originalName: 'Our Team At Work.PNG',
      uploadedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(JSON.parse(await readFile(recordPath('logo.png'), 'utf-8'))).toEqual({
      alt: 'The company mark',
      tags: ['brand'],
      originalName: 'logo.png',
    });
    expect(JSON.parse(await readFile(recordPath('uploads/deep.png'), 'utf-8'))).toEqual({
      alt: 'In a subfolder',
      uploadedAt: '2026-02-02T00:00:00.000Z',
    });

    await expect(stat(join(assetsPath, '.asset-manifest.json'))).rejects.toThrow();
    await expect(stat(join(assetsPath, '.asset-manifest.json.migrated'))).rejects.toThrow();
    expect(await readFile(join(contentRoot, '.asset-metadata', '.asset-manifest.json.migrated'), 'utf-8')).toBe(
      originalBytes,
    );
  });

  test('two first-saves-after-upgrade at once both land', async () => {
    await seedImage('hero.png');
    await seedImage('logo.png');
    await seedImage('uploads/deep.png');
    await seedLegacyManifest();

    const [a, b] = await Promise.all([
      perRequest().updateMetadata('hero.png', { alt: 'saved by A' }),
      perRequest().updateMetadata('logo.png', { alt: 'saved by B' }),
    ]);

    expect([a.success, b.success]).toEqual([true, true]);
    expect((await perRequest().getAsset('hero.png'))?.alt).toBe('saved by A');
    expect((await perRequest().getAsset('logo.png'))?.alt).toBe('saved by B');
  });

  test('a torn record is rebuilt from the legacy file rather than left empty', async () => {
    await seedImage('hero.png');
    await seedImage('fourth.png');
    await seedLegacyManifest();
    await mkdir(join(contentRoot, '.asset-metadata'), { recursive: true });
    await writeFile(recordPath('hero.png'), '');

    await perRequest().updateMetadata('fourth.png', { alt: 'trigger' });

    const hero = await perRequest().getAsset('hero.png');
    expect(hero?.alt).toBe('Our team at work');
    expect(hero?.tags).toEqual(['hero', 'people']);
    expect(hero?.originalName).toBe('Our Team At Work.PNG');
  });

  test('an unparseable manifest stops the save instead of wiping it', async () => {
    await seedImage('hero.png');
    await seedLegacyManifest(
      '<<<<<<< HEAD\n{"hero.png":{"alt":"mine"}}\n=======\n{"hero.png":{"alt":"theirs"}}\n>>>>>>> branch\n',
    );

    const result = await perRequest().updateMetadata('hero.png', { alt: 'this must not land' });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.reason).toBe('write-failed');
      expect(result.error).toContain('.asset-manifest.json');
    }
    await stat(join(assetsPath, '.asset-manifest.json'));
    await expect(stat(join(contentRoot, '.asset-metadata'))).rejects.toThrow();
  });

  test('an upload replaces a stale record rather than inheriting its alt text', async () => {
    await mkdir(join(contentRoot, '.asset-metadata'), { recursive: true });
    await writeFile(
      recordPath('hero.png'),
      JSON.stringify({ alt: 'metadata from the image that used to be here', tags: ['confidential'] }),
    );

    const uploaded = await perRequest().upload(new File([pngBytes(10, 20)], 'hero.png', { type: 'image/png' }));
    expect(uploaded.success).toBe(true);

    const asset = await perRequest().getAsset('hero.png');
    expect(asset?.alt).toBeUndefined();
    expect(asset?.tags).toBeUndefined();
  });
});

describe('asset metadata failures are reported, not swallowed', () => {
  let assetsPath: string;
  let contentRoot: string;

  beforeEach(async () => {
    assetsPath = makeTempPath('asset-failures');
    contentRoot = makeTempPath('asset-failures-content');
    await mkdir(assetsPath, { recursive: true });
    await mkdir(contentRoot, { recursive: true });
  });

  afterEach(async () => {
    await chmod(assetsPath, 0o755).catch(() => {});
    await chmod(contentRoot, 0o755).catch(() => {});
    await rm(assetsPath, { recursive: true, force: true });
    await rm(contentRoot, { recursive: true, force: true });
  });

  function perRequest(): AssetOperations {
    return new AssetOperations({ assetsPath, contentRoot });
  }

  test('a save that cannot be written reports write-failed', async () => {
    await writeFile(join(assetsPath, 'hero.png'), pngBytes(1200, 675));
    await chmod(contentRoot, 0o555);

    const result = await perRequest().updateMetadata('hero.png', { alt: 'nowhere to put this' });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.reason).toBe('write-failed');
    }
  });

  test('a listing of a read-only directory still reports dimensions and writes nothing', async () => {
    await writeFile(join(assetsPath, 'hero.png'), pngBytes(1200, 675));
    await chmod(assetsPath, 0o555);

    const listing = await perRequest().listFolder('/');

    expect(listing.assets.map((asset) => [asset.filename, asset.width, asset.height])).toEqual([
      ['hero.png', 1200, 675],
    ]);
    expect((await readdir(assetsPath)).sort()).toEqual(['hero.png']);
  });

  test('one unreadable record does not blank the rest of the folder', async () => {
    await mkdir(join(contentRoot, '.asset-metadata'), { recursive: true });
    for (let i = 0; i < 5; i += 1) {
      await writeFile(join(assetsPath, `img-${i}.png`), pngBytes(100, 100));
      await writeFile(
        join(contentRoot, '.asset-metadata', `img-${i}.png.json`),
        i === 2 ? '{ not json at all' : JSON.stringify({ alt: `alt ${i}` }),
      );
    }

    const listing = await perRequest().listFolder('/');

    expect(listing.assets).toHaveLength(5);
    const alts = new Map(listing.assets.map((asset) => [asset.filename, asset.alt]));
    expect(alts.get('img-0.png')).toBe('alt 0');
    expect(alts.get('img-1.png')).toBe('alt 1');
    expect(alts.get('img-2.png')).toBeUndefined();
    expect(alts.get('img-3.png')).toBe('alt 3');
    expect(alts.get('img-4.png')).toBe('alt 4');
  });

  test('readAssetFile refuses a path that is not a recognized image', async () => {
    await writeFile(join(assetsPath, 'notes.txt'), 'not an image');

    const result = await perRequest().readAssetFile('notes.txt');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('Asset not found');
    }
  });
});

describe('the asset routes stay inside the media library', () => {
  let container: string;
  let library: string;
  let contentRoot: string;
  let neighbour: string;
  const neighbourBytes = '{"this file":"has nothing to do with the media library"}';

  beforeEach(async () => {
    container = makeTempPath('asset-routes');
    library = join(container, 'assets');
    contentRoot = join(container, 'content');
    neighbour = join(container, 'sites.json');
    await mkdir(library, { recursive: true });
    await writeFile(neighbour, neighbourBytes);
  });

  afterEach(async () => {
    await rm(container, { recursive: true, force: true });
  });

  function routes() {
    const api = new InMemoryContentAPI({
      sites: { shop: { locales: ['en'], defaultLocale: 'en' } },
      globalLocales: ['en'],
    });
    return createContentAPIRouter(api, { assetsPath: library, contentRoot });
  }

  test('a delete whose path climbs out leaves the file next to the library alone', async () => {
    const res = await routes().fetch(new Request('http://localhost/assets/meta/..%2F..%2Fsites', { method: 'DELETE' }));

    expect(res.status).toBe(400);
    expect(await readFile(neighbour, 'utf-8')).toBe(neighbourBytes);
  });

  test('delete called directly with a climbing folder reports failure and deletes nothing', async () => {
    const result = await new AssetOperations({ assetsPath: library, contentRoot }).delete('sites', '/../..');

    expect(result.success).toBe(false);
    expect(await readFile(neighbour, 'utf-8')).toBe(neighbourBytes);
  });

  test('a folder whose name merely starts with the library folder name is not the library', async () => {
    // `assets-backup` is not inside `assets`, and a check on the first letters
    // of the path cannot tell the two apart
    const sibling = join(container, `${basename(library)}-backup`);
    await mkdir(sibling, { recursive: true });
    await writeFile(join(sibling, 'secret.png'), 'not part of the media library');

    const res = await routes().fetch(
      new Request(`http://localhost/assets/meta/..%2F${basename(sibling)}%2Fsecret.png`, { method: 'DELETE' }),
    );

    expect(res.status).toBe(400);
    expect(await readFile(join(sibling, 'secret.png'), 'utf-8')).toBe('not part of the media library');
  });

  test('a move whose filename climbs out leaves that file where it is', async () => {
    // The folders are checked, the names of the files are not — and a name is
    // free to hold `../` of its own
    await mkdir(join(library, 'a', 'b'), { recursive: true });
    await mkdir(join(library, 'c'), { recursive: true });
    const outsider = join(container, 'secret.png');
    await writeFile(outsider, 'lives outside the media library');

    const res = await routes().fetch(
      new Request('http://localhost/assets/move', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ filenames: ['../../secret.png'], sourceFolder: '/c', targetFolder: '/a/b' }),
      }),
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_REQUEST', message: 'Invalid filename' } });
    expect(await readFile(outsider, 'utf-8')).toBe('lives outside the media library');
    await expect(stat(join(library, 'secret.png'))).rejects.toThrow();
  });

  test('moving a picture onto its own folder answers, and the picture can still be saved afterwards', async () => {
    await writeFile(join(library, 'hero.png'), pngBytes(800, 600));
    const app = routes();

    const move = await withTimeout(
      app.fetch(
        new Request('http://localhost/assets/move', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ filenames: ['hero.png'], sourceFolder: '/', targetFolder: '/' }),
        }),
      ),
      'POST /assets/move with one folder for both ends',
    );
    expect(move.status).toBe(200);

    const save = await withTimeout(
      app.fetch(
        new Request('http://localhost/assets/meta/hero.png', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ alt: 'saved after the move' }),
        }),
      ),
      'the save after that move',
    );
    expect(save.status).toBe(200);

    expect((await new AssetOperations({ assetsPath: library, contentRoot }).getAsset('hero.png'))?.alt).toBe(
      'saved after the move',
    );
  });
});
