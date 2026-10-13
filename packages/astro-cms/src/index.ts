// Astro integration for Conloca CMS

// MDX component registry plugin API — hosts use these to register JSX
// components (e.g. Starlight's Steps/Tabs/Card) with typed insert editors
// and opt-in auto-import injection. Runtime registry also wires through
// the schemasPath option; hosts export `mdxComponents` from the same file.
//
// `readStringAttribute` / `writeStringAttribute` are mdast-level helpers
// for hosts writing their own typed `Editor` components — controlled
// inputs against a string prop. Re-exported here so a host's editor file
// can pull everything it needs from one place.
export {
  defineMdxComponents,
  type MdxComponentDescriptor,
  type MdxComponentInsertHint,
  type MdxComponentProp,
  type MdxComponents,
  type MdxJsxComponentDescriptor,
  type MdxSnippetDescriptor,
  readStringAttribute,
  writeStringAttribute,
} from '@conloca/cms-spa/mdx-components-define';
// Page-schema plugin API — hosts use these to declare frontmatter form UI
// for the CMS page-settings dialog. Runtime registry lives in @conloca/cms-spa
// and is wired by the schemasPath option (see ConlocaCMSOptions).
export {
  type CoreFieldsMode,
  definePageSchema,
  type FieldHint,
  type FieldHintCommon,
  type FieldHints,
  type FieldHintVariant,
  type PageSchemaDescriptor,
  type PageSchemaEntry,
  type PageSchemaGroup,
  type PageSchemas,
} from '@conloca/cms-spa/page-schema-define';
// Blocks mark the parts they render from the page's settings, so a click on
// the editor canvas opens Page settings at that field.
export {
  type PageSettingAttributes,
  type PageSettingName,
  pageSettingAttributes,
} from '@conloca/cms-spa/page-setting-attributes';
// Re-export Zod schemas and types for convenience
export {
  type FragmentMeta,
  fragmentMetaSchema,
  type PageMeta,
  pageMetaSchema,
} from '@conloca/content-api/schemas';
// Read-only ContentAPI over the build's content collections.
export {
  type CollectionBackedContentAPIOptions,
  createCollectionBackedContentAPI,
} from './handlers/collection-content-api.js';
// `scanForHydratableComponents` lives in '@conloca/astro-cms/node' — it
// imports fast-glob and node:fs, which crash when this barrel is
// dynamic-imported in the browser (notably by the CMS SPA's schemas
// loader). Hosts that need it import from the /node subpath.
// Type-only export for sites that want to customize hydration
export type { ComponentRegistry } from './lib/hydration-script.js';
export {
  findHydratableComponents,
  type HydratableComponent,
  type HydratableComponentConfig,
  hasHydratableComponents,
  isHydratable,
} from './lib/hydration-utils.js';
export {
  entryIdFromPath,
  extractSlugFromPathname,
  isPublished,
  pathnameFromSlug,
  staticPathParams,
  toDate,
} from './lib/route-utils.js';
export { serializeProps } from './lib/serialize-props.js';
// New hydration API: withHydration wrapper and build-time scanner
export { type HydrationMeta, type WithHydrationStrategy, withHydration } from './lib/withHydration.js';
// Locale plumbing helpers — translate framework-native i18n configs
// into Conloca's locale shape. See locales-helpers.ts for the contract.
export { type ConlocaLocales, localesFromAstroI18n, localesFromStarlight } from './locales-helpers.js';
// Hydration support for interactive components
// NOTE: The root entry point is intentionally static-safe.
// Node/Astro integration APIs live under '@conloca/astro-cms/node'.

/**
 * Migration stub: the integration moved to '@conloca/astro-cms/node' so the
 * root entry stays static-safe. Published 0.1.x exported it from the root —
 * without this stub those configs fail with an opaque "not a function".
 *
 * @deprecated Import { conlocaCMS } from '@conloca/astro-cms/node' instead.
 */
export function conlocaCMS(_options?: unknown): never {
  throw new Error(
    "conlocaCMS moved: import { conlocaCMS } from '@conloca/astro-cms/node'. " +
      'The package root stays free of Node-only code so it can load in any runtime.',
  );
}
export type {
  ContentFragmentSectionProps,
  DataCollectionEntry,
  DataContext,
  HydrationStrategy,
  LayoutProps,
  PageData,
  PageReference,
  ResolvedRoutingConfig,
  TemplateConfig,
} from './types.js';
