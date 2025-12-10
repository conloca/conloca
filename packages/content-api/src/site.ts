import type { ContentAPI } from './content-api.interface';
import { localesOf } from './content-utils';
import type { SiteIndex } from './site-index';
import type { ContentManifest, CreatePageInput, CreateResult, MoveResult, SiteFilters } from './types';

export class Site {
  constructor(
    private siteName: string,
    private api: ContentAPI,
    private siteIndex: SiteIndex,
  ) {}

  // Content discovery
  *listContent(filters?: SiteFilters): Generator<ContentManifest> {
    // Get the base manifests using the most efficient method
    let manifests: Generator<ContentManifest>;

    if (filters?.locales && filters.locales.length === 1) {
      manifests = this.siteIndex.getManifestsByLocale(filters.locales[0]);
    } else {
      manifests = this.siteIndex.getAllManifests();
    }

    // Apply additional filters if needed
    if (filters?.collection || filters?.type || filters?.published !== undefined) {
      for (const manifest of manifests) {
        if (filters.collection && manifest.collection !== filters.collection) continue;
        if (filters.type && manifest.type !== filters.type) continue;
        if (filters.published !== undefined) {
          // Check if any locale is published
          let hasPublishedLocale = false;
          for (const locale of localesOf(manifest)) {
            if (!locale.unpublishAt || new Date(locale.unpublishAt) > new Date()) {
              hasPublishedLocale = true;
              break;
            }
          }
          if (filters.published !== hasPublishedLocale) continue;
        }
        yield manifest;
      }
    } else {
      // No additional filters, yield all manifests
      yield* manifests;
    }
  }

  // List pages (convenience method for middleware)
  *listPages(locale?: string): Generator<ContentManifest> {
    const filters: SiteFilters = {};
    if (locale) filters.locales = [locale];

    yield* this.listContent(filters);
  }

  // Get all collections for this site
  get collections(): Set<string> {
    return this.siteIndex.collections;
  }

  // Pathname operations (returns null if available, ContentManifest if taken)
  getByPathname(pathname: string, locale?: string): ContentManifest | null {
    return this.siteIndex.getByPathname(pathname, locale);
  }

  // Get by previous pathname (for redirects)
  getByPreviousPathname(pathname: string, locale?: string): ContentManifest | null {
    return this.siteIndex.getByPreviousPathname(pathname, locale);
  }

  // Move content (handles rename + redirect tracking)
  async move(id: string, locale: string, newPathname: string): Promise<MoveResult> {
    // Check if new pathname is available
    const existing = this.getByPathname(newPathname, locale);
    if (existing && existing.id !== id) {
      return {
        moved: false,
        reason: 'already_exists',
      };
    }

    // Get current content
    const content = await this.api.getLocalized(id, locale);
    if (!content) {
      return {
        moved: false,
        reason: 'not_found',
      };
    }

    // Update with new pathname (this will handle previousPathnames)
    const updateResult = await this.api.updateLocalized({
      id,
      locale,
      data: {
        pathname: newPathname,
        meta: content.localized.meta,
      },
      etag: content.localized.etag,
    });

    if (!updateResult.success) {
      return {
        moved: false,
        reason: updateResult.reason,
        error: updateResult.error,
      };
    }

    return {
      moved: true,
      previousPathname: content.localized.pathname,
      etag: updateResult.etag,
    };
  }

  // Check if pathname is in redirect history
  getRedirect(pathname: string): ContentManifest | null {
    return this.siteIndex.getByPreviousPathname(pathname);
  }

  // Validate pathname is available (not taken or in redirects)
  isPathnameAvailable(pathname: string, locale: string, excludeId?: string): boolean {
    // Check if pathname is already taken
    const existing = this.getByPathname(pathname, locale);
    if (existing && existing.id !== excludeId) {
      return false;
    }

    // Check if pathname is in redirects
    const redirect = this.getByPreviousPathname(pathname, locale);
    if (redirect && redirect.id !== excludeId) {
      return false;
    }

    return true;
  }

  // Get the ID of content that conflicts with a pathname
  getPathnameConflict(pathname: string, locale: string, excludeId?: string): string | null {
    const existing = this.getByPathname(pathname, locale);
    if (existing && existing.id !== excludeId) {
      return existing.id;
    }
    return null;
  }

  // Check if pathname is in redirects
  isPathnameInRedirects(pathname: string, locale: string): boolean {
    return this.getByPreviousPathname(pathname, locale) !== null;
  }

  // Create page with validation
  async create(data: CreatePageInput): Promise<CreateResult> {
    // Validate pathname availability for all locales
    for (const [locale, localeData] of Object.entries(data.locales)) {
      const existing = this.getByPathname(localeData.pathname, locale);
      if (existing) {
        return {
          success: false,
          reason: 'pathname_taken',
          error: new Error(`Pathname ${localeData.pathname} is already in use for locale ${locale}`),
        };
      }

      // Check redirects too
      const redirect = this.getRedirect(localeData.pathname);
      if (redirect) {
        return {
          success: false,
          reason: 'pathname_in_redirects',
          error: new Error(`Pathname ${localeData.pathname} is in redirect history for locale ${locale}`),
        };
      }
    }

    return this.api.createContent({
      kind: 'page',
      site: this.siteName,
      collection: data.collection,
      type: 'puck',
      locales: data.locales,
    });
  }
}
