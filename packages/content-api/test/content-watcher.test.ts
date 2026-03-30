import { describe, expect, it } from 'bun:test';

import {
  type ContentWatchEvent,
  type ContentWatcherOptions,
  createContentWatchHandlers,
  type WebSocketSender,
} from '../src/content-watcher';

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
    kind: 'page' | 'block' | 'data';
  }[];
}

function createTestSetup(options?: { reindexResult?: ReindexResult; reindexError?: Error }) {
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

  it('does not call the callback when reindex fails', async () => {
    const { handlers, refreshEvents, wsMessages } = createTestSetup({
      reindexError: new Error('boom'),
    });

    await handlers.onAdd('/repo/content/site/pages/home.en.vxjson');

    expect(wsMessages).toHaveLength(0);
    expect(refreshEvents).toHaveLength(0);
  });
});
