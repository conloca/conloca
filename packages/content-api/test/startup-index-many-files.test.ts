import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileSystemContentAPI } from '../src/filesystem-content-api.js';
import { VXJSON } from '../src/vxjson.js';

/** Writes `count` pages, each a different size. */
function seedPages(root: string, count: number): void {
  mkdirSync(join(root, 'default', 'pages'), { recursive: true });
  writeFileSync(
    join(root, 'sites.json'),
    JSON.stringify({ sites: { default: { defaultLocale: 'en', locales: ['en'] } }, globalLocales: ['en'] }),
  );
  for (let i = 0; i < count; i++) {
    writeFileSync(
      join(root, 'default', 'pages', `page-${i}.en.vxjson`),
      VXJSON.serialize({
        id: `page-${i}`,
        type: 'puck',
        kind: 'page',
        site: 'default',
        collection: 'pages',
        created: '2020-01-01T00:00:00.000Z',
        modified: '2020-01-01T00:00:00.000Z',
        meta: { title: `Page ${i}`, description: 'd'.repeat(i * 7) },
        content: { puckData: { root: {}, content: [] } },
      } as never),
    );
  }
}

describe('FileSystemContentAPI startup indexing', () => {
  let root: string;

  beforeEach(() => {
    FileSystemContentAPI.clearCaches();
    root = mkdtempSync(join(tmpdir(), 'conloca-many-files-'));
  });

  afterEach(() => {
    FileSystemContentAPI.clearCaches();
    rmSync(root, { recursive: true, force: true });
  });

  it('lists every page of a site with more than a hundred content files', async () => {
    seedPages(root, 300);

    const api = await FileSystemContentAPI.create({ contentRoot: root });

    expect(api.getIndexProblems()).toEqual([]);
    const listed = [...api.listAllContent({ kind: 'page' })].map((page) => page.id).sort();
    expect(listed).toEqual(Array.from({ length: 300 }, (_, i) => `page-${i}`).sort());
  });
});
