import { defineCollection } from 'astro:content';
import { createContentAPI } from '@conloca/content-api/node';
import { blockMetaSchema, dataMetaSchema, pageMetaSchema } from '@conloca/content-api/schemas';
import { conlocaLoader } from './loader';

/**
 * Options for createConlocaCollections().
 */
export interface CreateConlocaCollectionsOptions {
  /** Path to content root directory. @default './content' */
  contentRoot?: string;
  /** Site name for multi-site setups. @default 'default' */
  site?: string;
}

/**
 * Return type of createConlocaCollections().
 */
export interface ConlocaCollectionsResult {
  /** Astro Content Collections definitions - export this as `collections` */
  collections: Record<string, ReturnType<typeof defineCollection>>;
}

/**
 * Creates Astro Content Collections by discovering from indexed content.
 * Uses content-api to find collections that have content.
 *
 * @example
 * ```typescript
 * // src/content.config.ts
 * import { createConlocaCollections } from '@conloca/astro-cms/node/content';
 *
 * export const { collections } = await createConlocaCollections();
 * ```
 */
export async function createConlocaCollections(
  options: CreateConlocaCollectionsOptions = {},
): Promise<ConlocaCollectionsResult> {
  const { contentRoot = './content', site = 'default' } = options;

  const api = await createContentAPI({ contentRoot });
  const collections: Record<string, ReturnType<typeof defineCollection>> = {};

  // Add block collections
  for (const name of api.blocks.collections) {
    collections[name] = defineCollection({
      loader: conlocaLoader({ collection: name, contentRoot, site, kind: 'block' }),
      // Cast needed: Astro uses Zod v3 BaseSchema types, our schemas are Zod v4
      schema: blockMetaSchema.passthrough() as never,
    });
  }

  // Add data collections
  for (const name of api.data.collections) {
    collections[name] = defineCollection({
      loader: conlocaLoader({ collection: name, contentRoot, site, kind: 'data' }),
      schema: dataMetaSchema.passthrough() as never,
    });
  }

  // Add page collections for this site
  const siteCollections = api.getSite(site)?.collections ?? new Set<string>();
  for (const name of siteCollections) {
    collections[name] = defineCollection({
      loader: conlocaLoader({ collection: name, contentRoot, site, kind: 'page' }),
      schema: pageMetaSchema.passthrough() as never,
    });
  }

  return { collections };
}
