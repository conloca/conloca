import { type HostSchema, type HostSchemaMetadata, resolveHostJsonSchema, rootObjectOf } from '../host-schema.js';

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

/** A resolved form definition: one {@link FieldInfo} per field, in render order. */
export type FormFields = Record<string, FieldInfo>;

type JsonSchema = HostSchemaMetadata['schema'];

/** The control-relevant part of a field schema, after `$ref`s and `| null` are unwrapped. */
function describeField(
  metadata: HostSchemaMetadata,
  node: JsonSchema,
): Omit<FieldInfo, 'isOptional' | 'isNullable'> & {
  isNullable: boolean;
} {
  const resolved = resolveHostJsonSchema(metadata, node);
  const description = node.description ?? resolved?.description;
  const base = description === undefined ? {} : { description };
  if (!resolved) return { type: 'string', ...base, isNullable: false };

  if ('oneOf' in resolved) {
    const members = resolved.oneOf.map((member) => resolveHostJsonSchema(metadata, member));
    const isNullable = members.some((member) => member !== null && 'type' in member && member.type === 'null');
    const rest = members.filter((member) => !(member !== null && 'type' in member && member.type === 'null'));
    const constants = rest.flatMap((member) =>
      member !== null && 'const' in member && typeof member.const === 'string' ? [member.const] : [],
    );
    if (rest.length > 0 && constants.length === rest.length) {
      return { type: 'enum', enumValues: constants, ...base, isNullable };
    }
    const [only] = rest;
    if (rest.length === 1 && only) return { ...describeField(metadata, only), ...base, isNullable };
    // A union of unrelated shapes (`string | boolean`) has no single control;
    // the text input is the same fallback an unknown field always got.
    return { type: 'string', ...base, isNullable };
  }

  if ('const' in resolved) {
    return typeof resolved.const === 'string'
      ? { type: 'enum', enumValues: [resolved.const], ...base, isNullable: false }
      : { type: 'string', ...base, isNullable: false };
  }

  if (!('type' in resolved)) return { type: 'string', ...base, isNullable: false };
  switch (resolved.type) {
    case 'string': {
      if (resolved.format === 'date-time') return { type: 'date', format: 'date-time', ...base, isNullable: false };
      // A format and a length limit are independent constraints; the form keeps both.
      const limit = resolved.maxLength === undefined ? {} : { maxLength: resolved.maxLength };
      if (resolved.format === 'url' || resolved.format === 'uri') {
        return { type: 'string', format: 'url', ...base, ...limit, isNullable: false };
      }
      if (resolved.format === 'email') return { type: 'string', format: 'email', ...base, ...limit, isNullable: false };
      return { type: 'string', ...base, ...limit, isNullable: false };
    }
    case 'integer':
    case 'number':
      return { type: 'number', ...base, isNullable: false };
    case 'boolean':
      return { type: 'boolean', ...base, isNullable: false };
    case 'array':
      return { type: 'array', ...base, isNullable: false };
    case 'null':
      return { type: 'string', ...base, isNullable: true };
    default:
      return { type: 'string', ...base, isNullable: false };
  }
}

// Metadata is generated once and never mutated, so the derived form is too:
// resolving it once keeps every render handing out the same record.
const fieldsByMetadata = new WeakMap<HostSchemaMetadata, FormFields>();

/**
 * The form generated JSON Schema metadata (`typia.json.schema<T>()`) renders
 * as: one {@link FieldInfo} per top-level property, in declaration order,
 * optional when the property is not `required`.
 */
export function fieldsOfMetadata(metadata: HostSchemaMetadata): FormFields {
  const cached = fieldsByMetadata.get(metadata);
  if (cached) return cached;
  const root = rootObjectOf(metadata);
  const required = new Set(root?.required ?? []);
  const fields: FormFields = {};
  for (const [name, node] of Object.entries(root?.properties ?? {})) {
    fields[name] = { ...describeField(metadata, node), isOptional: !required.has(name) };
  }
  fieldsByMetadata.set(metadata, fields);
  return fields;
}

/** The form a {@link HostSchema} renders as — its metadata's {@link fieldsOfMetadata}. */
export function fieldsOfHostSchema(schema: HostSchema): FormFields {
  return fieldsOfMetadata(schema.metadata);
}
