// The MDX component registry scan, for any build-time caller, so it runs the
// same discovery implementation as the dev endpoint.
export { discoverMdxComponents, type MdxRegistryScanOptions, toPortableImports } from '../src/discovery/discover.js';
export type { DiscoveredComponent } from '../src/discovery/merge-registry.js';
// The editor descriptors conlocaCMS publishes during a build.
export {
  EDITOR_DESCRIPTORS_ENV_VAR,
  type EditorDescriptorChannel,
  readEditorDescriptors,
} from '../src/editor-descriptors.js';
export { type HydrationDiscovery, scanForHydratableComponents } from '../src/lib/hydration-scanner.js';
export { type ConlocaLocales, localesFromAstroI18n, localesFromStarlight } from '../src/locales-helpers.js';
export { type ConlocaCMSOptions, conlocaCMS } from '../src/plugin-spa.js';
// Pure HTML→wrapper-shape heuristic, for any build-time caller, so it runs
// the same find-wrapper implementation as the dev endpoint.
export {
  type ContentWrapperInfo,
  type DiscoveredWrappers,
  findContentWrapper,
} from '../src/site-styles/content-wrapper-endpoint.js';
// Sitemap entries for CMS pages, which a sitemap cannot find by itself when they render on demand.
export { type AstroUrlSettings, type ConlocaSitemapOptions, conlocaSitemapOptions } from '../src/sitemap-options.js';
