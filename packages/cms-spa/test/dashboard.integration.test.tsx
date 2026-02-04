/// <reference lib="dom" />
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { cleanup, screen } from '@testing-library/react';
import { CMSDashboard } from '../src/components/CMSDashboard';
import { renderWithProviders, setupTestAPI, testApi } from './test-utils';

// Cleanup after each test
afterEach(() => {
  cleanup();
  testApi?.clear();
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
      kind: 'block',
      collection: 'blocks',
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
      kind: 'block',
      collection: 'blocks',
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
    expect(screen.getByTestId('section-card-blocks')).toHaveTextContent('2'); // Total blocks
    expect(screen.getByText('Pages')).toBeInTheDocument();
    expect(screen.getByText('Blocks')).toBeInTheDocument();
  });

  test('shows empty state when no content exists', async () => {
    // Don't add any content - InMemoryContentAPI starts empty

    renderWithProviders(<CMSDashboard />, {}, false);

    // Wait for dashboard title to appear
    await screen.findByTestId('dashboard-title');

    // Should show zero counts using the count-specific test IDs
    expect(screen.getByTestId('section-card-pages-count')).toHaveTextContent('0');
    expect(screen.getByTestId('section-card-blocks-count')).toHaveTextContent('0');
  });
});
