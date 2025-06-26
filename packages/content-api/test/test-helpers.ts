import type {
  BatchResult,
  ContentEntry,
  ContentListResult,
  CreateResult,
  DeleteResult,
  LocalizedEntry,
  UpdateResult,
} from '../src/types';

// Type guard functions for test assertions

export function isContentWithLocales(value: unknown): value is ContentEntry {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    'site' in value &&
    'collection' in value &&
    'type' in value &&
    'locales' in value
  );
}

export function isLocalizedContent(value: unknown): value is LocalizedEntry {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    'site' in value &&
    'collection' in value &&
    'type' in value &&
    'localized' in value &&
    typeof (value as any).localized === 'object' &&
    'locale' in (value as any).localized &&
    'etag' in (value as any).localized &&
    'meta' in (value as any).localized &&
    'content' in (value as any).localized
  );
}

export function isCreateSuccess(result: CreateResult): result is CreateResult & { success: true; id: string } {
  return result.success === true && typeof result.id === 'string';
}

export function isUpdateSuccess(result: UpdateResult): result is UpdateResult & { success: true; etag: string } {
  return result.success === true && typeof result.etag === 'string';
}

export function isDeleteSuccess(result: DeleteResult): result is DeleteResult & { success: true } {
  return result.success === true;
}

export function isBatchSuccess(result: BatchResult): result is BatchResult & { success: true } {
  return result.success === true;
}

export function isContentListResult(value: unknown): value is ContentListResult {
  return (
    typeof value === 'object' &&
    value !== null &&
    'items' in value &&
    'total' in value &&
    Array.isArray((value as { items: unknown }).items) &&
    typeof (value as { total: unknown }).total === 'number'
  );
}

// Response type guards for middleware tests

export interface JsonResponse<T = unknown> {
  status: number;
  headers: Headers;
  data: T;
}

export async function parseJsonResponse<T = unknown>(res: Response): Promise<JsonResponse<T>> {
  const data = await res.json();
  return {
    status: res.status,
    headers: res.headers,
    data: data as T,
  };
}

export interface ContentListResponse {
  items: Array<{
    id: string;
    site: string;
    collection: string;
    locale: string;
    [key: string]: unknown;
  }>;
  total: number;
}

export function isContentListResponse(data: unknown): data is ContentListResponse {
  return (
    typeof data === 'object' &&
    data !== null &&
    'items' in data &&
    'total' in data &&
    Array.isArray((data as { items: unknown }).items)
  );
}

export interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: any;
  };
  [key: string]: unknown;
}

export function isErrorResponse(data: unknown): data is ErrorResponse {
  return (
    typeof data === 'object' &&
    data !== null &&
    'error' in data &&
    typeof (data as any).error === 'object' &&
    'code' in (data as any).error &&
    'message' in (data as any).error
  );
}

export interface SuccessResponse {
  success: boolean;
  [key: string]: unknown;
}

export function isSuccessResponse(data: unknown): data is SuccessResponse {
  return typeof data === 'object' && data !== null && 'success' in data;
}

// Create result that could be failure
export function isCreateResult(data: unknown): data is CreateResult {
  return (
    typeof data === 'object' &&
    data !== null &&
    'success' in data &&
    typeof (data as { success: unknown }).success === 'boolean'
  );
}

export interface CollectionsResponse {
  collections: string[];
}

export function isCollectionsResponse(data: unknown): data is CollectionsResponse {
  return (
    typeof data === 'object' &&
    data !== null &&
    'collections' in data &&
    Array.isArray((data as { collections: unknown }).collections)
  );
}

export interface SitesConfigResponse {
  sites: Record<string, unknown>;
  globalLocales: string[];
}

export function isSitesConfigResponse(data: unknown): data is SitesConfigResponse {
  return (
    typeof data === 'object' &&
    data !== null &&
    'sites' in data &&
    'globalLocales' in data &&
    typeof (data as { sites: unknown }).sites === 'object' &&
    Array.isArray((data as { globalLocales: unknown }).globalLocales)
  );
}

export interface PathnameAvailableResponse {
  available: boolean;
  existingId?: string;
}

export function isPathnameAvailableResponse(data: unknown): data is PathnameAvailableResponse {
  return (
    typeof data === 'object' &&
    data !== null &&
    'available' in data &&
    typeof (data as { available: unknown }).available === 'boolean'
  );
}

export interface NameAvailableResponse {
  available: boolean;
  existingId?: string;
}

export function isNameAvailableResponse(data: unknown): data is NameAvailableResponse {
  return (
    typeof data === 'object' &&
    data !== null &&
    'available' in data &&
    typeof (data as { available: unknown }).available === 'boolean'
  );
}

export interface BatchResponse {
  success: boolean;
  updated: number;
  failed: number;
}

export function isBatchResponse(data: unknown): data is BatchResponse {
  return (
    typeof data === 'object' &&
    data !== null &&
    'success' in data &&
    'updated' in data &&
    'failed' in data &&
    typeof (data as { success: unknown }).success === 'boolean' &&
    typeof (data as { updated: unknown }).updated === 'number' &&
    typeof (data as { failed: unknown }).failed === 'number'
  );
}

// Helper to assert defined values without non-null assertion
export function assertDefined<T>(value: T | null | undefined, message?: string): asserts value is T {
  if (value === null || value === undefined) {
    throw new Error(message || 'Expected value to be defined');
  }
}

// Helper to extract ID from create result safely
export function getCreatedId(result: CreateResult): string {
  if (!isCreateSuccess(result)) {
    throw new Error(`Create failed: ${result.reason || 'unknown error'}`);
  }
  return result.id;
}

// Helper to extract etag from update result safely
export function getUpdateEtag(result: UpdateResult): string {
  if (!isUpdateSuccess(result)) {
    throw new Error(`Update failed: ${result.reason || 'unknown error'}`);
  }
  return result.etag;
}
