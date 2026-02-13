import type { z } from 'zod';

export interface FieldInfo {
  type: 'string' | 'number' | 'boolean' | 'date' | 'array' | 'enum';
  format?: 'url' | 'email' | 'date-time';
  description?: string;
  isOptional: boolean;
  isNullable: boolean;
  /** For enum types, the list of allowed values */
  enumValues?: string[];
  /** For string types, the max length constraint if defined */
  maxLength?: number;
}

// Internal Zod def shape — intentionally loosely typed since we access internals
type ZodDef = Record<string, unknown>;

/**
 * Gets the Zod type name from _def, supporting both old (typeName) and new (type) API.
 */
function getZodTypeName(def: ZodDef): string {
  // Zod 3.x uses typeName, Zod 4.x/mini uses type
  return (def.typeName as string) || (def.type as string) || '';
}

/**
 * Introspects a Zod field to extract type and validation information.
 * Note: Uses Zod's internal `._def` structure which is stable but not public API.
 * Supports both Zod 3.x (typeName) and Zod 4.x/mini (type) structures.
 */
export function getZodFieldInfo(field: z.ZodTypeAny): FieldInfo {
  let current: { _def: ZodDef } = field as unknown as { _def: ZodDef };
  let isOptional = false;
  let isNullable = false;
  let description: string | undefined;

  // Unwrap optional/nullable/default wrappers to get to the inner type
  while (current._def) {
    const typeName = getZodTypeName(current._def);

    if (typeName === 'ZodOptional' || typeName === 'optional') {
      isOptional = true;
      current = current._def.innerType as { _def: ZodDef };
    } else if (typeName === 'ZodNullable' || typeName === 'nullable') {
      isNullable = true;
      current = current._def.innerType as { _def: ZodDef };
    } else if (typeName === 'ZodDefault' || typeName === 'default') {
      current = current._def.innerType as { _def: ZodDef };
    } else {
      break;
    }
  }

  description = current._def.description as string | undefined;
  const typeName = getZodTypeName(current._def);

  // Detect type and format based on Zod type
  if (typeName === 'ZodEnum' || typeName === 'enum') {
    const enumValues =
      (current._def.values as string[]) || ((current as unknown as { options?: string[] }).options as string[]) || [];
    return { type: 'enum', enumValues, description, isOptional, isNullable };
  }
  if (typeName === 'ZodNativeEnum' || typeName === 'nativeEnum') {
    const nativeEnum = current._def.values as Record<string, string | number>;
    const enumValues = Object.values(nativeEnum).filter((v) => typeof v === 'string') as string[];
    return { type: 'enum', enumValues, description, isOptional, isNullable };
  }
  if (typeName === 'ZodDate' || typeName === 'date') {
    return { type: 'date', format: 'date-time', description, isOptional, isNullable };
  }
  if (typeName === 'ZodBoolean' || typeName === 'boolean') {
    return { type: 'boolean', description, isOptional, isNullable };
  }
  if (typeName === 'ZodNumber' || typeName === 'number') {
    return { type: 'number', description, isOptional, isNullable };
  }
  if (typeName === 'ZodArray' || typeName === 'array') {
    return { type: 'array', description, isOptional, isNullable };
  }
  if (typeName === 'ZodString' || typeName === 'string') {
    const checks = (current._def.checks as { kind: string; value?: number }[] | undefined) || [];
    for (const check of checks) {
      if (check.kind === 'url') {
        return { type: 'string', format: 'url', description, isOptional, isNullable };
      }
      if (check.kind === 'email') {
        return { type: 'string', format: 'email', description, isOptional, isNullable };
      }
    }
    const maxCheck = checks.find((c) => c.kind === 'max');
    const maxLength = maxCheck?.value;
    return { type: 'string', description, isOptional, isNullable, maxLength };
  }

  // Default fallback for unknown types
  return { type: 'string', description, isOptional, isNullable };
}

/**
 * Extracts field information from a Zod object schema.
 * Returns a record mapping field names to their FieldInfo.
 */
export function getZodShape(schema: z.ZodObject<z.ZodRawShape>): Record<string, FieldInfo> {
  const shape = schema.shape;
  const result: Record<string, FieldInfo> = {};

  for (const [key, field] of Object.entries(shape)) {
    result[key] = getZodFieldInfo(field as z.ZodTypeAny);
  }

  return result;
}
