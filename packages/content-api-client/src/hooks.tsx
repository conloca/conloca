import type {
  AssetEntry,
  AssetMetadataPatch,
  AssetUsage,
  ContentEntry,
  ContentListResult,
  ContentManifest,
  CreateContentInput,
  DataContext,
  EditorDataBindings,
  FolderListing,
  FolderTreeNode,
  GitCommitResult,
  GitPullResult,
  GitPushResult,
  GitStatus,
  GlobalFilters,
  LocaleVersion,
  LocalizedEntry,
  MDXCompileResponse,
  PageReference,
  SitesConfig,
  UpdateLocaleInput,
} from '@conloca/content-api';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { APIClientError, ContentAPIClient, StaleWriteError } from './client.js';
import { buildRouteData, type RouteData } from './data-bindings.js';

// Global client instance
let globalClient: ContentAPIClient | null = null;

export function getContentAPIClient(): ContentAPIClient {
  if (!globalClient) {
    globalClient = new ContentAPIClient();
  }
  return globalClient;
}

export function setContentAPIClient(client: ContentAPIClient): void {
  globalClient = client;
}

// ===== Type Guards =====
function isContentListResult(value: unknown): value is ContentListResult {
  return (
    typeof value === 'object' &&
    value !== null &&
    'items' in value &&
    'total' in value &&
    Array.isArray((value as { items: unknown }).items) &&
    typeof (value as { total: unknown }).total === 'number'
  );
}

function hashString(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index++) {
    const char = value.charCodeAt(index);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return hash.toString(36);
}

/**
 * A listing entry rebuilt from a saved version keeps the `unpublished` marker
 * the list carried: saving publishes nothing, and the fetched version does not
 * say. The next refetch of the list replaces it with the server's answer.
 */
function keepUnpublishedMarker(previous: LocaleVersion | undefined, saved: LocaleVersion): LocaleVersion {
  return previous?.unpublished ? { ...saved, unpublished: true } : saved;
}

// ===== Query Keys =====
const queryKeys = {
  currentUser: () => ['auth', 'user'] as const,
  gitStatus: () => ['git', 'status'] as const,
  content: (id: string) => ['content', id] as const,
  localized: (id: string, locale: string) => ['content', id, locale] as const,
  sitePages: (site: string, locale?: string) => ['sites', site, 'pages', locale] as const,
  /** Every page list of a site, whatever locale it is filtered to. */
  sitePagesOfSite: (site: string) => ['sites', site, 'pages'] as const,
  pageByPathname: (site: string, pathname: string, locale?: string) =>
    ['sites', site, 'pathname', pathname, locale] as const,
  pathnameAvailability: (site: string, pathname: string, excludeId?: string, locale?: string) =>
    ['sites', site, 'pathname-availability', pathname, excludeId, locale] as const,
  fragments: (collection?: string, locale?: string) => ['fragments', collection, locale] as const,
  fragmentByName: (name: string, collection?: string, locale?: string) =>
    ['fragments', name, collection, locale] as const,
  data: (collection?: string, locale?: string) => ['data', collection, locale] as const,
  dataByName: (name: string, collection: string, locale?: string) => ['data', name, collection, locale] as const,
  dataNameAvailability: (name: string, collection: string, excludeId?: string) =>
    ['data', 'name-availability', name, collection, excludeId] as const,
  dataCollections: () => ['data', 'collections'] as const,
  dataContext: (collection?: string, bindings?: EditorDataBindings) =>
    ['data', 'context', collection, bindings] as const,
  allContent: (filters?: GlobalFilters) => ['content', 'all', filters] as const,
  untranslatedContent: (targetLocale: string, excludeSites?: string[], includeUnpublished?: boolean) =>
    ['content', 'untranslated', targetLocale, excludeSites, includeUnpublished] as const,
  sitesConfig: () => ['sites', 'config'] as const,
  assets: () => ['assets'] as const,
  asset: (path: string) => ['assets', path] as const,
  assetFolders: (path?: string) => ['asset-folders', path] as const,
  assetUsage: (path: string | null) => ['asset-usage', path] as const,
  folderTree: () => ['folder-tree'] as const,
  mdxCompile: (cacheKey: string) => ['mdx', 'compile', cacheKey] as const,
};

// ===== Core Content Hooks =====

export function useContent(id: string) {
  const client = getContentAPIClient();

  return useQuery<ContentEntry | null>({
    queryKey: queryKeys.content(id),
    queryFn: () => client.getContent(id),
    enabled: !!id,
  });
}

export function useLocalizedContent(id: string, locale: string) {
  const client = getContentAPIClient();

  return useQuery<LocalizedEntry | null>({
    queryKey: queryKeys.localized(id, locale),
    queryFn: () => client.getLocalized(id, locale),
    enabled: !!id && !!locale,
  });
}

export interface UseCompileMDXOptions {
  mdxContent: string | null;
  cacheKey?: string;
}

export function useCompileMDX({ mdxContent, cacheKey }: UseCompileMDXOptions) {
  const client = getContentAPIClient();
  const resolvedCacheKey = cacheKey || (mdxContent ? `mdx-${hashString(mdxContent)}` : 'mdx-empty');

  return useQuery<MDXCompileResponse>({
    queryKey: queryKeys.mdxCompile(resolvedCacheKey),
    queryFn: () => client.compileMDX(mdxContent!),
    enabled: !!mdxContent,
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
  });
}

// ===== Mutation Hooks =====

export function useCreateContent() {
  const client = getContentAPIClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateContentInput) => {
      const result = await client.createContent(data);
      if (result.success && result.id) {
        // Fetch the full content to get server-generated data
        const fullContent = await client.getContent(result.id);
        return { ...result, fullContent };
      }
      return result;
    },
    onSuccess: (result, variables) => {
      if (result.success && result.id && 'fullContent' in result && result.fullContent) {
        // Cache the server's response
        queryClient.setQueryData(queryKeys.content(result.id), result.fullContent);

        if (variables.kind === 'page' && variables.site) {
          // Refetch the page lists (any locale filter) instead of appending the fetched entry: the list says
          // whether the page is published and the entry does not, so an appended page would read as live
          // until the refetch anyway.
          void queryClient.invalidateQueries({ queryKey: queryKeys.sitePagesOfSite(variables.site) });
        } else if (variables.kind === 'fragment') {
          // Invalidate all fragment queries to ensure the new fragment appears everywhere
          queryClient.invalidateQueries({ queryKey: ['fragments'] });
        } else if (variables.kind === 'data') {
          // Invalidate all data queries to ensure the new data entry appears everywhere
          queryClient.invalidateQueries({ queryKey: ['data'] });
        }
      }
    },
  });
}

export function useUpdateLocalized() {
  const client = getContentAPIClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: UpdateLocaleInput) => {
      const result = await client.updateLocalized(input);
      if (result.success) {
        // Fetch the updated localized content to get server-processed data
        const updatedContent = await client.getLocalized(input.id, input.locale);
        return { ...result, updatedContent };
      }
      return result;
    },
    onSuccess: (result, variables) => {
      if (result.success && 'updatedContent' in result && result.updatedContent) {
        // Update the localized content query with server data
        queryClient.setQueryData(queryKeys.localized(variables.id, variables.locale), result.updatedContent);

        // Update the full content entry
        queryClient.setQueryData(queryKeys.content(variables.id), (old: ContentEntry | null | undefined) => {
          if (!old) return old;
          return {
            ...old,
            locales: {
              ...old.locales,
              [variables.locale]: result.updatedContent!.localized,
            },
          };
        });

        // Update list queries to reflect the server data. A locale the list item does not hold yet is not
        // added from the saved version: the version cannot say whether it was ever published, and a list
        // item that gains an unmarked locale reads as live. The lists holding such an item are refetched.
        const updateListQueries = (old: ContentListResult | undefined) => {
          if (!isContentListResult(old)) return old;
          return {
            ...old,
            items: old.items.map((item) =>
              item.id === variables.id && Object.hasOwn(item.locales, variables.locale)
                ? {
                    ...item,
                    locales: {
                      ...item.locales,
                      [variables.locale]: keepUnpublishedMarker(item.locales[variables.locale], {
                        locale: result.updatedContent!.localized.locale,
                        etag: result.updatedContent!.localized.etag,
                        created: result.updatedContent!.localized.created,
                        modified: result.updatedContent!.localized.modified,
                        pathname: result.updatedContent!.localized.pathname,
                        previousPathnames: result.updatedContent!.localized.previousPathnames,
                        name: result.updatedContent!.localized.name,
                        publishAt: result.updatedContent!.localized.publishAt,
                        unpublishAt: result.updatedContent!.localized.unpublishAt,
                        meta: result.updatedContent!.localized.meta,
                      }),
                    },
                  }
                : item,
            ),
          };
        };

        queryClient.setQueriesData({ queryKey: ['sites'], exact: false }, updateListQueries);

        queryClient.setQueriesData({ queryKey: ['fragments'], exact: false }, updateListQueries);

        queryClient.setQueriesData({ queryKey: ['data'], exact: false }, updateListQueries);

        void queryClient.invalidateQueries({
          predicate: ({ queryKey, state }) =>
            (queryKey[0] === 'sites' || queryKey[0] === 'fragments' || queryKey[0] === 'data') &&
            isContentListResult(state.data) &&
            state.data.items.some((item) => item.id === variables.id && !Object.hasOwn(item.locales, variables.locale)),
        });
      }
    },
  });
}

interface DeleteContentArgs {
  id: string;
  etag: string;
  locale?: string;
}

export function useDeleteContent() {
  const client = getContentAPIClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, etag, locale }: DeleteContentArgs) => {
      // If locale is provided, it's a locale-specific delete
      if (locale) {
        return client.deleteLocalized({ id, locale, etag });
      }
      // Otherwise, delete entire content
      return client.deleteContent(id, etag);
    },
    onSuccess: (result, variables) => {
      if (result.success) {
        if (variables.locale) {
          // For locale-specific deletion, update the content entry to remove the locale
          queryClient.setQueryData(queryKeys.content(variables.id), (old: ContentEntry | null | undefined) => {
            if (!old) return old;
            const locale = variables.locale!;
            const { [locale]: _, ...remainingLocales } = old.locales;
            return {
              ...old,
              locales: remainingLocales,
            };
          });

          // Update list queries to remove the locale from the item
          const updateListQueries = (old: ContentListResult | undefined) => {
            if (!isContentListResult(old)) return old;
            const locale = variables.locale!;
            return {
              ...old,
              items: old.items
                .map((item) => {
                  if (item.id === variables.id) {
                    const { [locale]: _, ...remainingLocales } = item.locales;
                    return {
                      ...item,
                      locales: remainingLocales,
                    };
                  }
                  return item;
                })
                .filter((item) => Object.keys(item.locales).length > 0), // Remove items with no locales
            };
          };

          queryClient.setQueriesData({ queryKey: ['sites'], exact: false }, updateListQueries);
          queryClient.setQueriesData({ queryKey: ['fragments'], exact: false }, updateListQueries);
          queryClient.setQueriesData({ queryKey: ['data'], exact: false }, updateListQueries);
          queryClient.setQueriesData({ queryKey: ['content', 'all'], exact: false }, updateListQueries);
        } else {
          // For full deletion, remove from cache
          queryClient.removeQueries({ queryKey: queryKeys.content(variables.id) });
          queryClient.removeQueries({ queryKey: ['content', variables.id], exact: false });

          // Update list queries by removing the deleted item
          queryClient.setQueriesData({ queryKey: ['sites'], exact: false }, (old: ContentListResult | undefined) => {
            if (!isContentListResult(old)) return old;
            const newItems = old.items.filter((item) => item.id !== variables.id);
            return {
              ...old,
              items: newItems,
              total: newItems.length < old.items.length ? old.total - 1 : old.total,
            };
          });

          // Update fragment lists
          queryClient.setQueriesData(
            { queryKey: ['fragments'], exact: false },
            (old: ContentListResult | undefined) => {
              if (!isContentListResult(old)) return old;
              const newItems = old.items.filter((item) => item.id !== variables.id);
              return {
                ...old,
                items: newItems,
                total: newItems.length < old.items.length ? old.total - 1 : old.total,
              };
            },
          );

          // Update data lists
          queryClient.setQueriesData({ queryKey: ['data'], exact: false }, (old: ContentListResult | undefined) => {
            if (!isContentListResult(old)) return old;
            const newItems = old.items.filter((item) => item.id !== variables.id);
            return {
              ...old,
              items: newItems,
              total: newItems.length < old.items.length ? old.total - 1 : old.total,
            };
          });

          // Update all content queries
          queryClient.setQueriesData(
            { queryKey: ['content', 'all'], exact: false },
            (old: ContentListResult | undefined) => {
              if (!isContentListResult(old)) return old;
              const newItems = old.items.filter((item) => item.id !== variables.id);
              return {
                ...old,
                items: newItems,
                total: newItems.length < old.items.length ? old.total - 1 : old.total,
              };
            },
          );
        }
      }
    },
  });
}

interface DeleteLocalizedArgs {
  id: string;
  locale: string;
  etag: string;
}

export function useDeleteLocalized() {
  const client = getContentAPIClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, locale, etag }: DeleteLocalizedArgs) => client.deleteLocalized({ id, locale, etag }),
    onSuccess: (result, variables) => {
      if (result.success) {
        // Invalidate specific locale query
        queryClient.invalidateQueries({
          queryKey: queryKeys.localized(variables.id, variables.locale),
        });
        // Invalidate the full content query
        queryClient.invalidateQueries({ queryKey: queryKeys.content(variables.id) });
      }
    },
  });
}

// ===== Site Hooks =====

export function useSitePages(site: string, locale?: string) {
  const client = getContentAPIClient();

  return useQuery<ContentListResult>({
    queryKey: queryKeys.sitePages(site, locale),
    queryFn: () => client.getSitePages(site, locale),
  });
}

export function usePageByPathname(site: string, pathname: string, locale?: string) {
  const client = getContentAPIClient();

  return useQuery<ContentManifest | null>({
    queryKey: queryKeys.pageByPathname(site, pathname, locale),
    queryFn: () => client.getPageByPathname(site, pathname, locale),
    enabled: !!pathname,
  });
}

export function usePathnameAvailability(site: string, pathname: string, excludeId?: string, locale?: string) {
  const client = getContentAPIClient();

  return useQuery({
    queryKey: queryKeys.pathnameAvailability(site, pathname, excludeId, locale),
    queryFn: async () => {
      const available = await client.isPathnameAvailable(site, pathname, excludeId, locale);
      return { available };
    },
    enabled: !!site && !!pathname,
    // For pathname validation, we want immediate feedback
    staleTime: 0,
    gcTime: 0,
  });
}

interface MovePageArgs {
  site: string;
  id: string;
  pathname: string;
  locale?: string;
  etag: string;
}

export function useMovePage() {
  const client = getContentAPIClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ site, id, pathname, locale = 'en', etag }: MovePageArgs) =>
      client.movePage(site, id, pathname, locale, etag),
    onSuccess: (result, variables) => {
      if (result.moved) {
        // Invalidate site pages and content queries
        queryClient.invalidateQueries({ queryKey: ['sites', variables.site] });
        queryClient.invalidateQueries({ queryKey: queryKeys.content(variables.id) });
      }
    },
  });
}

// ===== Fragment Hooks =====

export function useFragments(collection?: string, locale?: string) {
  const client = getContentAPIClient();

  return useQuery<ContentListResult>({
    queryKey: queryKeys.fragments(collection, locale),
    queryFn: () => client.getFragments(collection, locale),
  });
}

export function useFragmentByName(name: string, collection?: string, locale?: string) {
  const client = getContentAPIClient();

  return useQuery<ContentManifest | null>({
    queryKey: queryKeys.fragmentByName(name, collection, locale),
    queryFn: () => client.getFragmentByName(name, collection, locale),
    enabled: !!name,
  });
}

// ===== Data Hooks =====

export function useData(collection?: string, locale?: string) {
  const client = getContentAPIClient();

  return useQuery<ContentListResult>({
    queryKey: queryKeys.data(collection, locale),
    queryFn: () => client.getData(collection, locale),
  });
}

export function useDataByName(name: string, collection: string, locale?: string) {
  const client = getContentAPIClient();

  return useQuery<ContentManifest | null>({
    queryKey: queryKeys.dataByName(name, collection, locale),
    queryFn: () => client.getDataByName(name, collection, locale),
    enabled: !!name && !!collection,
  });
}

export function useDataNameAvailability(name: string, collection: string, excludeId?: string) {
  const client = getContentAPIClient();

  return useQuery({
    queryKey: queryKeys.dataNameAvailability(name, collection, excludeId),
    queryFn: async () => {
      const available = await client.isDataNameAvailable(name, collection, excludeId);
      return { available };
    },
    enabled: !!name && !!collection,
    staleTime: 0,
    gcTime: 0,
  });
}

export function useDataCollections() {
  const client = getContentAPIClient();

  return useQuery<string[]>({
    queryKey: queryKeys.dataCollections(),
    queryFn: () => client.getDataCollections(),
  });
}

// ===== Data Context Hooks =====

/** Whether two values are equal by value, Dates compared by their time. */
function isSameValue<T>(a: T, b: T): boolean {
  if (a instanceof Date || b instanceof Date) {
    return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
  }
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
    return Object.is(a, b);
  }
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const entries = Object.entries(a);
  return (
    entries.length === Object.keys(b).length &&
    entries.every(([key, value]) => {
      const descriptor = Object.getOwnPropertyDescriptor(b, key);
      return descriptor !== undefined && isSameValue(value, descriptor.value);
    })
  );
}

/**
 * The data context the published page gets for `page`, built in the browser
 * from the site's routing bindings. Waits while either is unknown; null when
 * no route serves the page's collection, since a query cannot hold undefined.
 * A refetch that finds nothing changed hands back the context already held,
 * so work keyed on it, such as resolving the page's blocks, does not run again.
 */
export function useDataContext(page: PageReference | undefined, bindings: EditorDataBindings | undefined) {
  const client = getContentAPIClient();
  const collection = page?.collection;
  // The page is joined on read, not fetched: a Page settings save changes the
  // page but not what its route binds, so it must not fetch the feed again.
  const withPage = useCallback(
    (routeData: RouteData | null): DataContext | null => (routeData && page ? { ...routeData, page } : null),
    [page],
  );

  return useQuery<RouteData | null, Error, DataContext | null>({
    queryKey: queryKeys.dataContext(collection, bindings),
    queryFn: async () => {
      // A manual refetch can run a disabled query before its inputs arrive.
      if (!collection || !bindings) return null;
      return (await buildRouteData(client, collection, bindings)) ?? null;
    },
    enabled: !!collection && !!bindings,
    select: withPage,
    // The cache's own sharing keeps unchanged plain objects and arrays only,
    // so it would take the page timestamps (Dates) for a change every time.
    structuralSharing: (held, fetched) => (isSameValue(held, fetched) ? held : fetched),
  });
}

// ===== Global Hooks =====

export function useAllContent(filters?: GlobalFilters) {
  const client = getContentAPIClient();

  return useQuery<ContentListResult>({
    queryKey: queryKeys.allContent(filters),
    queryFn: () => client.listAllContent(filters),
  });
}

export function useUntranslatedContent(targetLocale: string, excludeSites?: string[], includeUnpublished?: boolean) {
  const client = getContentAPIClient();

  return useQuery<ContentListResult>({
    queryKey: queryKeys.untranslatedContent(targetLocale, excludeSites, includeUnpublished),
    queryFn: () => client.findUntranslatedContent(targetLocale, excludeSites, includeUnpublished),
  });
}

export function useSitesConfig() {
  const client = getContentAPIClient();

  return useQuery<SitesConfig>({
    queryKey: queryKeys.sitesConfig(),
    queryFn: () => client.getSitesConfig(),
  });
}

// ===== Auth Hooks =====

export function useCurrentUser() {
  const client = getContentAPIClient();

  return useQuery({
    queryKey: queryKeys.currentUser(),
    queryFn: () => client.getCurrentUser(),
    staleTime: 60000, // Cache for 1 minute (user doesn't change often)
  });
}

// ===== Batch Operations =====

export function useBatchUpdate() {
  const client = getContentAPIClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (operations: UpdateLocaleInput[]) => {
      const result = await client.batchUpdate(operations);

      // Fetch updated content for successful operations
      if (result.operations && result.updated > 0) {
        const updatedContents = await Promise.all(
          result.operations.map(async (opResult, index) => {
            if (opResult.updated) {
              const op = operations[index];
              const updated = await client.getLocalized(op.id, op.locale);
              return { index, content: updated };
            }
            return null;
          }),
        );

        return {
          ...result,
          updatedContents: updatedContents.filter(
            (item): item is { index: number; content: LocalizedEntry } => item !== null,
          ),
        };
      }

      return result;
    },
    onSuccess: (result, variables) => {
      if ('updatedContents' in result && result.updatedContents) {
        // Update caches with the fetched server data
        result.updatedContents.forEach(({ index, content }) => {
          if (!content) return;

          const operation = variables[index];

          // Update localized content
          queryClient.setQueryData(queryKeys.localized(operation.id, operation.locale), content);

          // Update full content entry
          queryClient.setQueryData(queryKeys.content(operation.id), (old: ContentEntry | null | undefined) => {
            if (!old) return old;
            return {
              ...old,
              locales: {
                ...old.locales,
                [operation.locale]: content.localized,
              },
            };
          });
        });

        // Update list queries with server data
        const updatedMap = new Map(
          result.updatedContents.map(({ index, content }) => {
            const op = variables[index];
            return [`${op.id}:${op.locale}`, content];
          }),
        );

        const updateListQueries = (old: ContentListResult | undefined) => {
          if (!isContentListResult(old)) return old;
          return {
            ...old,
            items: old.items.map((item) => {
              const hasUpdate = Object.keys(item.locales).some((locale) => updatedMap.has(`${item.id}:${locale}`));

              if (hasUpdate) {
                const newLocales = { ...item.locales };
                Object.keys(newLocales).forEach((locale) => {
                  const updated = updatedMap.get(`${item.id}:${locale}`);
                  if (updated) {
                    const { content, ...manifestData } = updated.localized;
                    newLocales[locale] = keepUnpublishedMarker(newLocales[locale], manifestData);
                  }
                });
                return { ...item, locales: newLocales };
              }

              return item;
            }),
          };
        };

        queryClient.setQueriesData({ queryKey: ['sites'], exact: false }, updateListQueries);

        queryClient.setQueriesData({ queryKey: ['fragments'], exact: false }, updateListQueries);

        queryClient.setQueriesData({ queryKey: ['data'], exact: false }, updateListQueries);
      }
    },
  });
}

// ===== Git Hooks =====

export function useGitStatus() {
  const client = getContentAPIClient();

  return useQuery<GitStatus>({
    queryKey: queryKeys.gitStatus(),
    queryFn: () => client.getGitStatus(),
    refetchInterval: 10000,
    staleTime: 5000,
  });
}

export function useCommitChanges() {
  const queryClient = useQueryClient();
  const client = getContentAPIClient();

  return useMutation({
    mutationFn: (message: string | undefined) => client.commitChanges(message),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.gitStatus() });
    },
  });
}

export function usePushChanges() {
  const queryClient = useQueryClient();
  const client = getContentAPIClient();

  return useMutation({
    mutationFn: () => client.pushChanges(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.gitStatus() });
    },
  });
}

export function usePullChanges() {
  const queryClient = useQueryClient();
  const client = getContentAPIClient();

  return useMutation({
    mutationFn: () => client.pullChanges(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.gitStatus() });
    },
  });
}

// ===== Asset Hooks =====

export function useAssets() {
  const client = getContentAPIClient();

  return useQuery<{ assets: AssetEntry[] }>({
    queryKey: queryKeys.assets(),
    queryFn: () => client.listAssets(),
  });
}

export function useAsset(path: string) {
  const client = getContentAPIClient();

  return useQuery<AssetEntry | null>({
    queryKey: queryKeys.asset(path),
    queryFn: () => client.getAsset(path),
    enabled: !!path,
  });
}

export function useUploadAsset() {
  const client = getContentAPIClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (formData: FormData) => client.uploadAsset(formData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.assets() });
      queryClient.invalidateQueries({ queryKey: ['asset-folders'] });
      queryClient.invalidateQueries({ queryKey: queryKeys.folderTree() });
    },
  });
}

export function useImportAssetUrl() {
  const client = getContentAPIClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ url, alt, folder }: { url: string; alt?: string; folder?: string }) =>
      client.importAssetUrl(url, alt, folder),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.assets() });
      queryClient.invalidateQueries({ queryKey: ['asset-folders'] });
      queryClient.invalidateQueries({ queryKey: queryKeys.folderTree() });
    },
  });
}

export function useDeleteAsset() {
  const client = getContentAPIClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (path: string) => client.deleteAsset(path),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.assets() });
      queryClient.invalidateQueries({ queryKey: ['asset-folders'] });
      queryClient.invalidateQueries({ queryKey: queryKeys.folderTree() });
    },
  });
}

export function useBulkDeleteAssets() {
  const client = getContentAPIClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (paths: string[]) => {
      let successCount = 0;
      let failCount = 0;
      for (const path of paths) {
        try {
          await client.deleteAsset(path);
          successCount++;
        } catch {
          failCount++;
        }
      }
      return { successCount, failCount };
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.assets() });
      queryClient.invalidateQueries({ queryKey: ['asset-folders'] });
      queryClient.invalidateQueries({ queryKey: queryKeys.folderTree() });
    },
  });
}

// ===== Media Library Hooks =====

export function useAssetFolders(path?: string) {
  const client = getContentAPIClient();

  return useQuery<FolderListing>({
    queryKey: queryKeys.assetFolders(path),
    queryFn: () => client.listFolder(path),
  });
}

export function useCreateFolder() {
  const client = getContentAPIClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (path: string) => client.createFolder(path),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['asset-folders'] });
      queryClient.invalidateQueries({ queryKey: queryKeys.folderTree() });
    },
  });
}

export function useUpdateAssetMetadata() {
  const client = getContentAPIClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ path, updates }: { path: string; updates: AssetMetadataPatch }) =>
      client.updateAssetMetadata(path, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.assets() });
      queryClient.invalidateQueries({ queryKey: ['asset-folders'] });
    },
  });
}

export function useAssetUsage(path: string | null) {
  const client = getContentAPIClient();

  return useQuery<AssetUsage[]>({
    queryKey: queryKeys.assetUsage(path),
    queryFn: () => client.getAssetUsage(path!),
    enabled: !!path,
    // Asked again each time: a page saved since the last answer may link the asset now
    staleTime: 0,
  });
}

export function useFolderTree() {
  const client = getContentAPIClient();

  return useQuery<{ tree: FolderTreeNode[] }>({
    queryKey: queryKeys.folderTree(),
    queryFn: () => client.getFolderTree(),
    staleTime: 30_000, // Cache for 30 seconds
  });
}

export function useMoveAssets() {
  const client = getContentAPIClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      filenames,
      sourceFolder,
      targetFolder,
    }: {
      filenames: string[];
      sourceFolder: string;
      targetFolder: string;
    }) => client.moveAssets(filenames, sourceFolder, targetFolder),
    onSuccess: () => {
      // Invalidate all folder-related queries to refresh counts and listings
      queryClient.invalidateQueries({ queryKey: queryKeys.assets() });
      queryClient.invalidateQueries({ queryKey: ['asset-folders'] });
      queryClient.invalidateQueries({ queryKey: queryKeys.folderTree() });
    },
  });
}

export type { GitCommitResult, GitPullResult, GitPushResult, GitStatus };
// Re-export for convenience
export { APIClientError, ContentAPIClient, StaleWriteError };
