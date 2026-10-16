import type { FieldInfo, FormFields } from './utils/schema-fields.js';

/**
 * Form definitions for the metadata the CMS itself owns.
 *
 * These were Zod objects built only so a Zod introspector could read a
 * {@link FormFields} record back out of them — the schemas were never parsed
 * with. They are the records directly now; validation of the same metadata is
 * the generated validators in `@conloca/content-api/schemas`.
 *
 * Every entry below is pinned as a literal table in
 * `test/content-form-fields.test.ts`, which also checks each field's
 * type/optional/nullable against the Typia-generated metadata of the matching
 * content-api type. Each record keeps its literal keys (`satisfies`), so a
 * dialog can prove at compile time which fields it renders.
 */

const requiredString = (description: string): FieldInfo => ({
  type: 'string',
  description,
  isOptional: false,
  isNullable: false,
});
const optionalString = (description: string): FieldInfo => ({
  type: 'string',
  description,
  isOptional: true,
  isNullable: false,
});
const optionalStringArray = (description: string): FieldInfo => ({
  type: 'array',
  description,
  isOptional: true,
  isNullable: false,
});
const optionalNullableDate = (description: string): FieldInfo => ({
  type: 'date',
  format: 'date-time',
  description,
  isOptional: true,
  isNullable: true,
});

/** Pathname — the page-settings core section in every mode (the dialog renders the title itself). */
export const pathnameOnlyFields = {
  pathname: requiredString('URL path (e.g., /about)'),
} satisfies FormFields;

/** Publishing window only — the page-settings trailing section in `minimal` mode. */
export const publishWindowFields = {
  publishAt: optionalNullableDate(
    'When the page goes live. Page lists that sort by date use this date, or the date the page was created when it is empty.',
  ),
  unpublishAt: optionalNullableDate('Schedule unpublish date/time'),
} satisfies FormFields;

/** SEO + publishing window — the page-settings trailing section in `full` mode. */
export const seoPublishingFields = {
  description: optionalString('Meta description for search engines'),
  robots: optionalString('Robots meta tag (e.g., index, follow)'),
  canonical: { ...optionalString('Canonical URL for duplicate content'), format: 'url' },
  ...publishWindowFields,
} satisfies FormFields;

/** Editable fragment metadata — replaces `fragmentEditableSchema`. */
export const fragmentEditableFields = {
  title: requiredString('Display name for the fragment'),
  description: optionalString('Brief description of this fragment'),
  category: optionalString('Category for organizing fragments (e.g., headers, cta, content)'),
  tags: optionalStringArray('Tags for filtering and organization'),
} satisfies FormFields;

/** Editable data-entry metadata — replaces `dataEditableSchema`. */
export const dataEditableFields = {
  title: requiredString('Display name for the entry'),
  description: optionalString('Brief description of this entry'),
  category: optionalString('Category for organizing entries'),
  tags: optionalStringArray('Tags for filtering and organization'),
} satisfies FormFields;
