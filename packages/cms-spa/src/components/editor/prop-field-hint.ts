import type { JsonValue } from '@conloca/mdx/render';
import { isJsonValue } from '../../live/messages.js';
import type { MdxComponentField } from '../../mdx-components.js';
import type { FieldHint } from '../../page-schemas.js';

function unknownField(field: never): never {
  throw new Error(`Unknown prop type ${JSON.stringify(field)}`);
}

/** The `HintForm` control for a descriptor prop, so list and object props get structured fields. */
export function propFieldHint(prop: MdxComponentField): FieldHint {
  const common = { label: prop.label, help: prop.help };
  switch (prop.type) {
    case 'list':
      return { ...common, control: 'array', of: propFieldHint(prop.of) };
    case 'object':
      return {
        ...common,
        control: 'object',
        fields: Object.fromEntries(Object.entries(prop.fields).map(([key, field]) => [key, propFieldHint(field)])),
      };
    case 'string':
      return prop.options?.length
        ? { ...common, control: 'select', options: prop.options }
        : { ...common, control: 'text' };
    case 'number':
      return { ...common, control: 'number' };
    case 'boolean':
      return { ...common, control: 'switch' };
    default:
      return unknownField(prop);
  }
}

export function emptyFieldValue(field: MdxComponentField): JsonValue {
  switch (field.type) {
    case 'object':
      return {};
    case 'list':
      return [];
    case 'string':
      return '';
    case 'number':
      return 0;
    case 'boolean':
      return false;
    default:
      return unknownField(field);
  }
}

/**
 * The JSON a `HintForm` draft stands for: list items `HintForm`'s Add item leaves `undefined` become
 * the field's empty value, keys a cleared input left `undefined` are dropped, and keys the descriptor
 * does not declare are kept in place, so a no-op edit serializes to the same JSON.
 */
export function normalizeFieldValue(field: MdxComponentField, value: unknown): JsonValue {
  if (field.type === 'list') {
    return Array.isArray(value)
      ? value.map((item) => (item === undefined ? emptyFieldValue(field.of) : normalizeFieldValue(field.of, item)))
      : [];
  }
  if (field.type === 'object') {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).flatMap(([key, v]: [string, unknown]): Array<[string, JsonValue]> => {
        if (v === undefined) return [];
        const sub = Object.keys(field.fields).includes(key) ? field.fields[key] : undefined;
        if (sub) return [[key, normalizeFieldValue(sub, v)]];
        return isJsonValue(v) ? [[key, v]] : [];
      }),
    );
  }
  return isJsonValue(value) ? value : emptyFieldValue(field);
}
