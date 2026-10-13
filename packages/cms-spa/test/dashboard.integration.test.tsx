/// <reference lib="dom" />
import { afterEach, beforeEach, describe, expect, setSystemTime, test } from 'bun:test';
import { cleanup, screen } from '@testing-library/react';
import { CMSDashboard } from '../src/components/CMSDashboard.js';
import { renderWithProviders, setupTestAPI, testApi } from './test-utils.js';

// Cleanup after each test, including a clock a test stopped
afterEach(() => {
  cleanup();
  testApi?.clear();
  setSystemTime();
});

beforeEach(() => {
  setupTestAPI();
});

describe('CMSDashboard Integration', () => {
  test('fetches and displays content statistics', async () => {
    // Add test data to InMemoryContentAPI
    await testApi.createContent({
      kind: 'page',
      site: 'default',
      collection: 'pages',
      type: 'puck',
      meta: { title: 'Home' },
      locales: {
        en: {
          meta: { title: 'Home' },
          pathname: '/',
          content: { puckData: { root: {}, content: [], zones: {} } },
        },
        nl: {
          meta: { title: 'Thuis' },
          pathname: '/',
          content: { puckData: { root: {}, content: [], zones: {} } },
        },
      },
    });

    await testApi.createContent({
      kind: 'page',
      site: 'default',
      collection: 'pages',
      type: 'puck',
      meta: { title: 'About' },
      locales: {
        en: {
          meta: { title: 'About' },
          pathname: '/about',
          content: { puckData: { root: {}, content: [], zones: {} } },
        },
      },
    });

    await testApi.createContent({
      kind: 'fragment',
      collection: 'fragments',
      type: 'mdx',
      name: 'hero',
      meta: { title: 'Hero' },
      locales: {
        en: {
          meta: { title: 'Hero' },
          content: { mdx: '# Hero' },
        },
      },
    });

    await testApi.createContent({
      kind: 'fragment',
      collection: 'fragments',
      type: 'mdx',
      name: 'cta',
      meta: { title: 'CTA' },
      locales: {
        en: {
          meta: { title: 'CTA' },
          content: { mdx: '## Call to Action' },
        },
      },
    });

    renderWithProviders(<CMSDashboard />, {}, false);

    // Wait for content to appear using new section-card test IDs
    const pagesCard = await screen.findByTestId('section-card-pages');

    // Check stats are displayed
    expect(pagesCard).toHaveTextContent('2'); // Total pages for default site
    expect(screen.getByTestId('section-card-fragments')).toHaveTextContent('2'); // Total fragments
    expect(screen.getByText('Pages')).toBeInTheDocument();
    expect(screen.getByText('Fragments')).toBeInTheDocument();
  });

  test('shows empty state when no content exists', async () => {
    // Don't add any content - InMemoryContentAPI starts empty

    renderWithProviders(<CMSDashboard />, {}, false);

    // Wait for dashboard title to appear
    await screen.findByTestId('dashboard-title');

    // Should show zero counts using the count-specific test IDs
    expect(screen.getByTestId('section-card-pages-count')).toHaveTextContent('0');
    expect(screen.getByTestId('section-card-fragments-count')).toHaveTextContent('0');
  });

  test('recent activity calls a page a draft from the instant its unpublish time arrives', async () => {
    // The clock stands still, so the dashboard judges the page at exactly its unpublish time.
    const unpublishAt = new Date('2026-09-23T12:00:00Z');
    setSystemTime(unpublishAt);
    await testApi.createContent({
      kind: 'page',
      site: 'default',
      collection: 'pages',
      type: 'puck',
      meta: { title: 'Retired' },
      locales: {
        en: {
          meta: { title: 'Retired' },
          pathname: '/retired',
          unpublishAt: unpublishAt.toISOString(),
          content: { puckData: { root: {}, content: [], zones: {} } },
        },
      },
    });

    renderWithProviders(<CMSDashboard />, {}, false);

    const recentPage = (await screen.findByText('Retired')).closest('a');
    expect(recentPage).toHaveTextContent('Status: draft');
  });
});
