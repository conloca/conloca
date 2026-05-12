import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import {
  ContentAPIClient,
  type ContentData,
  type LocalizedEntry,
  setContentAPIClient,
  type UpdateResult,
} from '@conloca/content-api-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, waitForElementToBeRemoved } from '@testing-library/react';
import type { ReactNode } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { ConflictDialog } from '../src/components/dialogs/ConflictDialog';
import { PageEditor } from '../src/components/editor/PageEditor';
import { renderWithProviders, setupTestAPI, testApi } from './test-utils';

/**
 * PageEditor now uses `useUnsavedChangesGuard` which depends on react-router-dom's
 * `useBlocker` — that hook requires a Data Router (`createBrowserRouter` /
 * `createMemoryRouter` + `<RouterProvider>`). The legacy `MemoryRouter` element
 * doesn't satisfy that contract in v7. Wrap PageEditor in a memory data router
 * so the guard hook can mount cleanly inside these tests.
 */
function renderWithDataRouter(ui: ReactNode, queryClient: QueryClient) {
  const router = createMemoryRouter([{ path: '/', element: ui }], { initialEntries: ['/'] });
  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  testApi?.clear();
});

describe('Conflict Resolution', () => {
  let queryClient: QueryClient;
  let apiClient: ContentAPIClient;
  const mockConfig = { components: {} }; // Basic Puck config

  beforeEach(() => {
    // Setup test API
    setupTestAPI();

    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });

    // Get the API client that was set up
    apiClient = new ContentAPIClient({ baseUrl: '/__conloca/api' });
    setContentAPIClient(apiClient);
  });

  describe('PageEditor Conflict Detection', () => {
    it('should detect stale write conflicts on save', async () => {
      // Create a page in the test API
      const createResult = await testApi.createContent({
        kind: 'page',
        site: 'default',
        collection: 'pages',
        type: 'puck',
        meta: { title: 'Test Page' },
        locales: {
          en: {
            meta: { title: 'Test Page' },
            pathname: '/test',
            content: {
              puckData: {
                content: [],
                root: {},
                zones: {},
              },
            },
          },
        },
      });

      const pageId = createResult.id!;

      // Get the initial content to capture the current ETag
      const initialContent = await testApi.getLocalized(pageId, 'en');
      const originalEtag = initialContent!.localized.etag;

      // Simulate another user updating the content (this will change the ETag)
      await testApi.updateLocalized({
        id: pageId,
        locale: 'en',
        etag: originalEtag,
        data: {
          meta: { title: 'Test Page - Updated by Another User' },
        },
      });

      // Now the PageEditor will try to save with the old ETag and should get a conflict
      const onSave = mock(async (data: any, forceEtag?: string) => {
        // When PageEditor tries to save, it will use the old ETag
        const result = await apiClient.updateLocalized({
          id: pageId,
          locale: 'en',
          etag: originalEtag, // This is now stale!
          data: {
            content: { puckData: data },
          },
        });
        return result;
      });

      renderWithDataRouter(
        <PageEditor
          pageId={pageId}
          entry={initialContent!}
          config={mockConfig}
          availableLocales={['en']}
          onSave={onSave}
          onBack={() => {}}
          onOpenMetadata={() => {}}
        />,
        queryClient,
      );

      expect(await screen.findByText('Test Page')).toBeDefined();

      // The save button exists
      expect(screen.getByRole('button', { name: /save/i })).toBeDefined();
    });

    it('should show what changed in conflict dialog - full integration', async () => {
      // Create initial content using the real API
      const createResult = await testApi.createContent({
        kind: 'page',
        site: 'default',
        collection: 'pages',
        type: 'puck',
        meta: { title: 'Test Page' },
        locales: {
          en: {
            meta: { title: 'Test Page' },
            pathname: '/test',
            content: {
              puckData: {
                content: [],
                root: { title: 'Original Title' },
                zones: {},
              },
            },
          },
        },
      });

      const contentId = createResult.id!;

      // Get the current content and ETag
      const currentContent = await testApi.getLocalized(contentId, 'en');
      if (!currentContent) throw new Error('Content not found');
      const originalEtag = currentContent.localized.etag;

      // Someone else modifies the content to create a conflict scenario
      await testApi.updateLocalized({
        id: contentId,
        locale: 'en',
        etag: originalEtag,
        data: {
          pathname: '/test',
          meta: { title: 'Server Modified Title' },
          content: {
            puckData: {
              content: [],
              root: { title: 'Server Modified Content' },
              zones: {},
            },
          },
        },
      });

      // Mock the save function to use the real API and handle conflicts properly
      const onSave = mock(async (data: any) => {
        try {
          // Try to save with the original (now stale) ETag
          const result = await testApi.updateLocalized({
            id: contentId,
            locale: 'en',
            etag: originalEtag, // This is stale!
            data: {
              pathname: '/test',
              content: { puckData: data },
            },
          });
          return result;
        } catch (error: any) {
          // Convert error to the expected format for PageEditor
          if (error.reason === 'stale_write') {
            // Refetch the current content to show in conflict dialog
            const serverContent = await testApi.getLocalized(contentId, 'en');
            return {
              success: false,
              reason: 'stale_write',
              currentEtag: error.currentEtag,
              conflictDetails: {
                metaChanged: true,
                contentChanged: true,
                currentContent: serverContent?.localized.content,
                localContent: { puckData: data },
                currentMeta: serverContent?.localized.meta,
              },
            } as any;
          }
          throw error;
        }
      });

      // Get the initial content to use in PageEditor
      const initialContent = await testApi.getLocalized(contentId, 'en');
      if (!initialContent) throw new Error('Content not found');

      // Modify the local data to simulate user changes
      const modifiedEntry: LocalizedEntry = {
        ...initialContent,
        localized: {
          ...initialContent.localized,
          meta: { title: 'Local Modified Meta' },
          content: {
            puckData: {
              content: [],
              root: { title: 'Local Modified Title' },
              zones: {},
            },
          },
        },
      };

      renderWithDataRouter(
        <PageEditor
          pageId={contentId}
          entry={modifiedEntry}
          config={mockConfig}
          availableLocales={['en']}
          onSave={onSave}
          onBack={() => {}}
          onOpenMetadata={() => {}}
        />,
        queryClient,
      );

      // Wait for the editor to load
      expect(await screen.findByText('Local Modified Meta')).toBeDefined();

      // Use keyboard shortcut to trigger save
      fireEvent.keyDown(document, { key: 's', metaKey: true });

      // Wait for conflict dialog to appear
      expect(await screen.findByRole('heading', { name: /conflict detected/i })).toBeDefined();

      // Check that we can see the modal dialog
      expect(screen.getByText(/the content has been modified by another user/i)).toBeDefined();
    });
  });

  describe('ConflictDialog Component', () => {
    it('should render with proper options', () => {
      const mockConflict: UpdateResult = {
        success: false,
        reason: 'stale_write',
        currentEtag: 'new.etag',
        conflictDetails: {
          metaChanged: true,
          contentChanged: true,
        },
      };

      const onReload = mock(() => {});
      const onForceSave = mock(() => {});
      const onCancel = mock(() => {});

      render(
        <ConflictDialog conflict={mockConflict} onReload={onReload} onForceSave={onForceSave} onCancel={onCancel} />,
      );

      // Should show dialog title
      expect(screen.getByRole('heading', { name: /conflict detected/i })).toBeDefined();

      // Should show three action buttons
      expect(screen.getByRole('button', { name: /reload and lose changes/i })).toBeDefined();
      expect(screen.getByRole('button', { name: /force save/i })).toBeDefined();
      expect(screen.getByRole('button', { name: /cancel/i })).toBeDefined();

      // Should indicate both meta and content changed
      expect(screen.getByText(/both metadata and content have been modified/i)).toBeDefined();
    });

    it('should handle reload option', async () => {
      const mockConflict: UpdateResult = {
        success: false,
        reason: 'stale_write',
        currentEtag: 'new.etag',
      };

      const onReload = mock(() => {});
      const onForceSave = mock(() => {});
      const onCancel = mock(() => {});

      render(
        <ConflictDialog conflict={mockConflict} onReload={onReload} onForceSave={onForceSave} onCancel={onCancel} />,
      );

      // Click reload button
      const reloadButton = screen.getByRole('button', { name: /reload and lose changes/i });
      fireEvent.click(reloadButton);

      // Should show confirmation
      expect(await screen.findByText(/are you sure.*lose all unsaved changes/i)).toBeDefined();

      // Confirm reload
      const confirmButton = screen.getByRole('button', { name: /yes, reload/i });
      fireEvent.click(confirmButton);

      expect(onReload).toHaveBeenCalled();
    });

    it('should handle force save with new etag', async () => {
      const mockConflict: UpdateResult = {
        success: false,
        reason: 'stale_write',
        currentEtag: 'newer.etag',
      };

      const onReload = mock(() => {});
      const onForceSave = mock(() => {});
      const onCancel = mock(() => {});

      render(
        <ConflictDialog conflict={mockConflict} onReload={onReload} onForceSave={onForceSave} onCancel={onCancel} />,
      );

      // Click force save
      const forceSaveButton = screen.getByRole('button', { name: /force save/i });
      fireEvent.click(forceSaveButton);

      // Should pass the new etag
      expect(onForceSave).toHaveBeenCalledWith('newer.etag');
    });

    it('should show content change details when content differs', () => {
      const mockConflict: UpdateResult = {
        success: false,
        reason: 'stale_write',
        currentEtag: 'new.etag',
        conflictDetails: {
          metaChanged: false,
          contentChanged: true,
          currentContent: {
            puckData: {
              root: { props: { title: 'Server Version' } },
            },
          },
          localContent: {
            puckData: {
              root: { props: { title: 'Local Version' } },
            },
          },
        },
      };

      render(
        <ConflictDialog
          conflict={mockConflict}
          onReload={mock(() => {})}
          onForceSave={mock(() => {})}
          onCancel={mock(() => {})}
        />,
      );

      // Should show content-only change details
      expect(screen.getByTestId('conflict-details').textContent).toBe('Only content has changed.');
    });

    it('should handle metadata-only conflicts', () => {
      const mockConflict: UpdateResult = {
        success: false,
        reason: 'stale_write',
        currentEtag: 'newmeta.samecontent',
        conflictDetails: {
          metaChanged: true,
          contentChanged: false,
          currentMeta: {
            title: 'New Title',
            publishAt: '2024-12-01T00:00:00Z',
          },
        },
      };

      render(
        <ConflictDialog
          conflict={mockConflict}
          onReload={mock(() => {})}
          onForceSave={mock(() => {})}
          onCancel={mock(() => {})}
        />,
      );

      // Should indicate only metadata changed
      expect(screen.getByText(/only metadata has changed/i)).toBeDefined();

      // Should show the metadata changes
      expect(screen.getByText('New Title')).toBeDefined();
      expect(screen.getByText(/publish.*december/i)).toBeDefined();
    });
  });

  describe('Force Save Flow', () => {
    it('should retry save with force flag after conflict', async () => {
      // Create initial content
      await testApi.createContent({
        kind: 'page',
        site: 'default',
        collection: 'pages',
        type: 'puck',
        meta: { title: 'Test Page' },
        locales: {
          en: {
            meta: { title: 'Test Page' },
            pathname: '/test',
            content: {
              puckData: {
                content: [],
                root: { title: 'Original Title' },
                zones: {},
              },
            },
          },
        },
      });

      // Get the content to get its ID and etag
      const allContent = Array.from(testApi.listAllContent());
      const testContent = allContent[0];
      const contentId = testContent.id;

      // Get initial ETag before external modification
      const initialContent = await testApi.getLocalized(contentId, 'en');
      if (!initialContent) throw new Error('Content not found');
      const originalEtag = initialContent.localized.etag;

      // Simulate external modification to create conflict
      await testApi.updateLocalized({
        id: contentId,
        locale: 'en',
        etag: originalEtag,
        data: {
          pathname: '/test',
          meta: { title: 'Server Modified' },
          content: {
            puckData: {
              content: [],
              root: { title: 'Server Content' },
              zones: {},
              pageMeta: { title: 'Server Modified' },
            },
          },
        },
      });

      let saveAttempts = 0;
      const onSave = mock(async (data: any, forceEtag?: string) => {
        saveAttempts++;

        if (saveAttempts === 1 && !forceEtag) {
          // First attempt with stale ETag
          try {
            return await testApi.updateLocalized({
              id: contentId,
              locale: 'en',
              etag: originalEtag, // Stale!
              data: {
                pathname: '/test',
                content: { puckData: data },
              },
            });
          } catch (error: any) {
            if (error.reason === 'stale_write') {
              // Refetch to get current server state and fresh ETag
              const serverContent = await testApi.getLocalized(contentId, 'en');
              return {
                success: false,
                reason: 'stale_write',
                currentEtag: serverContent!.localized.etag, // Fresh ETag from refetch
                conflictDetails: {
                  metaChanged: true,
                  contentChanged: true,
                  currentContent: serverContent?.localized.content,
                  localContent: { puckData: data },
                  currentMeta: serverContent?.localized.meta,
                },
              } as any;
            }
            throw error;
          }
        } else if (saveAttempts === 2 && forceEtag) {
          // Force save - just use the ETag we already have from the conflict
          // No additional refetch needed, just save with the fresh ETag
          return await testApi.updateLocalized({
            id: contentId,
            locale: 'en',
            etag: forceEtag, // Use the ETag from the conflict (already fresh)
            data: {
              pathname: '/test',
              content: { puckData: data },
            },
          });
        }

        throw new Error(`Unexpected save attempt: ${saveAttempts}, forceEtag: ${forceEtag}`);
      });

      // Create modified entry for testing using the initial content (before server modification)
      const modifiedEntry: LocalizedEntry = {
        ...initialContent,
        localized: {
          ...initialContent.localized,
          content: {
            puckData: {
              content: [],
              root: { title: 'Modified Title' },
              zones: {},
            },
          },
        },
      };

      renderWithDataRouter(
        <PageEditor
          pageId={contentId}
          entry={modifiedEntry}
          config={mockConfig}
          availableLocales={['en']}
          onSave={onSave}
          onBack={() => {}}
          onOpenMetadata={() => {}}
        />,
        queryClient,
      );

      // Wait for the editor to load
      expect(await screen.findByText('Test Page')).toBeDefined();

      // Use keyboard shortcut to trigger save (bypasses isDirty check)
      fireEvent.keyDown(document, { key: 's', metaKey: true });

      // Wait for conflict dialog to appear
      expect(await screen.findByRole('heading', { name: /conflict detected/i })).toBeDefined();

      // Set up removal watcher BEFORE clicking force save
      const dialogRemoval = waitForElementToBeRemoved(() =>
        screen.queryByRole('heading', { name: /conflict detected/i }),
      );

      // Click force save button
      const forceSaveButton = screen.getByRole('button', { name: /force save/i });
      fireEvent.click(forceSaveButton);

      // Should call onSave again with the fresh etag from refetch
      await waitFor(() => {
        expect(onSave).toHaveBeenCalledTimes(2);
        expect(onSave).toHaveBeenNthCalledWith(2, expect.anything(), expect.any(String));
      });

      // Conflict dialog should disappear after successful force save
      await dialogRemoval;
    });
  });
});
