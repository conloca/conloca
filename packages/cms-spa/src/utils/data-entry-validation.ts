import type { HostSchema } from '../host-schema.js';

/**
 * Why the build would reject `values` as a data entry of `schema`, or null when it accepts them.
 *
 * Only the verdict is read: a pruning validator (`typia.plain.createValidatePrune`) drops undeclared
 * keys from what it validates, so it gets a copy and the caller stores `values` as they are, keys
 * written outside the form included.
 */
export function validateEntryData(schema: HostSchema, values: Record<string, unknown>): string | null {
  const result = schema.validate(structuredClone(values));
  if (result.success) return null;
  const fields = result.errors.map((error) => `${error.path.replace(/^\$input\./, '')} (expected ${error.expected})`);
  return `Fix these fields before saving: ${fields.join(', ')}`;
}
