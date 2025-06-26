import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import type { SitesConfig, VXJSONFile } from '../src/types';
import { conlocaContent } from '../src/vite-plugin';
import { VXJSON } from '../src/vxjson';

describe('Vite Plugin - File Watching Integration', () => {
  const testDir = '/tmp/test-vite-plugin';
  const contentRoot = join(testDir, 'content');

  const sitesConfig: SitesConfig = {
    sites: {
      'test-site': {
        locales: ['en'],
        defaultLocale: 'en',
      },
    },
    globalLocales: ['en'],
  };

  beforeEach(async () => {
    await mkdir(contentRoot, { recursive: true });
    await mkdir(join(contentRoot, 'test-site', 'pages'), { recursive: true });
    await writeFile(join(contentRoot, 'sites.json'), JSON.stringify(sitesConfig));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it('should configure vite plugin with content API', async () => {
    const plugin = conlocaContent({ contentRoot });

    expect(plugin.name).toBe('vite-plugin-conloca-content');
    expect(typeof plugin.configureServer).toBe('function');
  });

  it('should handle file watching events', async () => {
    const plugin = conlocaContent({ contentRoot });

    // Mock vite server
    const mockEvents: any[] = [];
    const mockServer = {
      watcher: {
        add: () => {},
        on: (event: string, handler: Function) => {
          // Store event handlers for testing
          mockEvents.push({ event, handler });
        },
      },
      middlewares: {
        use: () => {},
      },
      ws: {
        send: (data: any) => {
          mockEvents.push({ type: 'ws-send', data });
        },
      },
    };

    // Configure the server - create a minimal plugin context
    const mockContext = {
      meta: { rollupVersion: '0.0.0', watchMode: true, viteVersion: '5.0.0' },
      error: (e: any): never => {
        console.error(e);
        throw e;
      },
      debug: console.debug,
      info: console.info,
      warn: console.warn,
    };

    if (typeof plugin.configureServer === 'function') {
      await plugin.configureServer.call(mockContext, mockServer as any);
    } else if (
      plugin.configureServer &&
      typeof plugin.configureServer === 'object' &&
      'handler' in plugin.configureServer
    ) {
      await plugin.configureServer.handler.call(mockContext, mockServer as any);
    }

    // Find the event handlers
    const changeHandler = mockEvents.find((e) => e.event === 'change')?.handler;
    const addHandler = mockEvents.find((e) => e.event === 'add')?.handler;
    const unlinkHandler = mockEvents.find((e) => e.event === 'unlink')?.handler;

    expect(changeHandler).toBeDefined();
    expect(addHandler).toBeDefined();
    expect(unlinkHandler).toBeDefined();

    // Test file change event
    const testFile = join(contentRoot, 'test-site', 'pages', 'test.en.vxjson');
    const testData: VXJSONFile = {
      id: 'test-id',
      type: 'puck',
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
      meta: { title: 'Test Page' },
      content: { puckData: { root: {} } },
    };
    await writeFile(testFile, VXJSON.serialize(testData));

    // Simulate change event
    await changeHandler(testFile);

    // Check that WebSocket message was sent with LocalizedManifest
    const wsMessage = mockEvents.find((e) => e.type === 'ws-send' && e.data.event === 'conloca:content-update');
    expect(wsMessage).toBeDefined();
    expect(wsMessage.data.data.action).toBe('update');
    expect(wsMessage.data.data.manifest).toBeDefined();
    expect(wsMessage.data.data.manifest.id).toBe('test-id');
    expect(wsMessage.data.data.manifest.localized.locale).toBe('en');
    expect(wsMessage.data.data.manifest.localized.meta.title).toBe('Test Page');
  });
});
