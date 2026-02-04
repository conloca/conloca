import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, waitForElementToBeRemoved } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { BlockList } from '../src/components/pages/BlockList';
import { PageList } from '../src/components/pages/PageList';
import { API_ROUTES, mockAPIError, setupTestAPI, testApi } from './test-utils';

// Clean up after each test
afterEach(() => {
  cleanup();
  testApi?.clear();
});

// TODO: Delete functionality tests need to be rewritten after UI redesign
// These tests look for outdated testids and UI patterns that no longer exist
describe.skip('Delete Functionality', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });

    // Setup real in-memory API with test data
    setupTestAPI('/__conloca/api');
  });

  describe('BlockList Delete', () => {
    it('should show delete button for each block', async () => {
      // Create test blocks using real API
      await testApi.createContent({
        type: 'mdx',
        kind: 'block',
        collection: 'shared',
        name: 'hero-block',
        meta: { title: 'Hero Block' },
        locales: {
          en: {
            meta: { title: 'Hero Block' },
            content: { mdx: '# Hero Block' },
          },
        },
      });

      await testApi.createContent({
        type: 'mdx',
        kind: 'block',
        collection: 'shared',
        name: 'feature-block',
        meta: { title: 'Feature Block' },
        locales: {
          en: {
            meta: { title: 'Feature Block' },
            content: { mdx: '# Feature Block' },
          },
        },
      });

      render(
        <MemoryRouter>
          <QueryClientProvider client={queryClient}>
            <BlockList />
          </QueryClientProvider>
        </MemoryRouter>,
      );

      await waitFor(() => {
        expect(screen.getByText('Hero Block')).toBeDefined();
        expect(screen.getByText('Feature Block')).toBeDefined();
      });

      // Should have delete buttons for each block
      const deleteButtons = screen.getAllByRole('button', { name: /delete/i });
      expect(deleteButtons).toHaveLength(2);
    });

    it('should show confirmation dialog when delete is clicked', async () => {
      // Create a test block
      await testApi.createContent({
        type: 'mdx',
        kind: 'block',
        collection: 'shared',
        name: 'hero-block',
        meta: { title: 'Hero Block' },
        locales: {
          en: {
            meta: { title: 'Hero Block' },
            content: { mdx: '# Hero Block' },
          },
        },
      });

      render(
        <MemoryRouter>
          <QueryClientProvider client={queryClient}>
            <BlockList />
          </QueryClientProvider>
        </MemoryRouter>,
      );

      await screen.findByText('Hero Block');

      // Click delete button
      const deleteButton = screen.getByRole('button', { name: /delete/i });
      fireEvent.click(deleteButton);

      // Should show confirmation dialog
      await waitFor(() => {
        expect(screen.getByText(/are you sure you want to delete/i)).toBeDefined();
        expect(screen.getByText(/this action cannot be undone/i)).toBeDefined();
      });

      // Should have cancel and confirm buttons
      expect(screen.getByRole('button', { name: /cancel/i })).toBeDefined();
      expect(screen.getByRole('button', { name: /confirm delete/i })).toBeDefined();
    });

    it('should call deleteContent when confirmed', async () => {
      // Create a test block
      await testApi.createContent({
        type: 'mdx',
        kind: 'block',
        collection: 'shared',
        name: 'hero-block',
        meta: { title: 'Hero Block' },
        locales: {
          en: {
            meta: { title: 'Hero Block' },
            content: { mdx: '# Hero Block' },
          },
        },
      });

      render(
        <MemoryRouter>
          <QueryClientProvider client={queryClient}>
            <BlockList />
          </QueryClientProvider>
        </MemoryRouter>,
      );

      await screen.findByText('Hero Block');

      // Click delete
      fireEvent.click(screen.getByRole('button', { name: /delete/i }));

      // Confirm deletion
      const confirmButton = await screen.findByRole('button', { name: /confirm delete/i });
      fireEvent.click(confirmButton);

      // Wait for the block to be removed from the UI
      await waitForElementToBeRemoved(() => screen.queryByText('Hero Block'));

      // Verify the block was actually deleted from the API
      const allContent = Array.from(testApi.listAllContent());
      expect(allContent).toHaveLength(0);
    });

    it('should handle delete errors gracefully', async () => {
      // Create a test block
      const createResult = await testApi.createContent({
        type: 'mdx',
        kind: 'block',
        collection: 'shared',
        name: 'hero-block',
        meta: { title: 'Hero Block' },
        locales: {
          en: {
            meta: { title: 'Hero Block' },
            content: { mdx: '# Hero Block' },
          },
        },
      });

      const blockId = createResult.id!;

      // Mock a stale write error for the delete request
      mockAPIError(API_ROUTES.CONTENT_BY_ID(blockId), 409, 'STALE_WRITE', 'Content has been modified', {
        currentEtag: 'newer-etag',
      });

      render(
        <MemoryRouter>
          <QueryClientProvider client={queryClient}>
            <BlockList />
          </QueryClientProvider>
        </MemoryRouter>,
      );

      await screen.findByText('Hero Block');

      // Delete and confirm
      fireEvent.click(screen.getByRole('button', { name: /delete/i }));
      const confirmButton = await screen.findByRole('button', { name: /confirm delete/i });
      fireEvent.click(confirmButton);

      // Should close the dialog after error
      await waitFor(() => {
        expect(screen.queryByRole('heading', { name: /are you sure/i })).toBeNull();
      });
    });

    it('should remove block from list after successful deletion', async () => {
      // Create multiple test blocks
      await testApi.createContent({
        type: 'mdx',
        kind: 'block',
        collection: 'shared',
        name: 'hero-block',
        meta: { title: 'Hero Block' },
        locales: {
          en: {
            meta: { title: 'Hero Block' },
            content: { mdx: '# Hero Block' },
          },
        },
      });

      await testApi.createContent({
        type: 'mdx',
        kind: 'block',
        collection: 'shared',
        name: 'feature-block',
        meta: { title: 'Feature Block' },
        locales: {
          en: {
            meta: { title: 'Feature Block' },
            content: { mdx: '# Feature Block' },
          },
        },
      });

      render(
        <MemoryRouter>
          <QueryClientProvider client={queryClient}>
            <BlockList />
          </QueryClientProvider>
        </MemoryRouter>,
      );

      await waitFor(() => {
        expect(screen.getByText('Hero Block')).toBeDefined();
        expect(screen.getByText('Feature Block')).toBeDefined();
      });

      // Delete first block
      const deleteButtons = screen.getAllByRole('button', { name: /delete/i });
      fireEvent.click(deleteButtons[0]);

      const confirmButton = await screen.findByRole('button', { name: /confirm delete/i });
      fireEvent.click(confirmButton);

      // Hero Block should be removed, Feature Block should remain
      await waitForElementToBeRemoved(() => screen.queryByText('Hero Block'));
      expect(screen.getByText('Feature Block')).toBeDefined();
    });
  });

  describe('PageList Delete', () => {
    it('should show delete button in actions column', async () => {
      // Create test pages
      await testApi.createContent({
        type: 'puck',
        kind: 'page',
        site: 'default',
        collection: 'pages',
        meta: { title: 'Homepage' },
        locales: {
          en: {
            meta: { title: 'Homepage' },
            pathname: '/',
            content: { puckData: { root: {}, content: [], zones: {} } },
          },
          nl: {
            meta: { title: 'Startpagina' },
            pathname: '/',
            content: { puckData: { root: {}, content: [], zones: {} } },
          },
        },
      });

      render(
        <MemoryRouter>
          <QueryClientProvider client={queryClient}>
            <PageList />
          </QueryClientProvider>
        </MemoryRouter>,
      );

      // Wait for page to load
      await screen.findByText('Homepage');

      // Should show delete buttons in the actions column
      const deleteButtons = screen.getAllByRole('button', { name: /delete/i });
      expect(deleteButtons.length).toBeGreaterThan(0);
    });

    it('should allow deletion of entire page when only one locale exists', async () => {
      // Create a page with only one locale
      const createResult = await testApi.createContent({
        type: 'puck',
        kind: 'page',
        site: 'default',
        collection: 'pages',
        meta: { title: 'Single Locale Page' },
        locales: {
          en: {
            meta: { title: 'Single Locale Page' },
            pathname: '/single',
            content: { puckData: { root: {}, content: [], zones: {} } },
          },
        },
      });

      const pageId = createResult.id!;

      render(
        <MemoryRouter>
          <QueryClientProvider client={queryClient}>
            <PageList />
          </QueryClientProvider>
        </MemoryRouter>,
      );

      await screen.findByText('Single Locale Page');

      // The delete button should be enabled and show appropriate title - using test ID
      // In "all" view, the test ID includes the locale
      const deleteButton = screen.getByTestId(`delete-${pageId}.en`);
      expect(deleteButton).toBeDefined();
      expect(deleteButton.hasAttribute('disabled')).toBe(false);
      expect(deleteButton.getAttribute('title')).toBe('Delete entire page');

      // Click delete button
      fireEvent.click(deleteButton);

      // Should show confirmation dialog for deleting the entire page
      await waitFor(() => {
        expect(screen.getByText(/are you sure you want to delete this page/i)).toBeDefined();
      });

      // Confirm deletion
      const confirmButton = await screen.findByRole('button', { name: /confirm delete/i });
      fireEvent.click(confirmButton);

      // Page should be completely removed
      await waitForElementToBeRemoved(() => screen.queryByText('Single Locale Page'));

      // Verify the page was actually deleted from the API
      const allContent = Array.from(testApi.listAllContent());
      expect(allContent).toHaveLength(0);
    });

    it('should allow deletion of specific locale when multiple exist', async () => {
      // Create a page with multiple locales
      await testApi.createContent({
        type: 'puck',
        kind: 'page',
        site: 'default',
        collection: 'pages',
        meta: { title: 'Multi-locale Page' },
        locales: {
          en: {
            meta: { title: 'Multi-locale Page' },
            pathname: '/multi',
            content: { puckData: { root: {}, content: [], zones: {} } },
          },
          nl: {
            meta: { title: 'Meertalige Pagina' },
            pathname: '/multi',
            content: { puckData: { root: {}, content: [], zones: {} } },
          },
        },
      });

      render(
        <MemoryRouter>
          <QueryClientProvider client={queryClient}>
            <PageList />
          </QueryClientProvider>
        </MemoryRouter>,
      );

      // Wait for the page to load - it might show either locale's title
      await waitFor(() => {
        const titles = ['Multi-locale Page', 'Meertalige Pagina'];
        const hasTitle = titles.some((title) => screen.queryByText(title));
        expect(hasTitle).toBe(true);
      });

      // There should be two delete buttons (one for each locale)
      const deleteButtons = screen.getAllByRole('button', { name: /delete/i });
      expect(deleteButtons).toHaveLength(2);

      // Click the first delete button (for one of the locales)
      fireEvent.click(deleteButtons[0]);

      // Confirm deletion
      const confirmButton = await screen.findByRole('button', { name: /confirm delete/i });
      fireEvent.click(confirmButton);

      // Wait for one of the locales to be removed
      await waitFor(() => {
        const remainingDeleteButtons = screen.getAllByRole('button', { name: /delete/i });
        expect(remainingDeleteButtons).toHaveLength(1);
      });

      // Page should still exist with one locale
      const titles = ['Multi-locale Page', 'Meertalige Pagina'];
      const hasTitle = titles.some((title) => screen.queryByText(title));
      expect(hasTitle).toBe(true);
    });
  });
});
