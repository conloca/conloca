import type {
  ContentEntry,
  ContentListResult,
  ContentManifest,
  CreateContentInput,
  GlobalFilters,
  LocalizedEntry,
  UpdateLocaleInput,
} from '@conloca/content-api';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { APIClientError, ContentAPIClient, StaleWriteError } from './client';

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

// ===== Query Keys =====
const queryKeys = {
  content: (id: string) => ['content', id] as const,
  localized: (id: string, locale: string) => ['content', id, locale] as const,
  sitePages: (site: string, locale?: string) => ['sites', site, 'pages', locale] as const,
  pageByPathname: (site: string, pathname: string, locale?: string) =>
    ['sites', site, 'pathname', pathname, locale] as const,
  pathnameAvailability: (site: string, pathname: string, excludeId?: string) =>
    ['sites', site, 'pathname-availability', pathname, excludeId] as const,
  blocks: (collection?: string, locale?: string) => ['blocks', collection, locale] as const,
  blockByName: (name: string, collection?: string, locale?: string) => ['blocks', name, collection, locale] as const,
  allContent: (filters?: GlobalFilters) => ['content', 'all', filters] as const,
  untranslatedContent: (targetLocale: string, excludeSites?: string[], includeUnpublished?: boolean) =>
    ['content', 'untranslated', targetLocale, excludeSites, includeUnpublished] as const,
  sitesConfig: () => ['sites', 'config'] as const,
};

// ===== Core Content Hooks =====

export function useContent(id: string) {
  const client = getContentAPIClient();

  return useQuery({
    queryKey: queryKeys.content(id),
    queryFn: () => client.getContent(id),
    enabled: !!id,
  });
}

export function useLocalizedContent(id: string, locale: string) {
  const client = getContentAPIClient();

  return useQuery({
    queryKey: queryKeys.localized(id, locale),
    queryFn: () => client.getLocalized(id, locale),
    enabled: !!id && !!locale,
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

        // Update list queries by adding the new item from server data
        const newManifest: ContentManifest = {
          id: result.fullContent.id,
          type: result.fullContent.type,
          kind: result.fullContent.kind,
          site: result.fullContent.site,
          collection: result.fullContent.collection,
          locales: Object.entries(result.fullContent.locales).reduce(
            (acc, [locale, localeData]) => {
              const { content, ...manifestData } = localeData;
              acc[locale] = manifestData;
              return acc;
            },
            {} as ContentManifest['locales'],
          ),
        };

        if (variables.kind === 'page' && variables.site) {
          queryClient.setQueriesData(
            { queryKey: queryKeys.sitePages(variables.site) },
            (old: ContentListResult | undefined) => {
              if (!old) return old;
              return {
                ...old,
                items: [...old.items, newManifest],
                total: old.total + 1,
              };
            },
          );
        } else if (variables.kind === 'block') {
          // Invalidate all block queries to ensure the new block appears everywhere
          queryClient.invalidateQueries({ queryKey: ['blocks'] });
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

        // Update list queries to reflect the server data
        const updateListQueries = (old: ContentListResult | undefined) => {
          if (!old) return old;
          return {
            ...old,
            items: old.items.map((item) =>
              item.id === variables.id
                ? {
                    ...item,
                    locales: {
                      ...item.locales,
                      [variables.locale]: {
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
                      },
                    },
                  }
                : item,
            ),
          };
        };

        queryClient.setQueriesData({ queryKey: ['sites'], exact: false }, updateListQueries);

        queryClient.setQueriesData({ queryKey: ['blocks'], exact: false }, updateListQueries);
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
            if (!old) return old;
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
          queryClient.setQueriesData({ queryKey: ['blocks'], exact: false }, updateListQueries);
          queryClient.setQueriesData({ queryKey: ['content', 'all'], exact: false }, updateListQueries);
        } else {
          // For full deletion, remove from cache
          queryClient.removeQueries({ queryKey: queryKeys.content(variables.id) });
          queryClient.removeQueries({ queryKey: ['content', variables.id], exact: false });

          // Update list queries by removing the deleted item
          queryClient.setQueriesData({ queryKey: ['sites'], exact: false }, (old: ContentListResult | undefined) => {
            if (!old) return old;
            const newItems = old.items.filter((item) => item.id !== variables.id);
            return {
              ...old,
              items: newItems,
              total: newItems.length < old.items.length ? old.total - 1 : old.total,
            };
          });

          // Update block lists
          queryClient.setQueriesData({ queryKey: ['blocks'], exact: false }, (old: ContentListResult | undefined) => {
            if (!old) return old;
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
              if (!old) return old;
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

  return useQuery({
    queryKey: queryKeys.sitePages(site, locale),
    queryFn: () => client.getSitePages(site, locale),
  });
}

export function usePageByPathname(site: string, pathname: string, locale?: string) {
  const client = getContentAPIClient();

  return useQuery({
    queryKey: queryKeys.pageByPathname(site, pathname, locale),
    queryFn: () => client.getPageByPathname(site, pathname, locale),
    enabled: !!pathname,
  });
}

export function usePathnameAvailability(site: string, pathname: string, excludeId?: string) {
  const client = getContentAPIClient();

  return useQuery({
    queryKey: queryKeys.pathnameAvailability(site, pathname, excludeId),
    queryFn: async () => {
      const available = await client.isPathnameAvailable(site, pathname, excludeId);
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

// ===== Block Hooks =====

export function useBlocks(collection?: string, locale?: string) {
  const client = getContentAPIClient();

  return useQuery({
    queryKey: queryKeys.blocks(collection, locale),
    queryFn: () => client.getBlocks(collection, locale),
  });
}

export function useBlockByName(name: string, collection?: string, locale?: string) {
  const client = getContentAPIClient();

  return useQuery({
    queryKey: queryKeys.blockByName(name, collection, locale),
    queryFn: () => client.getBlockByName(name, collection, locale),
    enabled: !!name,
  });
}

// ===== Global Hooks =====

export function useAllContent(filters?: GlobalFilters) {
  const client = getContentAPIClient();

  return useQuery({
    queryKey: queryKeys.allContent(filters),
    queryFn: () => client.listAllContent(filters),
  });
}

export function useUntranslatedContent(targetLocale: string, excludeSites?: string[], includeUnpublished?: boolean) {
  const client = getContentAPIClient();

  return useQuery({
    queryKey: queryKeys.untranslatedContent(targetLocale, excludeSites, includeUnpublished),
    queryFn: () => client.findUntranslatedContent(targetLocale, excludeSites, includeUnpublished),
  });
}

export function useSitesConfig() {
  const client = getContentAPIClient();

  return useQuery({
    queryKey: queryKeys.sitesConfig(),
    queryFn: () => client.getSitesConfig(),
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

          const operation = variables[index!];

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
            const op = variables[index!];
            return [op.id + ':' + op.locale, content];
          }),
        );

        const updateListQueries = (old: ContentListResult | undefined) => {
          if (!old) return old;
          return {
            ...old,
            items: old.items.map((item) => {
              const hasUpdate = Object.keys(item.locales).some((locale) => updatedMap.has(item.id + ':' + locale));

              if (hasUpdate) {
                const newLocales = { ...item.locales };
                Object.keys(newLocales).forEach((locale) => {
                  const updated = updatedMap.get(item.id + ':' + locale);
                  if (updated) {
                    const { content, ...manifestData } = updated.localized;
                    newLocales[locale] = manifestData;
                  }
                });
                return { ...item, locales: newLocales };
              }

              return item;
            }),
          };
        };

        queryClient.setQueriesData({ queryKey: ['sites'], exact: false }, updateListQueries);

        queryClient.setQueriesData({ queryKey: ['blocks'], exact: false }, updateListQueries);
      }
    },
  });
}

// Re-export for convenience
export { ContentAPIClient, StaleWriteError, APIClientError };
