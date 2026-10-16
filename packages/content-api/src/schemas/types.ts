/**
 * Content metadata shapes the CMS reads and writes.
 *
 * These were Zod schema objects (`pageMetaSchema`, `dataMetaSchema`, …) until
 * the Typia migration. They are now plain TypeScript types: `./validators`
 * carries the generated validators, `./normalize` carries the coercion and
 * key-stripping the Zod schemas used to perform. `@conloca/astro-cms` validates
 * collection entries with the same generated validators inside its loader.
 *
 * Optional fields also admit an explicit `undefined`, as the `z.infer` types
 * they replaced did, so consumers compiling with `exactOptionalPropertyTypes`
 * keep accepting `{ description: undefined }`. The closed shapes are type
 * aliases, not interfaces, for the same reason: like the `z.infer` aliases,
 * they stay assignable to `Record<string, unknown>`.
 */

// ===== Page =====

/**
 * Page metadata — editable fields only. Used by CMS forms for dynamic form
 * generation; the form-field descriptors live in the CMS package.
 */
export type PageEditable = {
  /** Page title for SEO and browser tab. */
  title: string;
  /** Meta description for search engines. */
  description?: string | undefined;
  /** URL path (e.g. `/about`). */
  pathname: string;
  /** Schedule publish date/time. */
  publishAt?: Date | null | undefined;
  /** Schedule unpublish date/time. */
  unpublishAt?: Date | null | undefined;
  /** Robots meta tag (e.g. `index, follow`). */
  robots?: string | undefined;
  /** Canonical URL for duplicate content. Validated as a URL. */
  canonical?: string | undefined;
};

/** Full page metadata with the system fields the loader adds. */
export type PageMeta = PageEditable & {
  id: string;
  locale: string;
};

// ===== Fragment =====

/** Fragment metadata — editable fields only. */
export type FragmentEditable = {
  /** Display name for the fragment. */
  title: string;
  /** Brief description of this fragment. */
  description?: string | undefined;
  /** Category for organizing fragments (e.g. headers, cta, content). */
  category?: string | undefined;
  /** Tags for filtering and organization. */
  tags?: string[] | undefined;
};

/** Full fragment metadata with the system fields the loader adds. */
export type FragmentMeta = FragmentEditable & {
  id: string;
  locale: string;
  name: string;
};

// ===== MDX page frontmatter =====

/**
 * Frontmatter of an `mdx`-type page — renderer-neutral.
 *
 * Default for the CMS form when editing an mdx page; projects override via
 * `mdxPages.schema` when they want a renderer-specific shape.
 *
 * Permissive on purpose: the index signature is the Zod `.passthrough()` this
 * replaced — unknown frontmatter keys flow through unchanged so the file's
 * existing fields are never lost on save.
 */
export interface MdxPageFrontmatter {
  /** Page title for SEO and browser tab. */
  title: string;
  /** Meta description for search engines. */
  description?: string | undefined;
  /** Hide the page from production builds. */
  draft?: boolean | undefined;
  [key: string]: unknown;
}

// ===== Data =====

/** Data-entry metadata — editable fields only. */
export type DataEditable = {
  /** Display name for the entry. */
  title: string;
  /** Brief description of this entry. */
  description?: string | undefined;
  /** Category for organizing entries. */
  category?: string | undefined;
  /** Tags for filtering and organization. */
  tags?: string[] | undefined;
};

/**
 * Full data-entry metadata: the editable fields, the system fields the loader
 * adds, and the arbitrary JSON payload under `data`.
 */
export type DataMeta = DataEditable & {
  id: string;
  locale: string;
  name: string;
  data?: Record<string, unknown> | undefined;
};

// ===== Collection entries =====

/**
 * Page metadata as a collection entry carries it: the declared fields validated,
 * every other top-level field (loader-written `created`/`puckData`, host meta)
 * kept as-is. This is what `pageMetaSchema.loose()` accepted.
 */
export interface LoosePageMeta extends PageMeta {
  [key: string]: unknown;
}

/** Fragment metadata with undeclared top-level fields kept (`fragmentMetaSchema.loose()`). */
export interface LooseFragmentMeta extends FragmentMeta {
  [key: string]: unknown;
}

/** Data-entry metadata with undeclared top-level fields kept (`dataMetaSchema.loose()`). */
export interface LooseDataMeta extends DataMeta {
  [key: string]: unknown;
}

// ===== Validation results =====

/**
 * One validation failure, in the shape Typia reports it: the `$input`-rooted
 * path, the type that was expected there, and the value that was found.
 *
 * Declared here rather than re-exported from Typia so this package's published
 * declarations stay free of a `typia` type import — the transform runs at build
 * time and consumers get generated code, not a Typia dependency.
 */
export interface SchemaIssue {
  readonly path: string;
  readonly expected: string;
  readonly value: unknown;
}

/** Outcome of a `parse*` call: the Zod `safeParse` contract, without Zod. */
export type SchemaParseResult<T> =
  | { readonly success: true; readonly data: T }
  | { readonly success: false; readonly issues: readonly SchemaIssue[] };
