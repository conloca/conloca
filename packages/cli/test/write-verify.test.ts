import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileSystemContentAPI } from '@conloca/content-api/node';
import { updateDataEntry } from '../src/lib/data-write.js';
import { updatePage } from '../src/lib/page-write.js';

const SITES = { sites: { default: { locales: ['en'], defaultLocale: 'en' } }, globalLocales: ['en'] };

let dir: string;
let contentRoot: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'conloca-write-verify-'));
  contentRoot = join(dir, 'content');
  await Bun.write(join(contentRoot, 'sites.json'), JSON.stringify(SITES));
});

afterEach(async () => {
  FileSystemContentAPI.clearCaches();
  await rm(dir, { recursive: true, force: true });
});

const pagePath = () => join(contentRoot, 'default', 'pages', 'about.en.vxjson');
const entryPath = () => join(contentRoot, 'data', 'people', 'ada.en.json');

/** Rewrites a JSON content file the way an outside writer would, changing only what `edit` changes. */
async function rewrite(
  filePath: string,
  edit: (file: { meta: { title?: string; description?: string }; data: { role?: string } }) => void,
): Promise<void> {
  const file = JSON.parse(await readFile(filePath, 'utf8'));
  edit(file);
  await writeFile(filePath, JSON.stringify(file, null, 2));
}

describe('a CLI page write checks that it survived', () => {
  let id: string;

  beforeEach(async () => {
    const api = await FileSystemContentAPI.create({ contentRoot });
    const created = await api.createContent({
      kind: 'page',
      site: 'default',
      collection: 'pages',
      type: 'puck',
      locales: {
        en: {
          pathname: '/about',
          meta: { title: 'About' },
          content: { puckData: { root: {}, content: [], zones: {} } },
        },
      },
    });
    id = created.id ?? '';
    FileSystemContentAPI.clearCaches();
  });

  it('fails with an error when its write did not survive', async () => {
    const run = updatePage({
      contentRoot,
      site: 'default',
      ref: id,
      title: 'CLI',
      // a raw write replaces the file without the CLI's change, after its updateLocalized returned
      afterWrite: () =>
        rewrite(pagePath(), (file) => {
          file.meta.title = 'Other';
        }),
    });
    await expect(run).rejects.toThrow(
      `your write to ${pagePath()} was overwritten by another writer; re-run the command`,
    );
  });

  it('succeeds when a later write merged its change in', async () => {
    const run = updatePage({
      contentRoot,
      site: 'default',
      ref: id,
      title: 'CLI',
      afterWrite: () =>
        rewrite(pagePath(), (file) => {
          file.meta.description = 'Edited';
        }),
    });
    expect((await run).id).toBe(id);
  });
});

describe('a CLI data write checks that it survived', () => {
  beforeEach(async () => {
    const api = await FileSystemContentAPI.create({ contentRoot });
    await api.data.create({
      collection: 'people',
      name: 'ada',
      locales: { en: { meta: { title: 'Ada' }, content: { data: { role: 'Engineer' } } } },
    });
    FileSystemContentAPI.clearCaches();
  });

  it('fails with an error when its write did not survive', async () => {
    const run = updateDataEntry({
      contentRoot,
      site: 'default',
      collection: 'people',
      ref: 'ada',
      data: { role: 'Mathematician' },
      // an older version comes back over the CLI's change
      afterWrite: () =>
        rewrite(entryPath(), (file) => {
          file.data.role = 'Engineer';
        }),
    });
    await expect(run).rejects.toThrow('was overwritten by another writer');
  });

  it('succeeds when nothing replaced its write', async () => {
    const run = updateDataEntry({
      contentRoot,
      site: 'default',
      collection: 'people',
      ref: 'ada',
      data: { role: 'Mathematician' },
    });
    expect((await run).id).toBeString();
  });
});
