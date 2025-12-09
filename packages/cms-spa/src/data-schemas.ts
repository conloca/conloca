import type { z } from 'zod';

/**
 * Type for a collection of data schemas.
 * Each key is a collection name, value is the Zod schema for that collection's data.
 */
export type DataSchemas = Record<string, z.ZodObject<z.ZodRawShape>>;

/**
 * Set the data schemas for all collections.
 * Called by the virtual module that loads user's schema definitions.
 *
 * @param schemas - Record mapping collection names to Zod schemas
 */
export function setDataSchemas(schemas: DataSchemas): void {
  if (typeof window !== 'undefined') {
    (window as any).__DATA_SCHEMAS__ = schemas;
  }
}
