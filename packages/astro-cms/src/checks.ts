/**
 * Pure project-health helpers shared with external tooling (the conloca CLI's
 * doctor command). This entry must stay a leaf: node:fs and node:path only,
 * so importing it never pulls in the astro integration graph.
 */
export {
  CONTENT_CONFIG_SNIPPET,
  type ContentConfigProblem,
  findContentConfigProblem,
} from './lib/content-config-guard.js';
