import type { JsxComponentDescriptor, JsxEditorProps } from '@mdxeditor/editor';
import { type ComponentType, useEffect, useState } from 'react';
import {
  isJsxDescriptor,
  type MdxComponentDescriptor,
  type MdxComponents,
  mergeDiscoveredMdxComponents,
} from './mdx-components-define.js';
import { getSiteRender, subscribeSiteRender } from './site-render.js';

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
 *
 * `withImport: false` drops the import a save would emit: a fragment's
 * components come from the site's vocabulary, never from an import.
 */
export function toJsxComponentDescriptor(
  d: MdxComponentDescriptor,
  fallbackEditor: ComponentType<JsxEditorProps>,
  { withImport }: { withImport: boolean } = { withImport: true },
): JsxComponentDescriptor {
  if (!isJsxDescriptor(d)) {
    throw new Error(`toJsxComponentDescriptor: '${d.name}' is a snippet, not a JSX component.`);
  }
  return {
    name: d.name,
    kind: d.kind,
    props: (d.props ?? []).map((p) => ({
      name: p.name,
      type: p.type === 'string' || p.type === 'number' ? p.type : 'expression',
      required: p.required,
    })),
    hasChildren: d.hasChildren,
    Editor: d.Editor ?? fallbackEditor,
    ...(withImport && d.import ? { source: d.import.from, defaultExport: d.import.default ?? false } : {}),
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
 * so settle order stops mattering. An editor embedding the CMS installs
 * through the same two slots.
 *
 * The merge keeps host-authored entries for the current site render's
 * fragment vocabulary names, and is redone whenever the site render changes.
 */
export function installHostAuthoredMdxComponents(components: MdxComponents): void {
  getSharedState().hostAuthored = components;
  remerge();
}

/** Install the auto-discovered descriptor list — see `installHostAuthoredMdxComponents`. */
export function installDiscoveredMdxComponents(components: MdxComponents): void {
  getSharedState().discovered = components;
  remerge();
}

let unsubscribeSiteRender: (() => void) | undefined;

function remerge(): void {
  unsubscribeSiteRender ??= subscribeSiteRender(remerge);
  const state = getSharedState();
  const hostWins = new Set(Object.keys(getSiteRender().vocabulary.components));
  setMdxComponents(mergeDiscoveredMdxComponents(state.hostAuthored ?? [], state.discovered ?? [], hostWins));
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
