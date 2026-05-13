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
  readStringAttribute,
  writeStringAttribute,
} from '@conloca/cms-spa/mdx-components';
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
} from '@conloca/cms-spa/page-schemas';
// Re-export Zod schemas and types for convenience
export {
  type BlockMeta,
  blockMetaSchema,
  type PageMeta,
  pageMetaSchema,
} from '@conloca/content-api/schemas';
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
export { extractSlugFromPathname, isPublished, pathnameFromSlug, toDate } from './lib/route-utils.js';
export { serializeProps } from './lib/serialize-props.js';
// New hydration API: withHydration wrapper and build-time scanner
export { type HydrationMeta, type WithHydrationStrategy, withHydration } from './lib/withHydration.js';
// Locale plumbing helpers — translate framework-native i18n configs
// into Conloca's locale shape. See locales-helpers.ts for the contract.
export { type ConlocaLocales, localesFromAstroI18n, localesFromStarlight } from './locales-helpers.js';
// Hydration support for interactive components
// NOTE: The root entry point is intentionally static-safe.
// Node/Astro integration APIs live under '@conloca/astro-cms/node'.
export type {
  DataCollectionEntry,
  HydrationStrategy,
  LayoutProps,
  PageData,
  PageReference,
  ResolvedRoutingConfig,
  TemplateConfig,
} from './types.js';
