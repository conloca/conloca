import type { z } from 'zod';

export interface FieldInfo {
  type: 'string' | 'number' | 'boolean' | 'date' | 'array' | 'enum';
  format?: 'url' | 'email' | 'date-time';
  description?: string;
  isOptional: boolean;
  isNullable: boolean;
  /** For enum types, the list of allowed values */
  enumValues?: string[];
}

/**
 * Gets the Zod type name from _def, supporting both old (typeName) and new (type) API.
 */
function getZodTypeName(def: Record<string, unknown>): string {
  // Zod 3.x uses typeName, Zod 4.x/mini uses type
  return (def.typeName as string) || (def.type as string) || '';
}

/**
 * Introspects a Zod field to extract type and validation information.
 * Note: Uses Zod's internal `._def` structure which is stable but not public API.
 * Supports both Zod 3.x (typeName) and Zod 4.x/mini (type) structures.
 */
export function getZodFieldInfo(field: z.ZodTypeAny): FieldInfo {
  let current = field;
  let isOptional = false;
  let isNullable = false;
  let description: string | undefined;

  // Unwrap optional/nullable/default wrappers to get to the inner type
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  while (current._def) {
    const typeName = getZodTypeName(current._def as Record<string, unknown>);

    if (typeName === 'ZodOptional' || typeName === 'optional') {
      isOptional = true;
      current = current._def.innerType;
    } else if (typeName === 'ZodNullable' || typeName === 'nullable') {
      isNullable = true;
      current = current._def.innerType;
    } else if (typeName === 'ZodDefault' || typeName === 'default') {
      current = current._def.innerType;
    } else {
      break;
    }
  }

  description = current._def.description;
  const typeName = getZodTypeName(current._def as Record<string, unknown>);

  // Detect type and format based on Zod type
  if (typeName === 'ZodEnum' || typeName === 'enum') {
    // ZodEnum: Zod 3.x uses _def.values, Zod 4.x uses .options on the schema itself
    const enumValues =
      (current._def.values as string[]) || ((current as unknown as { options?: string[] }).options as string[]) || [];
    return { type: 'enum', enumValues, description, isOptional, isNullable };
  }
  if (typeName === 'ZodNativeEnum' || typeName === 'nativeEnum') {
    // ZodNativeEnum stores values in _def.values as an object
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
    // Check for URL/email validators in string checks
    const checks = (current._def.checks as Array<{ kind: string }>) || [];
    for (const check of checks) {
      if (check.kind === 'url') {
        return { type: 'string', format: 'url', description, isOptional, isNullable };
      }
      if (check.kind === 'email') {
        return { type: 'string', format: 'email', description, isOptional, isNullable };
      }
    }
    return { type: 'string', description, isOptional, isNullable };
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
