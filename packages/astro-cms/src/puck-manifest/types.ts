import type { JsonValue } from '@conloca/content-api';

export type { JsonValue };

/**
 * Machine-readable description of a site's Puck config, read from source
 * without executing it. Consumed by agents that edit a site's content and have
 * no checkout — they need to know what components exist and what each accepts
 * before they can compose a page.
 */
export interface PuckManifest {
  components: Record<string, ManifestComponent>;
  /**
   * Page-level fields from the config's `root`. `fieldsUnreadable` means what
   * it means on a component: some of the set could not be read, the entries
   * listed are the ones it provably declares, and any other prop may exist.
   */
  root?: { fields: Record<string, ManifestField>; fieldsUnreadable?: true };
  /** Sidebar grouping, as declared in `categories`. */
  categories?: Record<string, { title?: string; components: string[] }>;
  /**
   * Some of `categories` could not be read: the value as a whole, a category
   * whose name or entry is written in a shape this reader cannot follow, or a
   * title or component list it could not take. The categories listed are ones
   * the config provably declares, with their components; others may exist,
   * and a listed one may carry a title that is missing here.
   */
  categoriesUnreadable?: true;
  /** Components named in `components` whose definition could not be resolved. */
  unresolved: string[];
  /**
   * Why a name in `unresolved` could not be followed, where a reason is known —
   * e.g. "the function is async, so the call returns a promise rather than a
   * component". Diagnostic prose for humans
   * and doctors, not a contract: keys are a subset of `unresolved`.
   */
  unresolvedReasons?: Record<string, string>;
  /**
   * The config may declare components this manifest cannot name. With no
   * components listed, the names are unknown altogether: the file cannot be
   * opened, it exports no object, its component map is written in a shape
   * this reader cannot follow, or reading it — or sending what it reads — would
   * cost more than the reader allows. The empty manifest is an admission, not
   * a site that declares no components. With components listed, those are provably
   * declared, and a spread, a computed name or a prototype this reader cannot
   * follow may add others.
   */
  unreadable?: true;
  /**
   * Why `unreadable` is set, beside every one. With no components listed: its
   * file could not be opened, it or a file it loads does not parse, it has no
   * default export, its
   * default export or its components map is not an object this reader can
   * read, or reading it — or the manifest it makes — would cost more than the
   * reader allows. With components listed: the write in the components map
   * that may add others. Written for the site's developer; prose, not a
   * contract.
   */
  unreadableReason?: string;
}

export interface ManifestComponent {
  label?: string;
  fields: Record<string, ManifestField>;
  defaultProps?: Record<string, JsonValue>;
  /** Puck's own agent annotations, copied verbatim. */
  ai?: JsonValue;
  /**
   * Some of the `fields` value could not be followed — a getter, a call, a
   * name leading nowhere, or a spread or computed key inside the set that may
   * add or replace any entry. A name that DOES lead somewhere is followed, so
   * this marks what stayed unknown rather than merely what was named. The
   * entries listed above are the ones the set provably declares — none, when
   * the value as a whole was unreadable — and any other prop may exist too.
   */
  fieldsUnreadable?: true;
  /**
   * Keys the source writes that could not be read, in whole or in part —
   * `label: makeLabel()`, a `defaultProps` entry computed at runtime, a
   * computed key that may have replaced any of them. Such a key is absent from
   * this entry, or carries only the part that did read; what is missing is
   * unknown rather than absent. `fields` has `fieldsUnreadable` instead.
   *
   * A behaviour key listed here — `resolveFields`, `resolveData`,
   * `resolvePermissions` — is one a computed key this reader cannot name may
   * have written or erased, so whether its marker below applies cannot be
   * read, and the marker is left off.
   */
  unreadableKeys?: ('label' | 'defaultProps' | 'ai' | 'resolveFields' | 'resolveData' | 'resolvePermissions')[];
  /** Field list is computed at render (`resolveFields`); the read list is a superset. */
  dynamicFields?: true;
  /** Props may be overwritten at render (`resolveData`). */
  derivedProps?: true;
  /** Placement or cardinality limited by `resolvePermissions` — the rule itself is code and unreadable. */
  hasPlacementRules?: true;
}

export interface ManifestField {
  type: string;
  label?: string;
  /** `radio` / `select` choices. */
  options?: Array<{ label: JsonValue; value: JsonValue }>;
  /** `array` item fields. */
  arrayFields?: Record<string, ManifestField>;
  /** `object` sub-fields. */
  objectFields?: Record<string, ManifestField>;
  /** Value bounds on a `number` field; item-count bounds on an `array` field. */
  min?: number;
  max?: number;
  /** `slot` nesting rules — what may and may not be dropped inside. */
  allow?: string[];
  disallow?: string[];
  ai?: JsonValue;
  /** A `custom` or `external` field with no `ai.schema`: nothing can infer its shape. */
  opaque?: true;
  /**
   * Some part of this field is written in a shape this reader cannot follow: a
   * function (`defaultItemProps: () => …`), a spread leading nowhere, a key it
   * cannot name (`[key]: …`), a prototype set with `__proto__`, a name whose
   * declaration could not be reached (`options: buildOptions()`), or an
   * options list that is not `{ label, value }` pairs. A plain name IS
   * followed — `options: sizeOptions` and the shorthand `{ options }` read the
   * list, and a spread of a written-down source merges — so this marks what
   * stayed unknown, not merely what was named. Whatever is missing from the
   * properties above is unknown, not absent, and a write this reader could not
   * name takes every value read before it.
   *
   * On a `slot` it stands for rules written somewhere this reader does not
   * look: Puck takes `allow`/`disallow` from the field or from the slot the
   * component's `render` draws, so a slot writing neither here has nesting
   * rules that are unknown rather than none.
   *
   * Beside `type: 'unknown'` it says something stronger: the entry is not a
   * field declaration this reader could recognise at all — nothing it or its
   * spreads write mentions a type — so the prop is named and nothing about its
   * shape is claimed.
   */
  unreadable?: true;
}
