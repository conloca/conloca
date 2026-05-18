import { useEffect, useState } from 'react';

/**
 * Shared registry for host-site CSS strings across module instances.
 *
 * The astro-cms virtual module (`${cmsRoute}/site-styles.js`) imports each
 * configured CSS file with Vite's `?inline` query (so the full CSS pipeline
 * runs) and calls `setSiteStyles` with the processed strings. The editor's
 * iframe bridge consumes them via `useSiteStyles` and injects them directly
 * into Puck's preview iframe <head>, bypassing the CMS chrome's parent <head>
 * so host-site CSS cannot bleed into the CMS UI.
 *
 * Uses window to ensure virtual modules and bundled code share the same state.
 */

export type SiteStyles = readonly string[];

interface SharedSiteStylesState {
  styles: SiteStyles;
  subscribers: Set<(styles: SiteStyles) => void>;
}

declare global {
  interface Window {
    __SITE_STYLES_STATE__?: SharedSiteStylesState;
  }
}

const getSharedState = (): SharedSiteStylesState => {
  if (typeof window !== 'undefined') {
    if (!window.__SITE_STYLES_STATE__) {
      window.__SITE_STYLES_STATE__ = {
        styles: [],
        subscribers: new Set(),
      };
    }
    return window.__SITE_STYLES_STATE__;
  }
  // SSR fallback
  return { styles: [], subscribers: new Set() };
};

/**
 * Register the site CSS strings. Called by the virtual module on initial
 * load and on HMR when any of the imported CSS files change. Notifies all
 * subscribers so mounted iframe bridges re-inject fresh style tags.
 */
export function setSiteStyles(styles: SiteStyles): void {
  const state = getSharedState();
  state.styles = styles;
  state.subscribers.forEach((fn) => fn(styles));
}

/**
 * Get the current site CSS strings synchronously.
 */
export function getSiteStyles(): SiteStyles {
  return getSharedState().styles;
}

/**
 * React hook that returns the current site CSS strings and re-renders the
 * caller when they change (HMR support).
 */
export function useSiteStyles(): SiteStyles {
  const [styles, setStyles] = useState(() => getSharedState().styles);

  useEffect(() => {
    const state = getSharedState();

    // Re-sync in case styles changed between render and effect
    if (state.styles !== styles) {
      setStyles(state.styles);
    }

    state.subscribers.add(setStyles);
    return () => {
      state.subscribers.delete(setStyles);
    };
  }, []);

  return styles;
}

/**
 * Inject the registered host-site CSS into the current document's `<head>`
 * while the calling component is mounted. Each stylesheet gets wrapped in a
 * named cascade layer so its rules sit at a known position in the cascade.
 *
 * Use this from the MDX editor in the main admin document, where there is
 * no iframe to isolate host CSS. Pick a layer name declared in main.css's
 * layer ordering BEFORE `cms-admin` so host CSS decorates host-defined
 * component classes (`.conloca-aside`, `.conloca-card`, etc.) without
 * overriding admin chrome.
 *
 * The Puck preview iframe path uses a different mechanism (style tags
 * appended directly to the iframe's `<head>` via `IframeBridge`, wrapped
 * in `@layer conloca-site` so host CSS wins inside the rendered page). Two
 * targets, two layer positions, one CSS registry.
 *
 * `@import url(...)` statements are hoisted to the top of the injected
 * `<style>` tag because they must come before other rules to be valid.
 * Hosts using Tailwind / Google Fonts depend on this.
 */
export function useInjectHostStyles(layerName: string): void {
  const styles = useSiteStyles();

  useEffect(() => {
    if (typeof document === 'undefined' || styles.length === 0) return;

    const tags: HTMLStyleElement[] = [];
    const marker = `data-conloca-host-styles-${layerName}`;

    for (const css of styles) {
      const imports: string[] = [];
      const cleaned = css.replace(/@import\s+url\([^)]*\)[^;]*;/g, (m) => {
        imports.push(m.trim());
        return '';
      });
      const wrapped = `${imports.join('\n')}\n@layer ${layerName} {\n${cleaned}\n}`;
      const tag = document.createElement('style');
      tag.setAttribute(marker, '');
      tag.textContent = wrapped;
      document.head.appendChild(tag);
      tags.push(tag);
    }

    return () => {
      for (const tag of tags) tag.remove();
    };
  }, [styles, layerName]);
}
