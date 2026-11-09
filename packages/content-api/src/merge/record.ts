import type { JsonObject, JsonValue } from '../types.js';
import type { AnchorStep, Field, FieldConflict } from './types.js';

/** What a walk needs beyond the three values: the file type for anchors, the conflict sink and the null-clear roots. */
export interface WalkContext {
  fileType: Field;
  conflicts: FieldConflict[];
  clearedRoots: readonly string[];
}

/**
 * `value` as the JSON `JSON.stringify` would write: a record key holding `undefined` is dropped, and an `undefined` list
 * item, `NaN` or an infinity becomes `null`. `undefined` itself stays absent. `null` for anything else that is not JSON
 * (a `Date`, a class instance, a function). Every input crosses into the engine through here.
 */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- This function is the JSON parsing boundary.
export function parseJson(value: unknown): { json: Field } | null {
  if (value === undefined) return { json: undefined };
  if (typeof value === 'number') return { json: Number.isFinite(value) ? value : null };
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return { json: value };
  if (Array.isArray(value)) {
    const list: JsonValue[] = [];
    for (const item of value) {
      const parsed = parseJson(item);
      if (!parsed) return null;
      list.push(parsed.json ?? null);
    }
    return { json: list };
  }
  if (typeof value !== 'object') return null;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const record: JsonObject = {};
  for (const key of Object.keys(value)) {
    const parsed = parseJson(Object.getOwnPropertyDescriptor(value, key)?.value);
    if (!parsed) return null;
    if (parsed.json !== undefined) setOwn(record, key, parsed.json);
  }
  return { json: record };
}

/** A JSON record, as opposed to an array or a scalar. */
export function isRecord(value: Field): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Sets an own enumerable property; plain assignment of `__proto__` would swap the prototype instead. */
export function setOwn(target: JsonObject, key: string, value: JsonValue): void {
  if (key === '__proto__')
    Object.defineProperty(target, key, { value, enumerable: true, configurable: true, writable: true });
  else target[key] = value;
}

/** Structural equality with key order ignored, via a stable stringify. */
export function deepEqual(a: Field, b: Field): boolean {
  return stableStringify(a) === stableStringify(b);
}

function stableStringify(value: Field): string {
  if (value === undefined) return 'undefined';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  const entries = Object.keys(value)
    // oxlint-disable-next-line unicorn/no-array-sort -- the target lib predates toSorted; this sorts a fresh local array.
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(Object.getOwnPropertyDescriptor(value, key)?.value)}`);
  return `{${entries.join(',')}}`;
}

/** The field walk, handed to the list merge so it can recurse without importing `json.ts` back. */
export type MergeField = (steps: AnchorStep[], base: Field, ours: Field, theirs: Field, ctx: WalkContext) => Field;

/** The diff walk, handed to the list diff the same way. */
export type DiffField = (
  steps: AnchorStep[],
  base: Field,
  next: Field,
  ctx: Omit<WalkContext, 'conflicts'>,
  out: string[],
) => void;
