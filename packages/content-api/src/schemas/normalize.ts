/**
 * The value rewriting the replaced Zod schemas performed before validating that
 * Typia does not do, spelled out as pure functions.
 *
 * Typia validates the value it is given — it never coerces and never copies —
 * so these Zod steps are explicit here, each unit-tested against the recorded
 * Zod behaviour: the fresh object every Zod parse returned, holding the
 * declared fields (and, for `.loose()`/`.passthrough()`, the undeclared ones)
 * with arrays and records copied; `z.coerce.date()`; and `z.string().url()`
 * (Zod's check is "the URL parser accepts it" and it rewrites the value, which
 * Typia's `tags.Format<'url'>` regex neither matches nor does).
 */

import type { SchemaIssue } from './types.js';

/** The page fields that were declared `z.coerce.date().nullable().optional()`. */
export const PAGE_DATE_KEYS = ['publishAt', 'unpublishAt'] as const;

/** The page fields that were declared `z.string().url().optional()`. */
export const PAGE_URL_KEYS = ['canonical'] as const;

/** The `expected` a rejected URL field reports, in Typia's notation. */
const URL_EXPECTED = 'string & Format<"url">';

/** The `expected` a rejected record field reports, in Typia's notation. */
const RECORD_EXPECTED = 'Record<string, unknown>';

/** The URL parser deletes every ASCII tab, LF and CR before parsing; so did Zod's output. */
const ASCII_TAB_OR_NEWLINE = /[\t\n\r]/g;

/** One shape's fields, by what normalization does with them. */
export interface ShapeFields {
  /**
   * Every field the shape declares. Zod read each by property lookup, so an
   * inherited or non-enumerable declared field counts; the copy carries it as
   * an own field.
   */
  readonly declared: readonly string[];
  /**
   * Whether undeclared fields survive the parse (`.loose()`/`.passthrough()`).
   * A strict shape never reads them, as `z.object()` never did, so a throwing
   * getter on a field the shape strips cannot fail the parse.
   */
  readonly keepsUndeclared: boolean;
  /** Fields declared `z.coerce.date().nullable().optional()`. */
  readonly dates?: readonly string[];
  /** Fields declared `z.string().url()`. */
  readonly urls?: readonly string[];
  /** Fields declared `z.array()`: an array is copied so the parsed one never aliases the caller's. */
  readonly arrays?: readonly string[];
  /**
   * Fields declared `z.record(z.string(), …)`: Zod accepted only a plain object
   * and returned a fresh one holding its own enumerable string keys.
   */
  readonly records?: readonly string[];
}

/** A normalized value plus the failures a generated validator cannot see in it. */
export interface Normalized {
  readonly value: unknown;
  readonly issues: readonly SchemaIssue[];
}

/** A non-null, non-array object — the only input shape normalization can rewrite. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * `z.coerce.date()` under a `.nullable().optional()` wrapper: `undefined` and
 * `null` short-circuit before coercion, anything else goes through `new Date()`.
 *
 * A `Date` input is cloned rather than passed through, which is what Zod did:
 * the parsed value never aliases the caller's Date, so mutating one cannot
 * reach through to the other.
 *
 * An uncoercible value yields an Invalid Date; that is not an error here.
 * `normalize()` reports it, because a `Date` carrying `NaN` still satisfies
 * every `instanceof Date` check a generated validator can make. That includes
 * values `new Date()` throws on (a BigInt, a Symbol, an object whose
 * `toString`/`valueOf` are not callable), so a parse reports them as an issue
 * instead of throwing.
 */
export function coerceNullableDate(value: unknown): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  try {
    return new Date(value as string | number);
  } catch {
    return new Date(Number.NaN);
  }
}

/**
 * `z.string().url()`: a string passes iff the WHATWG URL parser accepts it once
 * trimmed, and the parsed value is that trimmed string with ASCII tabs and
 * newlines removed (not the normalized `href`). `undefined` means rejected.
 */
export function coerceUrl(value: string): string | undefined {
  const trimmed = value.trim();
  try {
    new URL(trimmed);
  } catch {
    return undefined;
  }
  return trimmed.replace(ASCII_TAB_OR_NEWLINE, '');
}

/**
 * The value a validator may rewrite, and the issues only normalization can see.
 *
 * Every object input becomes a fresh top-level copy — as every Zod parse
 * returned one — so the parsed value never is the caller's. Like Zod's, the
 * copy reads each field once: first every `declared` field the input has
 * however it holds it (`key in input`: inherited, non-enumerable, a getter),
 * then, for a `keepsUndeclared` shape (`.loose()`), every other enumerable
 * field, own or inherited, by reference — except a `__proto__` key, which Zod
 * dropped. Then:
 * - `dates` are coerced, and each that ends up an Invalid Date is an issue
 *   (`expected: Date`), the way Zod reported it;
 * - `urls` holding a string are checked and rewritten by `coerceUrl()`, a
 *   rejected one is an issue; a non-string is left for the generated type check;
 * - `arrays` holding an array are copied;
 * - `records` holding a plain object are rebuilt by `copyRecord()`; any other
 *   object (an array, a `Date`, a class instance) is an issue, which the
 *   generated `Record<string, unknown>` check cannot be relied on to raise.
 *
 * A non-object passes through untouched for the validator to report.
 */
export function normalize(input: unknown, fields: ShapeFields): Normalized {
  if (!isRecord(input)) return { value: input, issues: [] };
  const value: Record<string, unknown> = {};
  for (const key of fields.declared) {
    if (key in input) value[key] = input[key];
  }
  if (fields.keepsUndeclared) {
    for (const key in input) {
      // Skipping `__proto__` also keeps the assignment below from setting the copy's prototype.
      if (key !== '__proto__' && !fields.declared.includes(key)) value[key] = input[key];
    }
  }
  const issues: SchemaIssue[] = [];
  for (const key of fields.dates ?? []) {
    if (!Object.hasOwn(value, key)) continue;
    const coerced = coerceNullableDate(value[key]);
    value[key] = coerced;
    if (coerced instanceof Date && Number.isNaN(coerced.getTime())) {
      issues.push({ path: `$input.${key}`, expected: 'Date', value: coerced });
    }
  }
  for (const key of fields.urls ?? []) {
    const raw = value[key];
    if (typeof raw !== 'string') continue;
    const coerced = coerceUrl(raw);
    if (coerced === undefined) issues.push({ path: `$input.${key}`, expected: URL_EXPECTED, value: raw });
    else value[key] = coerced;
  }
  for (const key of fields.arrays ?? []) {
    const raw = value[key];
    if (Array.isArray(raw)) value[key] = [...raw];
  }
  for (const key of fields.records ?? []) {
    const raw = value[key];
    if (typeof raw !== 'object' || raw === null) continue;
    const copy = Array.isArray(raw) ? undefined : copyRecord(raw);
    if (copy === undefined) issues.push({ path: `$input.${key}`, expected: RECORD_EXPECTED, value: raw });
    else value[key] = copy;
  }
  return { value, issues };
}

/**
 * `z.record(z.string(), z.unknown())`: `undefined` when Zod rejected the value,
 * else a fresh object with its own enumerable string keys. Zod's plain-object
 * test is constructor-based (`Object.create(null)` and objects inheriting from
 * a plain object pass; a `Date` or a class instance does not), it skipped a
 * `__proto__` key, and its string key schema rejected an enumerable symbol key.
 */
export function copyRecord(value: object): Record<string, unknown> | undefined {
  const valueConstructor: unknown = value.constructor;
  if (typeof valueConstructor === 'function') {
    const prototype: unknown = valueConstructor.prototype;
    if (typeof prototype !== 'object' || prototype === null) return undefined;
    if (!Object.hasOwn(prototype, 'isPrototypeOf')) return undefined;
  }
  if (Object.getOwnPropertySymbols(value).some((symbol) => Object.prototype.propertyIsEnumerable.call(value, symbol))) {
    return undefined;
  }
  const copy: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key !== '__proto__') copy[key] = entry;
  }
  return copy;
}
