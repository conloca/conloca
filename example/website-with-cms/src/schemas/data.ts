import { defineHostSchema } from '@conloca/astro-cms/page-schemas';
import typia, { type tags } from 'typia';

/**
 * Data collection schemas for the CMS.
 *
 * Each key is a collection name (matching folders in content/data/). Each value
 * is a TypeScript type plus what Typia generates for it at build time:
 * `validate` checks every stored entry when the collection loads, and
 * `metadata` is the JSON Schema the CMS renders the entry form from.
 *
 * Tips:
 * - A JSDoc comment on a field becomes its help text in the form
 * - Optional properties (`?`) are optional fields
 * - Supported controls: string, number, boolean, date (`string & tags.Format<'date-time'>`),
 *   email / url (`tags.Format`), string literal unions (select), arrays
 * - `typia.plain.createValidatePrune<T>()` drops undeclared keys from stored
 *   entries; `typia.createValidate<T>()` keeps them
 */

/** Authors collection - blog post authors, team members, etc. */
export interface Author {
  /** Full name */
  name: string;
  /** Short biography */
  bio: string;
  /** Profile image URL */
  avatar?: string & tags.Format<'url'>;
  /** Twitter handle (e.g., @username) */
  twitter?: string;
  /** Contact email */
  email?: string & tags.Format<'email'>;
}

/** Testimonials collection - customer reviews, quotes, etc. */
export interface Testimonial {
  /** Testimonial text */
  quote: string;
  /** Person who gave testimonial */
  author: string;
  /** Company name */
  company?: string;
  /** Job title or role */
  role?: string;
  /** Rating from 1-5 */
  rating?: number & tags.Minimum<1> & tags.Maximum<5>;
}

/** Settings collection - site configuration, feature flags, etc. */
export interface Settings {
  /** Site name */
  siteName?: string;
  /** Contact email address */
  contactEmail?: string & tags.Format<'email'>;
  /** Twitter profile URL */
  twitterUrl?: string & tags.Format<'url'>;
  /** GitHub profile URL */
  githubUrl?: string & tags.Format<'url'>;
  /** LinkedIn profile URL */
  linkedinUrl?: string & tags.Format<'url'>;
}

export const dataSchemas = {
  authors: defineHostSchema<Author>({
    validate: typia.plain.createValidatePrune<Author>(),
    metadata: typia.json.schema<Author>(),
  }),
  testimonials: defineHostSchema<Testimonial>({
    validate: typia.plain.createValidatePrune<Testimonial>(),
    metadata: typia.json.schema<Testimonial>(),
  }),
  settings: defineHostSchema<Settings>({
    validate: typia.plain.createValidatePrune<Settings>(),
    metadata: typia.json.schema<Settings>(),
  }),
};
