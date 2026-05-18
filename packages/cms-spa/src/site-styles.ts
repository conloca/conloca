import { useEffect, useState } from 'react';

/**
 * Two parallel registries for host-supplied CSS strings: `siteStyles` for the
 * Puck preview iframe (full page styling, Tailwind included), and
 * `editorStyles` for the MDX editor admin shell (narrow component CSS only).
 *
 * Each registry has an astro-cms virtual module (`${cmsRoute}/site-styles.js`
 * and `${cmsRoute}/editor-styles.js`) that imports the configured CSS files
 * with Vite's `?inline` query (so the full CSS pipeline runs) and calls the
 * corresponding setter. Consumers read via the matching hook.
 *
 * The split exists because the two surfaces have opposite cascade
 * requirements:
 * - The iframe shows the host's published page — host CSS should fully win,
 *   so `siteStyles` injects everything (Tailwind utilities, `:root` tokens,
 *   component CSS) wrapped in `@layer conloca-site` declared after every
 *   other top-level layer.
 * - The admin shell shows the editor — admin chrome must keep its own
 *   Tailwind utilities (`.bg-white`, `.text-grey-*`, dark variants). Host
 *   CSS injected here must NOT include Tailwind utilities or `:root` token
 *   overrides; it should be only the host-component selectors
 *   (`.conloca-aside`, `.conloca-card`, etc.). `editorStyles` is that
 *   narrow path.
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
    __EDITOR_STYLES_STATE__?: SharedSiteStylesState;
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

// ---------------------------------------------------------------------------
// editorStyles registry — narrow CSS path for the MDX editor admin shell.
// Mirrors the siteStyles pattern; see the top-of-file comment for why the
// split exists.
// ---------------------------------------------------------------------------

const getEditorStylesState = (): SharedSiteStylesState => {
  if (typeof window !== 'undefined') {
    if (!window.__EDITOR_STYLES_STATE__) {
      window.__EDITOR_STYLES_STATE__ = { styles: [], subscribers: new Set() };
    }
    return window.__EDITOR_STYLES_STATE__;
  }
  return { styles: [], subscribers: new Set() };
};

export function setEditorStyles(styles: SiteStyles): void {
  const state = getEditorStylesState();
  state.styles = styles;
  state.subscribers.forEach((fn) => fn(styles));
}

export function getEditorStyles(): SiteStyles {
  return getEditorStylesState().styles;
}

export function useEditorStyles(): SiteStyles {
  const [styles, setStyles] = useState(() => getEditorStylesState().styles);

  useEffect(() => {
    const state = getEditorStylesState();
    if (state.styles !== styles) setStyles(state.styles);
    state.subscribers.add(setStyles);
    return () => {
      state.subscribers.delete(setStyles);
    };
  }, []);

  return styles;
}

/**
 * Inject host CSS strings into the current document's `<head>` while the
 * calling component is mounted. Each stylesheet gets wrapped in a named
 * cascade layer so its rules sit at a known position in the cascade.
 *
 * Pass the styles array explicitly so callers stay in control of which
 * registry they consume (siteStyles vs editorStyles).
 *
 * `@import url(...)` statements are hoisted to the top of the injected
 * `<style>` tag because they must come before other rules to be valid.
 * Hosts using Tailwind / Google Fonts depend on this.
 */
export function useInjectHostStyles(layerName: string, styles: SiteStyles): void {
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
