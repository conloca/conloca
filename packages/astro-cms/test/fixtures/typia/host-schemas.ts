import { defineHostSchema } from '@conloca/cms-spa/page-schema-define';
import typia from 'typia';

/**
 * Host schemas exactly as a site authors them — a type plus its generated
 * validator and JSON Schema metadata. `test-native-preload.ts` compiles this
 * directory with the native Typia transform, so every value is compiler output.
 */

export interface ReadingTimeFields {
  readingTime?: number;
}
export const readingTimeFields = defineHostSchema<ReadingTimeFields>({
  validate: typia.createValidate<ReadingTimeFields>(),
  metadata: typia.json.schema<ReadingTimeFields>(),
});

export interface ExcerptFields {
  excerpt?: string;
}
export const excerptFields = defineHostSchema<ExcerptFields>({
  validate: typia.createValidate<ExcerptFields>(),
  metadata: typia.json.schema<ExcerptFields>(),
});

export interface DraftFields {
  draft?: boolean;
}
export const draftFields = defineHostSchema<DraftFields>({
  validate: typia.createValidate<DraftFields>(),
  metadata: typia.json.schema<DraftFields>(),
});

export interface AuthorFields {
  author?: string;
  tags?: string[];
  mandatory: string;
}
export const authorFields = defineHostSchema<AuthorFields>({
  validate: typia.createValidate<AuthorFields>(),
  metadata: typia.json.schema<AuthorFields>(),
});

export interface OptionalAuthorFields {
  author?: string;
}
export const optionalAuthorFields = defineHostSchema<OptionalAuthorFields>({
  validate: typia.createValidate<OptionalAuthorFields>(),
  metadata: typia.json.schema<OptionalAuthorFields>(),
});
/** A second, separately generated schema for the same field type. */
export const sameOptionalAuthorFields = defineHostSchema<{ author?: string }>({
  validate: typia.createValidate<{ author?: string }>(),
  metadata: typia.json.schema<{ author?: string }>(),
});

export interface ObjectAuthorFields {
  author?: { name: string };
}
export const objectAuthorFields = defineHostSchema<ObjectAuthorFields>({
  validate: typia.createValidate<ObjectAuthorFields>(),
  metadata: typia.json.schema<ObjectAuthorFields>(),
});

/** Nested properties named like annotation keywords: they are field names, not annotations. */
export const stringTitleBannerFields = defineHostSchema<{ banner?: { title: string; description?: string } }>({
  validate: typia.createValidate<{ banner?: { title: string; description?: string } }>(),
  metadata: typia.json.schema<{ banner?: { title: string; description?: string } }>(),
});
export const numberTitleBannerFields = defineHostSchema<{ banner?: { title: number; description?: string } }>({
  validate: typia.createValidate<{ banner?: { title: number; description?: string } }>(),
  metadata: typia.json.schema<{ banner?: { title: number; description?: string } }>(),
});

export interface StarlightOwnedCoreFields {
  title: string;
  description?: string;
  draft?: boolean;
}
export const starlightOwnedCoreFields = defineHostSchema<StarlightOwnedCoreFields>({
  validate: typia.createValidate<StarlightOwnedCoreFields>(),
  metadata: typia.json.schema<StarlightOwnedCoreFields>(),
});

export interface StarlightSidebarFields {
  title: string;
  sidebar?: { label?: string; order?: number };
}
/** Starlight's shape: a required core-owned `title` next to a closed nested object. */
export const starlightPrunedSidebarFields = defineHostSchema<StarlightSidebarFields>({
  validate: typia.plain.createValidatePrune<StarlightSidebarFields>(),
  metadata: typia.json.schema<StarlightSidebarFields>(),
});

export interface TitleRedeclaringFields {
  title: string;
}
export const titleRedeclaringFields = defineHostSchema<TitleRedeclaringFields>({
  validate: typia.createValidate<TitleRedeclaringFields>(),
  metadata: typia.json.schema<TitleRedeclaringFields>(),
});

export interface PuckDataFields {
  puckData?: { root?: object };
}
export const puckDataFields = defineHostSchema<PuckDataFields>({
  validate: typia.createValidate<PuckDataFields>(),
  metadata: typia.json.schema<PuckDataFields>(),
});

interface NamedAuthor {
  name: string;
  url: string;
}
export interface NestedAuthorFields {
  author?: NamedAuthor;
}
/** `createValidatePrune` — the z.object() equivalent that drops undeclared nested keys. */
export const closedNestedAuthorFields = defineHostSchema<NestedAuthorFields>({
  validate: typia.plain.createValidatePrune<NestedAuthorFields>(),
  metadata: typia.json.schema<NestedAuthorFields>(),
});
/** `createValidate` — keeps undeclared nested keys, the z.looseObject() equivalent. */
export const looseNestedAuthorFields = defineHostSchema<NestedAuthorFields>({
  validate: typia.createValidate<NestedAuthorFields>(),
  metadata: typia.json.schema<NestedAuthorFields>(),
});

export interface WeirdKeyFields {
  'og-image'?: string;
}
export const weirdKeyFields = defineHostSchema<WeirdKeyFields>({
  validate: typia.createValidate<WeirdKeyFields>(),
  metadata: typia.json.schema<WeirdKeyFields>(),
});

export interface Testimonial {
  quote: string;
}
export const testimonialPayload = defineHostSchema<Testimonial>({
  validate: typia.plain.createValidatePrune<Testimonial>(),
  metadata: typia.json.schema<Testimonial>(),
});

export interface Faq {
  question: string;
}
export const faqPayload = defineHostSchema<Faq>({
  validate: typia.createValidate<Faq>(),
  metadata: typia.json.schema<Faq>(),
});
