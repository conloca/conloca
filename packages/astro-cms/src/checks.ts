/**
 * Pure project-health helpers shared with external tooling (the conloca CLI's
 * doctor, page create and asset add commands). This entry must stay a leaf:
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
