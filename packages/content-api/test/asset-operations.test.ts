import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AssetOperations } from '../src/asset-operations';

/** Create a minimal valid JPEG-like File for upload tests */
function createTestFile(name: string, sizeBytes = 100, type = 'image/jpeg'): File {
  const data = new Uint8Array(sizeBytes);
  return new File([data], name, { type });
}

/** Helper to create a temp dir with unique name */
function makeTempPath(prefix: string): string {
  return join(tmpdir(), `conloca-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

describe('AssetOperations', () => {
  let assetsPath: string;
  let ops: AssetOperations;

  beforeEach(async () => {
    assetsPath = makeTempPath('asset-ops');
    await mkdir(assetsPath, { recursive: true });
    ops = new AssetOperations({ assetsPath });
  });

  afterEach(async () => {
    await rm(assetsPath, { recursive: true, force: true });
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
      const smallOps = new AssetOperations({ assetsPath, maxFileSize: 50 });
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

    test('returns error for path traversal attempt', async () => {
      const result = await ops.createFolder('../../outside');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('Invalid folder path');
      }
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

  describe('importFromUrl', () => {
    const originalFetch = globalThis.fetch;

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
      globalThis.fetch = mock(() => Promise.reject(new Error('Network error')));
      const result = await ops.importFromUrl('https://example.com/image.jpg');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('Failed to fetch URL');
      }
    });

    test('returns error when response not ok (404)', async () => {
      globalThis.fetch = mock(() => Promise.resolve(new Response('Not Found', { status: 404 })));
      const result = await ops.importFromUrl('https://example.com/image.jpg');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('Fetch failed with status 404');
      }
    });

    test('returns error when Content-Length exceeds maxFileSize', async () => {
      const smallOps = new AssetOperations({ assetsPath, maxFileSize: 100 });
      globalThis.fetch = mock(() =>
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
      const smallOps = new AssetOperations({ assetsPath, maxFileSize: 50 });
      // No Content-Length header, but body is bigger than limit
      globalThis.fetch = mock(() =>
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

    test('succeeds for valid public URL with valid image response', async () => {
      const imageData = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
      globalThis.fetch = mock(() =>
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

    test('returns error for non-existent asset', async () => {
      const result = await ops.updateMetadata('nonexistent.jpg', { alt: 'test' });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe('Asset not found');
      }
    });
  });

  describe('getUsage', () => {
    test('returns empty when no contentRoot configured', async () => {
      const usages = await ops.getUsage('photo.jpg');
      expect(usages).toEqual([]);
    });

    test('finds usage in .vxjson files that reference the filename', async () => {
      const contentRoot = makeTempPath('content-root');
      await mkdir(contentRoot, { recursive: true });

      // Create a vxjson file referencing our asset
      const vxjsonContent = JSON.stringify({
        meta: { title: 'Home' },
        content: { hero: { image: '/assets/uploads/photo.jpg' } },
      });
      await writeFile(join(contentRoot, 'home.vxjson'), vxjsonContent);

      const opsWithContent = new AssetOperations({ assetsPath, contentRoot });
      const usages = await opsWithContent.getUsage('photo.jpg');
      expect(usages.length).toBeGreaterThan(0);
      expect(usages[0].page).toBe('home');

      await rm(contentRoot, { recursive: true, force: true });
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
});
