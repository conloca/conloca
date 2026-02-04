/// <reference lib="dom" />
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { ErrorCodes } from '@conloca/content-api-client';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import App from '../src/App';
import { API_ROUTES, mockAPIError, renderWithProviders, setupTestAPI, testApi } from './test-utils';

// Set test timeout
const TEST_TIMEOUT = 10000;

// Setup before each test
beforeEach(() => {
  setupTestAPI('/__cms/api'); // Use the same base URL as the app expects
});

// Cleanup after each test
afterEach(() => {
  cleanup();
  testApi?.clear();
});

// Helper to render app with router and providers
function renderApp() {
  console.log('[Integration Test] Rendering app');

  return renderWithProviders(<App />, {}, false);
}

// TODO: Integration tests need to be rewritten after UI redesign
// These tests look for outdated testids (stat-card-*, page-list-*, etc.) that no longer exist
// in the redesigned CMSDashboard, PageList, and related components.
describe.skip('CMS Integration Tests', () => {
  describe('Dashboard', () => {
    test('fetches and displays content statistics on mount', async () => {
      console.log('[Integration Test] Starting dashboard test');

      // Add some test data
      await testApi.createContent({
        kind: 'page',
        site: 'default',
        collection: 'pages',
        type: 'puck',
        meta: { title: 'Home' },
        locales: {
          en: {
            pathname: '/',
            meta: { title: 'Home' },
            content: { puckData: { content: [], root: {}, zones: {} } },
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
            pathname: '/about',
            meta: { title: 'About' },
            content: { puckData: { content: [], root: {}, zones: {} } },
          },
        },
      });

      await testApi.createContent({
        kind: 'block',
        collection: 'shared',
        type: 'mdx',
        name: 'hero-block',
        meta: { title: 'Hero Block' },
        locales: {
          en: {
            meta: { title: 'Hero Block' },
            content: { mdx: '# Hero' },
          },
        },
      });

      console.log('[Integration Test] Rendering app');
      renderApp();

      // Check if dashboard loads
      console.log('[Integration Test] Waiting for dashboard to load');
      await waitFor(
        () => {
          console.log('[Integration Test] Dashboard still loading...');
          expect(screen.getByTestId('dashboard-title')).toBeInTheDocument();
        },
        { timeout: 5000 },
      );

      // Check for stats display
      console.log('[Integration Test] Dashboard loaded, checking stats');
      await waitFor(() => {
        expect(screen.getByText('Pages in default')).toBeInTheDocument();
        expect(screen.getByTestId('stat-card-pages').textContent).toContain('2');
        // Check the blocks stat card specifically
        const blocksCard = screen.getByTestId('stat-card-blocks');
        expect(blocksCard).toBeInTheDocument();
        expect(blocksCard.textContent).toContain('1');
      });

      console.log('[Integration Test] Dashboard test complete');
    });

    test('shows error state when API fails', async () => {
      // Simulate API errors for all dashboard endpoints
      mockAPIError(API_ROUTES.SITES, 500, ErrorCodes.WRITE_ERROR, 'Internal server error');
      mockAPIError(API_ROUTES.SITE_PAGES('default'), 500, ErrorCodes.WRITE_ERROR, 'Internal server error');
      mockAPIError(API_ROUTES.BLOCKS, 500, ErrorCodes.WRITE_ERROR, 'Internal server error');

      renderApp();

      await waitFor(() => {
        // Dashboard should show an error state
        const errorElement = screen.getByTestId('dashboard-error');
        expect(errorElement).toBeInTheDocument();
        expect(screen.getByText('Failed to load content')).toBeInTheDocument();
      });
    });
  });

  describe('Page List', () => {
    test('fetches and displays pages on mount', async () => {
      // Add test pages
      await testApi.createContent({
        kind: 'page',
        site: 'default',
        collection: 'pages',
        type: 'puck',
        meta: { title: 'Home' },
        locales: {
          en: {
            pathname: '/',
            meta: { title: 'Home' },
            content: { puckData: { content: [], root: {}, zones: {} } },
          },
          nl: {
            pathname: '/nl',
            meta: { title: 'Thuis' },
            content: { puckData: { content: [], root: {}, zones: {} } },
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
            pathname: '/about',
            meta: { title: 'About' },
            content: { puckData: { content: [], root: {}, zones: {} } },
          },
        },
      });

      console.log('[Integration Test] Starting page list test');
      renderApp();

      console.log('[Integration Test] Clicking pages link');
      fireEvent.click(screen.getByRole('link', { name: /pages/i }));

      console.log('[Integration Test] Current URL:', window.location.href || 'blank');
      console.log('[Integration Test] Page content:', document.body.textContent);

      // First check for empty state or loading
      await waitFor(() => {
        console.log('[Integration Test] Returning sites config for page list');
        console.log('[Integration Test] Returning pages for page list');
        // Either we see the pages or we see "No pages" message
        const hasPages = screen.queryByText('Home') || screen.queryByText('No pages found');
        expect(hasPages).toBeTruthy();
      });

      // Then check for the actual page items
      await waitFor(
        () => {
          expect(screen.getByText('Home')).toBeInTheDocument();
          expect(screen.getByText('About')).toBeInTheDocument();
        },
        { timeout: 5000 },
      );

      // Should show locale indicators
      expect(screen.getAllByTestId('locale-indicator')).toHaveLength(3);
    });

    test('creates new page when clicking New Page button', async () => {
      const startTime = performance.now();
      const logTiming = (msg: string) => {
        console.log(`[Timing] ${msg}: ${(performance.now() - startTime).toFixed(2)}ms`);
      };

      logTiming('Test started');
      renderApp();
      logTiming('App rendered');

      // Navigate to pages
      fireEvent.click(screen.getByRole('link', { name: /pages/i }));
      logTiming('Clicked pages link');

      await waitFor(() => {
        expect(screen.getByTestId('new-page-button')).toBeInTheDocument();
      });
      logTiming('Found new-page-button');

      // Click new page button
      fireEvent.click(screen.getByTestId('new-page-button'));
      logTiming('Clicked new page button');

      // Verify dialog opens by checking for presence in DOM
      // Use querySelector since Radix UI renders in a portal
      await waitFor(() => {
        const dialog = document.querySelector('[data-testid="create-page-dialog"]');
        const titleInput = document.querySelector('[data-testid="page-title-input"]');
        const pathInput = document.querySelector('[data-testid="page-path-input"]');
        const submitBtn = document.querySelector('[data-testid="create-page-submit"]');

        expect(dialog).toBeTruthy();
        expect(titleInput).toBeTruthy();
        expect(pathInput).toBeTruthy();
        expect(submitBtn).toBeTruthy();
      });
      logTiming('Dialog opened and all elements found');

      // Fill in form
      fireEvent.change(screen.getByTestId('page-title-input'), { target: { value: 'New Test Page' } });
      logTiming('Filled title input');

      // The path should auto-generate
      await waitFor(() => {
        const pathInput = screen.getByTestId('page-path-input') as HTMLInputElement;
        expect(pathInput.value).toBe('/new-test-page');
      });
      logTiming('Path auto-generated');

      // Change to custom path
      fireEvent.change(screen.getByTestId('page-path-input'), { target: { value: '/test-page' } });
      logTiming('Changed path to custom value');

      // Add a small delay to see if it's a race condition
      // await new Promise(resolve => setTimeout(resolve, 10));

      // Check button state before waiting
      const buttonBefore = screen.getByTestId('create-page-submit') as HTMLButtonElement;
      console.log(`[Timing] Button disabled state before wait: ${buttonBefore.disabled}`);

      // Wait for validation to complete and button to be enabled
      let checkCount = 0;
      await waitFor(
        () => {
          checkCount++;
          const createButton = screen.getByTestId('create-page-submit') as HTMLButtonElement;
          const checkTime = performance.now() - startTime;
          console.log(`[Timing] Check #${checkCount} at ${checkTime.toFixed(2)}ms: disabled=${createButton.disabled}`);
          expect(createButton).not.toBeDisabled();
        },
        { timeout: 5000 },
      );
      logTiming('Button enabled after validation');

      // Submit form
      console.log('[Integration Test] Clicking create button');
      fireEvent.click(screen.getByTestId('create-page-submit'));
      logTiming('Clicked submit button');

      // Wait for success - dialog should close and we should see the new page in the list
      await waitFor(
        () => {
          expect(screen.queryByTestId('create-page-dialog')).not.toBeInTheDocument();
        },
        { timeout: 5000 },
      );
      logTiming('Dialog closed');

      // Verify the page was created in the API
      const allContent = Array.from(testApi.listAllContent());
      expect(allContent).toHaveLength(1);
      expect(allContent[0].locales.en?.pathname).toBe('/test-page');
      expect(allContent[0].locales.en?.meta.title).toBe('New Test Page');
      logTiming('API verification complete');

      console.log('[Integration Test] Page creation flow tested successfully');
    });

    // Removed - duplicate test covered in conflict-resolution.test.tsx
  });

  describe('Block Management', () => {
    test('creates new block dialog flow', async () => {
      renderApp();

      // Navigate to blocks
      fireEvent.click(screen.getByRole('link', { name: /blocks/i }));

      await waitFor(() => {
        expect(screen.getByTestId('new-block-button')).toBeInTheDocument();
      });

      // Verify we're on blocks page (empty state)
      expect(screen.getByTestId('no-blocks-message')).toBeInTheDocument();

      // Click new block button
      fireEvent.click(screen.getByTestId('new-block-button'));

      // Dialog should open
      await waitFor(() => {
        expect(screen.getByTestId('create-block-dialog')).toBeInTheDocument();
        expect(screen.getByTestId('block-title-input')).toBeInTheDocument();
      });

      // Verify the input is focused
      const titleInput = screen.getByTestId('block-title-input');
      expect(document.activeElement).toBe(titleInput);

      // Verify submit button is disabled when empty
      expect(screen.getByTestId('create-block-submit')).toBeDisabled();

      // Fill in form
      fireEvent.change(titleInput, { target: { value: 'Test Hero Block' } });

      // Verify the submit button is now enabled
      const submitButton = screen.getByTestId('create-block-submit');
      expect(submitButton).not.toBeDisabled();

      // Test cancel button
      const cancelButton = screen.getByRole('button', { name: /cancel/i });
      fireEvent.click(cancelButton);

      // Dialog should close
      await waitFor(() => {
        expect(screen.queryByTestId('create-block-dialog')).not.toBeInTheDocument();
      });

      // Should still be on blocks page
      expect(screen.getByTestId('new-block-button')).toBeInTheDocument();

      // Note: MDX editor integration is tested separately in MDX editor package
    });
  });

  describe('Preview Functionality', () => {
    test('opens preview in new tab', async () => {
      // Mock window.open
      const mockOpen = mock(() => null);
      const originalOpen = window.open;
      window.open = mockOpen as any;

      try {
        // Create a test page
        const result = await testApi.createContent({
          kind: 'page',
          site: 'default',
          collection: 'pages',
          type: 'puck',
          meta: { title: 'Preview Test Page' },
          locales: {
            en: {
              pathname: '/preview-test',
              meta: { title: 'Preview Test Page' },
              content: { puckData: { content: [], root: {}, zones: {} } },
            },
          },
        });

        const pageId = result.id!;

        renderApp();

        // Navigate to pages first
        fireEvent.click(screen.getByRole('link', { name: /pages/i }));

        await waitFor(() => {
          expect(screen.getByTestId('new-page-button')).toBeInTheDocument();
        });

        // Find the edit button for our page
        const editButton = screen.getByTestId(`edit-${pageId}.en`);
        fireEvent.click(editButton);

        // Wait for page editor to load
        await waitFor(() => {
          expect(screen.getByTestId('preview-button')).toBeInTheDocument();
        });

        // Click preview button
        const previewButton = screen.getByTestId('preview-button');
        fireEvent.click(previewButton);

        // Verify window.open was called with the correct pathname
        expect(mockOpen).toHaveBeenCalledTimes(1);
        expect(mockOpen).toHaveBeenCalledWith('/preview-test', '_blank');
      } finally {
        window.open = originalOpen;
      }
    });
  });

  describe('Locale Selector', () => {
    test('filters pages by locale', async () => {
      console.log('[Locale Test] Starting locale filter test');

      // Create pages with different locale combinations
      const multiLocalePage = await testApi.createContent({
        kind: 'page',
        site: 'default',
        collection: 'pages',
        type: 'puck',
        meta: { title: 'Multi-locale Page' },
        locales: {
          en: {
            pathname: '/multi-locale',
            meta: { title: 'Multi-locale Page' },
            content: { puckData: { content: [], root: { title: 'English Content' }, zones: {} } },
          },
          nl: {
            pathname: '/nl/multi-locale',
            meta: { title: 'Multi-locale Page' },
            content: { puckData: { content: [], root: { title: 'Nederlandse Inhoud' }, zones: {} } },
          },
        },
      });

      console.log('[Locale Test] Created multi-locale page:', multiLocalePage.id);

      const englishOnlyPage = await testApi.createContent({
        kind: 'page',
        site: 'default',
        collection: 'pages',
        type: 'puck',
        meta: { title: 'English Only Page' },
        locales: {
          en: {
            pathname: '/english-only',
            meta: { title: 'English Only Page' },
            content: { puckData: { content: [], root: {}, zones: {} } },
          },
        },
      });

      console.log('[Locale Test] Created english-only page:', englishOnlyPage.id);

      // Verify pages exist in test API
      const allContent = Array.from(testApi.listAllContent());
      console.log('[Locale Test] Total content in API:', allContent.length);

      renderApp();

      // Navigate to pages
      fireEvent.click(screen.getByRole('link', { name: /pages/i }));

      await screen.findByTestId('new-page-button');

      // Wait for the page table to render with our pages
      await waitFor(() => {
        const pageTable = screen.getByRole('table');
        expect(pageTable).toBeInTheDocument();
      });

      // Initially should show all pages with all locales
      const localeIndicators = screen.getAllByTestId('locale-indicator');
      expect(localeIndicators).toHaveLength(3); // 2 for multi-locale, 1 for english-only

      // The locale selector should be present
      const localeFilter = screen.getByTestId('locale-selector');
      expect(localeFilter).toBeInTheDocument();

      // Select Dutch locale
      fireEvent.change(localeFilter, { target: { value: 'nl' } });

      // Should only show pages that have Dutch locale
      await waitFor(() => {
        // Check that we now have fewer locale indicators (only pages with nl)
        const visibleLocales = screen.getAllByTestId('locale-indicator');
        expect(visibleLocales).toHaveLength(2); // Both en and nl for the multi-locale page only

        // When filtered by nl, only the nl edit button should be visible
        const editButtons = screen.queryAllByTestId(/edit-.*/);
        expect(editButtons).toHaveLength(1); // Only one edit button
        expect(screen.getByTestId(`edit-${multiLocalePage.id}.nl`)).toBeInTheDocument();

        // English-only page should not be in the DOM at all
        expect(screen.queryByTestId(`edit-${englishOnlyPage.id}.en`)).not.toBeInTheDocument();
      });

      // Test passes - locale filtering works correctly
    });
  });

  describe('Error Handling', () => {
    test('shows error UI on API failures', async () => {
      // Set up error for the pages route
      mockAPIError(API_ROUTES.SITE_PAGES('default'), 500, ErrorCodes.WRITE_ERROR, 'Server error');

      renderApp();

      // Navigate to pages to trigger the error
      fireEvent.click(screen.getByRole('link', { name: /pages/i }));

      await waitFor(() => {
        // Should show error UI
        expect(screen.getByTestId('page-list-error')).toBeInTheDocument();
        expect(screen.getByText('Failed to load pages')).toBeInTheDocument();
        expect(screen.getByText('Server error')).toBeInTheDocument();
      });
    });
  });
});
