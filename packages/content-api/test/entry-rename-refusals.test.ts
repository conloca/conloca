import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ContentAPI } from '../src/content-api.interface.js';
import { ContentIndex } from '../src/content-index.js';
import { FileSystemContentAPI } from '../src/filesystem-content-api.js';
import { createContentAPIRouter } from '../src/middleware.js';
import { ErrorCodes, type UpdateResult } from '../src/types.js';
import { assertDefined, getCreatedId } from './test-helpers.js';
import { testTempDir } from './test-temp-dir.js';

/**
 * Renaming a fragment or data entry through the update routes.
 *
 * A fragment's name is part of its file path, content/fragments/<collection>/<name>.<locale>.mdx,
 * so a name like '../x' wrote the file outside its collection folder and '../../../x' outside the
 * content folder. A create refuses such a name as `invalid_name` and a name another entry has as
 * `name_taken`; a rename now refuses them the same way, before anything is written.
 */
describe('renaming a fragment or data entry through the update route', () => {
  let root: string;
  let api: FileSystemContentAPI;
  let router: ReturnType<typeof createContentAPIRouter>;

  beforeEach(async () => {
    FileSystemContentAPI.clearCaches();
    root = testTempDir('entry-rename');
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

  async function createEntry(kind: 'fragment' | 'data', name: string): Promise<string> {
    const created = await api.createContent({
      kind,
      type: kind === 'fragment' ? 'mdx' : 'json',
      collection: 'general',
      name,
      locales: {
        en: { meta: { title: name }, content: kind === 'fragment' ? { mdx: `# ${name}` } : { data: { name } } },
      },
    });
    return getCreatedId(created);
  }

  async function rename(id: string, name: string, rest: Record<string, unknown> = {}) {
    const current = await api.getLocalized(id, 'en');
    assertDefined(current, `entry ${id} should be readable`);
    const params = new URLSearchParams({ locale: 'en', etag: current.localized.etag });
    const response = await router.fetch(
      new Request(`http://localhost/content/${id}?${params}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...rest, name }),
      }),
    );
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  }

  /** Every file under the test's root folder, the content folder and whatever lies beside it. */
  async function filesUnderRoot(dir = root, prefix = ''): Promise<string[]> {
    const files: string[] = [];
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) files.push(...(await filesUnderRoot(join(dir, entry.name), path)));
      else files.push(path);
    }
    return files.sort();
  }

  for (const kind of ['fragment', 'data'] as const) {
    const byName = (name: string) => (kind === 'fragment' ? api.fragments : api.data).getByName('general', name, 'en');
    const label = kind === 'fragment' ? 'Fragment' : 'Data';

    test(`refuses a malformed ${kind} name as invalid_name, 400, and writes nothing`, async () => {
      const id = await createEntry(kind, 'hero');
      const before = await filesUnderRoot();

      for (const name of ['../escaped', '../../../escaped', 'nested/escaped', 'has space']) {
        const { status, body } = await rename(id, name);

        expect(status).toBe(400);
        expect(body).toMatchObject({
          success: false,
          reason: 'invalid_name',
          error: {
            code: ErrorCodes.INVALID_REQUEST,
            message: `Invalid ${kind} name: ${name}. ${label} names must contain only alphanumeric characters, hyphens, and underscores.`,
          },
        });
        expect(await filesUnderRoot()).toEqual(before);
        expect(byName('hero')?.id).toBe(id);
        expect(byName(name)).toBeNull();
      }
    });

    test(`refuses an emptied ${kind} name as invalid_name, 400, as a create does`, async () => {
      // An empty name used to be skipped, so the save answered 200 and kept the old name.
      const id = await createEntry(kind, 'hero');
      const before = await filesUnderRoot();

      const { status, body } = await rename(id, '');

      expect(status).toBe(400);
      expect(body).toMatchObject({
        success: false,
        reason: 'invalid_name',
        error: {
          code: ErrorCodes.INVALID_REQUEST,
          message: `${label} name is required`,
        },
      });
      expect(await filesUnderRoot()).toEqual(before);
      expect(byName('hero')?.id).toBe(id);
    });

    test(`refuses a ${kind} name another entry of the collection has as name_taken, 409`, async () => {
      const id = await createEntry(kind, 'hero');
      const otherId = await createEntry(kind, 'banner');
      const before = await filesUnderRoot();

      const { status, body } = await rename(id, 'banner');

      expect(status).toBe(409);
      expect(body).toMatchObject({
        success: false,
        reason: 'name_taken',
        error: { code: ErrorCodes.NAME_TAKEN, message: `${label} name banner already exists in collection general` },
      });
      expect(await filesUnderRoot()).toEqual(before);
      expect(byName('hero')?.id).toBe(id);
      expect(byName('banner')?.id).toBe(otherId);
    });

    // On a disk that ignores capitals (the macOS and Windows default), 'hero' and 'HERO' name one
    // file, so the rename's old file is the file it has just written.
    test(`keeps a ${kind} whose rename only changes its capitals, also after a restart`, async () => {
      // Deleting the old file after the write deleted the entry.
      const id = await createEntry(kind, 'hero');
      const file = kind === 'fragment' ? 'content/fragments/general/HERO.en.mdx' : 'content/data/general/HERO.en.json';

      const { status } = await rename(id, 'HERO');

      expect(status).toBe(200);
      expect(await filesUnderRoot()).toEqual([file, 'content/sites.json']);
      expect(byName('HERO')?.id).toBe(id);
      FileSystemContentAPI.clearCaches();
      api = await FileSystemContentAPI.create({ contentRoot: join(root, 'content'), canvasDir: join(root, 'canvas') });
      const reopened = await api.getLocalized(id, 'en');
      expect(reopened?.localized.name).toBe('HERO');
      expect(reopened?.localized.meta.title).toBe('hero');
    });

    test(`keeps a ${kind} whose rename only changes its capitals when the save fails after writing`, async () => {
      // The undo step deleted the file the save had written, which is the entry's only file.
      const id = await createEntry(kind, 'hero');
      const indexing = spyOn(ContentIndex.prototype, 'addContent').mockImplementationOnce(() => {
        throw new Error('index failure');
      });

      try {
        const { status, body } = await rename(id, 'HERO');

        expect(status).toBe(500);
        expect(body).toMatchObject({ success: false, reason: 'write_error' });
      } finally {
        indexing.mockRestore();
      }
      expect(await filesUnderRoot()).toHaveLength(2);
      FileSystemContentAPI.clearCaches();
      api = await FileSystemContentAPI.create({ contentRoot: join(root, 'content'), canvasDir: join(root, 'canvas') });
      expect((await api.getLocalized(id, 'en'))?.localized.meta.title).toBe('hero');
    });
  }

  test('still moves a fragment to a well-formed free name', async () => {
    const id = await createEntry('fragment', 'hero');

    const { status } = await rename(id, 'hero-2');

    expect(status).toBe(200);
    expect(await filesUnderRoot()).toEqual(['content/fragments/general/hero-2.en.mdx', 'content/sites.json']);
    expect(api.fragments.getByName('general', 'hero-2', 'en')?.id).toBe(id);
  });

  test('still saves an entry that sends back a name from before the check', async () => {
    // Only a new name is checked: an entry named before the check keeps saving with its name.
    await mkdir(join(root, 'content/fragments/general'), { recursive: true });
    await writeFile(
      join(root, 'content/fragments/general/hero banner.en.mdx'),
      '---\nid: legacy-hero\ntitle: Hero\n---\n# Hero',
    );
    FileSystemContentAPI.clearCaches();
    api = await FileSystemContentAPI.create({ contentRoot: join(root, 'content'), canvasDir: join(root, 'canvas') });
    router = createContentAPIRouter(api);

    const { status } = await rename('legacy-hero', 'hero banner', { meta: { title: 'Hero, retitled' } });

    expect(status).toBe(200);
    expect(await filesUnderRoot()).toEqual(['content/fragments/general/hero banner.en.mdx', 'content/sites.json']);
    expect((await api.getLocalized('legacy-hero', 'en'))?.localized.meta.title).toBe('Hero, retitled');
  });
});

/**
 * An update refused for its new path or name answers as a refused create does, whichever backend
 * refused it: 409 when another entry has the path or name or a page redirects from the path, and
 * 400 when it is malformed. It used to answer every such refusal with 500 and an empty error.
 */
describe('the update routes answering a refused new path or name', () => {
  const refusals: [reason: UpdateResult['reason'], status: number, code: string][] = [
    ['invalid_name', 400, ErrorCodes.INVALID_REQUEST],
    ['name_taken', 409, ErrorCodes.NAME_TAKEN],
    ['invalid_pathname', 400, ErrorCodes.INVALID_PATHNAME],
    ['pathname_taken', 409, ErrorCodes.PATHNAME_TAKEN],
    ['pathname_in_redirects', 409, ErrorCodes.PATHNAME_TAKEN],
  ];

  for (const method of ['PUT', 'PATCH']) {
    for (const [reason, status, code] of refusals) {
      test(`${method} answers ${reason} with ${status}`, async () => {
        const message = `refused as ${reason}`;
        const api = {
          updateLocalized: async () => ({ success: false, reason, error: new Error(message) }),
        } as unknown as ContentAPI;

        const response = await createContentAPIRouter(api).fetch(
          new Request('http://localhost/content/entry-1?locale=en&etag=etag-1', {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
          }),
        );

        expect(response.status).toBe(status);
        expect(await response.json()).toMatchObject({ success: false, reason, error: { code, message } });
      });
    }
  }
});
