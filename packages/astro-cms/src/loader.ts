import { createContentAPI } from '@conloca/content-api/reader';
import type { Loader, LoaderContext } from 'astro/loaders';

export interface ConlocaLoaderOptions {
  /** Must equal the content.config key this loader is mounted under — load() asserts it. */
  collection?: string;
  contentRoot: string;
  site?: string;
  /** Collection kind. If not provided, defaults to 'fragment' for 'fragments' collection, 'page' otherwise. */
  kind?: 'page' | 'fragment' | 'data';
}

/**
 * Custom Astro content loader for Conloca CMS.
 * Loads content from the Conloca content directory into Astro collections.
 */
export function conlocaLoader(options: ConlocaLoaderOptions): Loader {
  return {
    name: 'conloca-loader',
    async load(context: LoaderContext): Promise<void> {
      const { store, parseData, generateDigest, logger } = context;

      // The config key IS the name Astro types and queries; a mismatched
      // mount (`landing: conlocaPages(...)`) would silently serve another
      // collection's content under the wrong name.
      if (options.collection && context.collection !== options.collection) {
        throw new Error(
          `[conloca] collection mismatch: this loader is mounted under "${context.collection}" ` +
            `but loads "${options.collection}". The content.config key must match the Conloca collection name.`,
        );
      }

      // Create content API instance
      const api = await createContentAPI({ contentRoot: options.contentRoot });

      // Use provided kind, or fall back to inferring from collection name
      const kind = options.kind ?? (options.collection === 'fragments' ? 'fragment' : 'page');

      // List all content for this collection
      // Note: fragments and data don't have a site, so only pass site for pages
      const content = Array.from(
        api.listAllContent({
          collection: options.collection,
          kind,
          site: kind === 'page' ? options.site : undefined,
        }),
      );

      store.clear();

      for (const manifest of content) {
        // Skip type:'mdx' pages — they're owned by an external renderer
        // (any Astro loader reading from a site's `mdxPages` path in
        // sites.json, such as Starlight's stock docsLoader) and would
        // otherwise collide with the puck-page route handler.
        if (kind === 'page' && manifest.type === 'mdx') continue;

        for (const [locale, localeVersion] of Object.entries(manifest.locales)) {
          if (!localeVersion) continue;

          const entryId = `${manifest.id}/${locale}`;

          // For data and page collections, fetch full content to get the actual content fields
          let dataContent: Record<string, unknown> | undefined;
          let mdxContent: string | undefined;
          let puckData: unknown | undefined;

          if (kind === 'data') {
            const fullContent = await api.getLocalized(manifest.id, locale);
            if (fullContent?.localized.content?.data) {
              dataContent = fullContent.localized.content.data;
            }
          } else if (kind === 'fragment') {
            const fullContent = await api.getLocalized(manifest.id, locale);
            if (fullContent?.localized.content?.mdx) {
              mdxContent = fullContent.localized.content.mdx;
            }
          } else if (kind === 'page') {
            // For page collections, fetch full content to get puckData
            // This enables getCollection('pages') to return entries with puckData included
            const fullContent = await api.getLocalized(manifest.id, locale);
            if (fullContent?.localized.content?.puckData) {
              puckData = fullContent.localized.content.puckData;
            }
          }

          // Any key added here that is not part of pageMetaSchema must also be
          // listed in LOADER_RESERVED_FIELDS (internal/page-collection-schema.ts),
          // or a host page-meta field of the same name will replace it on every page.
          const data: Record<string, unknown> = {
            id: manifest.id,
            locale,
            ...(localeVersion.pathname && { pathname: localeVersion.pathname }),
            ...(localeVersion.name && { name: localeVersion.name }),
            ...localeVersion.meta,
            created: localeVersion.created,
            modified: localeVersion.modified,
            publishAt: localeVersion.publishAt,
            unpublishAt: localeVersion.unpublishAt,
            // Include the data content for data collections
            ...(dataContent && { data: dataContent }),
          };

          if (mdxContent !== undefined) {
            data.mdx = mdxContent;
          }

          // Include puckData for page collections (added separately to avoid spread type issues)
          if (puckData !== undefined) {
            data.puckData = puckData;
          }

          // filePath feeds Astro's error location: without it a validation
          // failure names only the opaque content id, not a file to open.
          const parsedData = await parseData({
            id: entryId,
            data,
            ...(localeVersion.sourcePath ? { filePath: localeVersion.sourcePath } : {}),
          });

          store.set({
            id: entryId,
            data: parsedData,
            digest: generateDigest(localeVersion.etag),
          });
        }
      }

      logger.info(`Loaded ${store.keys().length} entries from ${options.collection || `${kind} content`}`);
    },
  };
}
