import { z } from 'zod';

// ===== Page Schemas =====

/**
 * Base schema for page metadata - editable fields only.
 * Used by CMS forms for dynamic form generation.
 * Add .describe() for form field labels/hints.
 */
export const pageEditableSchema = z.object({
  title: z.string().describe('Page title for SEO and browser tab'),
  description: z.string().optional().describe('Meta description for search engines'),
  pathname: z.string().describe('URL path (e.g., /about)'),
  publishAt: z.coerce.date().nullable().optional().describe('Schedule publish date/time'),
  unpublishAt: z.coerce.date().nullable().optional().describe('Schedule unpublish date/time'),
  robots: z.string().optional().describe('Robots meta tag (e.g., index, follow)'),
  canonical: z.string().url().optional().describe('Canonical URL for duplicate content'),
});

export type PageEditable = z.infer<typeof pageEditableSchema>;

/**
 * Full page schema with system fields.
 * Used by Astro Content Collections for validation.
 */
export const pageMetaSchema = pageEditableSchema.extend({
  id: z.string(),
  locale: z.string(),
});

export type PageMeta = z.infer<typeof pageMetaSchema>;

// ===== Block Schemas =====

/**
 * Base schema for block metadata - editable fields only.
 * Used by CMS forms for dynamic form generation.
 * Add .describe() for form field labels/hints.
 */
export const blockEditableSchema = z.object({
  title: z.string().describe('Display name for the block'),
  description: z.string().optional().describe('Brief description of this block'),
  category: z.string().optional().describe('Category for organizing blocks (e.g., headers, cta, content)'),
  tags: z.array(z.string()).optional().describe('Tags for filtering and organization'),
});

export type BlockEditable = z.infer<typeof blockEditableSchema>;

/**
 * Full block schema with system fields.
 * Used by Astro Content Collections for validation.
 */
export const blockMetaSchema = blockEditableSchema.extend({
  id: z.string(),
  locale: z.string(),
  name: z.string(),
});

export type BlockMeta = z.infer<typeof blockMetaSchema>;

// ===== MDX Page Schemas =====

/**
 * Base schema for mdx-type page frontmatter — renderer-neutral.
 *
 * Default for the CMS form when editing an mdx page; projects override via
 * `mdxPages.schema` when they want a renderer-specific shape (e.g. an
 * Astro-collection schema with extra fields).
 *
 * Permissive on purpose: `.passthrough()` lets unknown frontmatter keys flow
 * through unchanged so the file's existing fields are never lost on save.
 */
export const mdxPageFrontmatterSchema = z
  .object({
    title: z.string().describe('Page title for SEO and browser tab'),
    description: z.string().optional().describe('Meta description for search engines'),
    draft: z.boolean().optional().describe('Hide the page from production builds'),
  })
  .passthrough();

export type MdxPageFrontmatter = z.infer<typeof mdxPageFrontmatterSchema>;

// ===== Data Schemas =====

/**
 * Base schema for data entry metadata - editable fields only.
 * Used by CMS forms for dynamic form generation.
 * Add .describe() for form field labels/hints.
 */
export const dataEditableSchema = z.object({
  title: z.string().describe('Display name for the entry'),
  description: z.string().optional().describe('Brief description of this entry'),
  category: z.string().optional().describe('Category for organizing entries'),
  tags: z.array(z.string()).optional().describe('Tags for filtering and organization'),
});

export type DataEditable = z.infer<typeof dataEditableSchema>;

/**
 * Zod schema for data entry metadata.
 * Covers common organizational fields for structured data collections.
 */
export const dataMetaSchema = dataEditableSchema.extend({
  // System fields (added by loader)
  id: z.string(),
  locale: z.string(),
  name: z.string(),

  // Actual data content (arbitrary JSON structure)
  data: z.record(z.string(), z.unknown()).optional(),
});

export type DataMeta = z.infer<typeof dataMetaSchema>;
