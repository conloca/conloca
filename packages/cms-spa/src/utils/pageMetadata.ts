import type { PageMetadata } from '../types';

interface LocaleVersionMetaSource {
  meta: Record<string, unknown> & { title?: string };
  pathname?: string;
  publishAt?: string;
  unpublishAt?: string;
}

// Fields rendered by the dialog's core/SEO sections. Everything else in
// `meta` is treated as custom-frontmatter and handed off to the
// schema-driven section for the page's pathname prefix.
const CORE_META_KEYS = new Set([
  'title',
  'description',
  'robots',
  'canonical',
  'keywords',
  'ogTitle',
  'ogDescription',
  'ogImage',
]);

export function extractPageMetadata(localized: LocaleVersionMetaSource): PageMetadata {
  const customMeta: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(localized.meta)) {
    if (!CORE_META_KEYS.has(key)) {
      customMeta[key] = value;
    }
  }
  return {
    title: (localized.meta.title as string | undefined) || '',
    description: (localized.meta.description as string | undefined) || '',
    pathname: localized.pathname || '/',
    publishDate: localized.publishAt ? new Date(localized.publishAt) : null,
    unpublishDate: localized.unpublishAt ? new Date(localized.unpublishAt) : null,
    robots: localized.meta.robots as string | undefined,
    canonical: localized.meta.canonical as string | undefined,
    customMeta,
  };
}

export interface MetadataUpdatePayload {
  meta: Record<string, unknown>;
  pathname: string;
  publishAt: string | null;
  unpublishAt: string | null;
}

export function buildMetadataUpdate(metadata: PageMetadata): MetadataUpdatePayload {
  return {
    meta: {
      title: metadata.title,
      description: metadata.description,
      robots: metadata.robots,
      canonical: metadata.canonical,
      ...(metadata.customMeta || {}),
    },
    pathname: metadata.pathname,
    publishAt: metadata.publishDate?.toISOString() || null,
    unpublishAt: metadata.unpublishDate?.toISOString() || null,
  };
}
