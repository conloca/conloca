import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { FileSystemContentAPI } from '../src/filesystem-content-api.js';
import type { CreateContentInput } from '../src/types.js';
import * as atomicWrite from '../src/utils/atomic-write.js';
import { getCreatedId } from './test-helpers.js';
import { testTempDir } from './test-temp-dir.js';

/** A write that dies part-way: half the bytes reach a temp file, then the process is gone. */
async function crashPartWay(filePath: string, content: string): Promise<void> {
  await writeFile(`${filePath}.tmp.crashed`, content.slice(0, content.length / 2));
  throw new Error('crash during write');
}

/** Runs `act` while every atomic write crashes part-way; returns whether a write (to `filePath`, if given) was attempted. */
async function whileWritesCrash<T>(act: () => Promise<T>, filePath?: string) {
  const write = spyOn(atomicWrite, 'atomicWriteFile').mockImplementation(crashPartWay);
  try {
    await act().catch(() => undefined);
    return filePath ? write.mock.calls.some(([path]) => path === filePath) : write.mock.calls.length > 0;
  } finally {
    write.mockRestore();
  }
}

describe('a page write that crashes part-way', () => {
  let root: string;
  let pages: string;

  beforeEach(async () => {
    FileSystemContentAPI.clearCaches();
    root = testTempDir('page-write-crash');
    pages = join(root, 'shop', 'pages');
    await mkdir(pages, { recursive: true });
    await writeFile(
      join(root, 'sites.json'),
      JSON.stringify({ sites: { shop: { locales: ['en'], defaultLocale: 'en' } }, globalLocales: ['en'] }),
    );
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  /** Files under the content root other than sites.json and crashed temp files. */
  async function pageFiles() {
    const names = await readdir(root, { recursive: true, withFileTypes: true });
    return names
      .filter((entry) => entry.isFile() && entry.name !== 'sites.json' && !entry.name.includes('.tmp.'))
      .map((entry) => entry.name);
  }

  test('leaves the vxjson page file the index scan was repairing intact', async () => {
    // content is not the last field, so opening the site rewrites the file
    const original = JSON.stringify(
      {
        id: 'page-1',
        type: 'puck',
        created: '2024-01-01T00:00:00.000Z',
        modified: '2024-01-01T00:00:00.000Z',
        content: { puckData: { root: { props: { title: 'Home' } } } },
        meta: { title: 'Home' },
      },
      null,
      2,
    );
    const filePath = join(pages, 'home.en.vxjson');
    await writeFile(filePath, original);

    const wrote = await whileWritesCrash(() => FileSystemContentAPI.create({ contentRoot: root }), filePath);

    expect(await readFile(filePath, 'utf-8')).toBe(original);
    expect(wrote).toBe(true);
  });

  test('leaves the mdx page file the index scan was repairing intact', async () => {
    // no created/modified in the frontmatter, so opening the site rewrites the file
    const original = '---\nid: page-2\ntitle: Home\n---\n\n# Home\n';
    const filePath = join(pages, 'home.en.mdx');
    await writeFile(filePath, original);

    const wrote = await whileWritesCrash(() => FileSystemContentAPI.create({ contentRoot: root }), filePath);

    expect(await readFile(filePath, 'utf-8')).toBe(original);
    expect(wrote).toBe(true);
  });

  test('leaves the vxjson page file a read was repairing intact', async () => {
    const api = await FileSystemContentAPI.create({ contentRoot: root });
    const id = getCreatedId(
      await api.createContent({
        kind: 'page',
        site: 'shop',
        collection: 'pages',
        type: 'puck',
        locales: { en: { pathname: '/home', meta: { title: 'Home' }, content: { puckData: {} } } },
      }),
    );
    const filePath = join(pages, 'home.en.vxjson');
    // content moved first, after the index was built, so only the read sees it out of order
    const { content, ...rest } = JSON.parse(await readFile(filePath, 'utf-8'));
    const original = JSON.stringify({ content, ...rest }, null, 2);
    await writeFile(filePath, original);

    const wrote = await whileWritesCrash(() => api.getLocalized(id, 'en'), filePath);

    expect(await readFile(filePath, 'utf-8')).toBe(original);
    expect(wrote).toBe(true);
  });

  const newContent = {
    'puck page': {
      kind: 'page',
      site: 'shop',
      collection: 'pages',
      type: 'puck',
      locales: { en: { pathname: '/about', meta: { title: 'About' }, content: { puckData: {} } } },
    },
    'mdx fragment': {
      kind: 'fragment',
      type: 'mdx',
      collection: 'general',
      name: 'hero',
      locales: { en: { meta: { title: 'hero' }, content: { mdx: '# hero' } } },
    },
    'json data entry': {
      kind: 'data',
      type: 'json',
      collection: 'authors',
      name: 'ann',
      locales: { en: { meta: { title: 'Ann' }, content: { data: { bio: 'hi' } } } },
    },
  } satisfies Record<string, CreateContentInput>;

  test.each(Object.entries(newContent))('leaves no partial file behind when creating a %s', async (_, input) => {
    const api = await FileSystemContentAPI.create({ contentRoot: root });

    const wrote = await whileWritesCrash(() => api.createContent(input));

    expect(await pageFiles()).toEqual([]);
    expect(wrote).toBe(true);
  });
});
