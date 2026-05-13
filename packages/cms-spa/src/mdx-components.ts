import { GenericJsxEditor, type JsxComponentDescriptor, type JsxEditorProps } from '@mdxeditor/editor';
import type { MdxJsxAttribute, MdxJsxFlowElement, MdxJsxTextElement } from 'mdast-util-mdx-jsx';
import type { ComponentType } from 'react';
import { useEffect, useState } from 'react';

/**
 * Plugin API for registering MDX JSX components that the CMS editor knows how
 * to insert, prop-edit, and (optionally) keep imports synced for.
 *
 * Mirrors the shape of `page-schemas.ts` — same `define*` identity helper,
 * same `setX/getX/useX` triad backed by a shared window-state cell, same HMR
 * subscriber pattern. Hosts add a `mdxComponents` export to the file pointed
 * at by the Astro integration's `schemasPath` option; the virtual module
 * loader in `@conloca/astro-cms` picks it up alongside `pageSchemas`.
 *
 * Pruning caveat: when `import.from` is set, the import is added/removed by
 * `@mdxeditor/editor`'s own export pipeline, which rebuilds the import block
 * on every save from the components actually referenced in the document.
 * Unrelated author imports (types, side effects) are dropped. See the
 * astro-cms README for the full constraint.
 */

export type MdxComponentProp =
  | {
      name: string;
      type: 'string';
      required?: boolean;
      label?: string;
      help?: string;
      defaultValue?: string;
      options?: ReadonlyArray<{ value: string; label: string }>;
    }
  | {
      name: string;
      type: 'number';
      required?: boolean;
      label?: string;
      help?: string;
      defaultValue?: number;
    }
  | {
      name: string;
      type: 'boolean';
      required?: boolean;
      label?: string;
      help?: string;
      defaultValue?: boolean;
    };

export interface MdxComponentInsertHint {
  /** Human-readable label shown in the slash menu and the toolbar dropdown. */
  label: string;
  /** Optional one-line description shown under the label in the slash menu. */
  description?: string;
  /** Optional Lucide icon name (rendered by the existing icon registry). */
  icon?: string;
  /** Aliases that match in slash-menu search ('callout' would match Aside). */
  keywords?: ReadonlyArray<string>;
}

export interface MdxComponentDescriptor {
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
  /** Default attributes used at insert time. */
  defaults?: {
    attributes?: Record<string, string | number | boolean>;
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

export type MdxComponents = ReadonlyArray<MdxComponentDescriptor>;

/**
 * Identity helper that validates registration-time invariants.
 *
 * Throws on:
 * - duplicate `name` across the array;
 * - `kind: 'text'` with `hasChildren: true` (text-kind JSX is treated as an
 *   inline atom by the Lexical bridge);
 * - two descriptors with conflicting `import.from` for the same `name`
 *   (deterministic merge failure that would otherwise surface as a confusing
 *   save-time error).
 */
export function defineMdxComponents(components: MdxComponents): MdxComponents {
  const seen = new Map<string, MdxComponentDescriptor>();
  for (const descriptor of components) {
    const existing = seen.get(descriptor.name);
    if (existing) {
      const a = existing.import?.from;
      const b = descriptor.import?.from;
      if (a !== b) {
        throw new Error(
          `defineMdxComponents: duplicate descriptor for '${descriptor.name}' with conflicting import.from (` +
            `'${a ?? '<none>'}' vs '${b ?? '<none>'}').`,
        );
      }
      throw new Error(`defineMdxComponents: duplicate descriptor for '${descriptor.name}'.`);
    }
    if (descriptor.kind === 'text' && descriptor.hasChildren) {
      throw new Error(
        `defineMdxComponents: descriptor '${descriptor.name}' has kind: 'text' with hasChildren: true — ` +
          "text-kind JSX is treated as an inline atom; use kind: 'flow' for components with children.",
      );
    }
    seen.set(descriptor.name, descriptor);
  }
  return components;
}

/**
 * Read a string-valued JSX attribute from an mdast flow element. Returns
 * an empty string when the attribute is missing or holds an expression
 * value (e.g. `prop={2}`). Designed for use inside `Editor` components on
 * an `MdxComponentDescriptor` — the typed editor that wants to drive a
 * controlled `<input value={...}>` against a string prop.
 */
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
 * Translate a plugin descriptor to the upstream `JsxComponentDescriptor`
 * shape that `@mdxeditor/editor` consumes. Booleans surface as expressions
 * (`{true}`) because the upstream `JsxPropertyDescriptor.type` is
 * `'string' | 'number' | 'expression'`.
 */
export function toJsxComponentDescriptor(d: MdxComponentDescriptor): JsxComponentDescriptor {
  return {
    name: d.name,
    kind: d.kind,
    props: (d.props ?? []).map((p) => ({
      name: p.name,
      type: p.type === 'boolean' ? 'expression' : p.type,
      required: p.required,
    })),
    hasChildren: d.hasChildren,
    Editor: d.Editor ?? GenericJsxEditor,
    ...(d.import ? { source: d.import.from, defaultExport: d.import.default ?? false } : {}),
  };
}

interface SharedMdxComponentsState {
  components: MdxComponents;
  subscribers: Set<(components: MdxComponents) => void>;
}

const getSharedState = (): SharedMdxComponentsState => {
  if (typeof window !== 'undefined') {
    const w = window as unknown as { __MDX_COMPONENTS_STATE__?: SharedMdxComponentsState };
    if (!w.__MDX_COMPONENTS_STATE__) {
      w.__MDX_COMPONENTS_STATE__ = {
        components: [],
        subscribers: new Set(),
      };
    }
    return w.__MDX_COMPONENTS_STATE__;
  }
  return { components: [], subscribers: new Set() };
};

/**
 * Replace the registered MDX components. Called by the virtual module that
 * loads the host's `schemas.ts`. Notifies subscribers so the editor picks
 * up HMR updates without remounting.
 */
export function setMdxComponents(components: MdxComponents): void {
  const state = getSharedState();
  state.components = components;
  state.subscribers.forEach((fn) => fn(components));
}

/** Read the current registry synchronously. */
export function getMdxComponents(): MdxComponents {
  return getSharedState().components;
}

/**
 * React hook subscribing to registry changes. Returns the current array and
 * updates on HMR.
 */
export function useMdxComponents(): MdxComponents {
  const [components, setComponents] = useState(() => getSharedState().components);

  useEffect(() => {
    const state = getSharedState();
    if (state.components !== components) {
      setComponents(state.components);
    }
    state.subscribers.add(setComponents);
    return () => {
      state.subscribers.delete(setComponents);
    };
  }, [components]);

  return components;
}
