import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ContentAPI } from '../src/content-api.interface.js';
import { createContentWatchHandlers } from '../src/content-watcher.js';
import type { Data } from '../src/data.js';
import { FileSystemContentAPI } from '../src/filesystem-content-api.js';
import { InMemoryContentAPI } from '../src/in-memory-content-api.js';
import { createContentAPIRouter } from '../src/middleware.js';
import type { SitesConfig } from '../src/types.js';
import { assertDefined, getCreatedId } from './test-helpers.js';
import { testTempDir } from './test-temp-dir.js';

/**
 * Renaming a data entry through the update routes.
 *
 * A data entry's name is part of its file path, content/data/<collection>/<name>.<locale>.json, as a
 * fragment's is. A rename used to answer 200 but only wrote the file under its old name while the
 * index took the new one, so the entry could not be read right after the rename and was back under
 * its old name after a restart. The in-memory backend ignored the name altogether. A rename, like a
 * fragment's, applies to the locale it is sent for.
 */
const sitesConfig: SitesConfig = { sites: {}, globalLocales: ['en', 'de'] };

type Backend = { api: ContentAPI & { data: Data }; reopen?: () => Promise<ContentAPI & { data: Data }> };

const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function fileSystemBackend(): Promise<Backend & { api: FileSystemContentAPI }> {
  FileSystemContentAPI.clearCaches();
  const root = testTempDir('data-rename');
  roots.push(root);
  const contentRoot = join(root, 'content');
  await mkdir(contentRoot, { recursive: true });
  await writeFile(join(contentRoot, 'sites.json'), JSON.stringify(sitesConfig));
  const open = () => FileSystemContentAPI.create({ contentRoot, canvasDir: join(root, 'canvas') });
  return {
    api: await open(),
    reopen: async () => {
      FileSystemContentAPI.clearCaches();
      return open();
    },
  };
}

const backends: [label: string, make: () => Promise<Backend>][] = [
  ['filesystem', fileSystemBackend],
  ['in-memory', async () => ({ api: new InMemoryContentAPI(sitesConfig) })],
];

async function createPrices(api: ContentAPI): Promise<string> {
  const created = await api.createContent({
    kind: 'data',
    type: 'json',
    collection: 'general',
    name: 'old',
    locales: {
      en: { meta: { title: 'Prices' }, content: { data: { price: 'ten' } } },
      de: { meta: { title: 'Preise' }, content: { data: { price: 'zehn' } } },
    },
  });
  return getCreatedId(created);
}

async function rename(api: ContentAPI, id: string, locale: string, name: string) {
  const current = await api.getLocalized(id, locale);
  assertDefined(current, `entry ${id} should be readable in ${locale}`);
  const params = new URLSearchParams({ locale, etag: current.localized.etag });
  const response = await createContentAPIRouter(api).fetch(
    new Request(`http://localhost/content/${id}?${params}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    }),
  );
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

/** The entry as a reader sees it: its name and data in each locale, what finds it by name, the collection. */
async function readBack(api: ContentAPI & { data: Data }, id: string) {
  const seen: Record<string, unknown> = {};
  for (const locale of ['en', 'de']) {
    const localized = await api.getLocalized(id, locale);
    seen[locale] = { name: localized?.localized.name, data: localized?.localized.content.data };
  }
  seen.byOldName = api.data.getByName('general', 'old')?.id ?? null;
  seen.byNewName = api.data.getByName('general', 'renamed')?.id ?? null;
  seen.listed = [...api.data.listContent({ collection: 'general' })].map((manifest) => ({
    id: manifest.id,
    names: Object.fromEntries(Object.entries(manifest.locales).map(([locale, lv]) => [locale, lv?.name])),
  }));
  return seen;
}

describe('renaming a data entry through the update route', () => {
  for (const [label, make] of backends) {
    describe(`on the ${label} backend`, () => {
      test('moves the renamed locale to the new name and leaves the other locale under the old one', async () => {
        const { api, reopen } = await make();
        const id = await createPrices(api);

        const { status } = await rename(api, id, 'en', 'renamed');

        expect(status).toBe(200);
        const expected = {
          en: { name: 'renamed', data: { price: 'ten' } },
          de: { name: 'old', data: { price: 'zehn' } },
          byOldName: id,
          byNewName: id,
          listed: [{ id, names: { en: 'renamed', de: 'old' } }],
        };
        expect(await readBack(api, id)).toEqual(expected);
        if (reopen) expect(await readBack(await reopen(), id)).toEqual(expected);
      });

      test('keeps the entry readable under its new name in every locale, also after a restart', async () => {
        const { api, reopen } = await make();
        const id = await createPrices(api);

        expect((await rename(api, id, 'en', 'renamed')).status).toBe(200);
        expect((await rename(api, id, 'de', 'renamed')).status).toBe(200);

        const expected = {
          en: { name: 'renamed', data: { price: 'ten' } },
          de: { name: 'renamed', data: { price: 'zehn' } },
          byOldName: null,
          byNewName: id,
          listed: [{ id, names: { en: 'renamed', de: 'renamed' } }],
        };
        expect(await readBack(api, id)).toEqual(expected);
        if (reopen) expect(await readBack(await reopen(), id)).toEqual(expected);
      });

      test('refuses a name another data entry has, as name_taken, 409', async () => {
        const { api } = await make();
        const id = await createPrices(api);
        const other = await api.createContent({
          kind: 'data',
          type: 'json',
          collection: 'general',
          name: 'taken',
          locales: { en: { meta: { title: 'Taken' }, content: { data: {} } } },
        });
        const otherId = getCreatedId(other);

        const { status, body } = await rename(api, id, 'en', 'taken');

        expect(status).toBe(409);
        expect(body).toMatchObject({
          success: false,
          reason: 'name_taken',
          error: { message: 'Data name taken already exists in collection general' },
        });
        expect(api.data.getByName('general', 'taken', 'en')?.id).toBe(otherId);
        expect(api.data.getByName('general', 'old', 'en')?.id).toBe(id);
      });

      test('refuses a name another data entry has in other capitals, and leaves that entry as it was', async () => {
        // On a disk that ignores capitals, Taken.en.json is taken.en.json: the rename wrote over it.
        const { api, reopen } = await make();
        const id = await createPrices(api);
        const otherId = getCreatedId(
          await api.createContent({
            kind: 'data',
            type: 'json',
            collection: 'general',
            name: 'taken',
            locales: { en: { meta: { title: 'Taken' }, content: { data: { secret: 'kept' } } } },
          }),
        );

        const { status, body } = await rename(api, id, 'en', 'Taken');

        expect(status).toBe(409);
        expect(body).toMatchObject({ success: false, reason: 'name_taken' });
        for (const reader of reopen ? [api, await reopen()] : [api]) {
          expect((await reader.getLocalized(otherId, 'en'))?.localized.content.data).toEqual({ secret: 'kept' });
          expect((await reader.getLocalized(id, 'en'))?.localized.name).toBe('old');
        }
      });

      test('refuses a malformed name as invalid_name, 400', async () => {
        const { api } = await make();
        const id = await createPrices(api);

        const { status, body } = await rename(api, id, 'en', '../escaped');

        expect(status).toBe(400);
        expect(body).toMatchObject({ success: false, reason: 'invalid_name' });
        expect(api.data.getByName('general', 'old', 'en')?.id).toBe(id);
      });
    });
  }

  test('moves the data file on disk', async () => {
    const { api } = await fileSystemBackend();
    const id = await createPrices(api);
    const dir = join(roots[0], 'content/data/general');

    await rename(api, id, 'en', 'renamed');
    expect((await readdir(dir)).sort()).toEqual(['old.de.json', 'renamed.en.json']);

    await rename(api, id, 'de', 'renamed');
    expect((await readdir(dir)).sort()).toEqual(['renamed.de.json', 'renamed.en.json']);
  });
});

describe('renaming one language while the dev server watches the content folder', () => {
  // The save writes the renamed language's new file and then deletes its old one, and the dev
  // server's file watcher hears both, in that order. The old file's name still finds the entry
  // through the language that keeps that name, so the deletion dropped the renamed language from
  // the index until a restart.
  async function watchedEntry(kind: 'data' | 'fragment') {
    const { api } = await fileSystemBackend();
    const contentRoot = join(roots[0], 'content');
    const content = kind === 'data' ? { data: { price: 'ten' } } : { mdx: '# Prices' };
    const id = getCreatedId(
      await api.createContent({
        kind,
        type: kind === 'data' ? 'json' : 'mdx',
        collection: 'general',
        name: 'old',
        locales: { en: { meta: { title: 'Prices' }, content }, de: { meta: { title: 'Preise' }, content } },
      }),
    );
    const deletions: unknown[] = [];
    const watcher = createContentWatchHandlers(
      api,
      { contentRoot, canvasDir: join(roots[0], 'canvas') },
      {
        send: ({ data }) => {
          if (data.action === 'delete') deletions.push(data);
        },
      },
    );
    const [folder, extension] = kind === 'data' ? ['data', 'json'] : ['fragments', 'mdx'];
    const file = (name: string, locale: string) =>
      join(contentRoot, folder, 'general', `${name}.${locale}.${extension}`);
    return { api, id, watcher, deletions, file };
  }

  for (const kind of ['data', 'fragment'] as const) {
    test(`keeps the renamed language of a ${kind} in the index`, async () => {
      const { api, id, watcher, deletions, file } = await watchedEntry(kind);

      expect((await rename(api, id, 'en', 'renamed')).status).toBe(200);
      await watcher.onAdd(file('renamed', 'en'));
      await watcher.onUnlink(file('old', 'en'));

      expect((await api.getLocalized(id, 'en'))?.localized.name).toBe('renamed');
      expect((await api.getLocalized(id, 'de'))?.localized.name).toBe('old');
      expect(deletions).toEqual([]);
    });

    test(`still drops a language of a ${kind} whose file is deleted`, async () => {
      const { api, id, watcher, deletions, file } = await watchedEntry(kind);

      await rm(file('old', 'de'));
      await watcher.onUnlink(file('old', 'de'));

      expect(deletions).toEqual([{ action: 'delete', id, locale: 'de', kind }]);
      expect(await api.getLocalized(id, 'de')).toBeNull();
      expect((await api.getLocalized(id, 'en'))?.localized.name).toBe('old');
    });

    test(`frees the name of a ${kind} language whose own file is deleted`, async () => {
      // The deleted language's name stayed taken until a restart, so a new entry could not have it.
      const { api, id, watcher, file } = await watchedEntry(kind);
      expect((await rename(api, id, 'de', 'renamed')).status).toBe(200);
      await watcher.onAdd(file('renamed', 'de'));
      await watcher.onUnlink(file('old', 'de'));

      await rm(file('renamed', 'de'));
      await watcher.onUnlink(file('renamed', 'de'));

      expect(await api.getLocalized(id, 'de')).toBeNull();
      expect(api[kind === 'data' ? 'data' : 'fragments'].getByName('general', 'renamed')).toBeNull();
      const created = await api.createContent({
        kind,
        type: kind === 'data' ? 'json' : 'mdx',
        collection: 'general',
        name: 'renamed',
        locales: { en: { meta: { title: 'New' }, content: kind === 'data' ? { data: {} } : { mdx: '# New' } } },
      });
      expect(created.success).toBe(true);
    });
  }
});

describe('renaming a fragment on the in-memory backend', () => {
  test('moves it to the new name, as the filesystem backend does', async () => {
    const api = new InMemoryContentAPI(sitesConfig);
    const created = await api.createContent({
      kind: 'fragment',
      type: 'mdx',
      collection: 'general',
      name: 'hero',
      locales: { en: { meta: { title: 'Hero' }, content: { mdx: '# Hero' } } },
    });
    const id = getCreatedId(created);

    expect((await rename(api, id, 'en', 'hero-2')).status).toBe(200);

    expect((await api.getLocalized(id, 'en'))?.localized.name).toBe('hero-2');
    expect(api.fragments.getByName('general', 'hero-2', 'en')?.id).toBe(id);
    expect(api.fragments.getByName('general', 'hero', 'en')).toBeNull();
  });
});
