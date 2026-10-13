# @conloca/content-api-client

TypeScript client library for interacting with the Conloca Content API. Provides both HTTP client and React hooks for
content operations.

## Overview

This package provides:

- `ContentAPIClient` - HTTP client for content operations
- React hooks (`useContent`, `useLocalizedContent`, `useUpdateLocalized`, etc.) built on TanStack Query
- Full TypeScript support with comprehensive types
- Dual ETags that refuse a write made against an outdated version
- Test helpers (`@conloca/content-api-client/testing`) that mock `fetch` in unit tests

## Installation

```bash
bun add @conloca/content-api-client
```

The React hooks need React 19 (a peer dependency) and a `QueryClientProvider` from `@tanstack/react-query` above the
components that use them. Add `@tanstack/react-query` to your app in a version that satisfies the range in this
package's `dependencies`, so your provider and the hooks use the same copy.

## Usage

### Basic Client Usage

```typescript
import { ContentAPIClient } from '@conloca/content-api-client';

// Create client instance
const client = new ContentAPIClient({
  baseUrl: '/__conloca/api', // optional, defaults to '/__conloca/api'
  // fetch: myFetch,         // optional, defaults to the global fetch at the time the client is created
});

// Get content by ID (null when there is no such entry)
const content = await client.getContent('page-id');

// Get localized content (null when the entry or the locale does not exist)
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
if (localizedContent) {
  const updateResult = await client.updateLocalized({
    id: 'page-id',
    locale: 'en',
    data: {
      meta: { title: 'Updated Title' },
    },
    etag: localizedContent.localized.etag,
  });
}
```

The dev server of an `@conloca/astro-cms` site serves the API under its editor route, at `/__cms/api` unless you changed
`route`; pass that as `baseUrl` there.

### React Hooks Usage

The hooks share one client. It calls `/__conloca/api` until you replace it, once before the first render, with
`setContentAPIClient(new ContentAPIClient({ baseUrl: '/__cms/api' }))`.

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StaleWriteError, useLocalizedContent, useUpdateLocalized } from '@conloca/content-api-client';

const queryClient = new QueryClient();

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TitleEditor contentId="page-id" />
    </QueryClientProvider>
  );
}

function TitleEditor({ contentId }: { contentId: string }) {
  // Fetch one locale of the entry, with its ETag
  const { data: entry, isLoading } = useLocalizedContent(contentId, 'en');

  // Update mutation
  const updateLocalized = useUpdateLocalized();

  const handleUpdate = async () => {
    if (!entry) return;
    try {
      await updateLocalized.mutateAsync({
        id: contentId,
        locale: 'en',
        data: { meta: { title: 'New Title' } },
        etag: entry.localized.etag,
      });
    } catch (error) {
      if (error instanceof StaleWriteError) {
        // Handle conflict - error.currentEtag is the ETag of the version on the server
      }
    }
  };

  if (isLoading) return <p>Loading…</p>;

  return (
    <button type="button" onClick={handleUpdate} disabled={updateLocalized.isPending}>
      Rename “{entry?.localized.meta.title}”
    </button>
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
import { ContentAPIClient, StaleWriteError } from '@conloca/content-api-client';
import { type MockAPIResponses, setupFetchMock } from '@conloca/content-api-client/testing';

describe('ContentAPIClient', () => {
  let client: ContentAPIClient;
  let responses: MockAPIResponses;

  beforeEach(() => {
    // setupFetchMock replaces the global fetch, so create the client after it:
    // a client keeps the fetch it found when it was created.
    ({ responses } = setupFetchMock(mock));
    client = new ContentAPIClient();
  });

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
behavior. `InMemoryContentAPI` and `createContentAPIRouter` come from `@conloca/content-api/node`; add
`@conloca/content-api` to your dev dependencies to import them.

**When to use InMemoryContentAPI:**

- Testing complete workflows (create → read → update → delete)
- Testing complex scenarios like conflict resolution
- Testing batch operations and transactions
- Testing API contract compliance
- Testing React components and hooks

**Example:**

```typescript
import { beforeEach, describe, expect, it } from 'bun:test';
import { createContentAPIRouter, InMemoryContentAPI } from '@conloca/content-api/node';
import { ContentAPIClient } from '@conloca/content-api-client';

describe('ContentAPIClient Integration Tests', () => {
  let client: ContentAPIClient;

  beforeEach(() => {
    // Create in-memory API
    const contentApi = new InMemoryContentAPI({
      sites: { default: { locales: ['en', 'nl'], defaultLocale: 'en' } },
      globalLocales: ['en', 'nl'],
    });

    // The router answers the API routes from its root (`/content`, `/sites`, ...)
    const router = createContentAPIRouter(contentApi);

    // Send the client's requests straight to the router
    client = new ContentAPIClient({
      baseUrl: 'http://test',
      fetch: ((input, init) => router.request(input, init)) as typeof fetch,
    });
  });

  it('should handle complete content lifecycle', async () => {
    // Create content
    const createResult = await client.createContent({
      kind: 'page',
      site: 'default',
      collection: 'pages',
      type: 'puck',
      locales: { en: { pathname: '/about', meta: { title: 'About' }, content: { puckData: { root: {} } } } },
    });
    const id = createResult.id!;

    // Read it back
    const content = await client.getContent(id);
    expect(content?.locales.en.pathname).toBe('/about');

    // Update it
    await client.updateLocalized({
      id,
      locale: 'en',
      data: { meta: { title: 'About Us' } },
      etag: content!.locales.en.etag,
    });

    // Delete it: deleting a whole entry takes the current ETag of any one of its locales
    const updated = await client.getContent(id);
    await client.deleteContent(id, updated!.locales.en.etag);
  });
});
```

## Test Helpers

The package provides test helpers in `@conloca/content-api-client/testing`:

### Mock Factories

`mockContentEntry`, `mockContentManifest`, `mockLocalizedEntry`, `mockCreateResult`, `mockUpdateResult`,
`mockDeleteResult` and `mockBatchResult` each return a complete value of their type; pass the fields you want to change.

```typescript
import { mockContentEntry } from '@conloca/content-api-client/testing';

// Create mock data with proper types
const content = mockContentEntry({
  id: 'custom-id',
  site: 'my-site',
});
```

### Fetch Mock Setup

`setupFetchMock` replaces the global `fetch` with a mock (it does not restore it) and returns that mock with a
`MockAPIResponses` that queues one response per call: `mockGetContent`, `mockGetLocalized`, `mockListContent`,
`mockCreateContent`, `mockUpdateContent`, `mockDeleteContent`, `mockStaleWrite`, `mockError` and `mockNetworkError`.
Create the client after calling it.

```typescript
import { mock } from 'bun:test';
import { mockContentEntry, setupFetchMock } from '@conloca/content-api-client/testing';

const { fetchMock, responses } = setupFetchMock(mock);

// Chain mock responses
responses
  .mockGetContent(mockContentEntry())
  .mockUpdateContent({ success: true, etag: 'new.etag' })
  .mockStaleWrite('current.etag');
```

`jsonResponse(body, { status, headers })` builds a JSON `Response` for your own mocks, and `API_ROUTES` holds API route
paths relative to `baseUrl`.

## Dual ETag System

The content API uses a dual ETag system for optimistic concurrency control:

- **Format**: `metaHash.contentHash` for pages and fragments; a data entry has a single hash
- **Meta Hash**: Changes when metadata (title, description, etc.) changes
- **Content Hash**: Changes when actual content changes

The file-backed API (`FileSystemContentAPI`, which `createContentAPI` from `@conloca/content-api/node` returns) checks
only the half a write changes: a `meta`, `publishAt` or `unpublishAt` change needs the current meta hash, a `content`
change the current content hash. A metadata or content write also updates the entry's `modified` time, which is part of
the metadata, so a metadata write changes only the meta hash while a content write changes both. Two writes sent with
the same loaded ETag therefore both succeed only when the metadata write comes first:

```typescript
import { ContentAPIClient } from '@conloca/content-api-client';

const client = new ContentAPIClient();

// Both users loaded the page when its ETag was 'oldMeta.oldContent'

// User 1 updates metadata first
await client.updateLocalized({
  id: 'page-id',
  locale: 'en',
  data: { meta: { title: 'New Title' } },
  etag: 'oldMeta.oldContent',
});

// User 2 then updates content with the ETag they loaded:
// the metadata write left its content hash current
await client.updateLocalized({
  id: 'page-id',
  locale: 'en',
  data: {
    content: {
      puckData: {/* ... */},
    },
  },
  etag: 'oldMeta.oldContent', // Succeeds
});
```

In the opposite order the metadata write is refused, because the content write already changed the meta hash. A second
metadata change with `'oldMeta.oldContent'` is refused too. `InMemoryContentAPI` compares the whole ETag, so there any
outdated ETag is refused.

## Best Practices

### 1. Choose the Right Testing Approach

- **Use mocks** for testing client behavior, error handling, and edge cases
- **Use InMemoryContentAPI** for testing workflows, integrations, and React components
- Don't mock what you can easily test with InMemoryContentAPI

### 2. Handle Stale Writes Gracefully

```typescript
import { ContentAPIClient, StaleWriteError } from '@conloca/content-api-client';

const client = new ContentAPIClient();
const loaded = await client.getLocalized('page-id', 'en');
if (!loaded) throw new Error('Page not found');

const update = { id: 'page-id', locale: 'en', data: { meta: { title: 'New Title' } }, etag: loaded.localized.etag };

try {
  await client.updateLocalized(update);
} catch (error) {
  if (!(error instanceof StaleWriteError)) throw error;

  // Fetch latest version
  const latest = await client.getLocalized(update.id, update.locale);

  // Retry with the current etag once you know your change does not undo theirs
  if (latest) {
    await client.updateLocalized({ ...update, etag: latest.localized.etag });
  }
}
```

### 3. Use React Query Features

The hooks are built on `@tanstack/react-query` 5 (`useQuery` and `useMutation`), so they return its usual results:
`data`, `isLoading`, `error` and `refetch` from a read hook, `mutate`, `mutateAsync` and `isPending` from a write hook.

When a write succeeds, the write hooks put the server's answer into the cache, or refetch the queries the write
affected, so other components that show the same content update without extra code. They do not update the cache before
the server answers, and their query keys are not exported. To reload a query yourself, call its `refetch`:

```tsx
import { useContent } from '@conloca/content-api-client';

export function ContentStatus({ id }: { id: string }) {
  const { data, isLoading, error, refetch } = useContent(id);

  if (isLoading) return <p>Loading…</p>;
  if (error) return <p>{error.message}</p>;

  return (
    <p>
      {data ? `${data.kind} ${data.id}` : 'Not found'}
      {/* Manually refetch */}
      <button type="button" onClick={() => refetch()}>
        Reload
      </button>
    </p>
  );
}
```

## API Reference

The full list of methods and hooks is at
[conloca.com/packages/content-api-client](https://conloca.com/packages/content-api-client/).

### ContentAPIClient

Main client class for content operations.

#### Constructor

```typescript
new ContentAPIClient(options?: { baseUrl?: string; fetch?: typeof fetch })
```

#### Common methods

- `getContent(id: string): Promise<ContentEntry | null>`
- `getLocalized(id: string, locale: string): Promise<LocalizedEntry | null>`
- `createContent(data: CreateContentInput): Promise<CreateResult>`
- `updateLocalized(input: UpdateLocaleInput): Promise<UpdateResult>`
- `deleteContent(id: string, etag: string): Promise<DeleteResult>`
- `deleteLocalized(input: { id: string; locale: string; etag: string }): Promise<DeleteResult>`
- `listAllContent(filters?: GlobalFilters): Promise<ContentListResult>`
- `batchUpdate(operations: UpdateLocaleInput[]): Promise<BatchResult>`
- `isPathnameAvailable(site: string, pathname: string, excludeId?: string, locale?: string): Promise<boolean>`

This package does not export `CreateContentInput`, `UpdateLocaleInput`, `GlobalFilters`, `ContentListResult` or
`BatchResult`; add `@conloca/content-api` to your dependencies and import them from there, for example
`import type { CreateContentInput, UpdateLocaleInput } from '@conloca/content-api';`.

Most methods throw an `APIClientError` (with `code` and `details`) when the server answers with an API error; an
outdated ETag throws its subclass `StaleWriteError` (with `currentEtag`).

### React Hooks

- `setContentAPIClient(client: ContentAPIClient)` / `getContentAPIClient()` - Set or read the client the hooks use
- `useContent(id: string)` - Fetch content by ID
- `useLocalizedContent(id: string, locale: string)` - Fetch localized content
- `useCreateContent()` - Create content mutation
- `useUpdateLocalized()` - Update one locale mutation (takes the same input as `updateLocalized`)
- `useDeleteContent()` - Delete content mutation (takes `{ id, etag, locale? }`; with `locale`, deletes that locale)
- `useSitePages(site: string, locale?: string)` - List site pages
- `useFragments(collection?: string, locale?: string)` - List fragments

## Building

```bash
# Build the library
nx build content-api-client

# Run tests
nx run content-api-client:test
```
