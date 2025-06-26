# @conloca/content-api-client

TypeScript client library for interacting with the Conloca Content API. Provides both HTTP client and React hooks for
content operations.

## Overview

This package provides:

- `ContentAPIClient` - HTTP client for content operations
- React hooks (`useContent`, `useUpdateContent`, etc.) for seamless integration
- Full TypeScript support with comprehensive types
- Dual ETag system for optimistic conflict resolution
- Test helpers for both unit and integration testing

## Installation

```bash
bun add @conloca/content-api-client
```

## Usage

### Basic Client Usage

```typescript
import { ContentAPIClient } from '@conloca/content-api-client';

// Create client instance
const client = new ContentAPIClient({
  baseUrl: '/__conloca/api', // optional, defaults to '/__conloca/api'
});

// Get content by ID
const content = await client.getContent('page-id');

// Get localized content
const localizedContent = await client.getLocalized('page-id', 'en');

// Create new content
const result = await client.createContent({
  kind: 'page',
  site: 'default',
  collection: 'pages',
  type: 'puck',
  locales: {
    en: {
      pathname: '/about',
      meta: { title: 'About Us' },
      content: { puckData: { root: {} } },
    },
  },
});

// Update content with ETag validation
const updateResult = await client.updateLocalized({
  id: 'page-id',
  locale: 'en',
  data: {
    meta: { title: 'Updated Title' },
  },
  etag: localizedContent.localized.etag,
});
```

### React Hooks Usage

```typescript
import { useContent, useUpdateContent } from '@conloca/content-api-client';

function MyComponent({ contentId }) {
  // Fetch content
  const { data: content, isLoading } = useContent(contentId);

  // Update mutation
  const updateContent = useUpdateContent();

  const handleUpdate = async () => {
    try {
      await updateContent.mutateAsync({
        id: contentId,
        locale: 'en',
        data: { meta: { title: 'New Title' } },
        etag: content.localized.etag
      });
    } catch (error) {
      if (error instanceof StaleWriteError) {
        // Handle conflict - error.data.currentEtag contains latest version
      }
    }
  };

  return (
    // Your UI here
  );
}
```

## Testing Approach

The content-api-client package uses a **dual testing strategy** to ensure both unit-level correctness and integration
reliability:

### 1. Unit Tests with Mocks (`client.test.ts`)

Unit tests focus on testing the client's behavior in isolation, ensuring proper request formation, response handling,
and error cases.

**When to use mocks:**

- Testing specific HTTP status codes and error conditions
- Testing request parameter formation and headers
- Testing client configuration options
- Testing edge cases that are hard to reproduce with real implementations
- Testing network failures and timeouts

**Example:**

```typescript
import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { ContentAPIClient } from '../src/client';
import { setupFetchMock } from '../src/test-helpers';

describe('ContentAPIClient', () => {
  const { fetchMock, responses } = setupFetchMock(mock);

  it('should handle 404 responses', async () => {
    responses.mockGetContent(null); // Returns 404

    const result = await client.getContent('non-existent');
    expect(result).toBeNull();
  });

  it('should handle stale writes', async () => {
    responses.mockStaleWrite('current.etag');

    await expect(
      client.updateLocalized({
        id: 'test-id',
        locale: 'en',
        data: {},
        etag: 'stale.etag',
      })
    ).rejects.toThrow(StaleWriteError);
  });
});
```

### 2. Integration Tests with InMemoryContentAPI (`client-integration.test.ts`)

Integration tests use the real `InMemoryContentAPI` implementation with the full middleware stack to test end-to-end
behavior.

**When to use InMemoryContentAPI:**

- Testing complete workflows (create → read → update → delete)
- Testing complex scenarios like conflict resolution
- Testing batch operations and transactions
- Testing API contract compliance
- Testing React components and hooks

**Example:**

```typescript
import { createContentAPIRouter, InMemoryContentAPI } from '@conloca/content-api/node';
import { ContentAPIClient } from '../src/client';

describe('ContentAPIClient Integration Tests', () => {
  let contentApi: InMemoryContentAPI;
  let client: ContentAPIClient;

  beforeEach(() => {
    // Create in-memory API
    contentApi = new InMemoryContentAPI({
      sites: { default: { locales: ['en', 'nl'] } }
    });

    // Create router with middleware
    const honoApp = createContentAPIRouter(contentApi);

    // Override fetch to use the router directly
    global.fetch = async (input, init) => {
      const request = new Request(input, init);
      return honoApp.fetch(request);
    };

    client = new ContentAPIClient({ baseUrl: 'http://test/__conloca/api' });
  });

  it('should handle complete content lifecycle', async () => {
    // Create content
    const createResult = await client.createContent({...});

    // Read it back
    const content = await client.getContent(createResult.id);

    // Update it
    await client.updateLocalized({...});

    // Delete it
    await client.deleteContent(createResult.id, content.etag);
  });
});
```

## Test Helpers

The package provides comprehensive test helpers in `src/test-helpers.ts`:

### Mock Factories

```typescript
import {
  mockContentEntry,
  mockLocalizedEntry,
  mockCreateResult,
  mockUpdateResult,
} from '@conloca/content-api-client/test-helpers';

// Create mock data with proper types
const content = mockContentEntry({
  id: 'custom-id',
  site: 'my-site',
});
```

### Fetch Mock Setup

```typescript
import { setupFetchMock } from '@conloca/content-api-client/test-helpers';
import { mock } from 'bun:test';

const { fetchMock, responses } = setupFetchMock(mock);

// Chain mock responses
responses
  .mockGetContent(mockContent)
  .mockUpdateContent({ success: true, etag: 'new.etag' })
  .mockStaleWrite('current.etag');
```

## Dual ETag System

The content API uses a dual ETag system for optimistic conflict resolution:

- **Format**: `metaHash.contentHash`
- **Meta Hash**: Changes when metadata (title, description, etc.) changes
- **Content Hash**: Changes when actual content changes

This allows non-conflicting updates to proceed:

```typescript
// User 1 updates metadata
await client.updateLocalized({
  id: 'page-id',
  locale: 'en',
  data: { meta: { title: 'New Title' } },
  etag: 'oldMeta.oldContent',
});

// User 2 can still update content if they have the new meta hash
await client.updateLocalized({
  id: 'page-id',
  locale: 'en',
  data: {
    content: {
      puckData: {
        /* ... */
      },
    },
  },
  etag: 'newMeta.oldContent', // Will succeed!
});
```

## Best Practices

### 1. Choose the Right Testing Approach

- **Use mocks** for testing client behavior, error handling, and edge cases
- **Use InMemoryContentAPI** for testing workflows, integrations, and React components
- Don't mock what you can easily test with InMemoryContentAPI

### 2. Handle Stale Writes Gracefully

```typescript
try {
  await updateContent(data);
} catch (error) {
  if (error instanceof StaleWriteError) {
    // Fetch latest version
    const latest = await client.getLocalized(id, locale);

    // Retry with current etag if changes don't conflict
    await updateContent({
      ...data,
      etag: error.data.currentEtag,
    });
  }
}
```

### 3. Use React Query Features

The React hooks are built on @tanstack/react-query, so you get:

- Automatic caching and invalidation
- Background refetching
- Optimistic updates
- Offline support

```typescript
const { data, isLoading, error, refetch } = useContent(id);

// Manually refetch
await refetch();

// Optimistic update
updateContent.mutate(data, {
  onMutate: async (newData) => {
    // Cancel outgoing refetches
    await queryClient.cancelQueries(['content', id]);

    // Optimistically update
    const previous = queryClient.getQueryData(['content', id]);
    queryClient.setQueryData(['content', id], newData);

    return { previous };
  },
  onError: (err, newData, context) => {
    // Rollback on error
    queryClient.setQueryData(['content', id], context.previous);
  },
});
```

## API Reference

### ContentAPIClient

Main client class for content operations.

#### Constructor

```typescript
new ContentAPIClient(options?: { baseUrl?: string })
```

#### Methods

- `getContent(id: string): Promise<ContentEntry | null>`
- `getLocalized(id: string, locale: string): Promise<LocalizedEntry | null>`
- `createContent(data: CreateContentInput): Promise<CreateResult>`
- `updateLocalized(input: UpdateLocaleInput): Promise<UpdateResult>`
- `deleteContent(id: string, etag: string): Promise<DeleteResult>`
- `listAllContent(filters?: ContentFilters): Promise<ListResult>`
- `batchUpdate(operations: UpdateLocaleInput[]): Promise<BatchResult>`
- `isPathnameAvailable(site: string, pathname: string, excludeId?: string): Promise<boolean>`

### React Hooks

- `useContent(id: string)` - Fetch content by ID
- `useLocalizedContent(id: string, locale: string)` - Fetch localized content
- `useCreateContent()` - Create content mutation
- `useUpdateContent()` - Update content mutation
- `useDeleteContent()` - Delete content mutation
- `useSitePages(site: string, locale?: string)` - List site pages
- `useBlocks(collection?: string, locale?: string)` - List blocks

## Building

```bash
# Build the library
nx build content-api-client

# Run tests
nx run content-api-client:test
```
