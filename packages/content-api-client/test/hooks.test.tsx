/// <reference lib="dom" />

import type { ContentEntry, LocalizedEntry } from '@conloca/content-api';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContentAPIClient } from '../src/client';
import {
  setContentAPIClient,
  useCompileMDX,
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
      getContent: vi.fn(() => Promise.resolve(null)),
      getLocalized: vi.fn(() => Promise.resolve(null)),
      createContent: vi.fn(() => Promise.resolve({ success: true, id: 'new-id', etag: 'metaHash.contentHash' })),
      updateLocalized: vi.fn(() =>
        Promise.resolve({ success: true, etag: 'updatedMeta.updatedContent', modified: new Date() }),
      ),
      deleteContent: vi.fn(() => Promise.resolve({ success: true })),
      getSitePages: vi.fn(() => Promise.resolve({ items: [], total: 0 })),
      getPageByPathname: vi.fn(() => Promise.resolve(null)),
      isPathnameAvailable: vi.fn(() => Promise.resolve(true)),
      movePage: vi.fn(() => Promise.resolve({ moved: true })),
      getBlocks: vi.fn(() => Promise.resolve({ items: [], total: 0 })),
      getBlockByName: vi.fn(() => Promise.resolve(null)),
      compileMDX: vi.fn(() =>
        Promise.resolve({ code: 'return { default: function Test() { return null } }', metadata: {} }),
      ),
      getData: vi.fn(() => Promise.resolve({ items: [], total: 0 })),
      getDataByName: vi.fn(() => Promise.resolve(null)),
      isDataNameAvailable: vi.fn(() => Promise.resolve(true)),
      getDataCollections: vi.fn(() => Promise.resolve([])),
      listAllContent: vi.fn(() => Promise.resolve({ items: [], total: 0 })),
      findUntranslatedContent: vi.fn(() => Promise.resolve({ items: [], total: 0 })),
      getSitesConfig: vi.fn(() => Promise.resolve({ sites: {} })),
      batchUpdate: vi.fn(() => Promise.resolve({ success: true, updated: 0, failed: 0, operations: [] })),
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

      mockClient.getContent = vi.fn(() => Promise.resolve(mockContent));

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
      mockClient.getContent = vi.fn(() => Promise.reject(error));

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

      mockClient.getLocalized = vi.fn(() => Promise.resolve(mockContent));

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
      };

      mockClient.compileMDX = vi.fn(() => Promise.resolve(compileResult));

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
      mockClient.getContent = vi.fn(() => Promise.resolve(createdContent));

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
      mockClient.createContent = vi.fn(() => Promise.reject(error));

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
      mockClient.getLocalized = vi.fn(() => Promise.resolve(updatedContent));

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

      mockClient.getSitePages = vi.fn(() => Promise.resolve(mockPages));

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

      mockClient.getData = vi.fn(() => Promise.resolve(mockData));

      const { result } = renderHook(() => useData('authors', 'en'), { wrapper });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(mockClient.getData).toHaveBeenCalledWith('authors', 'en');
      expect(result.current.data).toEqual(mockData);
    });

    it('should fetch all data when no filters', async () => {
      const mockData = { items: [], total: 0 };

      mockClient.getData = vi.fn(() => Promise.resolve(mockData));

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

      mockClient.getDataByName = vi.fn(() => Promise.resolve(mockEntry));

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
      mockClient.isDataNameAvailable = vi.fn(() => Promise.resolve(true));

      const { result } = renderHook(() => useDataNameAvailability('new-name', 'authors', 'exclude-id'), { wrapper });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(mockClient.isDataNameAvailable).toHaveBeenCalledWith('new-name', 'authors', 'exclude-id');
      expect(result.current.data).toEqual({ available: true });
    });

    it('should return available: false for taken name', async () => {
      mockClient.isDataNameAvailable = vi.fn(() => Promise.resolve(false));

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

      mockClient.getDataCollections = vi.fn(() => Promise.resolve(mockCollections));

      const { result } = renderHook(() => useDataCollections(), { wrapper });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(mockClient.getDataCollections).toHaveBeenCalled();
      expect(result.current.data).toEqual(mockCollections);
    });
  });
});
