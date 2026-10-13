import type { z } from 'zod';

export interface FieldInfo {
  type: 'string' | 'number' | 'boolean' | 'date' | 'array' | 'enum';
  format?: 'url' | 'email' | 'date-time';
  /** Help text the schema gives the field, from .describe() or .meta({ description }). */
  description?: string;
  isOptional: boolean;
  isNullable: boolean;
  enumValues?: string[];
  maxLength?: number;
}

/* oxlint-disable no-underscore-dangle -- Zod 3/4 expose these compatibility internals with underscore-prefixed names. */

interface ZodCompat {
  _def?: ZodDef;
  _zod?: { def?: ZodDef };
  description?: string;
  options?: string[];
}

interface ZodDef {
  typeName?: string;
  type?: string;
  check?: string;
  format?: string;
  kind?: string;
  maximum?: number;
  value?: number;
  innerType?: ZodCompat;
  values?: string[] | Record<string, string | number>;
  checks?: ZodCheck[];
}

interface ZodCheck extends ZodDef {
  _zod?: { def?: ZodDef };
}

function definition(schema: ZodCompat): ZodDef | undefined {
  return schema._def ?? schema._zod?.def;
}

function getZodTypeName(def: ZodDef): string {
  if (typeof def.typeName === 'string') return def.typeName;
  return typeof def.type === 'string' ? def.type : '';
}

function readStringCheck(def: ZodDef): Pick<FieldInfo, 'format' | 'maxLength'> {
  const format = def.check === 'string_format' ? def.format : def.kind;
  if (format === 'url' || format === 'email') return { format };
  if (def.check === 'max_length' && typeof def.maximum === 'number') return { maxLength: def.maximum };
  if (def.kind === 'max' && typeof def.value === 'number') return { maxLength: def.value };
  return {};
}

/**
 * Introspects the subset of Zod 3/4 internals required to render form hints.
 * The single assertion is the compatibility boundary; every field read after
 * it is represented explicitly by ZodCompat/ZodDef.
 */
export function getZodFieldInfo(field: z.ZodRawShape[string]): FieldInfo {
  // SAFETY: both supported Zod generations expose either _def or _zod.def;
  // ZodCompat contains only optional fields read by this compatibility adapter.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- documented third-party compatibility boundary
  let current = field as ZodCompat;
  let isOptional = false;
  let isNullable = false;
  let helpText: string | undefined;

  while (true) {
    helpText ??= current.description;
    const def = definition(current);
    if (!def) break;
    const typeName = getZodTypeName(def);

    if (typeName === 'ZodOptional' || typeName === 'optional') {
      isOptional = true;
    } else if (typeName === 'ZodNullable' || typeName === 'nullable') {
      isNullable = true;
    } else if (typeName !== 'ZodDefault' && typeName !== 'default') {
      break;
    }

    if (!def.innerType) break;
    current = def.innerType;
  }

  const def = definition(current);
  const typeName = def ? getZodTypeName(def) : '';

  if (typeName === 'ZodEnum' || typeName === 'enum') {
    const enumValues = Array.isArray(def?.values)
      ? def.values.filter((value): value is string => typeof value === 'string')
      : (current.options ?? []);
    return { type: 'enum', enumValues, description: helpText, isOptional, isNullable };
  }
  if (typeName === 'ZodNativeEnum' || typeName === 'nativeEnum') {
    const values = def?.values;
    const enumValues =
      values && !Array.isArray(values)
        ? Object.values(values).filter((value): value is string => typeof value === 'string')
        : [];
    return { type: 'enum', enumValues, description: helpText, isOptional, isNullable };
  }
  if (typeName === 'ZodDate' || typeName === 'date') {
    return { type: 'date', format: 'date-time', description: helpText, isOptional, isNullable };
  }
  if (typeName === 'ZodBoolean' || typeName === 'boolean') {
    return { type: 'boolean', description: helpText, isOptional, isNullable };
  }

  if (typeName === 'ZodNumber' || typeName === 'number') {
    return { type: 'number', description: helpText, isOptional, isNullable };
  }
  if (typeName === 'ZodArray' || typeName === 'array') {
    return { type: 'array', description: helpText, isOptional, isNullable };
  }
  if (typeName === 'ZodString' || typeName === 'string') {
    const checks = def?.checks ?? [];
    const constraints = [def, ...checks.map((check) => check._zod?.def ?? check)]
      .filter((check): check is ZodDef => check !== undefined)
      .map(readStringCheck);
    const format = constraints.find((constraint) => constraint.format)?.format;
    const maxLength = constraints.find((constraint) => constraint.maxLength !== undefined)?.maxLength;
    return { type: 'string', format, description: helpText, isOptional, isNullable, maxLength };
  }

  return { type: 'string', description: helpText, isOptional, isNullable };
}

export function getZodShape(schema: z.ZodObject<z.ZodRawShape>): Record<string, FieldInfo> {
  const result: Record<string, FieldInfo> = {};
  for (const [key, field] of Object.entries(schema.shape)) result[key] = getZodFieldInfo(field);
  return result;
}
