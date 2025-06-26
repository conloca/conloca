import type { BlockIndex } from './block-index';
import type { ContentAPI } from './content-api.interface';
import type { BlockFilters, ContentManifest, CreateBlockInput, CreateResult } from './types';

export class Blocks {
  constructor(
    private api: ContentAPI,
    private blockIndex: BlockIndex,
  ) {}

  // Content discovery
  *listContent(filters?: BlockFilters): Generator<ContentManifest> {
    // Choose the most efficient method based on filters
    if (filters?.collection) {
      if (filters.locales && filters.locales.length > 0) {
        // Filter by locales after getting collection entries
        for (const manifest of this.blockIndex.getManifestsByCollection(filters.collection)) {
          if (filters.locales.some((locale) => manifest.locales[locale])) {
            yield manifest;
          }
        }
      } else {
        yield* this.blockIndex.getManifestsByCollection(filters.collection);
      }
    } else if (filters?.locales && filters.locales.length > 0) {
      // For multiple locales, we need to check each
      for (const manifest of this.blockIndex.getAllManifests()) {
        if (filters.locales.some((locale) => manifest.locales[locale])) {
          yield manifest;
        }
      }
    } else {
      yield* this.blockIndex.getAllManifests();
    }
  }

  // Get all block collections
  get collections(): Set<string> {
    return this.blockIndex.collections;
  }

  // Block operations (returns null if not found)
  getByName(collection: string, name: string, locale?: string): ContentManifest | null {
    return this.blockIndex.getByName(collection, name, locale);
  }

  // Check if block name is available
  isNameAvailable(collection: string, name: string, excludeId?: string): boolean {
    const existing = this.getByName(collection, name);
    return !existing || existing.id === excludeId;
  }

  // Get the ID of content that conflicts with a block name
  getNameConflict(collection: string, name: string, excludeId?: string): string | null {
    const existing = this.getByName(collection, name);
    if (existing && existing.id !== excludeId) {
      return existing.id;
    }
    return null;
  }

  // Check if block name is valid
  isBlockNameValid(blockName: string): boolean {
    // Block names must not be empty
    if (!blockName || blockName.trim() === '') {
      return false;
    }

    // Block names must not contain dots (would interfere with locale suffixes)
    if (blockName.includes('.')) {
      return false;
    }

    // Block names must not contain path separators
    if (blockName.includes('/') || blockName.includes('\\')) {
      return false;
    }

    // Block names should only contain alphanumeric, hyphens, underscores
    return /^[a-zA-Z0-9_-]+$/.test(blockName);
  }

  // Create block with name validation
  async create(data: CreateBlockInput): Promise<CreateResult> {
    // Validate block name
    if (!this.isBlockNameValid(data.name)) {
      return {
        success: false,
        reason: 'invalid_name',
        error: new Error(`Invalid block name: ${data.name}`),
      };
    }

    // Check if name is already taken in any locale
    const existing = this.getByName(data.collection, data.name);
    if (existing) {
      return {
        success: false,
        reason: 'name_taken',
        error: new Error(`Block name ${data.name} already exists in collection ${data.collection}`),
      };
    }

    // Create the content
    return this.api.createContent({
      kind: 'block',
      collection: data.collection,
      type: 'mdx',
      name: data.name,
      meta: data.meta,
      locales: data.locales,
    });
  }
}
