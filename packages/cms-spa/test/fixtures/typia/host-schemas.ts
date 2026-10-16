import type { DataEditable, FragmentEditable, PageEditable } from '@conloca/content-api-client';
import typia, { type tags } from 'typia';
import { defineHostSchema } from '../../../src/host-schema.js';

/**
 * Host schemas exactly as a site authors them: a TypeScript type plus the
 * generated validator and JSON Schema metadata for it. The Bun test preload
 * runs the native Typia transform over this directory, so every value here is
 * compiler output — the same code a host build ships.
 */

export interface BlogFields {
  /** Byline shown on cards */
  author?: string;
  date?: string;
  excerpt?: string & tags.MaxLength<300>;
  featuredImage?: string;
  tags?: string[];
}

export const articleFields = defineHostSchema<BlogFields>({
  validate: typia.createValidate<BlogFields>(),
  metadata: typia.json.schema<BlogFields>(),
});

interface SidebarBadge {
  text: string;
  variant: 'default' | 'note' | 'tip' | 'caution' | 'danger' | 'success';
}

export interface StarlightFields {
  title: string;
  description?: string & tags.MaxLength<160>;
  template?: 'doc' | 'splash';
  draft?: boolean;
  editUrl?: (string & tags.Format<'url'>) | boolean;
  sidebar?: { label?: string; order?: number; hidden?: boolean; badge?: string | SidebarBadge };
}

export const starlightFields = defineHostSchema<StarlightFields>({
  validate: typia.plain.createValidatePrune<StarlightFields>(),
  metadata: typia.json.schema<StarlightFields>(),
});

export interface ProfileFields {
  heroImage?: string;
  featured: boolean;
  order?: number;
  audience: 'dev' | 'ops';
  readingTime: number | null;
  relatedSlugs?: string[];
  reviewedAt?: Date;
  contact?: string & tags.Format<'email'>;
  homepage?: string & tags.Format<'url'>;
  rating?: number & tags.Type<'int32'> & tags.Minimum<1> & tags.Maximum<5>;
  badge?: SidebarBadge;
}

export const profileFields = defineHostSchema<ProfileFields>({
  validate: typia.createValidate<ProfileFields>(),
  metadata: typia.json.schema<ProfileFields>(),
});

export interface PublishedAtFields {
  /** When this goes live */
  publishedAt?: string & tags.Format<'date-time'>;
}

export const publishedAtFields = defineHostSchema<PublishedAtFields>({
  validate: typia.createValidate<PublishedAtFields>(),
  metadata: typia.json.schema<PublishedAtFields>(),
});

/** Generated metadata for the content-api shapes the CMS's own form records stand for. */
export const pageEditableMetadata = typia.json.schema<PageEditable>();
export const fragmentEditableMetadata = typia.json.schema<FragmentEditable>();
export const dataEditableMetadata = typia.json.schema<DataEditable>();

/** A site schema that owns the page title (coreFields `minimal`/`none`). */
export interface TitleFields {
  title: string;
}

export const titleFields = defineHostSchema<TitleFields>({
  validate: typia.createValidate<TitleFields>(),
  metadata: typia.json.schema<TitleFields>(),
});

export interface AuthorFields {
  author?: string;
}

export const authorFields = defineHostSchema<AuthorFields>({
  validate: typia.createValidate<AuthorFields>(),
  metadata: typia.json.schema<AuthorFields>(),
});

export interface AuthorImageFields {
  author?: string;
  featuredImage?: string;
}

export const authorImageFields = defineHostSchema<AuthorImageFields>({
  validate: typia.createValidate<AuthorImageFields>(),
  metadata: typia.json.schema<AuthorImageFields>(),
});

/** A data collection's entry fields. */
export interface BioFields {
  bio?: string;
}

export const bioFields = defineHostSchema<BioFields>({
  validate: typia.createValidate<BioFields>(),
  metadata: typia.json.schema<BioFields>(),
});

/** Each field documents itself; the comment is the help text the form shows. */
export interface HelpTextFields {
  /** Title help */
  title: string;
  /** Robots help */
  robots?: string;
  /** Publish help */
  publishAt?: (string & tags.Format<'date-time'>) | null;
  /** Rating help */
  rating?: number;
  /** Tags help */
  tags?: string[];
}

export const helpTextFields = defineHostSchema<HelpTextFields>({
  validate: typia.createValidate<HelpTextFields>(),
  metadata: typia.json.schema<HelpTextFields>(),
});

export interface StringFormatFields {
  homepage?: string & tags.Format<'url'>;
  website?: string & tags.Format<'uri'>;
  contact?: string & tags.Format<'email'>;
  summary?: string & tags.MaxLength<160>;
  link?: string & tags.Format<'url'> & tags.MaxLength<200>;
  mailbox?: string & tags.Format<'email'> & tags.MaxLength<100>;
}

export const stringFormatFields = defineHostSchema<StringFormatFields>({
  validate: typia.createValidate<StringFormatFields>(),
  metadata: typia.json.schema<StringFormatFields>(),
});
