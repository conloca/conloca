import type { ContentAPI } from './content-api.interface';
import type { DataIndex } from './data-index';
import type { ContentManifest, CreateResult } from './types';

export interface DataFilters {
  collection?: string;
  locales?: string[];
}

export interface CreateDataInput {
  collection: string;
  name: string;
  meta?: { title?: string; description?: string; [key: string]: unknown };
  locales: {
    [locale: string]: {
      publishAt?: string | null | false;
      unpublishAt?: string | null | false;
      meta?: { title?: string; description?: string; [key: string]: unknown };
      content: {
        data: Record<string, unknown>;
      };
    };
  };
}

export class Data {
  constructor(
    private api: ContentAPI,
    private dataIndex: DataIndex,
  ) {}

  // Content discovery
  *listContent(filters?: DataFilters): Generator<ContentManifest> {
    // Choose the most efficient method based on filters
    if (filters?.collection) {
      if (filters.locales && filters.locales.length > 0) {
        // Filter by locales after getting collection entries
        for (const manifest of this.dataIndex.getManifestsByCollection(filters.collection)) {
          if (filters.locales.some((locale) => manifest.locales[locale])) {
            yield manifest;
          }
        }
      } else {
        yield* this.dataIndex.getManifestsByCollection(filters.collection);
      }
    } else if (filters?.locales && filters.locales.length > 0) {
      // For multiple locales, we need to check each
      for (const manifest of this.dataIndex.getAllManifests()) {
        if (filters.locales.some((locale) => manifest.locales[locale])) {
          yield manifest;
        }
      }
    } else {
      yield* this.dataIndex.getAllManifests();
    }
  }

  // Get all data collections
  get collections(): Set<string> {
    return this.dataIndex.collections;
  }

  // Data operations (returns null if not found)
  getByName(collection: string, name: string, locale?: string): ContentManifest | null {
    return this.dataIndex.getByName(collection, name, locale);
  }

  // Check if data name is available
  isNameAvailable(collection: string, name: string, excludeId?: string): boolean {
    const existing = this.getByName(collection, name);
    return !existing || existing.id === excludeId;
  }

  // Get the ID of content that conflicts with a data name
  getNameConflict(collection: string, name: string, excludeId?: string): string | null {
    const existing = this.getByName(collection, name);
    if (existing && existing.id !== excludeId) {
      return existing.id;
    }
    return null;
  }

  // Check if data name is valid
  isDataNameValid(dataName: string): boolean {
    // Data names must not be empty
    if (!dataName || dataName.trim() === '') {
      return false;
    }

    // Data names must not contain dots (would interfere with locale suffixes)
    if (dataName.includes('.')) {
      return false;
    }

    // Data names must not contain path separators
    if (dataName.includes('/') || dataName.includes('\\')) {
      return false;
    }

    // Data names should only contain alphanumeric, hyphens, underscores
    return /^[a-zA-Z0-9_-]+$/.test(dataName);
  }

  // Create data entry with name validation
  async create(input: CreateDataInput): Promise<CreateResult> {
    // Validate data name
    if (!this.isDataNameValid(input.name)) {
      return {
        success: false,
        reason: 'invalid_name',
        error: new Error(`Invalid data name: ${input.name}`),
      };
    }

    // Check if name is already taken in any locale
    const existing = this.getByName(input.collection, input.name);
    if (existing) {
      return {
        success: false,
        reason: 'name_taken',
        error: new Error(`Data name ${input.name} already exists in collection ${input.collection}`),
      };
    }

    // Create the content
    return this.api.createContent({
      kind: 'data',
      collection: input.collection,
      type: 'json',
      name: input.name,
      meta: input.meta,
      locales: input.locales,
    });
  }
}
