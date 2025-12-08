import type { z } from 'zod';

/**
 * Type for a collection of data schemas.
 * Each key is a collection name, value is the Zod schema for that collection's data.
 */
export type DataSchemas = Record<string, z.ZodObject<z.ZodRawShape>>;

// Module-level storage for data schemas (no window global needed)
let dataSchemas: DataSchemas = {};

/**
 * Set the data schemas for all collections.
 * Called by the virtual module that loads user's schema definitions.
 *
 * @param schemas - Record mapping collection names to Zod schemas
 */
export function setDataSchemas(schemas: DataSchemas): void {
  dataSchemas = schemas;
}

/**
 * Get all data schemas.
 *
 * @returns Record of collection name to Zod schema
 */
export function getDataSchemas(): DataSchemas {
  return dataSchemas;
}

/**
 * Get the schema for a specific collection.
 *
 * @param collection - The collection name
 * @returns The Zod schema or null if not found
 */
export function getDataSchema(collection: string): z.ZodObject<z.ZodRawShape> | null {
  return dataSchemas[collection] ?? null;
}

/**
 * Check if any data schemas are configured.
 *
 * @returns true if at least one schema is configured
 */
export function hasDataSchemas(): boolean {
  return Object.keys(dataSchemas).length > 0;
}
