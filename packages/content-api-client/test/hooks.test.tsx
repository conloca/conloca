/// <reference lib="dom" />

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import type { ContentEntry, LocalizedEntry } from '@conloca/content-api';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { ContentAPIClient } from '../src/client';
import {
  setContentAPIClient,
  useContent,
  useCreateContent,
  useData,
  useDataByName,
  useDataCollections,
  useDataNameAvailability,
  useLocalizedContent,
  usePathnameAvailability,
  useSitePages,
  useUpdateLocalized,
} from '../src/hooks';

// Cleanup after each test
afterEach(() => {
  cleanup();
});

describe('Content API Hooks', () => {
  let mockClient: ContentAPIClient;
  let queryClient: QueryClient;
  let wrapper: ({ children }: { children: ReactNode }) => JSX.Element;

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
      getSitePages: mock(() => Promise.resolve({ entries: [], total: 0 })),
      getPageByPathname: mock(() => Promise.resolve(null)),
      isPathnameAvailable: mock(() => Promise.resolve(true)),
      movePage: mock(() => Promise.resolve({ moved: true })),
      getBlocks: mock(() => Promise.resolve({ entries: [], total: 0 })),
      getBlockByName: mock(() => Promise.resolve(null)),
      getData: mock(() => Promise.resolve({ items: [], total: 0 })),
      getDataByName: mock(() => Promise.resolve(null)),
      isDataNameAvailable: mock(() => Promise.resolve(true)),
      getDataCollections: mock(() => Promise.resolve([])),
      listAllContent: mock(() => Promise.resolve({ entries: [], total: 0 })),
      findUntranslatedContent: mock(() => Promise.resolve({ entries: [], total: 0 })),
      getSitesConfig: mock(() => Promise.resolve({ sites: {} })),
      batchUpdate: mock(() => Promise.resolve({ success: true, updated: 0, failed: 0, operations: [] })),
    } as any;

    setContentAPIClient(mockClient);
  });

  describe('useContent', () => {
    it('should fetch content by ID', async () => {
      const mockContent: ContentWithLocales = {
        id: 'test-id',
        site: 'test-site',
        locales: {
          en: {
            id: 'test-id',
            locale: 'en',
            type: 'puck',
            content: { puckData: {} },
            meta: {
              pathname: '/test',
              title: 'Test',
              published: true,
            },
            etag: '"123"',
            modified: new Date(),
            size: 1000,
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
      const mockContent: LocalizedContent = {
        id: 'test-id',
        locale: 'en',
        type: 'puck',
        content: { puckData: {} },
        meta: {
          pathname: '/test',
          title: 'Test',
          published: true,
        },
        etag: '"123"',
        modified: new Date(),
        size: 1000,
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
        entries: [
          { id: 'page1', site: 'test-site', pathname: '/page1' },
          { id: 'page2', site: 'test-site', pathname: '/page2' },
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

      expect(mockClient.isPathnameAvailable).toHaveBeenCalledWith('test-site', '/new-path', 'exclude-id');
      expect(result.current.data).toEqual({ available: true });
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
});
