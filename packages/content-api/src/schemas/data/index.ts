import { z } from 'zod';

// ===== Example Data Collection Schemas =====
// These are EXAMPLE schemas showing how to define data collection structures.
// The CMS does NOT use these at runtime - define your own in your project!
//
// To use schemas in the CMS:
// 1. Create src/schemas/data.ts in your Astro project
// 2. Export `dataSchemas` with your collection schemas
// 3. Add `dataSchemasPath: './src/schemas/data.ts'` to conlocaCMS() config

/**
 * Example: Authors collection schema.
 * Used for blog post authors, team members, etc.
 *
 * @deprecated Define your own schemas in your project's src/schemas/data.ts
 * @example
 * ```ts
 * // src/schemas/data.ts
 * import { z } from 'zod';
 * export const dataSchemas = {
 *   authors: z.object({
 *     name: z.string().describe('Full name'),
 *     bio: z.string().describe('Biography'),
 *   }),
 * };
 * ```
 */
export const authorsSchema = z.object({
  name: z.string().describe('Full name'),
  bio: z.string().describe('Short biography'),
  avatar: z.string().url().optional().describe('Profile image URL'),
  twitter: z.string().optional().describe('Twitter handle (e.g., @username)'),
  email: z.string().email().optional().describe('Contact email'),
});

export type Author = z.infer<typeof authorsSchema>;

/**
 * Example: Testimonials collection schema.
 * Used for customer testimonials, reviews, etc.
 *
 * @deprecated Define your own schemas in your project's src/schemas/data.ts
 */
export const testimonialsSchema = z.object({
  quote: z.string().describe('Testimonial text'),
  author: z.string().describe('Person who gave testimonial'),
  company: z.string().optional().describe('Company name'),
  role: z.string().optional().describe('Job title or role'),
  rating: z.number().min(1).max(5).optional().describe('Rating from 1-5'),
});

export type Testimonial = z.infer<typeof testimonialsSchema>;

// ===== Schema Registry (EXAMPLE ONLY) =====

/**
 * Example registry mapping collection names to their Zod schemas.
 *
 * @deprecated The CMS no longer uses this at runtime.
 * Define your own dataSchemas in your project and configure dataSchemasPath.
 */
export const dataSchemas: Record<string, z.ZodObject<z.ZodRawShape>> = {
  authors: authorsSchema,
  testimonials: testimonialsSchema,
};

/**
 * Get the schema for a data collection from the example registry.
 *
 * @deprecated The CMS no longer uses this. Use useDataSchema() from @conloca/cms-spa instead,
 * which reads from schemas configured via dataSchemasPath in your project.
 */
export function getDataSchema(collection: string): z.ZodObject<z.ZodRawShape> | null {
  return dataSchemas[collection] ?? null;
}

/**
 * Check if a collection has a schema defined in the example registry.
 *
 * @deprecated The CMS no longer uses this. Use useHasDataSchemas() from @conloca/cms-spa instead.
 */
export function hasDataSchema(collection: string): boolean {
  return collection in dataSchemas;
}
