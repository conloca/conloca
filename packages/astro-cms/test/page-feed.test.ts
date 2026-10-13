import { describe, expect, mock, test } from 'bun:test';
import { stubCollections } from './astro-content-stub.js';

stubCollections.pages = [
  {
    id: 'vx-hello',
    locale: 'en',
    pathname: '/blog/hello',
    title: 'Hello',
    created: '2026-01-01T00:00:00.000Z',
    modified: '2026-02-01T00:00:00.000Z',
    puckData: { content: [], root: { props: {} } },
  },
  { id: 'vx-hello', locale: 'de', pathname: '/blog/hello', title: 'Hallo' },
  { id: 'vx-later', locale: 'en', pathname: '/blog/later', title: 'Later', publishAt: '2999-01-01T00:00:00.000Z' },
  { id: 'vx-pricing', locale: 'en', pathname: '/pricing', title: 'Pricing' },
];

// Resolves only inside an Astro process that installs conlocaCMS().
const routing = {
  enabled: true,
  locale: 'en',
  siteName: 'default',
  fallback: '404',
  onConflict: 'warn',
  routes: { pages: { pattern: '/[...page]', collection: 'pages' } },
};

mock.module('virtual:conloca-routing-config', () => ({ default: routing }));

const { getPagesByPrefix } = await import('../src/page-feed.js');

describe('listing CMS pages from a plain Astro page', () => {
  test('lists each published page under the prefix once, in the site language', async () => {
    const pages = await getPagesByPrefix('/blog/');

    expect(pages.map((page) => [page.pathname, page.title])).toEqual([['/blog/hello', 'Hello']]);
  });

  test('hands over the page metadata without the fields the content store keeps for itself', async () => {
    const [page] = await getPagesByPrefix('/blog/');

    for (const field of ['id', 'locale', 'pathname', 'puckData', 'created', 'modified']) {
      expect(page?.meta).not.toHaveProperty(field);
    }
    expect(page?.timestamps?.modified).toBeInstanceOf(Date);
    // No publish time, so the page is dated by its creation.
    expect(page?.timestamps?.published).toEqual(new Date('2026-01-01T00:00:00.000Z'));
  });

  test('lists another language when asked for it', async () => {
    const pages = await getPagesByPrefix('/blog/', { locale: 'de' });

    expect(pages.map((page) => page.title)).toEqual(['Hallo']);
  });

  test('refuses to answer when the site has no content routes, rather than returning an empty list', async () => {
    routing.enabled = false;
    try {
      await expect(getPagesByPrefix('/blog/')).rejects.toThrow('no content routes');
    } finally {
      routing.enabled = true;
    }
  });
});
