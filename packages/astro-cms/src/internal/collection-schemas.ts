/**
 * The schemas Conloca's collection factories declare, built in one place so
 * the content config (build) and a draft preview (server runtime) parse
 * entries with the same schema. Free of Astro's content layer and of the
 * loader's filesystem reader: a preview builds these in a Worker, where the
 * site's content config itself cannot be evaluated.
 */

import type { DataSchemas, PageSchemas } from '@conloca/cms-spa/page-schema-define';
import { dataMetaSchema, fragmentMetaSchema } from '@conloca/content-api/schemas';
import { z } from 'zod';
import { ALL_FRAGMENTS_COLLECTION } from '../handlers/page-render-core.js';
import type { ResolvedRoutingConfig } from '../types.js';
import { buildPageCollectionSchema, hostFieldsFromPageSchemas } from './page-collection-schema.js';

/** The schema of a conlocaPages() collection declared with `pageSchemas`. */
export function pageCollectionSchema(pageSchemas: PageSchemas | undefined) {
  return buildPageCollectionSchema(pageSchemas ? hostFieldsFromPageSchemas(pageSchemas) : z.object({}));
}

/**
 * The schema of a conlocaData() collection: base meta plus the collection's
 * payload under `data`. `data` stays optional: an entry saved before any
 * payload exists is not an error.
 */
export function dataCollectionSchema<T extends z.ZodObject<z.ZodRawShape>>(payload: T) {
  return z.looseObject({ ...dataMetaSchema.shape, data: payload.optional() });
}

/** The schema of every conlocaFragments() collection, the aggregate included. */
export const fragmentCollectionSchema = fragmentMetaSchema.loose();

/** What the site's `contentSchemasPath` module exports: the inputs its content config hands the factories. */
export interface ContentSchemas {
  pageSchemas?: PageSchemas;
  dataSchemas?: DataSchemas;
}

/**
 * The schema of each collection a page render reads — its routes' page
 * collections, their bound data collections and the fragments aggregate —
 * built as conlocaPages / conlocaData / conlocaFragments build them. A site
 * without `contentSchemasPath` gets the schemas those factories declare with
 * no host input: Conloca's own fields are parsed (publish dates become Dates),
 * host page fields are not validated and data payloads pass as they are.
 */
export function previewCollectionSchemas(
  routing: ResolvedRoutingConfig,
  { pageSchemas, dataSchemas }: ContentSchemas,
): Record<string, z.ZodType> {
  const schemas: Record<string, z.ZodType> = { [ALL_FRAGMENTS_COLLECTION]: fragmentCollectionSchema };
  const pages = pageCollectionSchema(pageSchemas);
  for (const route of Object.values(routing.routes)) {
    schemas[route.collection] = pages;
    for (const name of route.dataBindings.collections ?? []) {
      const payload = dataSchemas?.[name];
      schemas[name] = payload ? dataCollectionSchema(payload) : dataMetaSchema.loose();
    }
  }
  return schemas;
}
