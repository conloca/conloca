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
 * Schema for block metadata - editable fields only.
 * Blocks need category/tags because they all live in a single `blocks/` folder
 * and need metadata for organization and filtering.
 */
export const blockEditableSchema = z.object({
  title: z.string().describe('Display name'),
  description: z.string().optional().describe('Brief description'),
  category: z.string().optional().describe('Category for organization'),
  tags: z.array(z.string()).optional().describe('Tags for filtering'),
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

// ===== Data Schemas =====

/**
 * Schema for data entry metadata - simpler than blocks.
 * Data entries are organized by collections (folders), so they don't need category/tags.
 * If you need additional fields, add them to your data schema instead.
 */
export const dataEditableSchema = z.object({
  title: z.string().describe('Display name'),
  description: z.string().optional().describe('Brief description'),
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
  data: z.record(z.unknown()).optional(),
});

export type DataMeta = z.infer<typeof dataMetaSchema>;

// ===== Data Collection Schemas (DEPRECATED) =====
// The CMS no longer uses schemas from this package at runtime.
// Define your own schemas in your project and configure dataSchemasPath.
// See: packages/content-api/src/schemas/data/index.ts for examples.

// Note: Re-export removed to prevent accidental usage.
// Users should use useDataSchema() from @conloca/cms-spa instead.
