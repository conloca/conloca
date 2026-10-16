/**
 * Generated validators for the content metadata shapes.
 *
 * Every `typia.createValidate<T>()` below is rewritten into concrete generated
 * validation code by the `ttsc` transform (spec 12 §The build chain) — in
 * tsdown's Rolldown pipeline for the published build, and by the Bun test
 * preload for `bun test`. Nothing here hand-rolls a check.
 *
 * `parse*` is the replacement for the Zod schemas' `safeParse`: normalize first
 * (`./normalize` reproduces what Zod did implicitly: the fresh copy, the
 * unknown-key strip of the strict shapes, the date coercion and the `.url()`
 * check), then validate with `typia.createValidate<T>()`.
 *
 * `canonical` deliberately carries no `tags.Format<'url'>`: Typia's URL regex
 * rejects URLs Zod accepted (`https://example.com?lang=en`, `#top`,
 * `http://localhost:4321/`) and accepts ones it rejected (port 99999), so the
 * page parsers keep Zod's parser-based check in `normalize()` instead.
 */

import typia, { type IValidation } from 'typia';
import { normalize, PAGE_DATE_KEYS, PAGE_URL_KEYS, type ShapeFields } from './normalize.js';
import type {
  DataEditable,
  DataMeta,
  FragmentEditable,
  FragmentMeta,
  LooseDataMeta,
  LooseFragmentMeta,
  LoosePageMeta,
  MdxPageFrontmatter,
  PageEditable,
  PageMeta,
  SchemaIssue,
  SchemaParseResult,
} from './types.js';

/** Field names `PageMeta` declares — the fields a host page schema may not redeclare. */
export const PAGE_META_KEYS: readonly (keyof PageMeta)[] = typia.reflect.literals<keyof PageMeta>();

const validatePageEditable = typia.createValidate<PageEditable>();
const validatePageMeta = typia.createValidate<PageMeta>();
const validateFragmentEditable = typia.createValidate<FragmentEditable>();
const validateFragmentMeta = typia.createValidate<FragmentMeta>();
const validateMdxPageFrontmatter = typia.createValidate<MdxPageFrontmatter>();
const validateDataEditable = typia.createValidate<DataEditable>();
const validateDataMeta = typia.createValidate<DataMeta>();
const validateLoosePageMeta = typia.createValidate<LoosePageMeta>();
const validateLooseFragmentMeta = typia.createValidate<LooseFragmentMeta>();
const validateLooseDataMeta = typia.createValidate<LooseDataMeta>();

/** Typia's `IError` already carries path/expected/value; copy it so no Typia type reaches the public API. */
function toIssues(errors: readonly IValidation.IError[]): SchemaIssue[] {
  return errors.map((error) => ({ path: error.path, expected: error.expected, value: error.value }));
}

/** The field names `T` declares, without an index signature's `string`/`number`. */
type DeclaredKey<T> = keyof {
  [K in keyof T as string extends K ? never : number extends K ? never : K]: T[K];
};

/** Page shapes: the former `z.coerce.date()` and `z.string().url()` fields. */
const PAGE_EDITABLE_FIELDS: ShapeFields = {
  declared: typia.reflect.literals<keyof PageEditable>(),
  keepsUndeclared: false,
  dates: PAGE_DATE_KEYS,
  urls: PAGE_URL_KEYS,
};
const PAGE_META_FIELDS: ShapeFields = { ...PAGE_EDITABLE_FIELDS, declared: PAGE_META_KEYS };
const LOOSE_PAGE_META_FIELDS: ShapeFields = { ...PAGE_META_FIELDS, keepsUndeclared: true };
/** Fragment shapes: the `z.array()` tags. */
const FRAGMENT_EDITABLE_FIELDS: ShapeFields = {
  declared: typia.reflect.literals<keyof FragmentEditable>(),
  keepsUndeclared: false,
  arrays: ['tags'],
};
const FRAGMENT_META_FIELDS: ShapeFields = {
  ...FRAGMENT_EDITABLE_FIELDS,
  declared: typia.reflect.literals<keyof FragmentMeta>(),
};
const LOOSE_FRAGMENT_META_FIELDS: ShapeFields = { ...FRAGMENT_META_FIELDS, keepsUndeclared: true };
const MDX_PAGE_FRONTMATTER_FIELDS: ShapeFields = {
  declared: typia.reflect.literals<DeclaredKey<MdxPageFrontmatter>>(),
  keepsUndeclared: true,
};
/** Data shapes: the tags, plus the `z.record()` payload on the full one. */
const DATA_EDITABLE_FIELDS: ShapeFields = {
  declared: typia.reflect.literals<keyof DataEditable>(),
  keepsUndeclared: false,
  arrays: ['tags'],
};
const DATA_META_FIELDS: ShapeFields = {
  declared: typia.reflect.literals<keyof DataMeta>(),
  keepsUndeclared: false,
  arrays: ['tags'],
  records: ['data'],
};
const LOOSE_DATA_META_FIELDS: ShapeFields = { ...DATA_META_FIELDS, keepsUndeclared: true };

/**
 * Normalize, then validate, folding in the failures a generated validator
 * cannot see: an Invalid Date (`new Date('nonsense')` is a `Date`, so every
 * structural check passes while Zod rejected it as `expected: date`), a URL
 * field the URL parser rejects, and a record field Zod's plain-object check
 * rejected. A field the generated validator already reported is reported once.
 */
function parseWith<T>(
  input: unknown,
  fields: ShapeFields,
  validate: (input: unknown) => IValidation<T>,
): SchemaParseResult<T> {
  const { value, issues } = normalize(input, fields);
  const result = validate(value);
  if (!result.success) {
    const reported = new Set(result.errors.map((error) => error.path));
    return {
      success: false,
      issues: [...toIssues(result.errors), ...issues.filter((issue) => !reported.has(issue.path))],
    };
  }
  if (issues.length > 0) return { success: false, issues };
  return { success: true, data: result.data };
}

/** Editable page fields: unknown keys stripped, `publishAt`/`unpublishAt` coerced to `Date`, `canonical` checked. */
export function parsePageEditable(input: unknown): SchemaParseResult<PageEditable> {
  return parseWith(input, PAGE_EDITABLE_FIELDS, validatePageEditable);
}

/** Full page metadata: editable fields plus `id`/`locale`, same strip, date coercion and URL check. */
export function parsePageMeta(input: unknown): SchemaParseResult<PageMeta> {
  return parseWith(input, PAGE_META_FIELDS, validatePageMeta);
}

/** Editable fragment fields; unknown keys stripped. */
export function parseFragmentEditable(input: unknown): SchemaParseResult<FragmentEditable> {
  return parseWith(input, FRAGMENT_EDITABLE_FIELDS, validateFragmentEditable);
}

/** Full fragment metadata: editable fields plus `id`/`locale`/`name`. */
export function parseFragmentMeta(input: unknown): SchemaParseResult<FragmentMeta> {
  return parseWith(input, FRAGMENT_META_FIELDS, validateFragmentMeta);
}

/** MDX page frontmatter; undeclared keys are preserved (the former `.passthrough()`). */
export function parseMdxPageFrontmatter(input: unknown): SchemaParseResult<MdxPageFrontmatter> {
  return parseWith(input, MDX_PAGE_FRONTMATTER_FIELDS, validateMdxPageFrontmatter);
}

/** Editable data-entry fields; unknown keys stripped. */
export function parseDataEditable(input: unknown): SchemaParseResult<DataEditable> {
  return parseWith(input, DATA_EDITABLE_FIELDS, validateDataEditable);
}

/** Full data-entry metadata: editable fields plus `id`/`locale`/`name` and the `data` payload. */
export function parseDataMeta(input: unknown): SchemaParseResult<DataMeta> {
  return parseWith(input, DATA_META_FIELDS, validateDataMeta);
}

/**
 * A page collection entry: the declared page fields validated, dates coerced and
 * `canonical` URL-checked, every undeclared top-level field kept (the former
 * `pageMetaSchema.loose()`).
 */
export function parseLoosePageMeta(input: unknown): SchemaParseResult<LoosePageMeta> {
  return parseWith(input, LOOSE_PAGE_META_FIELDS, validateLoosePageMeta);
}

/** A fragment collection entry; undeclared top-level fields kept (the former `fragmentMetaSchema.loose()`). */
export function parseLooseFragmentMeta(input: unknown): SchemaParseResult<LooseFragmentMeta> {
  return parseWith(input, LOOSE_FRAGMENT_META_FIELDS, validateLooseFragmentMeta);
}

/** A data collection entry; undeclared top-level fields kept (the former `dataMetaSchema.loose()`). */
export function parseLooseDataMeta(input: unknown): SchemaParseResult<LooseDataMeta> {
  return parseWith(input, LOOSE_DATA_META_FIELDS, validateLooseDataMeta);
}
