/**
 * The entry parsers a draft preview runs, built from the same inputs and the
 * same builders conlocaPages, conlocaData and conlocaFragments hand their
 * loaders, so a preview record gets the values the build stores. Free of
 * Astro's content layer and of the loader's filesystem reader: a preview
 * builds these in a server runtime, where the site's content config itself
 * cannot be evaluated.
 */

import type { DataSchemas, PageSchemas } from '@conloca/cms-spa/page-schema-define';
import { parseLooseDataMeta } from '@conloca/content-api/schemas';
import { ALL_FRAGMENTS_COLLECTION } from '../handlers/collection-names.js';
import type { ResolvedRoutingConfig } from '../types.js';
import {
  createDataEntryParser,
  createPageEntryParser,
  type EntryParser,
  parseFragmentEntry,
} from './entry-validation.js';

/** What the site's `contentSchemasPath` module exports: the inputs its content config hands the factories. */
export interface ContentSchemas {
  pageSchemas?: PageSchemas;
  dataSchemas?: DataSchemas;
}

/**
 * The entry parser of each collection a page render reads — its routes' page
 * collections, their bound data collections and the fragments aggregate. A
 * site without `contentSchemasPath` gets the parsers those factories build
 * with no host input: Conloca's own fields are parsed (publish dates become
 * Dates), host page fields are not validated and data payloads pass as they
 * are.
 */
export function previewEntryParsers(
  routing: ResolvedRoutingConfig,
  { pageSchemas, dataSchemas }: ContentSchemas,
): Record<string, EntryParser<Record<string, unknown>>> {
  const parsers: Record<string, EntryParser<Record<string, unknown>>> = {
    [ALL_FRAGMENTS_COLLECTION]: parseFragmentEntry,
  };
  const parsePage = createPageEntryParser(pageSchemas);
  for (const route of Object.values(routing.routes)) {
    parsers[route.collection] = parsePage;
    for (const name of route.dataBindings.collections ?? []) {
      const payload = dataSchemas?.[name];
      parsers[name] = payload ? createDataEntryParser(payload) : parseLooseDataMeta;
    }
  }
  return parsers;
}
