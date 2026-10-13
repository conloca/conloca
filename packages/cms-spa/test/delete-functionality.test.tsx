import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, waitForElementToBeRemoved } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { FragmentList } from '../src/components/pages/FragmentList.js';
import { PageList } from '../src/components/pages/PageList.js';
import { API_ROUTES, mockAPIError, setupTestAPI, testApi } from './test-utils.js';

// Clean up after each test
afterEach(() => {
  cleanup();
  testApi?.clear();
});

// Helper function to click the "More actions" menu and then the delete option
async function clickDeleteInActionsMenu(index = 0) {
  // The delete button is now inside a "More actions" dropdown menu
  const moreActionsButtons = screen.getAllByRole('button', { name: /more actions/i });
  fireEvent.click(moreActionsButtons[index]);

  // Wait for and click the delete option in the dropdown
  // The dropdown items use button role, not menuitem
  await waitFor(() => {
    expect(screen.getByText('Delete')).toBeDefined();
  });
  fireEvent.click(screen.getByText('Delete'));
}

describe('Delete Functionality', () => {
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

  describe('FragmentList Delete', () => {
    it('should show more actions button for each fragment', async () => {
      // Create test fragments using real API
      await testApi.createContent({
        type: 'mdx',
        kind: 'fragment',
        collection: 'shared',
        name: 'hero-fragment',
        meta: { title: 'Hero Fragment' },
        locales: {
          en: {
            meta: { title: 'Hero Fragment' },
            content: { mdx: '# Hero Fragment' },
          },
        },
      });

      await testApi.createContent({
        type: 'mdx',
        kind: 'fragment',
        collection: 'shared',
        name: 'feature-fragment',
        meta: { title: 'Feature Fragment' },
        locales: {
          en: {
            meta: { title: 'Feature Fragment' },
            content: { mdx: '# Feature Fragment' },
          },
        },
      });

      render(
        <MemoryRouter>
          <QueryClientProvider client={queryClient}>
            <FragmentList />
          </QueryClientProvider>
        </MemoryRouter>,
      );

      await waitFor(() => {
        expect(screen.getByText('Hero Fragment')).toBeDefined();
        expect(screen.getByText('Feature Fragment')).toBeDefined();
      });

      // Should have "More actions" buttons for each fragment
      const moreActionsButtons = screen.getAllByRole('button', { name: /more actions/i });
      expect(moreActionsButtons).toHaveLength(2);
    });

    it('should show confirmation dialog when delete is clicked', async () => {
      // Create a test fragment
      await testApi.createContent({
        type: 'mdx',
        kind: 'fragment',
        collection: 'shared',
        name: 'hero-fragment',
        meta: { title: 'Hero Fragment' },
        locales: {
          en: {
            meta: { title: 'Hero Fragment' },
            content: { mdx: '# Hero Fragment' },
          },
        },
      });

      render(
        <MemoryRouter>
          <QueryClientProvider client={queryClient}>
            <FragmentList />
          </QueryClientProvider>
        </MemoryRouter>,
      );

      await screen.findByText('Hero Fragment');

      // Click "More actions" button and then delete option
      await clickDeleteInActionsMenu();

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
      // Create a test fragment
      await testApi.createContent({
        type: 'mdx',
        kind: 'fragment',
        collection: 'shared',
        name: 'hero-fragment',
        meta: { title: 'Hero Fragment' },
        locales: {
          en: {
            meta: { title: 'Hero Fragment' },
            content: { mdx: '# Hero Fragment' },
          },
        },
      });

      render(
        <MemoryRouter>
          <QueryClientProvider client={queryClient}>
            <FragmentList />
          </QueryClientProvider>
        </MemoryRouter>,
      );

      await screen.findByText('Hero Fragment');

      // Click "More actions" button and then delete option
      await clickDeleteInActionsMenu();

      // Confirm deletion
      const confirmButton = await screen.findByRole('button', { name: /confirm delete/i });
      fireEvent.click(confirmButton);

      // Wait for the fragment to be removed from the UI
      await waitForElementToBeRemoved(() => screen.queryByText('Hero Fragment'));

      // Verify the fragment was actually deleted from the API
      const allContent = Array.from(testApi.listAllContent());
      expect(allContent).toHaveLength(0);
    });

    it('should handle delete errors gracefully', async () => {
      // Create a test fragment
      const createResult = await testApi.createContent({
        type: 'mdx',
        kind: 'fragment',
        collection: 'shared',
        name: 'hero-fragment',
        meta: { title: 'Hero Fragment' },
        locales: {
          en: {
            meta: { title: 'Hero Fragment' },
            content: { mdx: '# Hero Fragment' },
          },
        },
      });

      const fragmentId = createResult.id!;

      // Mock a stale write error for the delete request
      mockAPIError(API_ROUTES.CONTENT_BY_ID(fragmentId), 409, 'STALE_WRITE', 'Content has been modified', {
        currentEtag: 'newer-etag',
      });

      render(
        <MemoryRouter>
          <QueryClientProvider client={queryClient}>
            <FragmentList />
          </QueryClientProvider>
        </MemoryRouter>,
      );

      await screen.findByText('Hero Fragment');

      // Delete and confirm via "More actions" menu
      await clickDeleteInActionsMenu();
      const confirmButton = await screen.findByRole('button', { name: /confirm delete/i });
      fireEvent.click(confirmButton);

      // Should close the dialog after error
      await waitFor(() => {
        expect(screen.queryByRole('heading', { name: /are you sure/i })).toBeNull();
      });
    });

    it('should remove fragment from list after successful deletion', async () => {
      // Create multiple test fragments
      await testApi.createContent({
        type: 'mdx',
        kind: 'fragment',
        collection: 'shared',
        name: 'hero-fragment',
        meta: { title: 'Hero Fragment' },
        locales: {
          en: {
            meta: { title: 'Hero Fragment' },
            content: { mdx: '# Hero Fragment' },
          },
        },
      });

      await testApi.createContent({
        type: 'mdx',
        kind: 'fragment',
        collection: 'shared',
        name: 'feature-fragment',
        meta: { title: 'Feature Fragment' },
        locales: {
          en: {
            meta: { title: 'Feature Fragment' },
            content: { mdx: '# Feature Fragment' },
          },
        },
      });

      render(
        <MemoryRouter>
          <QueryClientProvider client={queryClient}>
            <FragmentList />
          </QueryClientProvider>
        </MemoryRouter>,
      );

      await waitFor(() => {
        expect(screen.getByText('Hero Fragment')).toBeDefined();
        expect(screen.getByText('Feature Fragment')).toBeDefined();
      });

      // Delete first fragment via "More actions" menu (index 0 for first fragment)
      await clickDeleteInActionsMenu(0);

      const confirmButton = await screen.findByRole('button', { name: /confirm delete/i });
      fireEvent.click(confirmButton);

      // Hero Fragment should be removed, Feature Fragment should remain
      await waitForElementToBeRemoved(() => screen.queryByText('Hero Fragment'));
      expect(screen.getByText('Feature Fragment')).toBeDefined();
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
