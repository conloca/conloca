import type { JsxComponentDescriptor, JsxEditorProps } from '@mdxeditor/editor';
import { type ComponentType, useEffect, useState } from 'react';
import { isJsxDescriptor, type MdxComponentDescriptor, type MdxComponents } from './mdx-components-define.js';

// The declaration surface (types, defineMdxComponents, the attribute
// helpers) lives in mdx-components-define — editor-free so content configs
// and bare test runners can evaluate it. Re-exported here so existing
// importers of this module keep working unchanged.
export * from './mdx-components-define.js';

/**
 * Translate a JSX-flavored plugin descriptor to the upstream
 * `JsxComponentDescriptor` shape that `@mdxeditor/editor` consumes.
 * Booleans surface as expressions (`{true}`) because the upstream
 * `JsxPropertyDescriptor.type` is `'string' | 'number' | 'expression'`.
 *
 * The fallback editor is injected by the CMS editor entrypoint. Keeping that
 * dependency one-way prevents the registry module from importing GenericBlock,
 * which itself consumes this registry.
 *
 * Snippet descriptors are not JSX — call sites filter them out before
 * dispatching here. Passing one throws to surface the misuse loudly.
 */
export function toJsxComponentDescriptor(
  d: MdxComponentDescriptor,
  fallbackEditor: ComponentType<JsxEditorProps>,
): JsxComponentDescriptor {
  if (!isJsxDescriptor(d)) {
    throw new Error(`toJsxComponentDescriptor: '${d.name}' is a snippet, not a JSX component.`);
  }
  return {
    name: d.name,
    kind: d.kind,
    props: (d.props ?? []).map((p) => ({
      name: p.name,
      type: p.type === 'boolean' ? 'expression' : p.type,
      required: p.required,
    })),
    hasChildren: d.hasChildren,
    Editor: d.Editor ?? fallbackEditor,
    ...(d.import ? { source: d.import.from, defaultExport: d.import.default ?? false } : {}),
  };
}

interface SharedMdxComponentsState {
  components: MdxComponents;
  subscribers: Set<(components: MdxComponents) => void>;
  /**
   * Producer slots for the slotted installers below. Optional so state
   * created by an older copy of this module (the shared object lives on
   * `window`) keeps working.
   */
  hostAuthored?: MdxComponents;
  discovered?: MdxComponents;
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
  state.subscribers.forEach((fn) => {
    fn(components);
  });
}

/** Read the current registry synchronously. */
export function getMdxComponents(): MdxComponents {
  return getSharedState().components;
}

/**
 * Install the host-authored descriptor list (the schemas module's
 * `mdxComponents` export) without disturbing auto-discovered entries.
 *
 * The dev SPA has two unordered producers: the schemas virtual module and
 * the `/api/registry` fetch. A plain `setMdxComponents` from whichever
 * settled last overwrote the other's entries — discovered components
 * vanished whenever the fetch won the race. Each producer now writes its
 * own remembered slot and the registry is recomputed as the merge of both,
 * so settle order stops mattering. A host app that installs the full list
 * with a single `setMdxComponents` call keeps doing so; these slots are
 * dev-only plumbing.
 */
export function installHostAuthoredMdxComponents(components: MdxComponents): void {
  const state = getSharedState();
  state.hostAuthored = components;
  setMdxComponents(mergeDiscoveredMdxComponents(components, state.discovered ?? []));
}

/** Install the auto-discovered descriptor list — see `installHostAuthoredMdxComponents`. */
export function installDiscoveredMdxComponents(components: MdxComponents): void {
  const state = getSharedState();
  state.discovered = components;
  setMdxComponents(mergeDiscoveredMdxComponents(state.hostAuthored ?? [], components));
}

/**
 * Merge auto-discovered descriptors over host-authored ones.
 *
 * Discovered entries win on a name collision: they are derived from the
 * source of truth (the MDX files and component folders themselves), while a
 * hand-written list can lag. ONE rule for every caller — the dev SPA merges
 * the `/api/registry` response over the `schemasPath` exports, and a host app
 * merges the same two lists from what it supplies.
 *
 * Host survivors keep their relative order and discovered entries append
 * after them, so a colliding entry surfaces at its discovered position, not
 * its host slot. Inputs are assumed unique-by-name — that validation lives
 * in `defineMdxComponents` and the discovery merge, not here.
 */
export function mergeDiscoveredMdxComponents(hostAuthored: MdxComponents, discovered: MdxComponents): MdxComponents {
  if (discovered.length === 0) return hostAuthored;
  const discoveredNames = new Set(discovered.map((descriptor) => descriptor.name));
  return [...hostAuthored.filter((descriptor) => !discoveredNames.has(descriptor.name)), ...discovered];
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
