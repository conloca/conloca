import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  type ContentWatchEvent,
  type ContentWatcherOptions,
  createContentWatchHandlers,
  type WebSocketSender,
} from '../src/content-watcher.js';
import { FileSystemContentAPI } from '../src/filesystem-content-api.js';
import { VersionLog } from '../src/served-versions.js';
import { getCreatedId, must } from './test-helpers.js';
import { testTempDir } from './test-temp-dir.js';

interface ReindexResult {
  filesProcessed: number;
  filesSkipped: number;
  updated: {
    id: string;
    localized: {
      locale: string;
      meta: Record<string, unknown>;
    };
  }[];
  deleted?: {
    id: string;
    locale: string;
    kind: 'page' | 'fragment' | 'data';
  }[];
}

function createTestSetup(options?: { reindexResult?: ReindexResult; reindexError?: Error; mdxPagesRoot?: string }) {
  const reindexCalls: string[][] = [];
  const wsMessages: { type: string; event: string; data: unknown }[] = [];
  const refreshEvents: ContentWatchEvent[] = [];

  const contentApi = {
    async reindex(paths: string[]) {
      reindexCalls.push(paths);

      if (options?.reindexError) {
        throw options.reindexError;
      }

      return options?.reindexResult ?? { filesProcessed: 1, filesSkipped: 0, updated: [] };
    },
  };

  const ws: WebSocketSender = {
    send(payload) {
      wsMessages.push(payload);
    },
  };

  const watcherOptions: ContentWatcherOptions = {
    contentRoot: '/repo/content',
    canvasDir: '/repo/canvas',
    ...(options?.mdxPagesRoot ? { mdxPagesRoot: options.mdxPagesRoot } : {}),
  };

  const handlers = createContentWatchHandlers(contentApi, watcherOptions, ws, async (event) => {
    refreshEvents.push(event);
  });

  return {
    handlers,
    refreshEvents,
    reindexCalls,
    wsMessages,
  };
}

describe('createContentWatchHandlers', () => {
  it('calls the callback after a successful content update', async () => {
    const { handlers, refreshEvents, reindexCalls, wsMessages } = createTestSetup({
      reindexResult: {
        filesProcessed: 1,
        filesSkipped: 0,
        updated: [
          {
            id: 'home',
            localized: {
              locale: 'en',
              meta: { title: 'Home' },
            },
          },
        ],
      },
    });

    await handlers.onChange('/repo/content/site/pages/home.en.vxjson');

    expect(reindexCalls).toEqual([['/repo/content/site/pages/home.en.vxjson']]);
    expect(wsMessages).toHaveLength(1);
    expect(refreshEvents).toEqual([
      {
        file: '/repo/content/site/pages/home.en.vxjson',
        action: 'update',
        inMdxRoot: false,
        inContentRoot: true,
        ownWrite: false,
      },
    ]);
  });

  it('calls the callback after a successful deletion', async () => {
    const { handlers, refreshEvents, wsMessages } = createTestSetup({
      reindexResult: {
        filesProcessed: 0,
        filesSkipped: 0,
        updated: [],
        deleted: [
          {
            id: 'home',
            locale: 'en',
            kind: 'page',
          },
        ],
      },
    });

    await handlers.onUnlink('/repo/content/site/pages/home.en.vxjson');

    expect(wsMessages).toHaveLength(1);
    expect(refreshEvents).toEqual([
      {
        file: '/repo/content/site/pages/home.en.vxjson',
        action: 'delete',
        inMdxRoot: false,
        inContentRoot: true,
        ownWrite: false,
      },
    ]);
  });

  it('ignores files outside the content root or unsupported file types', async () => {
    const { handlers, refreshEvents, reindexCalls, wsMessages } = createTestSetup();

    await handlers.onChange('/repo/other/pages/home.en.vxjson');
    await handlers.onChange('/repo/content/site/pages/home.txt');

    expect(reindexCalls).toHaveLength(0);
    expect(wsMessages).toHaveLength(0);
    expect(refreshEvents).toHaveLength(0);
  });

  it('reindexes only the data files the content scanner indexes', async () => {
    const { handlers, reindexCalls } = createTestSetup();

    // A picture's metadata record, for a media folder that happens to be called `data`
    await handlers.onChange('/repo/content/.asset-metadata/data/chart.png.json');
    expect(reindexCalls).toEqual([]);

    await handlers.onChange('/repo/content/data/team/alice.en.json');
    expect(reindexCalls).toEqual([['/repo/content/data/team/alice.en.json']]);
  });

  it('flags events under mdxPagesRoot as inMdxRoot for docs-loader refresh', async () => {
    const { handlers, refreshEvents } = createTestSetup({
      mdxPagesRoot: '/repo/website/src/content/docs',
      reindexResult: { filesProcessed: 1, filesSkipped: 0, updated: [] },
    });

    await handlers.onAdd('/repo/website/src/content/docs/new-page.mdx');

    expect(refreshEvents).toEqual([
      {
        file: '/repo/website/src/content/docs/new-page.mdx',
        action: 'create',
        inMdxRoot: true,
        inContentRoot: false,
        ownWrite: false,
      },
    ]);
  });

  it('does not call the callback when reindex fails', async () => {
    const { handlers, refreshEvents, wsMessages } = createTestSetup({
      reindexError: new Error('boom'),
    });

    await handlers.onAdd('/repo/content/site/pages/home.en.vxjson');

    expect(wsMessages).toHaveLength(0);
    expect(refreshEvents).toHaveLength(0);
  });
});

describe('own writes', () => {
  const SITES = { sites: { example: { locales: ['en'], defaultLocale: 'en' } }, globalLocales: ['en'] };
  let dir: string;
  let lockDir: string;
  let id: string;
  let pagePath: string;
  let watched: FileSystemContentAPI;
  let editor: FileSystemContentAPI;
  let messages: { event: string }[];
  let onChange: (file: string) => Promise<void>;
  let onUnlink: (file: string) => Promise<void>;

  beforeEach(async () => {
    dir = testTempDir('watcher-own-writes');
    lockDir = `${dir}-locks`;
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'sites.json'), JSON.stringify(SITES));
    const log = new VersionLog(); // this dev server's process-wide log
    watched = await FileSystemContentAPI.create({ contentRoot: dir, lockDir, versionLog: log });
    id = getCreatedId(
      await watched.createContent({
        kind: 'page',
        site: 'example',
        collection: 'pages',
        type: 'puck',
        locales: { en: { pathname: '/about', meta: { title: 'About' }, content: {} } },
      }),
    );
    pagePath = join(dir, 'example', 'pages', 'about.en.vxjson');
    // The editor's handler loads the package beside the watcher's, so it keeps its own index but shares the log.
    FileSystemContentAPI.clearCaches();
    editor = await FileSystemContentAPI.create({ contentRoot: dir, lockDir, versionLog: log });
    messages = [];
    const handlers = createContentWatchHandlers(watched, { contentRoot: dir }, { send: (m) => void messages.push(m) });
    onChange = handlers.onChange;
    onUnlink = handlers.onUnlink;
  });

  afterEach(async () => {
    FileSystemContentAPI.clearCaches();
    await rm(dir, { recursive: true, force: true });
    await rm(lockDir, { recursive: true, force: true });
  });

  const edit = async (api: FileSystemContentAPI, title: string) => {
    const read = await api.getLocalized(id, 'en');
    const res = await api.updateLocalized({
      id,
      locale: 'en',
      etag: must(read).localized.etag,
      data: { meta: { title } },
    });
    expect(res.success).toBe(true);
  };

  it("does not announce the API's own write", async () => {
    await edit(editor, 'Mine');
    await onChange(pagePath);
    expect(messages.filter((m) => m.event === 'conloca:content-update')).toEqual([]);
  });

  it('still announces a CLI write made right after an own write', async () => {
    await edit(editor, 'Mine');
    FileSystemContentAPI.clearCaches();
    const cli = await FileSystemContentAPI.create({ contentRoot: dir, lockDir, versionLog: new VersionLog() });
    await edit(cli, 'CLI');
    await onChange(pagePath);
    expect(messages).toContainEqual(expect.objectContaining({ event: 'conloca:content-update' }));
  });

  it("does not announce the API's own create", async () => {
    getCreatedId(
      await editor.createContent({
        kind: 'page',
        site: 'example',
        collection: 'pages',
        type: 'puck',
        locales: { en: { pathname: '/team', meta: { title: 'Team' }, content: {} } },
      }),
    );
    const teamPath = join(dir, 'example', 'pages', 'team.en.vxjson');
    expect(editor.isOwnWriteFile(teamPath)).toBe(true);
    await onChange(teamPath);
    expect(messages.filter((m) => m.event === 'conloca:content-update')).toEqual([]);
  });

  it("counts the API's own delete as own and a later foreign delete as foreign", async () => {
    const read = must(await editor.getLocalized(id, 'en'));
    expect((await editor.deleteContent(id, read.localized.etag)).success).toBe(true);
    expect(editor.isOwnWriteFile(pagePath)).toBe(true);

    await writeFile(pagePath, '{}');
    expect(editor.isOwnWriteFile(pagePath)).toBe(false); // a foreign create, seen by the watcher
    await rm(pagePath);
    expect(editor.isOwnWriteFile(pagePath)).toBe(false);
  });

  it("does not announce the API's own delete", async () => {
    const read = must(await editor.getLocalized(id, 'en'));
    expect((await editor.deleteContent(id, read.localized.etag)).success).toBe(true);
    await onUnlink(pagePath);
    expect(messages.filter((m) => m.event === 'conloca:content-update')).toEqual([]);
  });

  it('still announces a foreign delete', async () => {
    await rm(pagePath);
    await onUnlink(pagePath);
    expect(messages).toContainEqual(expect.objectContaining({ event: 'conloca:content-update' }));
  });

  it("announces the API's own move as neither a delete nor a foreign change", async () => {
    const read = must(await editor.getLocalized(id, 'en'));
    const res = await editor.updateLocalized({
      id,
      locale: 'en',
      etag: read.localized.etag,
      data: { pathname: '/moved' },
    });
    expect(res.success).toBe(true);
    const movedPath = join(dir, 'example', 'pages', 'moved.en.vxjson');
    expect(editor.isOwnWriteFile(pagePath)).toBe(true);
    expect(editor.isOwnWriteFile(movedPath)).toBe(true);
    await onUnlink(pagePath);
    await onChange(movedPath);
    expect(messages.filter((m) => m.event === 'conloca:content-update')).toEqual([]);
  });

  it("announces the API's own rename in letter case only as neither a delete nor a foreign change", async () => {
    const heroId = getCreatedId(
      await editor.createContent({
        kind: 'fragment',
        type: 'mdx',
        collection: 'general',
        name: 'hero',
        locales: { en: { meta: { title: 'Hero' }, content: { mdx: '# Hero' } } },
      }),
    );
    const read = must(await editor.getLocalized(heroId, 'en'));
    const res = await editor.updateLocalized({
      id: heroId,
      locale: 'en',
      etag: read.localized.etag,
      data: { name: 'Hero' },
    });
    expect(res.success).toBe(true);
    const oldPath = join(dir, 'fragments', 'general', 'hero.en.mdx');
    const renamedPath = join(dir, 'fragments', 'general', 'Hero.en.mdx');
    // A case-insensitive disk reports both spellings of the one file; a case-sensitive one, a move of two files.
    expect(editor.isOwnWriteFile(oldPath)).toBe(true);
    expect(editor.isOwnWriteFile(renamedPath)).toBe(true);
    await onUnlink(oldPath);
    await onChange(renamedPath);
    expect(messages.filter((m) => m.event === 'conloca:content-update')).toEqual([]);
  });
});
