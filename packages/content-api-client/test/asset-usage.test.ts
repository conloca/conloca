import { describe, expect, test } from 'bun:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createContentAPIRouter, InMemoryContentAPI } from '@conloca/content-api/node';
import { ContentAPIClient } from '../src/client.js';

/**
 * The client's answer to "where is this picture used", for the picture at a path from the assets
 * root. The server answers `{ usage: [...] }`; the client handed that object on as if it were the
 * list, so the editor's "Used in" list never showed a single page.
 */
describe('asking where a picture is used', () => {
  async function clientWith(pageLinking: string): Promise<ContentAPIClient> {
    const api = new InMemoryContentAPI({
      sites: { default: { locales: ['en'], defaultLocale: 'en' } },
      globalLocales: ['en'],
    });
    await api.createContent({
      kind: 'page',
      site: 'default',
      collection: 'pages',
      type: 'puck',
      locales: {
        en: { pathname: '/trip-report', meta: { title: 'Trip', ogImage: pageLinking }, content: { puckData: {} } },
      },
    });
    // The assets folder is only named, never read: usage comes from the content
    const router = createContentAPIRouter(api, {
      assetsPath: join(tmpdir(), 'conloca-usage-assets'),
      contentRoot: join(tmpdir(), 'conloca-usage-content'),
    });
    const fetchRouter = async (input: RequestInfo | URL, init?: RequestInit) => router.request(input, init);
    return new ContentAPIClient({
      baseUrl: 'http://localhost',
      fetch: Object.assign(fetchRouter, { preconnect: () => {} }),
    });
  }

  test('lists the pages that link to it', async () => {
    const client = await clientWith('/assets/trip/beach.png');

    expect(await client.getAssetUsage('trip/beach.png')).toEqual([
      { page: '/trip-report (en)', field: 'meta.ogImage' },
    ]);
  });

  test('is an empty list for a picture nothing links to', async () => {
    const client = await clientWith('/assets/trip/beach.png');

    expect(await client.getAssetUsage('beach.png')).toEqual([]);
  });
});
