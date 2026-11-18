/**
 * DECLARATION side of the MDX-components plugin API — the half a host's
 * schemas module needs. Deliberately free of editor runtime imports so it
 * evaluates anywhere a content config or test runner does (no DOM, no vite
 * transform): the editor runtime (GenericBlock, the shared registry) lives in
 * `mdx-components.ts`, which re-exports everything here for compatibility.
 * Mirrors the `page-schemas` / `page-schema-define` split.
 */
import { type FragmentOutlineProps, type JsonValue, outlineIdFor } from '@conloca/mdx/render';
import type { JsxEditorProps } from '@mdxeditor/editor';
import type { MdxJsxAttribute, MdxJsxFlowElement, MdxJsxTextElement } from 'mdast-util-mdx-jsx';
import type { ComponentType } from 'react';

/**
 * Plugin API for registering insertable content for the CMS editor.
 *
 * Two flavors live in the same registry:
 *
 * 1. JSX components (`kind: 'flow' | 'text'`) — typed MDX components with
 *    prop-editor forms and optional auto-import injection.
 * 2. Markdown snippets (`kind: 'snippet'`) — host-defined boilerplate
 *    chunks the toolbar/slash menu insert as raw MDX. Used for "starting
 *    points" that are pure prose (callouts, comparison tables, lists)
 *    rather than reusable JSX surfaces.
 *
 * Mirrors the shape of `page-schemas.ts` — same `define*` identity helper,
 * same `setX/getX/useX` triad backed by a shared window-state cell, same
 * HMR subscriber pattern. Hosts add an `mdxComponents` export to the file
 * pointed at by the Astro integration's `schemasPath` option; the virtual
 * module loader in `@conloca/astro-cms` picks it up alongside `pageSchemas`.
 *
 * Pruning caveat (JSX flavor only): when `import.from` is set, the import
 * is added/removed by `@mdxeditor/editor`'s own export pipeline, which
 * rebuilds the import block on every save from the components actually
 * referenced in the document. Unrelated author imports (types, side
 * effects) are dropped. See the astro-cms README for the full constraint.
 */

/** Fields every prop shares. `hidden` keeps a top-level prop out of the settings panel; its value is still kept. */
interface MdxComponentPropBase {
  name: string;
  required?: boolean;
  label?: string;
  help?: string;
  hidden?: boolean;
}

export type MdxComponentProp =
  | (MdxComponentPropBase & {
      type: 'string';
      defaultValue?: string;
      options?: ReadonlyArray<{ value: string; label: string }>;
    })
  | (MdxComponentPropBase & { type: 'number'; defaultValue?: number })
  | (MdxComponentPropBase & { type: 'boolean'; defaultValue?: boolean })
  | (MdxComponentPropBase & { type: 'list'; of: MdxComponentField })
  | (MdxComponentPropBase & { type: 'object'; fields: Record<string, MdxComponentField> });

/** A list item or object field: an `MdxComponentProp` without `name`. */
export type MdxComponentField = MdxComponentProp extends infer P
  ? P extends MdxComponentProp
    ? Omit<P, 'name'>
    : never
  : never;

export interface MdxComponentInsertHint {
  /** Human-readable label shown in the slash menu and the toolbar dropdown. */
  label: string;
  /** Optional one-line description shown under the label in the slash menu. */
  description?: string;
  /** Optional Lucide icon name (rendered by the existing icon registry). */
  icon?: string;
  /** Aliases that match in slash-menu search ('callout' would match Aside). */
  keywords?: ReadonlyArray<string>;
  /**
   * Optional grouping label for the toolbar dropdown. Descriptors with the
   * same `category` render under a shared section header; descriptors that
   * omit it land in the default ungrouped bucket. Slash-menu rendering
   * currently ignores this — typeahead works better as a flat list.
   */
  category?: string;
}

/**
 * JSX component descriptor — a typed MDX surface the editor can prop-edit
 * and (optionally) keep imports synced for.
 */
export interface MdxJsxComponentDescriptor {
  /** Tag name authors write in MDX, e.g. 'Steps'. Unique across the registry. */
  name: string;
  /** Block-level (`flow`) or inline (`text`). */
  kind: 'flow' | 'text';
  /** Insert-time UI hints. Omit to hide from the slash menu and toolbar. */
  insert?: MdxComponentInsertHint;
  /** Props the in-place editor surfaces in its form. */
  props?: ReadonlyArray<MdxComponentProp>;
  /** Whether the component accepts children (nested rich-text editor). */
  hasChildren?: boolean;
  /**
   * Offer the component in the fragment editor's Block type dropdown, next to Paragraph and the headings: its body is
   * one line of text, such as an eyebrow or a quiet title. Choosing it turns the line into the component; choosing
   * Paragraph turns it back. Needs `kind: 'flow'` and `hasChildren: true`.
   */
  blockType?: boolean;
  /** Default attributes used at insert time. */
  defaults?: {
    attributes?: Record<string, JsonValue>;
    /** Raw MDX snippet parsed to mdast children at insert time. */
    children?: string;
  };
  /** Custom in-place editor. Falls back to GenericJsxEditor when omitted. */
  Editor?: ComponentType<JsxEditorProps>;
  /**
   * Opt-in import injection. When set, the editor's save serializer emits
   * `import { Name } from '<from>'` (or `import Name from '<from>'` when
   * `default: true`) whenever this component appears in the document.
   * Maps directly to upstream `JsxComponentDescriptor.source` +
   * `defaultExport`. See the pruning caveat at the top of this file.
   */
  import?: { from: string; default?: boolean };
}

/**
 * Markdown snippet descriptor — a host-defined boilerplate chunk inserted
 * as raw MDX. No props, no auto-import, no in-place editor: once inserted
 * the snippet *is* the document content, edited inline like any other
 * markdown.
 */
export interface MdxSnippetDescriptor {
  /**
   * Stable id. Not exposed in the output MDX; used only as a registry key
   * (so two snippets named 'Callout' would collide the same way two JSX
   * `<Callout>` components would).
   */
  name: string;
  kind: 'snippet';
  /** Insert-time UI hints. Required — a snippet with no label can't be inserted. */
  insert: MdxComponentInsertHint;
  /**
   * Raw MDX inserted at the cursor when the snippet is chosen. Parsed by
   * `@mdxeditor/editor`'s markdown insertion path, so JSX (e.g. nested
   * `<Card>`) round-trips through the registered JSX descriptors.
   */
  content: string;
}

export type MdxComponentDescriptor = MdxJsxComponentDescriptor | MdxSnippetDescriptor;

export type MdxComponents = ReadonlyArray<MdxComponentDescriptor>;

/** Type guard: descriptor is the JSX variant (vs. a snippet). */
export function isJsxDescriptor(d: MdxComponentDescriptor): d is MdxJsxComponentDescriptor {
  return d.kind === 'flow' || d.kind === 'text';
}

/** Type guard: descriptor is the snippet variant. */
export function isSnippetDescriptor(d: MdxComponentDescriptor): d is MdxSnippetDescriptor {
  return d.kind === 'snippet';
}

/**
 * Identity helper that validates registration-time invariants.
 *
 * Throws on:
 * - duplicate `name` across the array (across kinds — a JSX `<Aside>` and a
 *   snippet named 'Aside' would clash in the insert menu);
 * - `kind: 'text'` with `hasChildren: true` (text-kind JSX is treated as an
 *   inline atom by the Lexical bridge);
 * - two JSX descriptors with conflicting `import.from` for the same `name`
 *   (deterministic merge failure that would otherwise surface as a confusing
 *   save-time error);
 * - snippet descriptors with an empty `content` string (would silently
 *   insert nothing and look like a broken menu item).
 */
export function defineMdxComponents(components: MdxComponents): MdxComponents {
  const seen = new Map<string, MdxComponentDescriptor>();
  for (const descriptor of components) {
    const existing = seen.get(descriptor.name);
    if (existing) {
      // Duplicate-import is reported with its specific message because that
      // class of mistake comes from two registration files merging — the
      // generic 'duplicate descriptor' hint isn't enough to debug it.
      const a = isJsxDescriptor(existing) ? existing.import?.from : undefined;
      const b = isJsxDescriptor(descriptor) ? descriptor.import?.from : undefined;
      if (a !== b) {
        throw new Error(
          `defineMdxComponents: duplicate descriptor for '${descriptor.name}' with conflicting import.from (` +
            `'${a ?? '<none>'}' vs '${b ?? '<none>'}').`,
        );
      }
      throw new Error(`defineMdxComponents: duplicate descriptor for '${descriptor.name}'.`);
    }
    if (isJsxDescriptor(descriptor)) checkJsxProps(descriptor);
    if (isJsxDescriptor(descriptor) && descriptor.kind === 'text' && descriptor.hasChildren) {
      throw new Error(
        `defineMdxComponents: descriptor '${descriptor.name}' has kind: 'text' with hasChildren: true — ` +
          "text-kind JSX is treated as an inline atom; use kind: 'flow' for components with children.",
      );
    }
    if (
      isJsxDescriptor(descriptor) &&
      descriptor.blockType &&
      (descriptor.kind !== 'flow' || !descriptor.hasChildren)
    ) {
      throw new Error(
        `defineMdxComponents: descriptor '${descriptor.name}' has blockType: true — a block type holds a line of text, ` +
          "so it needs kind: 'flow' and hasChildren: true.",
      );
    }
    if (isSnippetDescriptor(descriptor) && descriptor.content.length === 0) {
      throw new Error(
        `defineMdxComponents: snippet descriptor '${descriptor.name}' has empty content — ` +
          'a snippet with no content would silently insert nothing.',
      );
    }
    seen.set(descriptor.name, descriptor);
  }
  return components;
}

function isPlainObject(v: unknown): v is { [key: string]: JsonValue } {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Throws when a field has an unusable shape or `value` (when given) contradicts it. `path` is `Card.cta.href`. */
function checkField(field: MdxComponentField, path: string, value?: JsonValue): void {
  const fail = (why: string): never => {
    throw new Error(`defineMdxComponents: ${path} ${why}.`);
  };
  const typeName: unknown = field.type;
  const has = value !== undefined && value !== null;
  switch (field.type) {
    case 'string':
    case 'number':
    case 'boolean':
      if (has && typeof value !== field.type) fail(`default must be a ${field.type}`);
      return;
    case 'list':
      if (!field.of) fail("is a list without 'of'");
      if (has && !Array.isArray(value)) fail('default must be an array');
      checkField(field.of, `${path}[]`);
      if (Array.isArray(value)) {
        for (const [i, item] of value.entries()) checkField(field.of, `${path}[${i}]`, item);
      }
      return;
    case 'object':
      if (!field.fields || Object.keys(field.fields).length === 0) fail("is an object without 'fields'");
      if (has && !isPlainObject(value)) fail('default must be an object');
      for (const [key, sub] of Object.entries(field.fields)) {
        checkField(sub, `${path}.${key}`, isPlainObject(value) ? value[key] : undefined);
      }
      return;
    default:
      fail(`has unknown type '${String(typeName)}'`);
  }
}

function checkJsxProps(d: MdxJsxComponentDescriptor): void {
  const defaults = d.defaults?.attributes ?? {};
  for (const prop of d.props ?? []) {
    if (/^on/i.test(prop.name)) {
      console.warn(
        `defineMdxComponents: ${d.name}.${prop.name} starts with "on" and is never passed to the component; rename it.`,
      );
    }
    const value = defaults[prop.name];
    const scalar = prop.type === 'string' || prop.type === 'number' || prop.type === 'boolean';
    // Scalar props predate this check; a throw here would crash existing sites at boot, so warn instead.
    if (scalar && value !== undefined && value !== null && typeof value !== prop.type) {
      console.warn(
        `defineMdxComponents: ${d.name}.${prop.name} default should be a ${prop.type}, got ${JSON.stringify(value)}.`,
      );
      continue;
    }
    checkField(prop, `${d.name}.${prop.name}`, value);
  }
}

/**
 * Read a string-valued JSX attribute from an mdast flow element. Returns
 * an empty string when the attribute is missing or holds an expression
 * value (e.g. `prop={2}`). Designed for use inside `Editor` components on
 * an `MdxComponentDescriptor` — the typed editor that wants to drive a
 * controlled `<input value={...}>` against a string prop.
 */
/**
 * Conservative detection for "this string prop value carries markdown
 * formatting." Used to decide whether inline editing in the SSR'd
 * preview is safe: a plaintext-only contenteditable would strip the
 * formatting on commit, so we'd rather route those props through the
 * side panel (where the author sees the raw text and decides).
 *
 * Detects only unambiguous markers — `**bold**` / `*em*`, inline code
 * `` `x` ``, and the `[text](url)` link form. Skips `_` / `__` (would
 * false-positive on filenames like `__init__.py`) and skips single
 * `*` (false-positive risk on prose). False positives just mean "edit
 * via panel instead of inline" which is the safe fallback; false
 * negatives silently destroy formatting, which is not.
 */
const MARKDOWN_MARKER_RE = /\*\*|`|\[[^\]\n]+?\]\([^)\n]+?\)/;
export function containsMarkdownMarkers(value: string): boolean {
  return MARKDOWN_MARKER_RE.test(value);
}

export function readStringAttribute(node: MdxJsxFlowElement | MdxJsxTextElement, name: string): string {
  const attr = node.attributes.find((a): a is MdxJsxAttribute => a.type === 'mdxJsxAttribute' && a.name === name);
  if (!attr || typeof attr.value !== 'string') return '';
  return attr.value;
}

/**
 * Return a new attributes array with the given string attribute set to
 * `value`, or with the attribute removed entirely when `value` is empty.
 * The empty-removes-the-attribute behaviour avoids serializing `prop=""`
 * back to the file.
 */
export function writeStringAttribute<T extends MdxJsxFlowElement | MdxJsxTextElement>(
  attributes: T['attributes'],
  name: string,
  value: string,
): T['attributes'] {
  const next = attributes.filter((a) => !(a.type === 'mdxJsxAttribute' && a.name === name));
  if (value.length > 0) {
    next.push({ type: 'mdxJsxAttribute', name, value });
  }
  return next as T['attributes'];
}

/**
 * `attributes` with the outline anchor (the `outline.id` prop) made from the contents text (`outline.text`) when the
 * element has no anchor and has text. An existing anchor is never changed, so links to it keep working after the text
 * is edited. `taken` holds the anchors already in the document.
 */
export function withOutlineId<T extends MdxJsxFlowElement | MdxJsxTextElement>(
  attributes: T['attributes'],
  outline: FragmentOutlineProps,
  taken: Iterable<string>,
): T['attributes'] {
  const named = (name: string) =>
    attributes.find((a): a is MdxJsxAttribute => a.type === 'mdxJsxAttribute' && a.name === name);
  const id = named(outline.id);
  const text = named(outline.text)?.value;
  if ((id && id.value !== '') || typeof text !== 'string' || text.trim() === '') return attributes;
  return writeAttribute<T>(attributes, outline.id, outlineIdFor(text, taken));
}

/**
 * Type-aware attribute writer. Encodes the value into the right
 * mdast shape so the saved MDX matches what an author would write
 * by hand:
 *
 *   - `string`           → `prop="value"`         (or removed if empty)
 *   - `boolean true`     → `prop`                 (JSX shorthand; value: null)
 *   - `boolean false`    → REMOVED                (default is implicit-false)
 *   - `number`           → `prop={42}`            (expression so `2` ≠ `"2"`)
 *   - `null`/`undefined` → REMOVED
 *
 * The string-only `writeStringAttribute` stays for callers that only
 * deal with strings (the inline-prop editor, free-text inputs). This
 * is for the side panel where booleans and numbers need correct mdast
 * encoding so a `stagger?: boolean` round-trips as `<CardGrid stagger>`
 * and not the truthy-but-incorrect `<CardGrid stagger="true">`.
 */
export function writeAttribute<T extends MdxJsxFlowElement | MdxJsxTextElement>(
  attributes: T['attributes'],
  name: string,
  value: JsonValue | null | undefined,
): T['attributes'] {
  const next = attributes.filter((a) => !(a.type === 'mdxJsxAttribute' && a.name === name));
  if (value === null || value === undefined) return next as T['attributes'];
  if (typeof value === 'string') {
    if (value.length === 0) return next as T['attributes'];
    next.push({ type: 'mdxJsxAttribute', name, value });
  } else if (typeof value === 'boolean') {
    if (!value) return next as T['attributes'];
    // JSX shorthand: `<Component prop />` is `value: null` in mdast.
    next.push({ type: 'mdxJsxAttribute', name, value: null });
  } else if (typeof value === 'number') {
    // Numbers must be expressions so the compiler reads `2` as a
    // number, not the string `"2"`. mdast-util-mdx-jsx expects an
    // `mdxJsxAttributeValueExpression` whose `value` is the source
    // text the runtime will evaluate.
    next.push({
      type: 'mdxJsxAttribute',
      name,
      value: { type: 'mdxJsxAttributeValueExpression', value: String(value) },
    });
  } else if (typeof value === 'object') {
    // Lists and objects: a JSON literal expression, which readAttrs parses back.
    next.push({
      type: 'mdxJsxAttribute',
      name,
      value: { type: 'mdxJsxAttributeValueExpression', value: JSON.stringify(value) },
    });
  }
  return next as T['attributes'];
}
