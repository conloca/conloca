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

// ---------------------------------------------------------------------------
// Fetched site styles — runtime CSS discovery from the integration endpoint.
//
// Replaces the manually-curated `editorStyles` list with the host's real CSS
// for the page being edited. The integration walks Vite's module graph from
// the page's URL and returns the concatenated stylesheets (Tailwind, theme
// CSS, framework-scoped styles) so the editor matches the published page.
// ---------------------------------------------------------------------------

/**
 * Fetch the host's CSS for a route URL from the integration's
 * `/api/styles` endpoint and return it as a single-element array suitable
 * for `useInjectHostStyles`. Empty until the fetch resolves; empty if no
 * URL is given.
 */
export function useFetchedSiteStyles(routeUrl: string | undefined, options: { cmsRoute?: string } = {}): SiteStyles {
  const [styles, setStyles] = useState<SiteStyles>([]);
  const cmsRoute = options.cmsRoute ?? '/__cms';

  useEffect(() => {
    if (!routeUrl) {
      setStyles([]);
      return;
    }

    let cancelled = false;
    const endpoint = `${cmsRoute}/api/styles?url=${encodeURIComponent(routeUrl)}`;

    fetch(endpoint)
      .then((res) => {
        if (!res.ok) throw new Error(`Styles endpoint returned ${res.status}`);
        return res.text();
      })
      .then((css) => {
        if (cancelled) return;
        setStyles(css ? [css] : []);
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn('[Conloca] Failed to fetch site styles:', err);
        setStyles([]);
      });

    return () => {
      cancelled = true;
    };
  }, [routeUrl, cmsRoute]);

  return styles;
}

/**
 * Inject host CSS strings into the current document's `<head>` while the
 * calling component is mounted. Each stylesheet gets wrapped in a named
 * cascade layer so its rules sit at a known position in the cascade.
 *
 * `@import url(...)` statements are hoisted to the top of the injected
 * `<style>` tag because they must come before other rules to be valid.
 * Hosts using Tailwind / Google Fonts depend on this.
 *
 * The pre-iframe era of this hook took a `scopeSelector` and wrapped
 * everything in `@scope (...)` to keep host CSS from leaking into the
 * admin chrome. With the editor now isolated in its own iframe (see
 * `EditorFrame.tsx`), no such scoping is needed — the iframe's
 * document boundary does the work.
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
