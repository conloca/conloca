import type {
  BatchResult,
  ContentEntry,
  ContentManifest,
  CreateResult,
  DeleteResult,
  LocalizedEntry,
  UpdateResult,
} from '@conloca/content-api';

/**
 * Test helpers for mocking Content API Client
 */

/**
 * API route patterns used by the content API
 * These match the routes defined in content-api/src/middleware.ts
 */
export const API_ROUTES = {
  SITES: '/sites',
  ALL_CONTENT: '/content',
  CONTENT_BY_ID: (id: string) => `/content/${id}`,
  LOCALIZED_CONTENT: (id: string, locale: string) => `/content/${id}/${locale}`,
  SITE_PAGES: (site: string) => `/${site}/pages`,
  BLOCKS: '/blocks',
  COLLECTIONS: '/content/collections',
  BATCH_UPDATE: '/content/batch',
  FIND_UNTRANSLATED: '/content/find-untranslated',
} as const;

export interface MockResponse {
  status?: number;
  headers?: Record<string, string>;
  body?: any;
}

/**
 * Creates a mock fetch function for testing
 * Note: This requires a mock function from your test framework (e.g., bun:test, jest, vitest)
 */
export function createMockFetch(mockFn: (impl?: any) => any) {
  return mockFn(() => Promise.resolve(new Response()));
}

/**
 * Creates a Response object with JSON body
 */
export function jsonResponse(body: any, options: { status?: number; headers?: Record<string, string> } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: options.status || 200,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
}

/**
 * Creates a mock ContentEntry
 */
export function mockContentEntry(overrides?: Partial<ContentEntry>): ContentEntry {
  return {
    id: 'test-id',
    site: 'test-site',
    collection: 'pages',
    type: 'puck',
    kind: 'page',
    locales: {
      en: {
        locale: 'en',
        etag: 'metaHash.contentHash',
        created: '2024-01-01T00:00:00Z',
        modified: '2024-01-01T00:00:00Z',
        pathname: '/test',
        meta: {
          title: 'Test Page',
        },
        content: { puckData: {} },
      },
    },
    ...overrides,
  };
}

/**
 * Creates a mock ContentManifest
 */
export function mockContentManifest(overrides?: Partial<ContentManifest>): ContentManifest {
  return {
    id: 'test-id',
    site: 'test-site',
    collection: 'pages',
    type: 'puck',
    kind: 'page',
    locales: {
      en: {
        locale: 'en',
        etag: 'metaHash.contentHash',
        created: '2024-01-01T00:00:00Z',
        modified: '2024-01-01T00:00:00Z',
        pathname: '/test',
        meta: {
          title: 'Test Page',
        },
      },
    },
    ...overrides,
  };
}

/**
 * Creates a mock LocalizedEntry
 */
export function mockLocalizedEntry(overrides?: Partial<LocalizedEntry>): LocalizedEntry {
  return {
    id: 'test-id',
    site: 'test-site',
    collection: 'pages',
    type: 'puck',
    kind: 'page',
    localized: {
      locale: 'en',
      etag: 'metaHash.contentHash',
      created: '2024-01-01T00:00:00Z',
      modified: '2024-01-01T00:00:00Z',
      pathname: '/test',
      meta: {
        title: 'Test Page',
      },
      content: { puckData: {} },
    },
    ...overrides,
  };
}

/**
 * Creates a mock CreateResult
 */
export function mockCreateResult(overrides?: Partial<CreateResult>): CreateResult {
  return {
    success: true,
    id: 'new-id',
    etag: 'newMetaHash.newContentHash',
    created: new Date('2024-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

/**
 * Creates a mock UpdateResult
 */
export function mockUpdateResult(overrides?: Partial<UpdateResult>): UpdateResult {
  return {
    success: true,
    etag: 'updatedMetaHash.updatedContentHash',
    modified: new Date('2024-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

/**
 * Creates a mock DeleteResult
 */
export function mockDeleteResult(overrides?: Partial<DeleteResult>): DeleteResult {
  return {
    success: true,
    ...overrides,
  };
}

/**
 * Creates a mock BatchResult
 */
export function mockBatchResult(overrides?: Partial<BatchResult>): BatchResult {
  return {
    operations: [],
    success: true,
    updated: 0,
    failed: 0,
    ...overrides,
  };
}

/**
 * Mock helper for setting up common API responses
 */
export class MockAPIResponses {
  constructor(private fetchMock: any) {}

  mockGetContent(content: ContentEntry | null, status = 200) {
    if (content) {
      this.fetchMock.mockResolvedValueOnce(jsonResponse(content, { status }));
    } else {
      this.fetchMock.mockResolvedValueOnce(new Response('Not found', { status: 404 }));
    }
    return this;
  }

  mockGetLocalized(entry: LocalizedEntry | null, status = 200) {
    if (entry) {
      this.fetchMock.mockResolvedValueOnce(jsonResponse(entry, { status }));
    } else {
      this.fetchMock.mockResolvedValueOnce(new Response('Not found', { status: 404 }));
    }
    return this;
  }

  mockListContent(items: ContentManifest[], status = 200) {
    this.fetchMock.mockResolvedValueOnce(jsonResponse({ items }, { status }));
    return this;
  }

  mockCreateContent(result: CreateResult, status = 200) {
    this.fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          ...result,
          created: result.created?.toISOString(),
        },
        { status },
      ),
    );
    return this;
  }

  mockUpdateContent(result: UpdateResult, status = 200) {
    this.fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          ...result,
          modified: result.modified?.toISOString(),
        },
        { status },
      ),
    );
    return this;
  }

  mockDeleteContent(result: DeleteResult, status = 200) {
    this.fetchMock.mockResolvedValueOnce(jsonResponse(result, { status }));
    return this;
  }

  mockStaleWrite(currentEtag: string) {
    this.fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          error: {
            code: 'STALE_WRITE',
            message: 'Content has been modified',
            details: { currentEtag },
          },
        },
        { status: 412 },
      ),
    );
    return this;
  }

  mockError(message: string, status = 500) {
    this.fetchMock.mockResolvedValueOnce(new Response(message, { status }));
    return this;
  }

  mockNetworkError() {
    this.fetchMock.mockRejectedValueOnce(new Error('Network error'));
    return this;
  }
}

/**
 * Setup fetch mock with helper
 * @param mockFn - Mock function from your test framework (e.g., mock from bun:test)
 */
export function setupFetchMock(mockFn: (impl?: any) => any) {
  const fetchMock = createMockFetch(mockFn);
  global.fetch = fetchMock as any;
  return {
    fetchMock,
    responses: new MockAPIResponses(fetchMock),
  };
}
