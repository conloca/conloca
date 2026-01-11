import type {
  APIError,
  BatchResult,
  ContentEntry,
  ContentListResult,
  ContentManifest,
  CreateContentInput,
  CreateResult,
  DeleteResult,
  ErrorCode,
  GlobalFilters,
  LocalizedEntry,
  MoveResult,
  SitesConfig,
  UpdateLocaleInput,
  UpdateResult,
} from '@conloca/content-api';
import { ErrorCodes } from '@conloca/content-api';

// Git operation types
export interface GitStatus {
  hasChanges: boolean;
  changedFiles: number;
  ahead: number;
  behind: number;
  branch: string;
  isRepo: boolean;
}

export interface GitCommitResult {
  success: boolean;
  commit?: string;
  summary?: string;
  error?: string;
}

export interface GitPushResult {
  success: boolean;
  error?: string;
}

export interface ContentAPIClientOptions {
  baseUrl?: string;
  fetch?: typeof fetch;
}

export class ContentAPIClient {
  private baseUrl: string;
  private fetch: typeof fetch;

  constructor(options: ContentAPIClientOptions = {}) {
    // Bind fetch to maintain its context
    if (options.fetch) {
      this.fetch = options.fetch;
    } else if (typeof globalThis !== 'undefined' && globalThis.fetch) {
      // Use globalThis for better compatibility
      this.fetch = globalThis.fetch.bind(globalThis);
    } else {
      this.fetch = fetch;
    }
    this.baseUrl = options.baseUrl || '/__conloca/api';
  }

  private async fetchAPI<T>(url: string, options?: RequestInit): Promise<T> {
    const response = await this.fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    });

    if (!response.ok) {
      let errorData: any;
      try {
        errorData = await response.json();
      } catch {
        // If JSON parsing fails, throw generic error
        throw new Error(`API error: ${response.status} ${response.statusText}`);
      }

      // Check if it's an APIError format
      if (errorData?.error?.code) {
        const apiError = errorData as APIError;

        // Special handling for stale writes
        if (apiError.error.code === ErrorCodes.STALE_WRITE) {
          throw new StaleWriteError({
            code: apiError.error.code,
            message: apiError.error.message,
            currentEtag: apiError.error.details?.currentEtag,
          });
        }

        // Create a proper error with code and details
        const error = new APIClientError(
          apiError.error.message,
          apiError.error.code as ErrorCode,
          apiError.error.details,
        );
        throw error;
      }

      // Fallback for non-standard error responses
      throw new Error(`API error: ${response.status} ${response.statusText}`);
    }

    return (await response.json()) as Promise<T>;
  }

  // Core content operations
  async getContent(id: string): Promise<ContentEntry | null> {
    try {
      const response = await this.fetch(`${this.baseUrl}/content/${id}`);
      if (response.status === 404) {
        return null;
      }
      if (!response.ok) {
        throw new Error(`Failed to fetch content: ${response.statusText}`);
      }
      return (await response.json()) as ContentEntry;
    } catch (error) {
      console.error('Error fetching content:', error);
      throw error;
    }
  }

  async getLocalized(id: string, locale: string): Promise<LocalizedEntry | null> {
    try {
      const response = await this.fetch(`${this.baseUrl}/content/${id}/${locale}`);
      if (response.status === 404) {
        return null;
      }
      if (!response.ok) {
        throw new Error(`Failed to fetch localized content: ${response.statusText}`);
      }
      return (await response.json()) as LocalizedEntry;
    } catch (error) {
      console.error('Error fetching localized content:', error);
      throw error;
    }
  }

  async createContent(data: CreateContentInput): Promise<CreateResult> {
    return this.fetchAPI<CreateResult>(`${this.baseUrl}/content`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateLocalized(input: UpdateLocaleInput): Promise<UpdateResult> {
    const { id, locale, data, etag } = input;
    const params = new URLSearchParams({ locale, etag });
    return this.fetchAPI<UpdateResult>(`${this.baseUrl}/content/${id}?${params}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteContent(id: string, etag: string): Promise<DeleteResult> {
    return this.fetchAPI<DeleteResult>(`${this.baseUrl}/content/${id}`, {
      method: 'DELETE',
      headers: {
        'If-Match': etag,
      },
    });
  }

  async deleteLocalized(input: { id: string; locale: string; etag: string }): Promise<DeleteResult> {
    return this.fetchAPI<DeleteResult>(`${this.baseUrl}/content/${input.id}?locale=${input.locale}`, {
      method: 'DELETE',
      headers: {
        'If-Match': input.etag,
      },
    });
  }

  // Site operations
  async getSitePages(site: string, locale?: string): Promise<ContentListResult> {
    const url = locale ? `${this.baseUrl}/${site}/pages?locale=${locale}` : `${this.baseUrl}/${site}/pages`;
    return this.fetchAPI<ContentListResult>(url);
  }

  async getPageByPathname(site: string, pathname: string, locale?: string): Promise<ContentManifest | null> {
    try {
      const url = locale
        ? `${this.baseUrl}/sites/${site}/pathname${pathname}?locale=${locale}`
        : `${this.baseUrl}/sites/${site}/pathname${pathname}`;
      const response = await this.fetch(url);
      if (response.status === 404) {
        return null;
      }
      if (!response.ok) {
        throw new Error(`Failed to fetch page: ${response.statusText}`);
      }
      return (await response.json()) as ContentManifest;
    } catch (error) {
      console.error('Error fetching page by pathname:', error);
      throw error;
    }
  }

  async isPathnameAvailable(site: string, pathname: string, excludeId?: string): Promise<boolean> {
    const params = new URLSearchParams({
      pathname,
      ...(excludeId && { excludeId }),
    });

    const response = await this.fetch(`${this.baseUrl}/${site}/pathname-available?${params}`);
    if (!response.ok) {
      throw new Error(`Failed to check pathname availability: ${response.statusText}`);
    }

    const data = (await response.json()) as { available: boolean };
    return data.available;
  }

  async movePage(site: string, id: string, pathname: string, locale: string, etag: string): Promise<MoveResult> {
    return this.fetchAPI<MoveResult>(`${this.baseUrl}/${site}/move`, {
      method: 'POST',
      body: JSON.stringify({ id, pathname, locale, etag }),
    });
  }

  // Block operations
  async getBlocks(collection?: string, locale?: string): Promise<ContentListResult> {
    const params = new URLSearchParams();
    if (collection) params.set('collection', collection);
    if (locale) params.set('locale', locale);

    const url = `${this.baseUrl}/blocks${params.toString() ? `?${params}` : ''}`;
    return this.fetchAPI<ContentListResult>(url);
  }

  async getBlockByName(name: string, collection?: string, locale?: string): Promise<ContentManifest | null> {
    try {
      const params = new URLSearchParams();
      if (collection) params.set('collection', collection);
      if (locale) params.set('locale', locale);

      const url = `${this.baseUrl}/blocks/${name}${params.toString() ? `?${params}` : ''}`;
      const response = await this.fetch(url);
      if (response.status === 404) {
        return null;
      }
      if (!response.ok) {
        throw new Error(`Failed to fetch block: ${response.statusText}`);
      }
      return (await response.json()) as ContentManifest;
    } catch (error) {
      console.error('Error fetching block by name:', error);
      throw error;
    }
  }

  // Data operations
  async getData(collection?: string, locale?: string): Promise<ContentListResult> {
    const params = new URLSearchParams();
    if (collection) params.set('collection', collection);
    if (locale) params.set('locale', locale);

    const url = `${this.baseUrl}/data${params.toString() ? `?${params}` : ''}`;
    return this.fetchAPI<ContentListResult>(url);
  }

  async getDataByName(name: string, collection: string, locale?: string): Promise<ContentManifest | null> {
    try {
      const params = new URLSearchParams();
      params.set('collection', collection);
      if (locale) params.set('locale', locale);

      const url = `${this.baseUrl}/data/${name}?${params}`;
      const response = await this.fetch(url);
      if (response.status === 404) {
        return null;
      }
      if (!response.ok) {
        throw new Error(`Failed to fetch data entry: ${response.statusText}`);
      }
      return (await response.json()) as ContentManifest;
    } catch (error) {
      console.error('Error fetching data entry by name:', error);
      throw error;
    }
  }

  async isDataNameAvailable(name: string, collection: string, excludeId?: string): Promise<boolean> {
    const params = new URLSearchParams({
      name,
      collection,
      ...(excludeId && { excludeId }),
    });

    const response = await this.fetch(`${this.baseUrl}/data/name-available?${params}`);
    if (!response.ok) {
      throw new Error(`Failed to check data name availability: ${response.statusText}`);
    }

    const data = (await response.json()) as { available: boolean };
    return data.available;
  }

  async getDataCollections(): Promise<string[]> {
    const response = await this.fetchAPI<{ collections: string[] }>(`${this.baseUrl}/data/collections`);
    return response.collections;
  }

  // Global operations
  async listAllContent(filters?: GlobalFilters): Promise<ContentListResult> {
    const params = new URLSearchParams();
    if (filters?.site) params.set('site', filters.site);
    if (filters?.collection) params.set('collection', filters.collection);
    if (filters?.locales?.length) params.set('locales', filters.locales.join(','));
    if (filters?.type) params.set('type', filters.type);
    if (filters?.published !== undefined) params.set('published', String(filters.published));
    if (filters?.kind) params.set('kind', filters.kind);
    if (filters?.localization) params.set('localization', filters.localization);
    if (filters?.missingLocales?.length) params.set('missingLocales', filters.missingLocales.join(','));

    const url = `${this.baseUrl}/content${params.toString() ? `?${params}` : ''}`;
    return this.fetchAPI<ContentListResult>(url);
  }

  async findUntranslatedContent(
    targetLocale: string,
    excludeSites?: string[],
    includeUnpublished?: boolean,
  ): Promise<ContentListResult> {
    const params = new URLSearchParams();
    if (excludeSites?.length) params.set('excludeSites', excludeSites.join(','));
    if (includeUnpublished) params.set('includeUnpublished', 'true');

    const url = `${this.baseUrl}/untranslated/${targetLocale}${params.toString() ? `?${params}` : ''}`;
    return this.fetchAPI<ContentListResult>(url);
  }

  async getSitesConfig(): Promise<SitesConfig> {
    return this.fetchAPI<SitesConfig>(`${this.baseUrl}/sites`);
  }

  // Batch operations
  async batchUpdate(operations: UpdateLocaleInput[]): Promise<BatchResult> {
    return this.fetchAPI<BatchResult>(`${this.baseUrl}/content/batch`, {
      method: 'POST',
      body: JSON.stringify({ operations }),
    });
  }

  // Git operations
  async getGitStatus(): Promise<GitStatus> {
    return this.fetchAPI<GitStatus>(`${this.baseUrl}/git/status`);
  }

  async commitChanges(message?: string): Promise<GitCommitResult> {
    return this.fetchAPI<GitCommitResult>(`${this.baseUrl}/git/commit`, {
      method: 'POST',
      body: JSON.stringify(message ? { message } : {}),
    });
  }

  async pushChanges(): Promise<GitPushResult> {
    return this.fetchAPI<GitPushResult>(`${this.baseUrl}/git/push`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
  }
}

// Custom error for API responses
export class APIClientError extends Error {
  constructor(
    message: string,
    public code: ErrorCode,
    public details?: any,
  ) {
    super(message);
    this.name = 'APIClientError';
  }
}

// Custom error for stale writes
export class StaleWriteError extends APIClientError {
  constructor(public data: { code: ErrorCode; message: string; currentEtag?: string }) {
    super(data.message, data.code, { currentEtag: data.currentEtag });
    this.name = 'StaleWriteError';
  }

  get currentEtag(): string | undefined {
    return this.details?.currentEtag;
  }
}
