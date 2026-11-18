import { defineFragmentComponents, type FragmentVocabulary, type JsonValue } from '@conloca/mdx/render';
import { type ComponentType, createElement, Fragment, type ReactNode, useId } from 'react';
import { renderToString } from 'react-dom/server';
import { serializeProps } from '../lib/serialize-props.js';
import type { HydrationMeta } from '../lib/withHydration.js';
import { IslandSlot } from './IslandSlot.js';

// biome-ignore lint/suspicious/noExplicitAny: site components take arbitrary props
type AnyComponent = ComponentType<any>;

const islands = new WeakSet();
const memo = new WeakMap<FragmentVocabulary, FragmentVocabulary>();
const staticMemo = new WeakMap<FragmentVocabulary, FragmentVocabulary>();

// The strategy withHydration() attached, read without trusting the shape of the function's own properties.
function strategyOf(component: AnyComponent | undefined): HydrationMeta['strategy'] | undefined {
  const meta: unknown = component === undefined ? undefined : Reflect.get(component, '__hydration');
  if (typeof meta !== 'object' || meta === null || Reflect.get(meta, '__isHydratable') !== true) return undefined;
  const strategy: unknown = Reflect.get(meta, 'strategy');
  return strategy === 'load' || strategy === 'visible' || strategy === 'idle' ? strategy : undefined;
}

function island(key: string, Component: AnyComponent, strategy: HydrationMeta['strategy']): AnyComponent {
  // Fragment props are the JSON values the renderer read from the attributes, plus the rendered children.
  function FragmentIsland({ children, ...props }: { children?: ReactNode; [prop: string]: JsonValue | ReactNode }) {
    const id = useId();
    const seen = { slot: false };
    const slot = children === undefined ? undefined : createElement(IslandSlot, { id, seen }, children);
    // Its own root, so the component's useId values carry the island id and the client root reproduces them.
    const html = renderToString(createElement(Component, slot === undefined ? props : { ...props, children: slot }), {
      identifierPrefix: id,
    });
    return createElement(
      Fragment,
      null,
      createElement('conloca-island', {
        'data-conloca-island': id,
        'data-conloca-component': key,
        'data-hydrate-strategy': strategy,
        'data-props': serializeProps(props),
        style: { display: 'contents' },
        // biome-ignore lint/security/noDangerouslySetInnerHtml: React's own server render of the component, not user input
        dangerouslySetInnerHTML: { __html: html },
      }),
      slot !== undefined && !seen.slot ? createElement('template', { 'data-conloca-island-slot': id }, children) : null,
    );
  }
  islands.add(FragmentIsland);
  return FragmentIsland;
}

/**
 * The vocabulary a published page renders fragments with: every `withHydration()` component becomes an island under
 * its registry key from `islandKeys`; everything else keeps its reference.
 *
 * @param unmapped - `'throw'` (default): a hydrated element override, or a hydrated component missing from
 *   `islandKeys`, throws. `'static'`: each such value keeps its reference, so it renders without hydration.
 */
export function islandVocabulary(
  vocabulary: FragmentVocabulary,
  islandKeys: ReadonlyMap<unknown, string>,
  unmapped: 'throw' | 'static' = 'throw',
): FragmentVocabulary {
  const cache = unmapped === 'throw' ? memo : staticMemo;
  const cached = cache.get(vocabulary);
  if (cached) return cached;
  for (const [name, element] of Object.entries(vocabulary.elements)) {
    if (strategyOf(element) && unmapped === 'throw') {
      throw new TypeError(
        `Element override <${name}> is wrapped in withHydration(); only fragment components can hydrate.`,
      );
    }
  }
  const components: Record<string, AnyComponent> = {};
  for (const [name, component] of Object.entries(vocabulary.components)) {
    const strategy = strategyOf(component);
    const key = strategy && islandKeys.get(component);
    if (strategy && key === undefined && unmapped === 'throw') {
      throw new TypeError(
        `Fragment component <${name}> is wrapped in withHydration(), but the build found no module for it. Import it into the render module by name from the file that calls withHydration().`,
      );
    }
    components[name] = strategy && key !== undefined ? island(key, component, strategy) : component;
  }
  const result = defineFragmentComponents({
    components,
    elements: { ...vocabulary.elements },
    outline: { ...vocabulary.outline },
  });
  cache.set(vocabulary, result);
  return result;
}

/** True only for the island wrappers `islandVocabulary` made. */
export function isFragmentIsland(component: unknown): boolean {
  return typeof component === 'function' && islands.has(component);
}
