import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { statSync } from 'node:fs';
import { lstat, mkdir, readdir, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ContentIndex } from '../src/content-index.js';
import { FileSystemContentAPI } from '../src/filesystem-content-api.js';
import type { CreateContentInput } from '../src/types.js';
import * as atomicWrite from '../src/utils/atomic-write.js';
import { assertDefined, getCreatedId } from './test-helpers.js';
import { testTempDir } from './test-temp-dir.js';

const writeAtomically = atomicWrite.atomicWriteFile;

/**
 * A fragment that changes only the capitals of its own name, on a disk that ignores capitals.
 *
 * On the disks macOS and Windows use by default, 'hero.en.mdx' and 'Hero.en.mdx' are one file. The
 * save writes the new name into that file, so removing the old name afterwards would remove the
 * fragment; the save renames it instead, and a failed save keeps it. Linux and case-sensitive disks
 * keep two files, so there each test makes the two names lead to one file from the moment the save
 * writes the new name, as a disk that ignores capitals has it. Without this, CI on Linux passes
 * whether or not the save keeps the file.
 */
describe('a fragment that changes only the capitals of its own name', () => {
  let root: string;
  let contentRoot: string;
  let api: FileSystemContentAPI;

  const open = () => FileSystemContentAPI.create({ contentRoot, canvasDir: join(root, 'canvas') });

  beforeEach(async () => {
    FileSystemContentAPI.clearCaches();
    root = testTempDir('name-letter-case-same-file');
    contentRoot = join(root, 'content');
    await mkdir(contentRoot, { recursive: true });
    await writeFile(
      join(contentRoot, 'sites.json'),
      JSON.stringify({ sites: { shop: { locales: ['en'], defaultLocale: 'en' } }, globalLocales: ['en'] }),
    );
    api = await open();
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  /** Creates the fragment 'hero' and returns its id and etag, and the paths of its old and new name. */
  async function createHero() {
    const hero: CreateContentInput = {
      kind: 'fragment',
      type: 'mdx',
      collection: 'general',
      name: 'hero',
      locales: { en: { meta: { title: 'hero' }, content: { mdx: '# hero' } } },
    };
    const id = getCreatedId(await api.createContent(hero));
    const current = await api.getLocalized(id, 'en');
    assertDefined(current, 'the fragment should be readable');
    const folder = join(contentRoot, 'fragments', 'general');
    return {
      id,
      etag: current.localized.etag,
      folder,
      oldPath: join(folder, 'hero.en.mdx'),
      newPath: join(folder, 'Hero.en.mdx'),
    };
  }

  test('keeps its file, under the new name, on a disk that ignores capitals', async () => {
    const { id, etag, folder, oldPath, newPath } = await createHero();

    const write = spyOn(atomicWrite, 'atomicWriteFile').mockImplementation(async (filePath, content) => {
      await writeAtomically(filePath, content);
      if (filePath !== newPath || statSync(oldPath).ino === statSync(newPath).ino) return;
      // A disk that keeps capitals apart: the written file stays under the old name, and the new name leads to it.
      await rename(newPath, oldPath);
      await symlink(oldPath, newPath);
    });
    try {
      const result = await api.updateLocalized({
        id,
        locale: 'en',
        data: { name: 'Hero' },
        etag,
      });
      expect(result.success).toBe(true);
      expect(write).toHaveBeenCalledWith(newPath, expect.any(String));
    } finally {
      write.mockRestore();
    }

    FileSystemContentAPI.clearCaches();
    const reread = await (await open()).getLocalized(id, 'en');
    expect(reread?.localized.name).toBe('Hero');
    expect(reread?.localized.content.mdx).toContain('# hero');
    expect(await readdir(folder)).toEqual(['Hero.en.mdx']);
    expect((await lstat(newPath)).isFile()).toBe(true);
    expect(await readFile(newPath, 'utf-8')).toContain('# hero');
  });

  test('keeps its file when the save fails after writing, on a disk that ignores capitals', async () => {
    // The failed save's undo step deleted the file it had written, which is the fragment's only file.
    const { id, etag, oldPath, newPath } = await createHero();

    const write = spyOn(atomicWrite, 'atomicWriteFile').mockImplementation(async (filePath, content) => {
      await writeAtomically(filePath, content);
      if (filePath !== newPath || statSync(oldPath).ino === statSync(newPath).ino) return;
      // A disk that keeps capitals apart: the written file is the only one, and the old name leads to it.
      await rm(oldPath);
      await symlink(newPath, oldPath);
    });
    const indexing = spyOn(ContentIndex.prototype, 'addContent').mockImplementationOnce(() => {
      throw new Error('index failure');
    });
    try {
      const result = await api.updateLocalized({ id, locale: 'en', data: { name: 'Hero' }, etag });
      expect(result).toMatchObject({ success: false, reason: 'write_error' });
      expect(write).toHaveBeenCalledWith(newPath, expect.any(String));
    } finally {
      write.mockRestore();
      indexing.mockRestore();
    }

    expect((await api.getLocalized(id, 'en'))?.localized.name).toBe('hero');
    expect(await readFile(oldPath, 'utf-8')).toContain('# hero');
  });
});
