import { getCollection } from 'astro:content';
import routingConfig from 'virtual:conloca-routing-config';
import { createCollectionContentSource, getPagesByPrefix as readPagesByPrefix } from './handlers/page-render-core.js';
import type { DataBindingConfig, PageReference } from './types.js';

/** How to order and cap the list, plus the language to read; the site's own language by default. */
export type PageFeedOptions = Omit<NonNullable<DataBindingConfig['pages']>, 'prefix'> & { locale?: string };

/**
 * The same list a route's `dataBindings.pages` hands its blocks as
 * `DataContext.pages`: one language, published pages only, newest publish date
 * first unless `sort` says otherwise, and metadata without the fields the
 * content store keeps for itself.
 */
export async function getPagesByPrefix(prefix: string, options: PageFeedOptions = {}): Promise<PageReference[]> {
  // With routing off there are no page collections to read and no resolved
  // language, so the list would come back empty with nothing to say why.
  if (!routingConfig.enabled) {
    throw new Error(
      `[Conloca] getPagesByPrefix('${prefix}') found no content routes: pass \`layout\` or \`routing\` to conlocaCMS() in astro.config.`,
    );
  }
  const { locale = routingConfig.locale, ...order } = options;
  const source = createCollectionContentSource({ getCollection, isDev: import.meta.env.DEV });
  return readPagesByPrefix(source, prefix, locale, routingConfig, order);
}
