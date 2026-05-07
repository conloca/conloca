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
 * Default for the CMS form when editing an mdx page; projects can override
 * via the `mdxPages.schema` option to plug in a renderer-specific shape
 * (e.g. `starlightFrontmatterSchema` below).
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

/**
 * Opt-in schema covering Astro Starlight's full frontmatter shape.
 * Pass this to `mdxPages.schema` when wiring Conloca with a Starlight project
 * to drive a Starlight-aware CMS form (sidebar order/badge/hidden, hero,
 * banner, prev/next overrides, pagefind, tableOfContents, template, editUrl,
 * lastUpdated overrides, head injection).
 *
 * `.passthrough()` so projects extending Starlight's `docsSchema({ extend })`
 * with custom fields don't have those fields stripped by the CMS form.
 */
export const starlightFrontmatterSchema = z
  .object({
    title: z.string().describe('Page title for SEO and browser tab'),
    description: z.string().optional().describe('Meta description for search engines'),
    editUrl: z.union([z.string().url(), z.boolean()]).optional().describe('Override or disable the edit-link URL'),
    lastUpdated: z.union([z.coerce.date(), z.boolean()]).optional().describe('Override the last-updated date'),
    draft: z.boolean().optional().describe('Hide the page from production builds'),
    template: z.enum(['doc', 'splash']).optional().describe('Page layout template'),
    slug: z.string().optional().describe('Override the auto-derived slug'),
    head: z.array(z.unknown()).optional().describe('Inject extra HTML tags into the page <head>'),
    pagefind: z.boolean().optional().describe('Include or exclude the page from Pagefind search'),
    tableOfContents: z
      .union([
        z.boolean(),
        z.object({ minHeadingLevel: z.number().int().optional(), maxHeadingLevel: z.number().int().optional() }),
      ])
      .optional()
      .describe('Override or disable the on-page table of contents'),
    hero: z
      .object({
        title: z.string().optional(),
        tagline: z.string().optional(),
        image: z.unknown().optional(),
        actions: z.array(z.unknown()).optional(),
      })
      .passthrough()
      .optional()
      .describe('Splash hero block (only for template: splash)'),
    banner: z.object({ content: z.string() }).optional().describe('Site-wide banner shown above the page'),
    prev: z
      .union([z.boolean(), z.object({ link: z.string().optional(), label: z.string().optional() })])
      .optional()
      .describe('Override the previous-page link'),
    next: z
      .union([z.boolean(), z.object({ link: z.string().optional(), label: z.string().optional() })])
      .optional()
      .describe('Override the next-page link'),
    sidebar: z
      .object({
        label: z.string().optional(),
        order: z.number().optional(),
        hidden: z.boolean().optional(),
        badge: z.union([z.string(), z.object({ text: z.string(), variant: z.string().optional() })]).optional(),
        attrs: z.record(z.string(), z.unknown()).optional(),
      })
      .optional()
      .describe('Sidebar entry overrides for this page'),
  })
  .passthrough();

export type StarlightFrontmatter = z.infer<typeof starlightFrontmatterSchema>;

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
