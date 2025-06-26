/// <reference lib="dom" />
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { ErrorCodes } from '@conloca/content-api-client';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { CMSDashboard } from '../src/components/CMSDashboard';
import { API_ROUTES, clearAPIErrors, mockAPIError, renderWithProviders, setupTestAPI, testApi } from './test-utils';

// Cleanup after each test
afterEach(() => {
  cleanup();
  testApi?.clear();
});

beforeEach(() => {
  setupTestAPI();
});

describe('CMSDashboard Integration', () => {
  test('shows loading state initially', () => {
    renderWithProviders(<CMSDashboard />, {}, false);

    // The loading state should appear briefly before data loads
    expect(screen.getByTestId('dashboard-loading')).toBeInTheDocument();
    expect(screen.getByText('Loading content...')).toBeInTheDocument();
  });

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

    // Wait for content to appear
    const pagesCard = await screen.findByTestId('stat-card-pages');

    // Check stats are displayed
    expect(pagesCard).toHaveTextContent('2'); // Total pages for default site
    expect(screen.getByTestId('stat-card-blocks')).toHaveTextContent('2'); // Total blocks
    expect(screen.getByText('Pages in default')).toBeInTheDocument();
    expect(screen.getByText('Blocks')).toBeInTheDocument();

    // Check locale breakdown for pages
    expect(pagesCard).toHaveTextContent('en');
    expect(pagesCard).toHaveTextContent('2'); // 2 pages in en
    expect(pagesCard).toHaveTextContent('nl');
    expect(pagesCard).toHaveTextContent('1'); // 1 page in nl

    // Check locale breakdown for blocks
    const blocksCard = screen.getByTestId('stat-card-blocks');
    expect(blocksCard).toHaveTextContent('en');
    expect(blocksCard).toHaveTextContent('2'); // 2 blocks in en

    // The dashboard now uses site-specific endpoints and block listing
  });

  test('shows error state when API fails', async () => {
    // Mock API errors for the routes that CMSDashboard uses before rendering
    mockAPIError(API_ROUTES.SITES, 500, ErrorCodes.FETCH_ERROR, 'Failed to fetch sites configuration');
    mockAPIError(API_ROUTES.SITE_PAGES('default'), 500, ErrorCodes.INTERNAL_ERROR, 'Failed to list pages for site');
    mockAPIError(API_ROUTES.BLOCKS, 500, ErrorCodes.INTERNAL_ERROR, 'Failed to list blocks');

    renderWithProviders(<CMSDashboard />, {}, false);

    await waitFor(
      () => {
        expect(screen.getByTestId('dashboard-error')).toBeInTheDocument();
      },
      { timeout: 3000 },
    );

    expect(screen.getByText('Failed to load content')).toBeInTheDocument();
    // The error message shows the error from the API
    expect(screen.getByText('Failed to fetch sites configuration')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();

    // Clear error mocks
    clearAPIErrors();
  });

  test('shows empty state when no content exists', async () => {
    // Don't add any content - InMemoryContentAPI starts empty

    renderWithProviders(<CMSDashboard />, {}, false);

    // Wait for stats to appear
    await screen.findByText('Pages in default');

    // Should show zero counts
    expect(screen.getAllByText('0')).toHaveLength(2); // 0 pages, 0 blocks
  });

  test('shows site selector when multiple sites exist', async () => {
    // Setup test API with multiple sites
    setupTestAPI('/__conloca/api', {
      sites: {
        default: {
          locales: ['en', 'nl'],
          defaultLocale: 'en',
        },
        blog: {
          locales: ['en', 'fr'],
          defaultLocale: 'en',
        },
      },
      globalLocales: ['en', 'nl', 'fr'],
    });

    // Add content for the blog site
    await testApi.createContent({
      kind: 'page',
      site: 'blog',
      collection: 'pages',
      type: 'puck',
      meta: { title: 'Blog Home' },
      locales: {
        en: {
          meta: { title: 'Blog Home' },
          pathname: '/',
          content: { puckData: { root: {}, content: [], zones: {} } },
        },
      },
    });

    renderWithProviders(<CMSDashboard />, {}, false);

    // Wait for site selector to appear
    await screen.findByText('Site: default');

    // Click the site selector
    const siteSelectorButton = screen.getByRole('button', { name: /Site: default/i });
    fireEvent.click(siteSelectorButton);

    // Wait for dropdown to open and show both sites
    await waitFor(() => {
      // Find buttons in the dropdown (not the main buttons)
      const dropdownButtons = screen.getAllByRole('button').filter((btn) => {
        const text = btn.textContent || '';
        return text === 'default' || text === 'blog';
      });
      expect(dropdownButtons).toHaveLength(2);
    });
  });
});
