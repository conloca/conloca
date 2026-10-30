/**
 * Pure project-health helpers shared with the conloca CLI (doctor, page create,
 * asset add and routes) and the editor-page build. This entry must stay a leaf:
 * node:fs, node:path and node:url only, so importing it never pulls in the
 * astro integration graph.
 */
export { deriveAssetRefBase } from './asset-ref-base.js';
export {
  CONTENT_CONFIG_SNIPPET,
  type ContentConfigProblem,
  findContentConfig,
  findContentConfigProblem,
} from './lib/content-config-guard.js';
export {
  type AstroI18nLocales,
  collectStaticPageRoutes,
  nonDefaultLocalesOf,
  type StaticPageRoute,
  type StaticPageRoutesInput,
} from './lib/static-page-routes.js';
