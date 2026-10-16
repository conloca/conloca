/**
 * Content metadata shapes and their generated validators.
 *
 * Zod is gone from this package: the shapes are plain TypeScript types
 * (`./types`), the validators are Typia-generated (`./validators`), and the
 * coercion/strip behaviour the Zod schemas performed implicitly is explicit and
 * separately tested (`./normalize`).
 *
 * The `parseLoose*` variants are what `@conloca/astro-cms`'s loader validates
 * collection entries with before they reach Astro's data store.
 */

export type {
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
export {
  PAGE_META_KEYS,
  parseDataEditable,
  parseDataMeta,
  parseFragmentEditable,
  parseFragmentMeta,
  parseLooseDataMeta,
  parseLooseFragmentMeta,
  parseLoosePageMeta,
  parseMdxPageFrontmatter,
  parsePageEditable,
  parsePageMeta,
} from './validators.js';
