/// <reference lib="dom" />
import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { ErrorCodes } from '@conloca/content-api-client';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { AppRoutes } from '../src/App.js';
import {
  PREVIEW_UNAVAILABLE_DETAIL,
  PREVIEW_UNAVAILABLE_TITLE,
} from '../src/components/editor/preview-availability.js';
import { Toaster, toast } from '../src/components/toast.js';
import { RpcError } from '../src/frame/channel.js';
import { configureUI, type OpenPreviewResult } from '../src/ui-config.js';
import {
  API_ROUTES,
  mockAPIError,
  renderAppWithDataRouter,
  renderWithProviders,
  setupTestAPI,
  testApi,
} from './test-utils.js';

// Set test timeout

// Setup before each test
beforeEach(() => {
  setupTestAPI('/__cms/api'); // Use the same base URL as the app expects
});

// Cleanup after each test
afterEach(() => {
  cleanup();
  testApi?.clear();
  configureUI({});
});

// Helper to render app with router and providers
function renderApp() {
  console.log('[Integration Test] Rendering app');

  return renderWithProviders(<AppRoutes />, {}, false);
}

// Toasts of earlier tests stay active and would replay into a new toaster.
function mountFreshToaster() {
  toast.dismiss();
  renderWithProviders(<Toaster />, {}, false);
}

async function createPuckPage(pathname: string, title: string): Promise<string> {
  const result = await testApi.createContent({
    kind: 'page',
    site: 'default',
    collection: 'pages',
    type: 'puck',
    meta: { title },
    locales: {
      en: { pathname, meta: { title }, content: { puckData: { content: [], root: {}, zones: {} } } },
    },
  });
  if (!result.id) throw new Error(`creating ${pathname} returned no id`);
  return result.id;
}

describe('CMS Integration Tests', () => {
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
        kind: 'fragment',
        collection: 'shared',
        type: 'mdx',
        name: 'hero-fragment',
        meta: { title: 'Hero Fragment' },
        locales: {
          en: {
            meta: { title: 'Hero Fragment' },
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

      // Check for stats display using new section-card test IDs
      console.log('[Integration Test] Dashboard loaded, checking stats');
      await waitFor(() => {
        // Use section-card testId to verify Pages section exists (avoid multiple matches from nav)
        const pagesCard = screen.getByTestId('section-card-pages');
        expect(pagesCard).toBeInTheDocument();
        expect(pagesCard.textContent).toContain('2');
        // Check the fragments stat card specifically
        const fragmentsCard = screen.getByTestId('section-card-fragments');
        expect(fragmentsCard).toBeInTheDocument();
        expect(fragmentsCard.textContent).toContain('1');
      });

      console.log('[Integration Test] Dashboard test complete');
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
      // Use getAllByRole and select the first (nav) link since dashboard also has section card links
      const pagesLinks = screen.getAllByRole('link', { name: /pages/i });
      fireEvent.click(pagesLinks[0]);

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
      // Use getAllByRole and select the first (nav) link since dashboard also has section card links
      const pagesLinks = screen.getAllByRole('link', { name: /pages/i });
      fireEvent.click(pagesLinks[0]);
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

      // Note: The component auto-generates path from title and may override manual changes
      // We'll use the auto-generated path for this test
      logTiming('Using auto-generated path');

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
          // Create stays disabled until the path check answers, so this polls.
          // A plain boolean keeps each miss cheap: toBeDisabled() prints the
          // whole element tree on every miss, seconds per poll under Happy DOM.
          expect(createButton.disabled).toBe(false);
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
      expect(allContent[0].locales.en?.pathname).toBe('/new-test-page');
      expect(allContent[0].locales.en?.meta.title).toBe('New Test Page');
      logTiming('API verification complete');

      console.log('[Integration Test] Page creation flow tested successfully');
    });

    // Removed - duplicate test covered in conflict-resolution.test.tsx
  });

  describe('Fragment Management', () => {
    test('creates new fragment dialog flow', async () => {
      renderApp();

      // Navigate to fragments - use getAllByRole and select nav link (first one)
      const fragmentsLinks = screen.getAllByRole('link', { name: /fragments/i });
      fireEvent.click(fragmentsLinks[0]);

      await waitFor(() => {
        expect(screen.getByTestId('new-fragment-button')).toBeInTheDocument();
      });

      // Verify we're on fragments page (empty state)
      expect(screen.getByTestId('no-fragments-message')).toBeInTheDocument();

      // Click new fragment button
      fireEvent.click(screen.getByTestId('new-fragment-button'));

      // Dialog should open
      await waitFor(() => {
        expect(screen.getByTestId('create-fragment-dialog')).toBeInTheDocument();
        expect(screen.getByTestId('fragment-title-input')).toBeInTheDocument();
      });

      // Verify the input is focused
      const titleInput = screen.getByTestId('fragment-title-input');
      expect(document.activeElement).toBe(titleInput);

      // Verify submit button is disabled when empty
      expect(screen.getByTestId('create-fragment-submit')).toBeDisabled();

      // Fill in form
      fireEvent.change(titleInput, { target: { value: 'Test Hero Fragment' } });

      // Verify the submit button is now enabled
      const submitButton = screen.getByTestId('create-fragment-submit');
      expect(submitButton).not.toBeDisabled();

      // Test cancel button
      const cancelButton = screen.getByRole('button', { name: /cancel/i });
      fireEvent.click(cancelButton);

      // Dialog should close
      await waitFor(() => {
        expect(screen.queryByTestId('create-fragment-dialog')).not.toBeInTheDocument();
      });

      // Should still be on fragments page
      expect(screen.getByTestId('new-fragment-button')).toBeInTheDocument();

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

        // PageEditor uses useBlocker → needs a Data Router. Mount the app
        // directly at the page editor route via createMemoryRouter so the
        // hook can resolve.
        renderAppWithDataRouter([`/pages/${pageId}`], undefined, false);

        // Wait for page editor to load
        await waitFor(() => {
          expect(screen.getByTestId('preview-button')).toBeInTheDocument();
        });

        // Click preview button
        const previewButton = screen.getByTestId('preview-button');
        fireEvent.click(previewButton);

        // Verify window.open was called with the correct pathname
        expect(mockOpen).toHaveBeenCalledTimes(1);
        expect(mockOpen).toHaveBeenCalledWith(expect.stringMatching(/^\/preview-test\?_t=\d+$/), '_blank');
      } finally {
        window.open = originalOpen;
      }
    });

    test('opens a blank tab synchronously and navigates it once openPreview returns the draft preview URL', async () => {
      let resolvePreview!: (result: OpenPreviewResult) => void;
      const previewPromise = new Promise<OpenPreviewResult>((resolve) => {
        resolvePreview = resolve;
      });
      let previewInput: { path: string } | undefined;
      configureUI({
        apiBaseUrl: '/__cms/api',
        openPreview: (input) => {
          previewInput = input;
          return previewPromise;
        },
      });
      const previewTab = { location: { href: 'about:blank' }, close: mock(() => {}), opener: window };
      const mockOpen = mock(() => previewTab);
      const originalOpen = window.open;
      window.open = mockOpen as any;

      try {
        const result = await testApi.createContent({
          kind: 'page',
          site: 'default',
          collection: 'pages',
          type: 'puck',
          meta: { title: 'Draft Preview Page' },
          locales: {
            en: {
              pathname: '/draft-preview',
              meta: { title: 'Draft Preview Page' },
              content: { puckData: { content: [], root: {}, zones: {} } },
            },
          },
        });
        renderAppWithDataRouter([`/pages/${result.id!}`], undefined, false);
        fireEvent.click(await screen.findByTestId('preview-button'));

        expect(mockOpen).toHaveBeenCalledTimes(1);
        expect(mockOpen).toHaveBeenCalledWith('', '_blank');
        expect(previewInput).toEqual({ path: '/draft-preview' });
        expect(previewTab.location.href).toBe('about:blank');

        resolvePreview({ ok: true, url: 'https://preview.example.test/draft-preview' });
        await waitFor(() => expect(previewTab.location.href).toBe('https://preview.example.test/draft-preview'));
        expect(previewTab.close).not.toHaveBeenCalled();
      } finally {
        window.open = originalOpen;
      }
    });

    test('closes the blank tab and reports the existing error when openPreview fails', async () => {
      let rejectPreview!: (error: unknown) => void;
      const previewPromise = new Promise<OpenPreviewResult>((_resolve, reject) => {
        rejectPreview = reject;
      });
      configureUI({ apiBaseUrl: '/__cms/api', openPreview: () => previewPromise });
      const previewTab = { location: { href: 'about:blank' }, close: mock(() => {}), opener: window };
      const mockOpen = mock(() => previewTab);
      const originalOpen = window.open;
      const originalConsoleError = console.error;
      const loggedErrors: unknown[][] = [];
      window.open = mockOpen as any;
      console.error = (...args: unknown[]) => loggedErrors.push(args);

      try {
        const result = await testApi.createContent({
          kind: 'page',
          site: 'default',
          collection: 'pages',
          type: 'puck',
          meta: { title: 'Broken Draft Preview' },
          locales: {
            en: {
              pathname: '/broken-draft-preview',
              meta: { title: 'Broken Draft Preview' },
              content: { puckData: { content: [], root: {}, zones: {} } },
            },
          },
        });
        renderAppWithDataRouter([`/pages/${result.id!}`], undefined, false);
        fireEvent.click(await screen.findByTestId('preview-button'));
        expect(mockOpen).toHaveBeenCalledWith('', '_blank');

        rejectPreview(new Error('preview failed'));
        await waitFor(() => expect(previewTab.close).toHaveBeenCalledTimes(1));
        expect(loggedErrors.some(([message]) => message === '[PageEditor] openPreview failed:')).toBe(true);
      } finally {
        window.open = originalOpen;
        console.error = originalConsoleError;
      }
    });

    // ------------------------------------------------------------------
    // No dead links. A site that does not serve draft preview has no URL
    // that could work, so the user would land on a 404 on their OWN site.
    // These fail if the editor navigates there.
    // ------------------------------------------------------------------

    test('explains instead of navigating when the site does not serve draft preview', async () => {
      const message = 'example.com does not serve draft preview, so a preview link would open a 404 there.';
      configureUI({
        apiBaseUrl: '/__cms/api',
        openPreview: async () => ({ ok: false as const, reason: 'not-deployed' as const, message }),
      });
      const previewTab = { location: { href: 'about:blank' }, close: mock(() => {}), opener: window };
      const mockOpen = mock(() => previewTab);
      const originalOpen = window.open;
      window.open = mockOpen as any;

      try {
        const result = await testApi.createContent({
          kind: 'page',
          site: 'default',
          collection: 'pages',
          type: 'puck',
          meta: { title: 'Undeployed Preview' },
          locales: {
            en: {
              pathname: '/undeployed',
              meta: { title: 'Undeployed Preview' },
              content: { puckData: { content: [], root: {}, zones: {} } },
            },
          },
        });
        renderAppWithDataRouter([`/pages/${result.id!}`], undefined, false);
        const button = await screen.findByTestId('preview-button');
        fireEvent.click(button);

        // The reserved tab is closed and NEVER navigated — no dead link.
        await waitFor(() => expect(previewTab.close).toHaveBeenCalledTimes(1));
        expect(previewTab.location.href).toBe('about:blank');

        // The control now carries the reason, so the user is told why rather
        // than left to click again.
        await waitFor(() => expect(button.getAttribute('aria-disabled')).toBe('true'));
        expect(button.getAttribute('title')).toBe(message);
        expect(button.getAttribute('aria-label')).toContain(message);
      } finally {
        window.open = originalOpen;
      }
    });

    test('does not flash a blank tab on a second click once the site is known to have no preview', async () => {
      configureUI({
        apiBaseUrl: '/__cms/api',
        openPreview: async () => ({ ok: false as const, reason: 'not-deployed' as const, message: 'no preview here' }),
      });
      const previewTab = { location: { href: 'about:blank' }, close: mock(() => {}), opener: window };
      const mockOpen = mock(() => previewTab);
      const originalOpen = window.open;
      window.open = mockOpen as any;

      try {
        const result = await testApi.createContent({
          kind: 'page',
          site: 'default',
          collection: 'pages',
          type: 'puck',
          meta: { title: 'Second Click' },
          locales: {
            en: {
              pathname: '/second-click',
              meta: { title: 'Second Click' },
              content: { puckData: { content: [], root: {}, zones: {} } },
            },
          },
        });
        renderAppWithDataRouter([`/pages/${result.id!}`], undefined, false);
        const button = await screen.findByTestId('preview-button');

        fireEvent.click(button);
        await waitFor(() => expect(button.getAttribute('aria-disabled')).toBe('true'));
        expect(mockOpen).toHaveBeenCalledTimes(1);

        // Second click must explain, not open-and-close a tab, which reads as
        // a bug even when the behaviour is correct.
        fireEvent.click(button);
        await waitFor(() => expect(previewTab.close).toHaveBeenCalledTimes(1));
        expect(mockOpen).toHaveBeenCalledTimes(1);
      } finally {
        window.open = originalOpen;
      }
    });

    test('renders Preview disabled with a reason when the host reports up front that the site has no preview', async () => {
      configureUI({
        apiBaseUrl: '/__cms/api',
        openPreview: async () => ({ ok: true as const, url: 'https://should-not-be-reached.test/' }),
        previewCapability: 'unavailable',
      });
      const result = await testApi.createContent({
        kind: 'page',
        site: 'default',
        collection: 'pages',
        type: 'puck',
        meta: { title: 'Known Undeployed' },
        locales: {
          en: {
            pathname: '/known-undeployed',
            meta: { title: 'Known Undeployed' },
            content: { puckData: { content: [], root: {}, zones: {} } },
          },
        },
      });
      renderAppWithDataRouter([`/pages/${result.id!}`], undefined, false);
      const button = await screen.findByTestId('preview-button');

      expect(button.getAttribute('aria-disabled')).toBe('true');
      // Plain English, states the fact about this branch, never blames the user.
      expect(button.getAttribute('title')).toBe(PREVIEW_UNAVAILABLE_DETAIL);
      // Still clickable on purpose: a `disabled` button shows no tooltip and
      // fires no handler, which would hide the reason entirely.
      expect(button.hasAttribute('disabled')).toBe(false);
    });

    test('leaves Preview enabled when capability is unknown, so a working site never loses it', async () => {
      configureUI({
        apiBaseUrl: '/__cms/api',
        openPreview: async () => ({ ok: true as const, url: 'https://preview.example.test/ok' }),
      });
      const result = await testApi.createContent({
        kind: 'page',
        site: 'default',
        collection: 'pages',
        type: 'puck',
        meta: { title: 'Unknown Capability' },
        locales: {
          en: {
            pathname: '/unknown-capability',
            meta: { title: 'Unknown Capability' },
            content: { puckData: { content: [], root: {}, zones: {} } },
          },
        },
      });
      renderAppWithDataRouter([`/pages/${result.id!}`], undefined, false);
      const button = await screen.findByTestId('preview-button');

      expect(button.getAttribute('aria-disabled')).toBe('false');
      expect(button.getAttribute('aria-label')).toBe('Preview');
    });

    // ------------------------------------------------------------------
    // A parent frame opens the tabs itself, so the preview address never
    // enters the editor page and no tab is born inside a sandboxed frame.
    // ------------------------------------------------------------------
    test('with the parent opening the tab, Preview opens no tab and asks the parent once', async () => {
      const inputs: { path: string }[] = [];
      configureUI({
        apiBaseUrl: '/__cms/api',
        previewTab: 'parent',
        openPreview: async (input) => {
          inputs.push(input);
          return { ok: true };
        },
      });
      const mockOpen = spyOn(window, 'open').mockImplementation(() => null);

      try {
        const id = await createPuckPage('/parent-preview', 'Parent Preview');
        renderAppWithDataRouter([`/pages/${id}`], undefined, false);
        fireEvent.click(await screen.findByTestId('preview-button'));

        await waitFor(() => expect(inputs).toEqual([{ path: '/parent-preview' }]));
        expect(mockOpen).not.toHaveBeenCalled();
      } finally {
        mockOpen.mockRestore();
      }
    });

    test('with the parent opening the tab, a not-deployed answer disables Preview and explains why', async () => {
      const message = 'example.com does not serve draft preview.';
      configureUI({
        apiBaseUrl: '/__cms/api',
        previewTab: 'parent',
        openPreview: async () => ({ ok: false as const, reason: 'not-deployed' as const, message }),
      });
      const mockOpen = spyOn(window, 'open').mockImplementation(() => null);

      try {
        const id = await createPuckPage('/parent-undeployed', 'Parent Undeployed');
        renderAppWithDataRouter([`/pages/${id}`], undefined, false);
        mountFreshToaster();
        const button = await screen.findByTestId('preview-button');
        fireEvent.click(button);

        expect(await screen.findByText(PREVIEW_UNAVAILABLE_TITLE)).toBeInTheDocument();
        expect(PREVIEW_UNAVAILABLE_TITLE).toBe('Preview is not available for this branch');
        await waitFor(() => expect(button.getAttribute('aria-disabled')).toBe('true'));
        expect(button.getAttribute('title')).toBe(message);
        expect(mockOpen).not.toHaveBeenCalled();
      } finally {
        mockOpen.mockRestore();
      }
    });

    test('with the parent opening the tab, a blocked popup shows nothing in the editor', async () => {
      let answered = false;
      configureUI({
        apiBaseUrl: '/__cms/api',
        previewTab: 'parent',
        openPreview: async () => {
          answered = true;
          return { ok: false as const, reason: 'popup-blocked' as const };
        },
      });
      const mockOpen = spyOn(window, 'open').mockImplementation(() => null);

      try {
        const id = await createPuckPage('/parent-blocked', 'Parent Blocked');
        renderAppWithDataRouter([`/pages/${id}`], undefined, false);
        mountFreshToaster();
        const button = await screen.findByTestId('preview-button');
        fireEvent.click(button);

        await waitFor(() => expect(answered).toBe(true));
        // Let the answer settle before checking that nothing was shown.
        await Bun.sleep(50);
        expect(document.querySelector('[data-sonner-toast]')).toBeNull();
        expect(button.getAttribute('aria-disabled')).toBe('false');
        expect(mockOpen).not.toHaveBeenCalled();
      } finally {
        mockOpen.mockRestore();
      }
    });

    test('live-site links go through openSiteUrl when the parent offers it', async () => {
      const opened: { path: string }[] = [];
      configureUI({
        apiBaseUrl: '/__cms/api',
        openSiteUrl: async (input) => {
          opened.push(input);
        },
      });
      const mockOpen = spyOn(window, 'open').mockImplementation(() => null);

      try {
        const id = await createPuckPage('/about', 'About');
        renderAppWithDataRouter(['/pages'], undefined, false);
        fireEvent.click(await screen.findByTestId(`page-title-${id}`));
        fireEvent.click(screen.getByRole('link', { name: '/about' }));

        await waitFor(() => expect(opened).toEqual([{ path: '/about' }, { path: '/about' }]));
        expect(mockOpen).not.toHaveBeenCalled();
      } finally {
        mockOpen.mockRestore();
      }
    });

    test('a refused live-site link only logs', async () => {
      configureUI({
        apiBaseUrl: '/__cms/api',
        openSiteUrl: () => Promise.reject(new RpcError('path refused', 'bad_arguments')),
      });
      const mockOpen = spyOn(window, 'open').mockImplementation(() => null);
      const loggedErrors: unknown[][] = [];
      const consoleError = spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
        loggedErrors.push(args);
      });

      try {
        const id = await createPuckPage('/refused', 'Refused');
        renderAppWithDataRouter(['/pages'], undefined, false);
        mountFreshToaster();
        fireEvent.click(await screen.findByTestId(`page-title-${id}`));

        await waitFor(() =>
          expect(loggedErrors.some(([message]) => message === '[PageList] openSiteUrl failed:')).toBe(true),
        );
        expect(document.querySelector('[data-sonner-toast]')).toBeNull();
        expect(mockOpen).not.toHaveBeenCalled();
      } finally {
        mockOpen.mockRestore();
        consoleError.mockRestore();
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
      // Use getAllByRole and select the first (nav) link since dashboard also has section card links
      const pagesLinks = screen.getAllByRole('link', { name: /pages/i });
      fireEvent.click(pagesLinks[0]);

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
      // Use getAllByRole and select the first (nav) link since dashboard also has section card links
      const pagesLinks = screen.getAllByRole('link', { name: /pages/i });
      fireEvent.click(pagesLinks[0]);

      await waitFor(() => {
        // Should show error UI
        expect(screen.getByTestId('page-list-error')).toBeInTheDocument();
        expect(screen.getByText('Failed to load pages')).toBeInTheDocument();
        expect(screen.getByText('Server error')).toBeInTheDocument();
      });
    });
  });
});
