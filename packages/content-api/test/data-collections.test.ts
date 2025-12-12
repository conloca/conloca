import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ContentAPI } from '../src/content-api.interface';
import { DataIndex } from '../src/data-index';
import { FileSystemContentAPI } from '../src/filesystem-content-api';
import { InMemoryContentAPI } from '../src/in-memory-content-api';
import type { ContentIdentity, LocaleVersion } from '../src/types';
import { assertDefined, getCreatedId } from './test-helpers';

describe('Data Collections - DataIndex', () => {
  let dataIndex: DataIndex;

  beforeEach(() => {
    dataIndex = new DataIndex();
  });

  describe('addContent', () => {
    test('adds new data entry to the index', () => {
      const identity: ContentIdentity = {
        id: 'vx-data123',
        type: 'json',
        kind: 'data',
        collection: 'authors',
      };

      const localeVersion: LocaleVersion = {
        locale: 'en',
        etag: 'meta123.content456',
        created: '2024-01-01T00:00:00Z',
        modified: '2024-01-01T00:00:00Z',
        name: 'john-doe',
        meta: { title: 'John Doe', description: 'Author bio' },
      };

      dataIndex.addContent(identity, localeVersion);

      const manifest = dataIndex.getManifest('vx-data123');
      expect(manifest).not.toBeNull();
      expect(manifest?.id).toBe('vx-data123');
      expect(manifest?.kind).toBe('data');
      expect(manifest?.collection).toBe('authors');
      expect(manifest?.locales.en?.name).toBe('john-doe');
    });

    test('adds entry to name index for lookup by name', () => {
      const identity: ContentIdentity = {
        id: 'vx-data123',
        type: 'json',
        kind: 'data',
        collection: 'authors',
      };

      const localeVersion: LocaleVersion = {
        locale: 'en',
        etag: 'meta123.content456',
        created: '2024-01-01T00:00:00Z',
        modified: '2024-01-01T00:00:00Z',
        name: 'john-doe',
        meta: { title: 'John Doe' },
      };

      dataIndex.addContent(identity, localeVersion);

      const byName = dataIndex.getByName('authors', 'john-doe');
      expect(byName).not.toBeNull();
      expect(byName?.id).toBe('vx-data123');
    });

    test('tracks collections automatically', () => {
      const identity: ContentIdentity = {
        id: 'vx-data123',
        type: 'json',
        kind: 'data',
        collection: 'authors',
      };

      const localeVersion: LocaleVersion = {
        locale: 'en',
        etag: 'meta123.content456',
        created: '2024-01-01T00:00:00Z',
        modified: '2024-01-01T00:00:00Z',
        name: 'john-doe',
        meta: { title: 'John Doe' },
      };

      dataIndex.addContent(identity, localeVersion);

      expect(dataIndex.collections.has('authors')).toBe(true);
    });

    test('merges multiple locales for same entry', () => {
      const identity: ContentIdentity = {
        id: 'vx-data123',
        type: 'json',
        kind: 'data',
        collection: 'authors',
      };

      dataIndex.addContent(identity, {
        locale: 'en',
        etag: 'meta123.content456',
        created: '2024-01-01T00:00:00Z',
        modified: '2024-01-01T00:00:00Z',
        name: 'john-doe',
        meta: { title: 'John Doe EN' },
      });

      dataIndex.addContent(identity, {
        locale: 'nl',
        etag: 'meta789.content012',
        created: '2024-01-01T00:00:00Z',
        modified: '2024-01-01T00:00:00Z',
        name: 'john-doe',
        meta: { title: 'John Doe NL' },
      });

      const manifest = dataIndex.getManifest('vx-data123');
      expect(manifest?.locales.en?.meta.title).toBe('John Doe EN');
      expect(manifest?.locales.nl?.meta.title).toBe('John Doe NL');
    });

    test('caches content when provided', () => {
      const identity: ContentIdentity = {
        id: 'vx-data123',
        type: 'json',
        kind: 'data',
        collection: 'authors',
      };

      const localeVersion: LocaleVersion = {
        locale: 'en',
        etag: 'meta123.content456',
        created: '2024-01-01T00:00:00Z',
        modified: '2024-01-01T00:00:00Z',
        name: 'john-doe',
        meta: { title: 'John Doe' },
      };

      const content = { data: { name: 'John Doe', email: 'john@example.com' } };

      dataIndex.addContent(identity, localeVersion, content);

      const cached = dataIndex.getCachedContent('vx-data123', 'en');
      expect(cached).toEqual(content);
    });
  });

  describe('getByName', () => {
    beforeEach(() => {
      const identity: ContentIdentity = {
        id: 'vx-author1',
        type: 'json',
        kind: 'data',
        collection: 'authors',
      };

      dataIndex.addContent(identity, {
        locale: 'en',
        etag: 'meta123.content456',
        created: '2024-01-01T00:00:00Z',
        modified: '2024-01-01T00:00:00Z',
        name: 'john-doe',
        meta: { title: 'John Doe' },
      });

      dataIndex.addContent(identity, {
        locale: 'nl',
        etag: 'meta789.content012',
        created: '2024-01-01T00:00:00Z',
        modified: '2024-01-01T00:00:00Z',
        name: 'john-doe',
        meta: { title: 'John Doe NL' },
      });
    });

    test('returns manifest when found by name', () => {
      const manifest = dataIndex.getByName('authors', 'john-doe');
      expect(manifest).not.toBeNull();
      expect(manifest?.id).toBe('vx-author1');
    });

    test('returns null for non-existent name', () => {
      const manifest = dataIndex.getByName('authors', 'non-existent');
      expect(manifest).toBeNull();
    });

    test('returns null for non-existent collection', () => {
      const manifest = dataIndex.getByName('non-existent', 'john-doe');
      expect(manifest).toBeNull();
    });

    test('filters by locale when provided', () => {
      const withEnglish = dataIndex.getByName('authors', 'john-doe', 'en');
      expect(withEnglish).not.toBeNull();

      const withGerman = dataIndex.getByName('authors', 'john-doe', 'de');
      expect(withGerman).toBeNull();
    });
  });

  describe('removeLocale', () => {
    test('removes specific locale from entry', () => {
      const identity: ContentIdentity = {
        id: 'vx-data123',
        type: 'json',
        kind: 'data',
        collection: 'authors',
      };

      dataIndex.addContent(identity, {
        locale: 'en',
        etag: 'meta123.content456',
        created: '2024-01-01T00:00:00Z',
        modified: '2024-01-01T00:00:00Z',
        name: 'john-doe',
        meta: { title: 'John Doe EN' },
      });

      dataIndex.addContent(identity, {
        locale: 'nl',
        etag: 'meta789.content012',
        created: '2024-01-01T00:00:00Z',
        modified: '2024-01-01T00:00:00Z',
        name: 'john-doe',
        meta: { title: 'John Doe NL' },
      });

      dataIndex.removeLocale('vx-data123', 'en');

      const manifest = dataIndex.getManifest('vx-data123');
      expect(manifest?.locales.en).toBeUndefined();
      expect(manifest?.locales.nl).toBeDefined();
    });

    test('removes entire entry when last locale is removed', () => {
      const identity: ContentIdentity = {
        id: 'vx-data123',
        type: 'json',
        kind: 'data',
        collection: 'authors',
      };

      dataIndex.addContent(identity, {
        locale: 'en',
        etag: 'meta123.content456',
        created: '2024-01-01T00:00:00Z',
        modified: '2024-01-01T00:00:00Z',
        name: 'john-doe',
        meta: { title: 'John Doe' },
      });

      dataIndex.removeLocale('vx-data123', 'en');

      const manifest = dataIndex.getManifest('vx-data123');
      expect(manifest).toBeNull();
    });
  });

  describe('removeEntry', () => {
    test('removes entry from all indexes', () => {
      const identity: ContentIdentity = {
        id: 'vx-data123',
        type: 'json',
        kind: 'data',
        collection: 'authors',
      };

      dataIndex.addContent(
        identity,
        {
          locale: 'en',
          etag: 'meta123.content456',
          created: '2024-01-01T00:00:00Z',
          modified: '2024-01-01T00:00:00Z',
          name: 'john-doe',
          meta: { title: 'John Doe' },
        },
        { data: { name: 'John Doe' } },
      );

      dataIndex.removeEntry('vx-data123');

      expect(dataIndex.getManifest('vx-data123')).toBeNull();
      expect(dataIndex.getByName('authors', 'john-doe')).toBeNull();
      expect(dataIndex.getCachedContent('vx-data123', 'en')).toBeNull();
    });
  });

  describe('generators', () => {
    beforeEach(() => {
      // Add multiple entries
      dataIndex.addContent(
        { id: 'vx-author1', type: 'json', kind: 'data', collection: 'authors' },
        {
          locale: 'en',
          etag: 'a1',
          created: '2024-01-01',
          modified: '2024-01-01',
          name: 'john-doe',
          meta: { title: 'John Doe' },
        },
      );
      dataIndex.addContent(
        { id: 'vx-author2', type: 'json', kind: 'data', collection: 'authors' },
        {
          locale: 'en',
          etag: 'a2',
          created: '2024-01-01',
          modified: '2024-01-01',
          name: 'jane-doe',
          meta: { title: 'Jane Doe' },
        },
      );
      dataIndex.addContent(
        { id: 'vx-setting1', type: 'json', kind: 'data', collection: 'settings' },
        {
          locale: 'en',
          etag: 's1',
          created: '2024-01-01',
          modified: '2024-01-01',
          name: 'site-config',
          meta: { title: 'Site Config' },
        },
      );
      dataIndex.addContent(
        { id: 'vx-author1', type: 'json', kind: 'data', collection: 'authors' },
        {
          locale: 'nl',
          etag: 'a1nl',
          created: '2024-01-01',
          modified: '2024-01-01',
          name: 'john-doe',
          meta: { title: 'John Doe NL' },
        },
      );
    });

    test('getAllManifests yields all entries', () => {
      const all = Array.from(dataIndex.getAllManifests());
      expect(all.length).toBe(3);
    });

    test('getManifestsByCollection yields only matching collection', () => {
      const authors = Array.from(dataIndex.getManifestsByCollection('authors'));
      expect(authors.length).toBe(2);
      expect(authors.every((m) => m.collection === 'authors')).toBe(true);
    });

    test('getManifestsByLocale yields only entries with locale', () => {
      const dutch = Array.from(dataIndex.getManifestsByLocale('nl'));
      expect(dutch.length).toBe(1);
      expect(dutch[0].id).toBe('vx-author1');
    });
  });

  describe('entryCount', () => {
    test('returns correct count', () => {
      expect(dataIndex.entryCount).toBe(0);

      dataIndex.addContent(
        { id: 'vx-data1', type: 'json', kind: 'data', collection: 'authors' },
        {
          locale: 'en',
          etag: 'e1',
          created: '2024-01-01',
          modified: '2024-01-01',
          name: 'a1',
          meta: { title: 'A1' },
        },
      );
      expect(dataIndex.entryCount).toBe(1);

      // Adding another locale to same entry doesn't increase count
      dataIndex.addContent(
        { id: 'vx-data1', type: 'json', kind: 'data', collection: 'authors' },
        {
          locale: 'nl',
          etag: 'e2',
          created: '2024-01-01',
          modified: '2024-01-01',
          name: 'a1',
          meta: { title: 'A1 NL' },
        },
      );
      expect(dataIndex.entryCount).toBe(1);

      // Adding new entry increases count
      dataIndex.addContent(
        { id: 'vx-data2', type: 'json', kind: 'data', collection: 'authors' },
        {
          locale: 'en',
          etag: 'e3',
          created: '2024-01-01',
          modified: '2024-01-01',
          name: 'a2',
          meta: { title: 'A2' },
        },
      );
      expect(dataIndex.entryCount).toBe(2);
    });
  });

  describe('clear', () => {
    test('clears all indexes', () => {
      dataIndex.addContent(
        { id: 'vx-data1', type: 'json', kind: 'data', collection: 'authors' },
        {
          locale: 'en',
          etag: 'e1',
          created: '2024-01-01',
          modified: '2024-01-01',
          name: 'a1',
          meta: { title: 'A1' },
        },
        { data: {} },
      );

      dataIndex.clear();

      expect(dataIndex.entryCount).toBe(0);
      expect(dataIndex.collections.size).toBe(0);
      expect(dataIndex.getManifest('vx-data1')).toBeNull();
      expect(dataIndex.getByName('authors', 'a1')).toBeNull();
    });
  });
});

describe('Data Collections - Data Class', () => {
  let api: ContentAPI;

  beforeEach(() => {
    api = new InMemoryContentAPI({
      sites: {
        shop: {
          locales: ['en', 'nl'],
          defaultLocale: 'en',
        },
      },
      globalLocales: ['en', 'nl', 'de'],
    });
  });

  describe('isDataNameValid', () => {
    test('accepts valid alphanumeric names with hyphens and underscores', () => {
      expect(api.data.isDataNameValid('john-doe')).toBe(true);
      expect(api.data.isDataNameValid('john_doe')).toBe(true);
      expect(api.data.isDataNameValid('JohnDoe123')).toBe(true);
      expect(api.data.isDataNameValid('a')).toBe(true);
    });

    test('rejects empty names', () => {
      expect(api.data.isDataNameValid('')).toBe(false);
      expect(api.data.isDataNameValid('   ')).toBe(false);
    });

    test('rejects names with dots (would conflict with locale suffix)', () => {
      expect(api.data.isDataNameValid('john.doe')).toBe(false);
      expect(api.data.isDataNameValid('config.en')).toBe(false);
    });

    test('rejects names with path separators', () => {
      expect(api.data.isDataNameValid('path/name')).toBe(false);
      expect(api.data.isDataNameValid('path\\name')).toBe(false);
    });

    test('rejects names with special characters', () => {
      expect(api.data.isDataNameValid('john doe')).toBe(false);
      expect(api.data.isDataNameValid('john@doe')).toBe(false);
      expect(api.data.isDataNameValid('john#doe')).toBe(false);
    });
  });

  describe('create', () => {
    test('creates data entry with valid name', async () => {
      const result = await api.data.create({
        collection: 'authors',
        name: 'john-doe',
        locales: {
          en: {
            meta: { title: 'John Doe' },
            content: { data: { name: 'John Doe', bio: 'A developer' } },
          },
        },
      });

      expect(result.success).toBe(true);
      expect(result.id).toBeDefined();

      // Verify the entry was created
      const entry = api.data.getByName('authors', 'john-doe');
      expect(entry).not.toBeNull();
      expect(entry?.kind).toBe('data');
      expect(entry?.collection).toBe('authors');
    });

    test('rejects invalid name', async () => {
      const result = await api.data.create({
        collection: 'authors',
        name: 'john.doe',
        locales: {
          en: {
            meta: { title: 'John Doe' },
            content: { data: { name: 'John Doe' } },
          },
        },
      });

      expect(result.success).toBe(false);
      expect(result.reason).toBe('invalid_name');
    });

    test('rejects duplicate name in same collection', async () => {
      // Create first entry
      await api.data.create({
        collection: 'authors',
        name: 'john-doe',
        locales: {
          en: {
            meta: { title: 'John Doe' },
            content: { data: { name: 'John Doe' } },
          },
        },
      });

      // Try to create duplicate
      const result = await api.data.create({
        collection: 'authors',
        name: 'john-doe',
        locales: {
          en: {
            meta: { title: 'Another John Doe' },
            content: { data: { name: 'Another John' } },
          },
        },
      });

      expect(result.success).toBe(false);
      expect(result.reason).toBe('name_taken');
    });

    test('allows same name in different collections', async () => {
      await api.data.create({
        collection: 'authors',
        name: 'config',
        locales: {
          en: {
            meta: { title: 'Author Config' },
            content: { data: { name: 'Author Config' } },
          },
        },
      });

      const result = await api.data.create({
        collection: 'settings',
        name: 'config',
        locales: {
          en: {
            meta: { title: 'Settings Config' },
            content: { data: { siteName: 'My Site' } },
          },
        },
      });

      expect(result.success).toBe(true);
    });
  });

  describe('listContent', () => {
    beforeEach(async () => {
      await api.data.create({
        collection: 'authors',
        name: 'john-doe',
        locales: {
          en: { meta: { title: 'John Doe' }, content: { data: { name: 'John' } } },
          nl: { meta: { title: 'John Doe NL' }, content: { data: { name: 'John NL' } } },
        },
      });
      await api.data.create({
        collection: 'authors',
        name: 'jane-doe',
        locales: {
          en: { meta: { title: 'Jane Doe' }, content: { data: { name: 'Jane' } } },
        },
      });
      await api.data.create({
        collection: 'settings',
        name: 'site-config',
        locales: {
          en: { meta: { title: 'Site Config' }, content: { data: { siteName: 'My Site' } } },
        },
      });
    });

    test('lists all data entries when no filter', () => {
      const all = Array.from(api.data.listContent());
      expect(all.length).toBe(3);
    });

    test('filters by collection', () => {
      const authors = Array.from(api.data.listContent({ collection: 'authors' }));
      expect(authors.length).toBe(2);
      expect(authors.every((m) => m.collection === 'authors')).toBe(true);
    });

    test('filters by locale', () => {
      const dutch = Array.from(api.data.listContent({ locales: ['nl'] }));
      expect(dutch.length).toBe(1);
      expect(dutch[0].locales.nl).toBeDefined();
    });

    test('filters by collection and locale', () => {
      const dutchAuthors = Array.from(api.data.listContent({ collection: 'authors', locales: ['nl'] }));
      expect(dutchAuthors.length).toBe(1);
    });
  });

  describe('isNameAvailable', () => {
    test('returns true for available name', () => {
      expect(api.data.isNameAvailable('authors', 'john-doe')).toBe(true);
    });

    test('returns false for taken name', async () => {
      await api.data.create({
        collection: 'authors',
        name: 'john-doe',
        locales: {
          en: { meta: { title: 'John' }, content: { data: {} } },
        },
      });

      expect(api.data.isNameAvailable('authors', 'john-doe')).toBe(false);
    });

    test('excludes own ID when checking', async () => {
      const result = await api.data.create({
        collection: 'authors',
        name: 'john-doe',
        locales: {
          en: { meta: { title: 'John' }, content: { data: {} } },
        },
      });

      const id = getCreatedId(result);
      expect(api.data.isNameAvailable('authors', 'john-doe', id)).toBe(true);
    });
  });

  describe('getNameConflict', () => {
    test('returns null for available name', () => {
      expect(api.data.getNameConflict('authors', 'john-doe')).toBeNull();
    });

    test('returns conflicting ID for taken name', async () => {
      const result = await api.data.create({
        collection: 'authors',
        name: 'john-doe',
        locales: {
          en: { meta: { title: 'John' }, content: { data: {} } },
        },
      });

      const id = getCreatedId(result);
      expect(api.data.getNameConflict('authors', 'john-doe')).toBe(id);
    });
  });

  describe('collections', () => {
    test('returns set of used collections', async () => {
      await api.data.create({
        collection: 'authors',
        name: 'john',
        locales: { en: { meta: { title: 'John' }, content: { data: {} } } },
      });
      await api.data.create({
        collection: 'settings',
        name: 'config',
        locales: { en: { meta: { title: 'Config' }, content: { data: {} } } },
      });

      const collections = api.data.collections;
      expect(collections.has('authors')).toBe(true);
      expect(collections.has('settings')).toBe(true);
      expect(collections.size).toBe(2);
    });
  });
});

describe('Data Collections - FileSystem Integration', () => {
  let tempDir: string;
  let api: ContentAPI;

  beforeEach(async () => {
    FileSystemContentAPI.clearCaches();

    tempDir = await mkdtemp(join(tmpdir(), 'data-collections-test-'));
    const contentRoot = join(tempDir, 'content');
    await mkdir(contentRoot, { recursive: true });
    await mkdir(join(contentRoot, 'data', 'authors'), { recursive: true });
    await mkdir(join(contentRoot, 'data', 'settings'), { recursive: true });

    // Create sites.json
    await writeFile(
      join(contentRoot, 'sites.json'),
      JSON.stringify({
        sites: {
          shop: {
            locales: ['en', 'nl'],
            defaultLocale: 'en',
          },
        },
        globalLocales: ['en', 'nl', 'de'],
      }),
    );

    // Create test data files with locale suffix: {name}.{locale}.json
    await writeFile(
      join(contentRoot, 'data', 'authors', 'john-doe.en.json'),
      JSON.stringify({
        id: 'vx-author123',
        type: 'json',
        created: '2024-01-01T00:00:00Z',
        modified: '2024-01-01T00:00:00Z',
        meta: { title: 'John Doe', description: 'Developer' },
        data: { name: 'John Doe', email: 'john@example.com' },
      }),
    );

    await writeFile(
      join(contentRoot, 'data', 'settings', 'site-config.en.json'),
      JSON.stringify({
        id: 'vx-settings123',
        type: 'json',
        created: '2024-01-01T00:00:00Z',
        modified: '2024-01-01T00:00:00Z',
        meta: { title: 'Site Configuration' },
        data: { siteName: 'My Website', contactEmail: 'hello@example.com' },
      }),
    );

    api = await FileSystemContentAPI.create({ contentRoot });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test('indexes data files from filesystem', () => {
    const all = Array.from(api.data.listContent());
    expect(all.length).toBe(2);
  });

  test('indexes data with correct kind', () => {
    const author = api.data.getByName('authors', 'john-doe');
    expect(author).not.toBeNull();
    expect(author?.kind).toBe('data');
    expect(author?.type).toBe('json');
  });

  test('discovers collections from filesystem', () => {
    expect(api.data.collections.has('authors')).toBe(true);
    expect(api.data.collections.has('settings')).toBe(true);
  });

  test('data entries use actual locales like other content types', () => {
    const author = api.data.getByName('authors', 'john-doe');
    // Data entries now use actual locales (e.g., 'en') like blocks and pages
    expect(author?.locales.en).toBeDefined();
    expect(author?.locales.en?.meta.title).toBe('John Doe');
    expect(author?.locales.en?.name).toBe('john-doe');
  });

  test('retrieves data content via locale', async () => {
    const author = api.data.getByName('authors', 'john-doe');
    assertDefined(author, 'Author should exist');

    // Data entries now use actual locales like other content types
    const localized = await api.getLocalized(author.id, 'en');
    assertDefined(localized, 'Localized content should exist');

    expect(localized.localized.content?.data).toBeDefined();
    expect((localized.localized.content?.data as any).email).toBe('john@example.com');
  });

  test('creates new data entry with file', async () => {
    const result = await api.data.create({
      collection: 'testimonials',
      name: 'acme-corp',
      locales: {
        en: {
          meta: { title: 'Acme Corp Testimonial' },
          content: { data: { quote: 'Great product!', author: 'Jane Smith' } },
        },
      },
    });

    expect(result.success).toBe(true);

    // Verify it's retrievable
    const entry = api.data.getByName('testimonials', 'acme-corp');
    expect(entry).not.toBeNull();
  });

  test('data entries are included in listAllContent', () => {
    const all = Array.from(api.listAllContent());
    const dataEntries = all.filter((m) => m.kind === 'data');
    expect(dataEntries.length).toBe(2);
  });

  test('data entries can be filtered by kind in listAllContent', () => {
    const all = Array.from(api.listAllContent({ kind: 'data' }));
    expect(all.length).toBe(2);
    expect(all.every((m) => m.kind === 'data')).toBe(true);
  });
});

describe('Data Collections - CRUD Operations', () => {
  let api: ContentAPI;

  beforeEach(() => {
    api = new InMemoryContentAPI({
      sites: {
        shop: {
          locales: ['en', 'nl'],
          defaultLocale: 'en',
        },
      },
      globalLocales: ['en', 'nl'],
    });
  });

  test('creates data entry via createContent', async () => {
    const result = await api.createContent({
      kind: 'data',
      collection: 'authors',
      type: 'json',
      name: 'john-doe',
      locales: {
        en: {
          meta: { title: 'John Doe' },
          content: { data: { name: 'John Doe' } },
        },
      },
    });

    expect(result.success).toBe(true);
    assertDefined(result.id, 'Should have ID');

    const content = await api.getContent(result.id);
    expect(content?.kind).toBe('data');
  });

  test('updates data entry via updateLocalized', async () => {
    const createResult = await api.data.create({
      collection: 'authors',
      name: 'john-doe',
      locales: {
        en: {
          meta: { title: 'John Doe' },
          content: { data: { name: 'John Doe' } },
        },
      },
    });

    const id = getCreatedId(createResult);
    const content = await api.getLocalized(id, 'en');
    assertDefined(content, 'Content should exist');

    const updateResult = await api.updateLocalized({
      id,
      locale: 'en',
      data: {
        meta: { title: 'John Doe Updated' },
        content: { data: { name: 'John Doe', email: 'john@updated.com' } },
      },
      etag: content.localized.etag,
    });

    expect(updateResult.success).toBe(true);

    const updated = await api.getLocalized(id, 'en');
    expect(updated?.localized.meta.title).toBe('John Doe Updated');
    expect((updated?.localized.content?.data as any).email).toBe('john@updated.com');
  });

  test('deletes data entry via deleteContent', async () => {
    const createResult = await api.data.create({
      collection: 'authors',
      name: 'john-doe',
      locales: {
        en: {
          meta: { title: 'John Doe' },
          content: { data: { name: 'John Doe' } },
        },
      },
    });

    const id = getCreatedId(createResult);
    const content = await api.getContent(id);
    assertDefined(content, 'Content should exist');

    // Get etag from any locale
    const localeEntry = Object.values(content.locales)[0];
    assertDefined(localeEntry, 'Should have at least one locale');

    const deleteResult = await api.deleteContent(id, localeEntry.etag);
    expect(deleteResult.success).toBe(true);

    const deleted = await api.getContent(id);
    expect(deleted).toBeNull();

    // Should also be removed from data index
    const byName = api.data.getByName('authors', 'john-doe');
    expect(byName).toBeNull();
  });

  test('deletes single locale via deleteLocalized', async () => {
    const createResult = await api.data.create({
      collection: 'authors',
      name: 'john-doe',
      locales: {
        en: { meta: { title: 'John Doe EN' }, content: { data: { name: 'John EN' } } },
        nl: { meta: { title: 'John Doe NL' }, content: { data: { name: 'John NL' } } },
      },
    });

    const id = getCreatedId(createResult);
    const content = await api.getLocalized(id, 'en');
    assertDefined(content, 'Content should exist');

    const deleteResult = await api.deleteLocalized({
      id,
      locale: 'en',
      etag: content.localized.etag,
    });
    expect(deleteResult.success).toBe(true);

    // Entry should still exist with NL locale
    const remaining = await api.getContent(id);
    expect(remaining).not.toBeNull();
    expect(remaining?.locales.en).toBeUndefined();
    expect(remaining?.locales.nl).toBeDefined();
  });
});
