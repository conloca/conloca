import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ContentAPI } from '../src/content-api.interface.js';
import { contentEtag, localeEtags } from '../src/content-etag.js';
import { FileSystemContentAPI } from '../src/filesystem-content-api.js';
import { InMemoryContentAPI } from '../src/in-memory-content-api.js';
import type { ContentEntry, SitesConfig } from '../src/types.js';
import { withFileLock } from '../src/utils/file-lock.js';
import { VXJSON } from '../src/vxjson.js';
import { getCreatedId, must } from './test-helpers.js';

const SITES: SitesConfig = {
  sites: { example: { locales: ['en', 'de'], defaultLocale: 'en' } },
  globalLocales: ['en', 'de'],
};
const CONTENT = { puckData: { root: { props: {} }, content: [], zones: {} } };
const noop = () => {};

for (const backend of ['memory', 'filesystem'] as const) {
  describe(`${backend} whole-content deletion`, () => {
    let api: ContentAPI;
    let root: string;
    let addLocale: (entry: ContentEntry) => Promise<void>;

    beforeEach(async () => {
      root = await mkdtemp(join(tmpdir(), 'conloca-whole-delete-'));
      if (backend === 'memory') {
        const memory = new InMemoryContentAPI(SITES);
        api = memory;
        addLocale = async (entry) => {
          memory.setContent({
            ...entry,
            locales: {
              ...entry.locales,
              de: { ...entry.locales.en, locale: 'de', etag: 'de.new', pathname: '/later' },
            },
          });
        };
      } else {
        await mkdir(root, { recursive: true });
        await writeFile(join(root, 'sites.json'), JSON.stringify(SITES));
        const filesystem = await FileSystemContentAPI.create({ contentRoot: root, lockDir: join(root, '.locks') });
        api = filesystem;
        addLocale = async (entry) => {
          const en = entry.locales.en;
          await writeFile(
            join(root, 'example', 'pages', 'later.de.vxjson'),
            VXJSON.serialize({
              id: entry.id,
              type: 'puck',
              created: en.created,
              modified: en.modified,
              meta: { title: 'Later translation' },
              content: CONTENT,
            }),
          );
          await filesystem.reindex();
        };
      }
    });

    afterEach(async () => {
      await rm(root, { recursive: true, force: true });
    });

    async function page(twoLocales = true): Promise<ContentEntry> {
      const created = await api.createContent({
        kind: 'page',
        site: 'example',
        collection: 'pages',
        type: 'puck',
        locales: {
          en: { pathname: '/before', meta: { title: 'Before' }, content: CONTENT },
          ...(twoLocales ? { de: { pathname: '/vorher', meta: { title: 'Vorher' }, content: CONTENT } } : {}),
        },
      });
      return must(await api.getContent(getCreatedId(created)));
    }

    it('deletes every locale when the complete snapshot is still current', async () => {
      const entry = await page();
      expect(await api.deleteContent(entry.id, contentEtag(localeEtags(entry)))).toEqual({ success: true });
      expect(await api.getContent(entry.id)).toBeNull();
    });

    it('keeps every locale when a non-first locale changed', async () => {
      const entry = await page();
      const snapshot = contentEtag(localeEtags(entry));
      expect(
        (
          await api.updateLocalized({
            id: entry.id,
            locale: 'de',
            etag: entry.locales.de.etag,
            data: { meta: { title: 'Changed translation' } },
          })
        ).success,
      ).toBe(true);
      expect(await api.deleteContent(entry.id, snapshot)).toMatchObject({ success: false, reason: 'stale_write' });
      expect(await api.getLocalized(entry.id, 'en')).not.toBeNull();
      expect(must(await api.getLocalized(entry.id, 'de')).localized.meta.title).toBe('Changed translation');
    });

    it('keeps both locales when a translation was added after the last-locale snapshot', async () => {
      const entry = await page(false);
      const snapshot = contentEtag(localeEtags(entry));
      await addLocale(entry);
      expect(await api.deleteContent(entry.id, snapshot)).toMatchObject({ success: false, reason: 'stale_write' });
      expect(await api.getLocalized(entry.id, 'en')).not.toBeNull();
      expect(await api.getLocalized(entry.id, 'de')).not.toBeNull();
      if (backend === 'filesystem') {
        expect(await readFile(join(root, 'example', 'pages', 'before.en.vxjson'), 'utf8')).toContain(entry.id);
        expect(await readFile(join(root, 'example', 'pages', 'later.de.vxjson'), 'utf8')).toContain(entry.id);
      }
    });

    it('refuses the old complete snapshot after one locale was removed', async () => {
      const entry = await page();
      const snapshot = contentEtag(localeEtags(entry));
      expect((await api.deleteLocalized({ id: entry.id, locale: 'de', etag: entry.locales.de.etag })).success).toBe(
        true,
      );
      expect(await api.deleteContent(entry.id, snapshot)).toMatchObject({ success: false, reason: 'stale_write' });
      expect(await api.getLocalized(entry.id, 'en')).not.toBeNull();
    });

    if (backend === 'filesystem') {
      it('refuses a locale added while deletion waits for the original file lock, without deleting either file', async () => {
        const entry = await page(false);
        const snapshot = contentEtag(localeEtags(entry));
        let release = noop;
        let acquired = noop;
        const released = new Promise<void>((resolve) => {
          release = resolve;
        });
        const ready = new Promise<void>((resolve) => {
          acquired = resolve;
        });
        const held = withFileLock(
          join(root, 'example', 'pages', 'before.en.vxjson'),
          async () => {
            acquired();
            await released;
          },
          { lockDir: join(root, '.locks') },
        );
        await ready;
        const deleting = api.deleteContent(entry.id, snapshot);
        try {
          await addLocale(entry);
        } finally {
          release();
          await held;
        }
        expect(await deleting).toMatchObject({ success: false, reason: 'stale_write' });
        expect(await api.getLocalized(entry.id, 'en')).not.toBeNull();
        expect(await api.getLocalized(entry.id, 'de')).not.toBeNull();
      });
    }

    it('preserves legacy callers using a current locale etag', async () => {
      const entry = await page();
      expect(await api.deleteContent(entry.id, entry.locales.en.etag)).toEqual({ success: true });
    });
  });
}
