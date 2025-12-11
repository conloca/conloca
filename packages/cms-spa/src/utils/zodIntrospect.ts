import type { z } from 'zod';

export interface FieldInfo {
  type: 'string' | 'number' | 'boolean' | 'date' | 'array';
  format?: 'url' | 'email' | 'date-time';
  description?: string;
  isOptional: boolean;
  isNullable: boolean;
}

/**
 * Introspects a Zod field to extract type and validation information.
 * Note: Uses Zod's internal `._def` structure which is stable but not public API.
 */
export function getZodFieldInfo(field: z.ZodTypeAny): FieldInfo {
  let current = field;
  let isOptional = false;
  let isNullable = false;
  let description: string | undefined;

  // Unwrap optional/nullable/default wrappers to get to the inner type
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  while (current._def) {
    const typeName = current._def.typeName as string;

    if (typeName === 'ZodOptional') {
      isOptional = true;
      current = current._def.innerType;
    } else if (typeName === 'ZodNullable') {
      isNullable = true;
      current = current._def.innerType;
    } else if (typeName === 'ZodDefault') {
      current = current._def.innerType;
    } else {
      break;
    }
  }

  description = current._def.description;
  const typeName = current._def.typeName as string;

  // Detect type and format based on Zod type
  if (typeName === 'ZodDate') {
    return { type: 'date', format: 'date-time', description, isOptional, isNullable };
  }
  if (typeName === 'ZodBoolean') {
    return { type: 'boolean', description, isOptional, isNullable };
  }
  if (typeName === 'ZodNumber') {
    return { type: 'number', description, isOptional, isNullable };
  }
  if (typeName === 'ZodArray') {
    return { type: 'array', description, isOptional, isNullable };
  }
  if (typeName === 'ZodString') {
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
