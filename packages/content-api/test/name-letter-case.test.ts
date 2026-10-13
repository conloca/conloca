import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { FileSystemContentAPI } from '../src/filesystem-content-api.js';
import { createContentAPIRouter } from '../src/middleware.js';
import { type CreateContentInput, ErrorCodes } from '../src/types.js';
import { assertDefined, getCreatedId } from './test-helpers.js';
import { testTempDir } from './test-temp-dir.js';

/**
 * Fragment and data names that differ only in letter case.
 *
 * A name is the entry's file name, content/fragments/<collection>/<name>.<locale>.mdx. The disks
 * macOS and Windows use by default treat 'Hero.en.mdx' and 'hero.en.mdx' as one file, so a new
 * 'Hero' next to 'hero' overwrote it there, and on a case-sensitive disk the two files clash as
 * soon as the project is checked out on such a machine. A name another entry has in any letter
 * case is now refused as taken, on a create and on a rename, and isNameAvailable counts it as not
 * available; an entry may still change the case of its own name.
 */
describe('fragment and data names that differ only in letter case', () => {
  let root: string;
  let api: FileSystemContentAPI;
  let router: ReturnType<typeof createContentAPIRouter>;

  beforeEach(async () => {
    FileSystemContentAPI.clearCaches();
    root = testTempDir('name-letter-case');
    const contentRoot = join(root, 'content');
    await mkdir(contentRoot, { recursive: true });
    await writeFile(
      join(contentRoot, 'sites.json'),
      JSON.stringify({ sites: { shop: { locales: ['en'], defaultLocale: 'en' } }, globalLocales: ['en'] }),
    );
    api = await FileSystemContentAPI.create({ contentRoot, canvasDir: join(root, 'canvas') });
    router = createContentAPIRouter(api);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  for (const kind of ['fragment', 'data'] as const) {
    const label = kind === 'fragment' ? 'Fragment' : 'Data';
    const folder = kind === 'fragment' ? 'fragments' : 'data';
    const file = (name: string) => `${folder}/general/${name}.en.${kind === 'fragment' ? 'mdx' : 'json'}`;

    function entry(name: string): CreateContentInput {
      return {
        kind,
        type: kind === 'fragment' ? 'mdx' : 'json',
        collection: 'general',
        name,
        locales: {
          en: { meta: { title: name }, content: kind === 'fragment' ? { mdx: `# ${name}` } : { data: { name } } },
        },
      };
    }

    async function create(name: string) {
      const response = await router.fetch(
        new Request('http://localhost/content', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(entry(name)),
        }),
      );
      return { status: response.status, body: (await response.json()) as Record<string, unknown> };
    }

    async function rename(id: string, name: string) {
      const current = await api.getLocalized(id, 'en');
      assertDefined(current, `entry ${id} should be readable`);
      const params = new URLSearchParams({ locale: 'en', etag: current.localized.etag });
      const response = await router.fetch(
        new Request(`http://localhost/content/${id}?${params}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name }),
        }),
      );
      return { status: response.status, body: (await response.json()) as Record<string, unknown> };
    }

    async function contentFiles(): Promise<string[]> {
      return (await readdir(join(root, 'content'), { recursive: true }))
        .filter((path) => path.endsWith('.mdx') || path.endsWith('.json'))
        .sort();
    }

    test(`refuses a new ${kind} named like another in other letters' case as name_taken, 409`, async () => {
      const heroId = getCreatedId(await api.createContent(entry('hero')));
      const heroFile = await readFile(join(root, 'content', file('hero')), 'utf-8');

      for (const name of ['Hero', 'HERO']) {
        const { status, body } = await create(name);

        expect(status).toBe(409);
        expect(body).toMatchObject({
          success: false,
          reason: 'name_taken',
          existingId: heroId,
          error: {
            code: ErrorCodes.NAME_TAKEN,
            message: `${label} name ${name} already exists in collection general`,
          },
        });
      }
      expect(await contentFiles()).toEqual([file('hero'), 'sites.json']);
      expect(await readFile(join(root, 'content', file('hero')), 'utf-8')).toBe(heroFile);
    });

    test(`refuses renaming a ${kind} to another's name in other letters' case as name_taken, 409`, async () => {
      const heroId = getCreatedId(await api.createContent(entry('hero')));
      const bannerId = getCreatedId(await api.createContent(entry('banner')));

      const { status, body } = await rename(bannerId, 'Hero');

      expect(status).toBe(409);
      expect(body).toMatchObject({ success: false, reason: 'name_taken' });
      expect(api[kind === 'fragment' ? 'fragments' : 'data'].getByName('general', 'hero', 'en')?.id).toBe(heroId);
      expect(api[kind === 'fragment' ? 'fragments' : 'data'].getByName('general', 'banner', 'en')?.id).toBe(bannerId);
    });

    test(`lets a ${kind} change the letter case of its own name, and keeps its file`, async () => {
      const heroId = getCreatedId(await api.createContent(entry('hero')));

      const { status } = await rename(heroId, 'Hero');

      expect(status).toBe(200);
      const renamed = await api.getLocalized(heroId, 'en');
      expect(renamed?.localized.name).toBe('Hero');
      expect(await contentFiles()).toHaveLength(2);
    });
  }

  test('answers a data name another entry has in other letter case as not available, naming that entry', async () => {
    const heroId = getCreatedId(
      await api.createContent({
        kind: 'data',
        type: 'json',
        collection: 'general',
        name: 'hero',
        locales: { en: { meta: { title: 'hero' }, content: { data: {} } } },
      }),
    );
    const check = async (query: string) =>
      (await router.fetch(new Request(`http://localhost/data/name-available?collection=general&${query}`))).json();

    expect(await check('name=Hero')).toEqual({ available: false, existingId: heroId });
    expect(await check(`name=HERO&excludeId=${heroId}`)).toEqual({ available: true });
  });

  test('counts a fragment name another fragment has in other letter case as not available', async () => {
    const heroId = getCreatedId(
      await api.createContent({
        kind: 'fragment',
        type: 'mdx',
        collection: 'general',
        name: 'hero',
        locales: { en: { meta: { title: 'hero' }, content: { mdx: '# hero' } } },
      }),
    );

    expect(api.fragments.isNameAvailable('general', 'Hero')).toBe(false);
    expect(api.fragments.isNameAvailable('general', 'HERO', heroId)).toBe(true);
  });
});
