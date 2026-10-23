/// <reference lib="dom" />

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import type {
  AssetEntry,
  ContentEntry,
  ContentListResult,
  ContentManifest,
  FolderTreeNode,
  LocaleVersion,
  LocalizedEntry,
  PageReference,
} from '@conloca/content-api';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { ContentAPIClient } from '../src/client.js';
import {
  setContentAPIClient,
  useBatchUpdate,
  useBulkDeleteAssets,
  useCompileMDX,
  useContent,
  useCreateContent,
  useCreateFolder,
  useData,
  useDataByName,
  useDataCollections,
  useDataContext,
  useDataNameAvailability,
  useDeleteAsset,
  useFolderTree,
  useImportAssetUrl,
  useLocalizedContent,
  usePathnameAvailability,
  useSitePages,
  useUpdateLocalized,
  useUploadAsset,
} from '../src/hooks.js';
import { pageStatusOf } from '../src/page-status.js';
import { jsonResponse } from '../src/test-helpers.js';

/** The `unpublished` marker on the first listed page's English version. */
function unpublishedOfFresh(data: ContentListResult | undefined) {
  return data?.items[0]?.locales.en?.unpublished;
}

// Cleanup after each test
afterEach(() => {
  cleanup();
});

describe('Content API Hooks', () => {
  let mockClient: ContentAPIClient;
  let queryClient: QueryClient;
  let wrapper: ({ children }: { children: ReactNode }) => ReactNode;

  beforeEach(() => {
    // Create a new QueryClient for each test
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });

    // Create wrapper component
    wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    mockClient = {
      getContent: mock(() => Promise.resolve(null)),
      getLocalized: mock(() => Promise.resolve(null)),
      createContent: mock(() => Promise.resolve({ success: true, id: 'new-id', etag: 'metaHash.contentHash' })),
      updateLocalized: mock(() =>
        Promise.resolve({ success: true, etag: 'updatedMeta.updatedContent', modified: new Date() }),
      ),
      deleteContent: mock(() => Promise.resolve({ success: true })),
      getSitePages: mock(() => Promise.resolve({ items: [], total: 0 })),
      getPageByPathname: mock(() => Promise.resolve(null)),
      isPathnameAvailable: mock(() => Promise.resolve(true)),
      movePage: mock(() => Promise.resolve({ moved: true })),
      getFragments: mock(() => Promise.resolve({ items: [], total: 0 })),
      getFragmentByName: mock(() => Promise.resolve(null)),
      compileMDX: mock(() =>
        Promise.resolve({ code: 'return { default: function Test() { return null } }', metadata: {} }),
      ),
      getData: mock(() => Promise.resolve({ items: [], total: 0 })),
      getDataByName: mock(() => Promise.resolve(null)),
      isDataNameAvailable: mock(() => Promise.resolve(true)),
      getDataCollections: mock(() => Promise.resolve([])),
      listAllContent: mock(() => Promise.resolve({ items: [], total: 0 })),
      findUntranslatedContent: mock(() => Promise.resolve({ items: [], total: 0 })),
      getSitesConfig: mock(() => Promise.resolve({ sites: {} })),
      batchUpdate: mock(() => Promise.resolve({ success: true, updated: 0, failed: 0, operations: [] })),
    } as any;

    setContentAPIClient(mockClient);
  });

  describe('useContent', () => {
    it('should fetch content by ID', async () => {
      const mockContent: ContentEntry = {
        id: 'test-id',
        kind: 'page',
        type: 'puck',
        collection: 'pages',
        site: 'test-site',
        locales: {
          en: {
            locale: 'en',
            created: new Date().toISOString(),
            content: { puckData: {} },
            meta: {
              title: 'Test',
            },
            etag: '"123"',
            modified: new Date().toISOString(),
            pathname: '/test',
          },
        },
      };

      mockClient.getContent = mock(() => Promise.resolve(mockContent));

      const { result } = renderHook(() => useContent('test-id'), { wrapper });

      expect(result.current.isLoading).toBe(true);
      expect(result.current.data).toBeUndefined();

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(mockClient.getContent).toHaveBeenCalledWith('test-id');
      expect(result.current.data).toEqual(mockContent);
      expect(result.current.error).toBeNull();
    });

    it('should handle errors', async () => {
      const error = new Error('Failed to fetch');
      mockClient.getContent = mock(() => Promise.reject(error));

      const { result } = renderHook(() => useContent('test-id'), { wrapper });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });

      expect(result.current.error).toEqual(error);
      expect(result.current.data).toBeUndefined();
    });

    it('should not fetch if ID is empty', async () => {
      const { result } = renderHook(() => useContent(''), { wrapper });

      // Should be disabled and not loading
      expect(result.current.isLoading).toBe(false);
      expect(result.current.data).toBeUndefined();
      expect(mockClient.getContent).not.toHaveBeenCalled();
    });
  });

  describe('useLocalizedContent', () => {
    it('should fetch localized content', async () => {
      const mockContent: LocalizedEntry = {
        id: 'test-id',
        kind: 'page',
        type: 'puck',
        site: 'test-site',
        collection: 'pages',
        localized: {
          locale: 'en',
          content: { puckData: {} },
          meta: {
            title: 'Test',
          },
          etag: '"123"',
          modified: new Date().toISOString(),
          created: new Date().toISOString(),
          pathname: '/test',
        },
      };

      mockClient.getLocalized = mock(() => Promise.resolve(mockContent));

      const { result } = renderHook(() => useLocalizedContent('test-id', 'en'), { wrapper });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(mockClient.getLocalized).toHaveBeenCalledWith('test-id', 'en');
      expect(result.current.data).toEqual(mockContent);
    });
  });

  describe('useCompileMDX', () => {
    it('should not compile when content is empty', () => {
      const { result } = renderHook(() => useCompileMDX({ mdxContent: null }), { wrapper });

      expect(result.current.isLoading).toBe(false);
      expect(mockClient.compileMDX).not.toHaveBeenCalled();
    });

    it('should compile MDX content', async () => {
      const compileResult = {
        code: 'return { default: function Test() { return null } }',
        metadata: { title: 'Test' },
        outline: [],
      };

      mockClient.compileMDX = mock(() => Promise.resolve(compileResult));

      const { result } = renderHook(() => useCompileMDX({ mdxContent: '# Test', cacheKey: 'etag-1' }), { wrapper });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(mockClient.compileMDX).toHaveBeenCalledWith('# Test');
      expect(result.current.data).toEqual(compileResult);
    });
  });

  describe('useCreateContent', () => {
    it('should create content', async () => {
      const createData = {
        kind: 'page' as const,
        site: 'test-site',
        collection: 'content',
        type: 'puck' as const,
        locales: {
          en: {
            pathname: '/new',
            meta: {
              title: 'New Page',
            },
            content: { puckData: {} },
          },
        },
      };

      // Mock the getContent call that happens after creation
      const createdContent: ContentEntry = {
        id: 'new-id',
        type: 'puck',
        kind: 'page',
        site: 'test-site',
        collection: 'content',
        locales: {
          en: {
            locale: 'en',
            etag: 'metaHash.contentHash',
            created: new Date().toISOString(),
            modified: new Date().toISOString(),
            pathname: '/new',
            meta: { title: 'New Page' },
            content: { puckData: {} },
          },
        },
      };
      mockClient.getContent = mock(() => Promise.resolve(createdContent));

      const { result } = renderHook(() => useCreateContent(), { wrapper });

      expect(result.current.isPending).toBe(false);

      result.current.mutate(createData);

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(mockClient.createContent).toHaveBeenCalledWith(createData);
      expect(mockClient.getContent).toHaveBeenCalledWith('new-id');
      expect(result.current.data).toMatchObject({ success: true, id: 'new-id', etag: 'metaHash.contentHash' });
    });

    it('should handle errors', async () => {
      const error = new Error('Create failed');
      mockClient.createContent = mock(() => Promise.reject(error));

      const { result } = renderHook(() => useCreateContent(), { wrapper });

      result.current.mutate({} as any);

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });

      expect(result.current.error).toEqual(error);
    });
  });

  describe('useUpdateLocalized', () => {
    it('should update content', async () => {
      const updateArgs = {
        id: 'test-id',
        data: {
          meta: { title: 'Updated' },
        },
        locale: 'en',
        etag: 'oldMetaHash.oldContentHash',
      };

      // Mock the getLocalized call that happens after update
      const updatedContent: LocalizedEntry = {
        id: 'test-id',
        type: 'puck',
        kind: 'page',
        site: 'test-site',
        collection: 'content',
        localized: {
          locale: 'en',
          etag: 'updatedMeta.updatedContent',
          created: new Date().toISOString(),
          modified: new Date().toISOString(),
          pathname: '/test',
          meta: { title: 'Updated' },
          content: { puckData: {} },
        },
      };
      mockClient.getLocalized = mock(() => Promise.resolve(updatedContent));

      const { result } = renderHook(() => useUpdateLocalized(), { wrapper });

      result.current.mutate(updateArgs);

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(mockClient.updateLocalized).toHaveBeenCalledWith(updateArgs);
      expect(mockClient.getLocalized).toHaveBeenCalledWith('test-id', 'en');
      expect(result.current.data?.success).toBe(true);
    });
  });

  describe('useSitePages', () => {
    it('should fetch site pages', async () => {
      const mockPages = {
        items: [
          {
            id: 'page1',
            site: 'test-site',
            kind: 'page' as const,
            type: 'puck' as const,
            collection: 'pages',
            locales: {
              en: {
                locale: 'en',
                pathname: '/page1',
                etag: 'etag-1',
                created: new Date().toISOString(),
                modified: new Date().toISOString(),
                meta: { title: 'Page 1' },
              },
            },
          },
          {
            id: 'page2',
            site: 'test-site',
            kind: 'page' as const,
            type: 'puck' as const,
            collection: 'pages',
            locales: {
              en: {
                locale: 'en',
                pathname: '/page2',
                etag: 'etag-2',
                created: new Date().toISOString(),
                modified: new Date().toISOString(),
                meta: { title: 'Page 2' },
              },
            },
          },
        ],
        total: 2,
      };

      mockClient.getSitePages = mock(() => Promise.resolve(mockPages));

      const { result } = renderHook(() => useSitePages('test-site', 'en'), { wrapper });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(mockClient.getSitePages).toHaveBeenCalledWith('test-site', 'en');
      expect(result.current.data).toEqual(mockPages);
    });
  });

  describe('usePathnameAvailability', () => {
    it('should check pathname availability', async () => {
      const { result } = renderHook(() => usePathnameAvailability('test-site', '/new-path', 'exclude-id'), { wrapper });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(mockClient.isPathnameAvailable).toHaveBeenCalledWith('test-site', '/new-path', 'exclude-id', undefined);
      expect(result.current.data).toEqual({ available: true });
    });

    it('should check pathname availability in the given locale', async () => {
      const { result } = renderHook(() => usePathnameAvailability('test-site', '/kontakt', undefined, 'de'), {
        wrapper,
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(mockClient.isPathnameAvailable).toHaveBeenCalledWith('test-site', '/kontakt', undefined, 'de');
    });

    it('should re-check when only the locale changes', async () => {
      mockClient.isPathnameAvailable = mock((_site: string, _pathname: string, _excludeId?: string, locale?: string) =>
        Promise.resolve(locale !== 'de'),
      );
      const { result, rerender } = renderHook(
        ({ locale }: { locale: string }) => usePathnameAvailability('test-site', '/kontakt', undefined, locale),
        { wrapper, initialProps: { locale: 'en' } },
      );

      await waitFor(() => {
        expect(result.current.data).toEqual({ available: true });
      });

      rerender({ locale: 'de' });

      await waitFor(() => {
        expect(result.current.data).toEqual({ available: false });
      });
    });

    it('should not query if site or pathname is empty', () => {
      const { result } = renderHook(() => usePathnameAvailability('', '/path'), { wrapper });

      expect(result.current.isLoading).toBe(false);
      expect(mockClient.isPathnameAvailable).not.toHaveBeenCalled();
      expect(result.current.data).toBeUndefined();
    });
  });

  describe('useData', () => {
    it('should fetch data entries', async () => {
      const mockData = {
        items: [
          {
            id: 'vx-data1',
            kind: 'data' as const,
            type: 'json' as const,
            collection: 'authors',
            locales: {
              en: {
                locale: 'en',
                etag: 'meta.content',
                created: '2024-01-01T00:00:00Z',
                modified: '2024-01-01T00:00:00Z',
                name: 'john-doe',
                meta: { title: 'John Doe' },
              },
            },
          },
        ],
        total: 1,
      };

      mockClient.getData = mock(() => Promise.resolve(mockData));

      const { result } = renderHook(() => useData('authors', 'en'), { wrapper });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(mockClient.getData).toHaveBeenCalledWith('authors', 'en');
      expect(result.current.data).toEqual(mockData);
    });

    it('should fetch all data when no filters', async () => {
      const mockData = { items: [], total: 0 };

      mockClient.getData = mock(() => Promise.resolve(mockData));

      const { result } = renderHook(() => useData(), { wrapper });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(mockClient.getData).toHaveBeenCalledWith(undefined, undefined);
    });
  });

  describe('useDataByName', () => {
    it('should fetch data entry by name', async () => {
      const mockEntry = {
        id: 'vx-data1',
        kind: 'data' as const,
        type: 'json' as const,
        collection: 'authors',
        locales: {
          en: {
            locale: 'en',
            etag: 'meta.content',
            created: '2024-01-01T00:00:00Z',
            modified: '2024-01-01T00:00:00Z',
            name: 'john-doe',
            meta: { title: 'John Doe' },
          },
        },
      };

      mockClient.getDataByName = mock(() => Promise.resolve(mockEntry));

      const { result } = renderHook(() => useDataByName('john-doe', 'authors', 'en'), { wrapper });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(mockClient.getDataByName).toHaveBeenCalledWith('john-doe', 'authors', 'en');
      expect(result.current.data).toEqual(mockEntry);
    });

    it('should not query if name is empty', () => {
      const { result } = renderHook(() => useDataByName('', 'authors'), { wrapper });

      expect(result.current.isLoading).toBe(false);
      expect(mockClient.getDataByName).not.toHaveBeenCalled();
    });

    it('should not query if collection is empty', () => {
      const { result } = renderHook(() => useDataByName('john-doe', ''), { wrapper });

      expect(result.current.isLoading).toBe(false);
      expect(mockClient.getDataByName).not.toHaveBeenCalled();
    });
  });

  describe('useDataNameAvailability', () => {
    it('should check data name availability', async () => {
      mockClient.isDataNameAvailable = mock(() => Promise.resolve(true));

      const { result } = renderHook(() => useDataNameAvailability('new-name', 'authors', 'exclude-id'), { wrapper });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(mockClient.isDataNameAvailable).toHaveBeenCalledWith('new-name', 'authors', 'exclude-id');
      expect(result.current.data).toEqual({ available: true });
    });

    it('should return available: false for taken name', async () => {
      mockClient.isDataNameAvailable = mock(() => Promise.resolve(false));

      const { result } = renderHook(() => useDataNameAvailability('taken-name', 'authors'), { wrapper });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.data).toEqual({ available: false });
    });

    it('should not query if name is empty', () => {
      const { result } = renderHook(() => useDataNameAvailability('', 'authors'), { wrapper });

      expect(result.current.isLoading).toBe(false);
      expect(mockClient.isDataNameAvailable).not.toHaveBeenCalled();
    });

    it('should not query if collection is empty', () => {
      const { result } = renderHook(() => useDataNameAvailability('some-name', ''), { wrapper });

      expect(result.current.isLoading).toBe(false);
      expect(mockClient.isDataNameAvailable).not.toHaveBeenCalled();
    });
  });

  describe('useDataCollections', () => {
    it('should fetch data collections', async () => {
      const mockCollections = ['authors', 'testimonials', 'settings'];

      mockClient.getDataCollections = mock(() => Promise.resolve(mockCollections));

      const { result } = renderHook(() => useDataCollections(), { wrapper });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(mockClient.getDataCollections).toHaveBeenCalled();
      expect(result.current.data).toEqual(mockCollections);
    });
  });

  describe('useDataContext', () => {
    const blogFeed = { siteName: 'default', locale: 'en', routes: { pages: { pages: { prefix: '/blog/' } } } };
    /** The page open in the editor, as the editor hands it over. */
    const openPage: PageReference = {
      id: 'vx-open',
      pathname: '/blog/open',
      title: 'Open post',
      collection: 'pages',
      meta: { title: 'Open post', author: 'Ada' },
    };
    const tomorrow = () => new Date(Date.now() + 86_400_000).toISOString();
    const yesterday = () => new Date(Date.now() - 86_400_000).toISOString();

    /** One English version of a piece of content, scheduled as given. */
    function manifest(
      id: string,
      kind: ContentManifest['kind'],
      version: { pathname?: string; name?: string; title: string; publishAt?: string; unpublishAt?: string },
    ): ContentManifest {
      const { title, ...fields } = version;
      return {
        id,
        kind,
        type: kind === 'data' ? 'json' : 'puck',
        collection: kind === 'data' ? 'team' : 'pages',
        ...(kind === 'page' ? { site: 'default' } : {}),
        locales: {
          en: {
            locale: 'en',
            etag: 'meta.content',
            created: '2026-09-01T00:00:00.000Z',
            modified: '2026-09-01T00:00:00.000Z',
            meta: { title },
            ...fields,
          },
        },
      };
    }

    /**
     * A backend that answers only the given paths; every other request gets
     * the 404 a server without that route answers.
     */
    function serveOnly(bodiesByPath: Record<string, unknown>) {
      const fetchMock = mock(async (input: RequestInfo | URL) => {
        const body = bodiesByPath[new URL(String(input), 'http://localhost').pathname];
        return body === undefined ? new Response('Not found', { status: 404 }) : jsonResponse(body);
      });
      setContentAPIClient(new ContentAPIClient({ baseUrl: '/api', fetch: fetchMock as unknown as typeof fetch }));
      return fetchMock;
    }

    it('builds the page feed from the content listing, with no data context route on the server', async () => {
      const listing = [
        manifest('a', 'page', { pathname: '/blog/a', title: 'A' }),
        manifest('b', 'page', { pathname: '/blog/b', title: 'B', publishAt: tomorrow() }),
        manifest('pricing', 'page', { pathname: '/pricing', title: 'Pricing' }),
      ];
      serveOnly({ '/api/content': { items: listing, total: listing.length } });

      const { result } = renderHook(() => useDataContext(openPage, blogFeed), { wrapper });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });
      expect(result.current.data?.pages?.map((page) => page.pathname)).toEqual(['/blog/a']);
    });

    // The editor resolves its blocks again whenever the context it holds
    // changes, and doing so replaces the editor, unsaved edits included. The
    // context's page timestamps are Dates, which the query cache cannot tell
    // apart from a change on its own.
    it('keeps the same context through a refetch that finds nothing changed', async () => {
      const listing = [manifest('a', 'page', { pathname: '/blog/a', title: 'A' })];
      const fetchMock = serveOnly({ '/api/content': { items: listing, total: listing.length } });

      const { result } = renderHook(() => useDataContext(openPage, blogFeed), { wrapper });
      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });
      const first = result.current.data;

      // The refetch's own result is what the component renders next; the
      // cache hands it over only on a later task.
      let refetched: Awaited<ReturnType<typeof result.current.refetch>> | undefined;
      await act(async () => {
        refetched = await result.current.refetch();
      });

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(refetched?.data).toBe(first);
    });

    it('hands back a new context when a refetch finds a page edited since', async () => {
      const edited = manifest('a', 'page', { pathname: '/blog/a', title: 'A' });
      edited.locales.en!.modified = '2026-09-02T00:00:00.000Z';
      const bodies: Record<string, unknown> = {
        '/api/content': { items: [manifest('a', 'page', { pathname: '/blog/a', title: 'A' })], total: 1 },
      };
      serveOnly(bodies);

      const { result } = renderHook(() => useDataContext(openPage, blogFeed), { wrapper });
      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });
      const first = result.current.data;

      bodies['/api/content'] = { items: [edited], total: 1 };
      await act(async () => {
        await result.current.refetch();
      });

      await waitFor(() => {
        expect(result.current.data).not.toBe(first);
      });
      expect(result.current.data?.pages?.[0]?.timestamps?.modified).toEqual(new Date('2026-09-02T00:00:00.000Z'));
    });

    it('bounds concurrent localized reads for a large routed data collection', async () => {
      const team = Array.from({ length: 24 }, (_, index) =>
        manifest(`member-${index}`, 'data', { name: `member-${index}`, title: `Member ${index}` }),
      );
      let inFlight = 0;
      let maxInFlight = 0;
      mockClient.getData = mock(() => Promise.resolve({ items: team, total: team.length }));
      mockClient.getLocalized = mock(async (id: string) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight -= 1;
        const item = team.find((entry) => entry.id === id)!;
        return {
          id,
          kind: 'data' as const,
          type: 'json' as const,
          collection: 'team',
          localized: { ...item.locales.en!, content: { data: { id } } },
        };
      });
      const bindings = { siteName: 'default', locale: 'en', routes: { pages: { collections: ['team'] } } };
      const { result } = renderHook(() => useDataContext(openPage, bindings), { wrapper });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data?.collections.team).toHaveLength(team.length);
      expect(maxInFlight).toBeLessThanOrEqual(8);
    });

    it("hands blocks each bound data collection's published, named entries with their data", async () => {
      const team = [
        manifest('jane', 'data', { name: 'jane', title: 'Jane' }),
        manifest('gone', 'data', { name: 'gone', title: 'Gone', unpublishAt: yesterday() }),
        manifest('unnamed', 'data', { title: 'Unnamed' }),
      ];
      const jane: LocalizedEntry = {
        id: 'jane',
        kind: 'data',
        type: 'json',
        collection: 'team',
        localized: { ...team[0].locales.en!, content: { data: { role: 'CTO' } } },
      };
      serveOnly({ '/api/data': { items: team, total: team.length }, '/api/content/jane/en': jane });

      const bindings = { siteName: 'default', locale: 'en', routes: { pages: { collections: ['team'] } } };
      const { result } = renderHook(() => useDataContext(openPage, bindings), { wrapper });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });
      expect(result.current.data).toEqual({
        collections: { team: [{ id: 'jane', name: 'jane', data: { role: 'CTO' }, meta: { title: 'Jane' } }] },
        locale: 'en',
        siteName: 'default',
        page: openPage,
      });
    });

    it('tells blocks which page they render, with its settings, on a route that binds nothing', async () => {
      const fetchMock = serveOnly({});
      const bindsNothing = { siteName: 'default', locale: 'en', routes: { pages: {} } };

      const { result } = renderHook(() => useDataContext(openPage, bindsNothing), { wrapper });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });
      expect(result.current.data).toEqual({ collections: {}, locale: 'en', siteName: 'default', page: openPage });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('hands over the page as it is now, without fetching the feed again, when its settings change', async () => {
      const listing = [manifest('a', 'page', { pathname: '/blog/a', title: 'A' })];
      const fetchMock = serveOnly({ '/api/content': { items: listing, total: listing.length } });

      const { result, rerender } = renderHook(({ page }) => useDataContext(page, blogFeed), {
        wrapper,
        initialProps: { page: openPage },
      });
      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });
      const feed = result.current.data?.pages;

      const retitled: PageReference = { ...openPage, title: 'Retitled', meta: { title: 'Retitled', author: 'Ada' } };
      rerender({ page: retitled });

      expect(result.current.data?.page).toBe(retitled);
      expect(result.current.data?.pages).toBe(feed);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('gives no context to a page no route serves, which has no published render either', async () => {
      const fetchMock = serveOnly({});

      const { result } = renderHook(() => useDataContext({ ...openPage, collection: 'posts' }, blogFeed), {
        wrapper,
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });
      expect(result.current.data).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('asks the backend nothing until the page has loaded', () => {
      const fetchMock = serveOnly({});

      const { result } = renderHook(() => useDataContext(undefined, blogFeed), { wrapper });

      expect(result.current.data).toBeUndefined();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    for (const unavailable of ['page', 'bindings'] as const) {
      it(`a manual refetch waits safely while ${unavailable} is unavailable`, async () => {
        const fetchMock = serveOnly({});
        const { result } = renderHook(
          () =>
            useDataContext(
              unavailable === 'page' ? undefined : openPage,
              unavailable === 'bindings' ? undefined : blogFeed,
            ),
          { wrapper },
        );
        await act(async () => {
          const refreshed = await result.current.refetch();
          expect(refreshed.isError).toBe(false);
          expect(refreshed.data).toBeNull();
        });
        expect(fetchMock).not.toHaveBeenCalled();
      });
    }

    it('asks the backend nothing while the editor has no bindings', () => {
      const fetchMock = serveOnly({});

      const { result } = renderHook(() => useDataContext(openPage, undefined), { wrapper });

      expect(result.current.isLoading).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('reports a listing the backend fails to serve instead of an empty feed', async () => {
      serveOnly({});

      const { result } = renderHook(() => useDataContext(openPage, blogFeed), { wrapper });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });
      expect(result.current.data).toBeUndefined();
    });
  });

  describe('media changes keep the folder tree current', () => {
    const uploaded: AssetEntry = {
      filename: 'a.png',
      originalName: 'a.png',
      mimeType: 'image/png',
      size: 1,
      uploadedAt: '2024-01-01T00:00:00Z',
    };
    let serverTree: { tree: FolderTreeNode[] };

    /** The server's tree: Root holding `assetCount` files, with `children` beneath it. */
    const rootWith = (assetCount: number, children: FolderTreeNode[] = []) => ({
      tree: [{ name: 'Root', path: '/', assetCount, children }],
    });

    beforeEach(() => {
      serverTree = rootWith(0);
      mockClient.getFolderTree = mock(() => Promise.resolve(serverTree));
      mockClient.uploadAsset = mock(() => Promise.resolve(uploaded));
      mockClient.importAssetUrl = mock(() => Promise.resolve(uploaded));
      mockClient.deleteAsset = mock(() => Promise.resolve({ success: true }));
      mockClient.createFolder = mock(() => Promise.resolve());
    });

    /** Render the folder tree beside a media change, once the first tree has arrived. */
    async function renderTreeWith<T>(useMediaChange: () => T) {
      const view = renderHook(() => ({ tree: useFolderTree(), change: useMediaChange() }), { wrapper });
      await waitFor(() => expect(view.result.current.tree.isSuccess).toBe(true));
      return view;
    }

    it('counts an uploaded file in its folder', async () => {
      const { result } = await renderTreeWith(useUploadAsset);
      serverTree = rootWith(1);
      result.current.change.mutate(new FormData());
      await waitFor(() => expect(result.current.tree.data?.tree[0].assetCount).toBe(1));
    });

    it('counts an image imported from a URL in its folder', async () => {
      const { result } = await renderTreeWith(useImportAssetUrl);
      serverTree = rootWith(1);
      result.current.change.mutate({ url: 'https://example.com/a.png' });
      await waitFor(() => expect(result.current.tree.data?.tree[0].assetCount).toBe(1));
    });

    it('stops counting a deleted file', async () => {
      serverTree = rootWith(1);
      const { result } = await renderTreeWith(useDeleteAsset);
      serverTree = rootWith(0);
      result.current.change.mutate('a.png');
      await waitFor(() => expect(result.current.tree.data?.tree[0].assetCount).toBe(0));
    });

    it('stops counting files removed by a bulk delete', async () => {
      serverTree = rootWith(2);
      const { result } = await renderTreeWith(useBulkDeleteAssets);
      serverTree = rootWith(0);
      result.current.change.mutate(['a.png', 'b.png']);
      await waitFor(() => expect(result.current.tree.data?.tree[0].assetCount).toBe(0));
    });

    it('lists a newly created folder', async () => {
      const { result } = await renderTreeWith(useCreateFolder);
      serverTree = rootWith(0, [{ name: 'blog', path: '/blog', assetCount: 0, children: [] }]);
      result.current.change.mutate('/blog');
      await waitFor(() => expect(result.current.tree.data?.tree[0].children.map((c) => c.path)).toEqual(['/blog']));
    });
  });

  describe('page lists keep what the server says about a never-published page', () => {
    const FRESH_AT = '2026-10-21T10:00:00.000Z';

    function freshPage(overrides: Partial<LocaleVersion> = {}): ContentManifest {
      return {
        id: 'fresh',
        site: 'test-site',
        kind: 'page',
        type: 'puck',
        collection: 'pages',
        locales: {
          en: {
            locale: 'en',
            pathname: '/fresh',
            etag: 'etag-1',
            created: FRESH_AT,
            modified: FRESH_AT,
            meta: { title: 'Fresh' },
            unpublished: true,
            ...overrides,
          },
        },
      };
    }

    function germanVersion(): LocaleVersion {
      return {
        locale: 'de',
        pathname: '/de/fresh',
        etag: 'etag-de',
        created: FRESH_AT,
        modified: FRESH_AT,
        meta: { title: 'Frisch' },
      };
    }

    function savedLocalized(): LocalizedEntry {
      return {
        id: 'fresh',
        site: 'test-site',
        kind: 'page',
        type: 'puck',
        collection: 'pages',
        localized: {
          locale: 'en',
          pathname: '/fresh',
          etag: 'etag-2',
          created: FRESH_AT,
          modified: '2026-10-22T10:00:00.000Z',
          meta: { title: 'Fresh, edited' },
          content: { puckData: {} },
        },
      };
    }

    function germanLocalized(): LocalizedEntry {
      return { ...savedLocalized(), localized: { ...germanVersion(), content: { puckData: {} } } };
    }

    /** A server that lists the page in English only until the German save, then in both, each never published. */
    function serveListing(refetchGate: () => Promise<void>) {
      let germanSaved = false;
      mockClient.getSitePages = mock(async () => {
        if (germanSaved) await refetchGate();
        const page = freshPage();
        if (germanSaved) page.locales.de = { ...germanVersion(), unpublished: true };
        return { items: [page], total: 1 };
      });
      mockClient.updateLocalized = mock(() => {
        germanSaved = true;
        return Promise.resolve({ success: true, etag: 'etag-de', modified: new Date() });
      });
      mockClient.getLocalized = mock(() => Promise.resolve(germanLocalized()));
    }

    it('keeps the marker on a page after one of its locales is saved', async () => {
      mockClient.getSitePages = mock(() => Promise.resolve({ items: [freshPage()], total: 1 }));
      mockClient.getLocalized = mock(() => Promise.resolve(savedLocalized()));
      const { result } = renderHook(() => ({ pages: useSitePages('test-site'), save: useUpdateLocalized() }), {
        wrapper,
      });
      await waitFor(() => expect(result.current.pages.isSuccess).toBe(true));

      result.current.save.mutate({
        id: 'fresh',
        locale: 'en',
        etag: 'etag-1',
        data: { meta: { title: 'Fresh, edited' } },
      });
      await waitFor(() => expect(result.current.save.isSuccess).toBe(true));

      expect(result.current.pages.data?.items[0].locales.en?.meta.title).toBe('Fresh, edited');
      expect(unpublishedOfFresh(result.current.pages.data)).toBe(true);
    });

    it('keeps the marker on a page after a batch save', async () => {
      mockClient.getSitePages = mock(() => Promise.resolve({ items: [freshPage()], total: 1 }));
      mockClient.getLocalized = mock(() => Promise.resolve(savedLocalized()));
      mockClient.batchUpdate = mock(() =>
        Promise.resolve({
          success: true,
          updated: 1,
          failed: 0,
          operations: [{ id: 'fresh', locale: 'en', updated: true }],
        }),
      );
      const { result } = renderHook(() => ({ pages: useSitePages('test-site'), batch: useBatchUpdate() }), {
        wrapper,
      });
      await waitFor(() => expect(result.current.pages.isSuccess).toBe(true));

      result.current.batch.mutate([
        { id: 'fresh', locale: 'en', etag: 'etag-1', data: { meta: { title: 'Fresh, edited' } } },
      ]);
      await waitFor(() => expect(result.current.batch.isSuccess).toBe(true));

      expect(result.current.pages.data?.items[0].locales.en?.meta.title).toBe('Fresh, edited');
      expect(unpublishedOfFresh(result.current.pages.data)).toBe(true);
    });

    it('lists a newly created page as the server lists it, marker included, in every locale filter', async () => {
      const fetched: ContentEntry = {
        id: 'fresh',
        site: 'test-site',
        kind: 'page',
        type: 'puck',
        collection: 'pages',
        locales: {
          en: {
            locale: 'en',
            pathname: '/fresh',
            etag: 'etag-1',
            created: FRESH_AT,
            modified: FRESH_AT,
            meta: { title: 'Fresh' },
            content: { puckData: {} },
          },
        },
      };
      // The server lists pages only once the create has reached it.
      let serverHasPage = false;
      mockClient.getSitePages = mock(() =>
        Promise.resolve(serverHasPage ? { items: [freshPage()], total: 1 } : { items: [], total: 0 }),
      );
      mockClient.createContent = mock(() => {
        serverHasPage = true;
        return Promise.resolve({ success: true, id: 'fresh', etag: 'etag-1' });
      });
      mockClient.getContent = mock(() => Promise.resolve(fetched));
      const { result } = renderHook(
        () => ({
          all: useSitePages('test-site'),
          english: useSitePages('test-site', 'en'),
          create: useCreateContent(),
        }),
        { wrapper },
      );
      await waitFor(() => expect(result.current.all.isSuccess && result.current.english.isSuccess).toBe(true));

      result.current.create.mutate({
        kind: 'page',
        site: 'test-site',
        collection: 'pages',
        type: 'puck',
        locales: { en: { pathname: '/fresh', meta: { title: 'Fresh' }, content: { puckData: {} } } },
      });

      await waitFor(() => expect(unpublishedOfFresh(result.current.all.data)).toBe(true));
      await waitFor(() => expect(unpublishedOfFresh(result.current.english.data)).toBe(true));
    });

    describe('a locale the listed page does not have yet', () => {
      it('keeps a never-published page a draft while the server has not yet listed the saved locale', async () => {
        let release: (() => void) | undefined;
        const refetchHeld = new Promise<void>((resolve) => {
          release = resolve;
        });
        serveListing(() => refetchHeld);
        const { result } = renderHook(
          () => ({
            all: useSitePages('test-site'),
            english: useSitePages('test-site', 'en'),
            save: useUpdateLocalized(),
          }),
          { wrapper },
        );
        await waitFor(() => expect(result.current.all.isSuccess && result.current.english.isSuccess).toBe(true));

        result.current.save.mutate({ id: 'fresh', locale: 'de', etag: '', data: { meta: { title: 'Frisch' } } });
        await waitFor(() => expect(result.current.save.isSuccess).toBe(true));

        for (const list of [result.current.all.data, result.current.english.data]) {
          const listed = list?.items[0];
          if (!listed) throw new Error('the page list lost the page');
          expect(pageStatusOf(listed)).toBe('draft');
        }

        release?.();
        await waitFor(() => expect(result.current.all.data?.items[0]?.locales.de?.unpublished).toBe(true));
        expect(pageStatusOf(result.current.all.data?.items[0] ?? { locales: {} })).toBe('draft');
      });

      it('adds no unmarked entry for it when it is saved in a batch', async () => {
        serveListing(() => Promise.resolve());
        mockClient.batchUpdate = mock(() =>
          Promise.resolve({
            success: true,
            updated: 1,
            failed: 0,
            operations: [{ id: 'fresh', locale: 'de', updated: true }],
          }),
        );
        const { result } = renderHook(() => ({ pages: useSitePages('test-site'), batch: useBatchUpdate() }), {
          wrapper,
        });
        await waitFor(() => expect(result.current.pages.isSuccess).toBe(true));

        result.current.batch.mutate([{ id: 'fresh', locale: 'de', etag: '', data: { meta: { title: 'Frisch' } } }]);
        await waitFor(() => expect(result.current.batch.isSuccess).toBe(true));

        const german = result.current.pages.data?.items[0]?.locales.de;
        expect(german === undefined || german.unpublished === true).toBe(true);
      });
    });
  });
});
