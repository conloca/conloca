import type { z } from 'zod';
import { getDataSchema, getDataSchemas, hasDataSchemas } from '../data-schemas';

/**
 * Hook to get all data schemas.
 * Returns an empty object if no schemas are configured.
 */
export function useDataSchemas(): Record<string, z.ZodObject<z.ZodRawShape>> {
  return getDataSchemas();
}

/**
 * Hook to get the schema for a specific collection.
 *
 * @param collection - The collection name
 * @returns The Zod schema or null if not found
 */
export function useDataSchema(collection: string): z.ZodObject<z.ZodRawShape> | null {
  return getDataSchema(collection);
}

/**
 * Hook to check if any data schemas are configured.
 */
export function useHasDataSchemas(): boolean {
  return hasDataSchemas();
}
