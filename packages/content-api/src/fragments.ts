import type { ContentAPI } from './content-api.interface.js';
import type { FragmentIndex } from './fragment-index.js';
import type { ContentManifest, CreateFragmentInput, CreateResult, FragmentFilters } from './types.js';

export class Fragments {
  constructor(
    private api: ContentAPI,
    private fragmentIndex: FragmentIndex,
  ) {}

  // Content discovery
  *listContent(filters?: FragmentFilters): Generator<ContentManifest> {
    // Choose the most efficient method based on filters
    if (filters?.collection) {
      if (filters.locales && filters.locales.length > 0) {
        // Filter by locales after getting collection entries
        for (const manifest of this.fragmentIndex.getManifestsByCollection(filters.collection)) {
          if (filters.locales.some((locale) => manifest.locales[locale])) {
            yield manifest;
          }
        }
      } else {
        yield* this.fragmentIndex.getManifestsByCollection(filters.collection);
      }
    } else if (filters?.locales && filters.locales.length > 0) {
      // For multiple locales, we need to check each
      for (const manifest of this.fragmentIndex.getAllManifests()) {
        if (filters.locales.some((locale) => manifest.locales[locale])) {
          yield manifest;
        }
      }
    } else {
      yield* this.fragmentIndex.getAllManifests();
    }
  }

  // Get all fragment collections
  get collections(): Set<string> {
    return this.fragmentIndex.collections;
  }

  // Fragment operations (returns null if not found)
  getByName(collection: string, name: string, locale?: string): ContentManifest | null {
    return this.fragmentIndex.getByName(collection, name, locale);
  }

  // Check if fragment name is available, in any letter case as getNameConflict checks it
  isNameAvailable(collection: string, name: string, excludeId?: string): boolean {
    return this.getNameConflict(collection, name, excludeId) === null;
  }

  // Get the ID of content that conflicts with a fragment name
  getNameConflict(collection: string, name: string, excludeId?: string): string | null {
    // In any letter case: those names share one file on a case-insensitive disk.
    for (const existing of this.fragmentIndex.getAllByNameInAnyCase(collection, name)) {
      if (existing.id !== excludeId) return existing.id;
    }
    return null;
  }

  // Check if fragment name is valid
  isFragmentNameValid(fragmentName: string): boolean {
    // Fragment names must not be empty
    if (!fragmentName || fragmentName.trim() === '') {
      return false;
    }

    // Fragment names must not contain dots (would interfere with locale suffixes)
    if (fragmentName.includes('.')) {
      return false;
    }

    // Fragment names must not contain path separators
    if (fragmentName.includes('/') || fragmentName.includes('\\')) {
      return false;
    }

    // Fragment names should only contain alphanumeric, hyphens, underscores
    return /^[a-zA-Z0-9_-]+$/.test(fragmentName);
  }

  // Create fragment with name validation
  async create(data: CreateFragmentInput): Promise<CreateResult> {
    // Validate fragment name
    if (!this.isFragmentNameValid(data.name)) {
      return {
        success: false,
        reason: 'invalid_name',
        error: new Error(`Invalid fragment name: ${data.name}`),
      };
    }

    // Check if name is already taken in any locale
    const existing = this.getByName(data.collection, data.name);
    if (existing) {
      return {
        success: false,
        reason: 'name_taken',
        error: new Error(`Fragment name ${data.name} already exists in collection ${data.collection}`),
      };
    }

    // Create the content
    return this.api.createContent({
      kind: 'fragment',
      collection: data.collection,
      type: 'mdx',
      name: data.name,
      meta: data.meta,
      locales: data.locales,
    });
  }
}
