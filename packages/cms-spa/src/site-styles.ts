import { useEffect, useState } from 'react';
import { IMPORT_RE } from './site-css-layer.js';
import { getCmsRoute } from './ui-config.js';

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
  state.subscribers.forEach((fn) => {
    fn(styles);
  });
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
  }, [styles]);

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
  state.subscribers.forEach((fn) => {
    fn(styles);
  });
}

export function getEditorStyles(): SiteStyles {
  return getEditorStylesState().styles;
}

/**
 * Interpret a styles-endpoint response body. Accepts only `text/css` — the
 * real endpoint (astro-cms styles-endpoint) always declares it. Where no such
 * endpoint exists, a catch-all route can answer the same path with
 * `200 text/html`: treating that HTML as CSS would not only inject garbage,
 * it would count as a NON-EMPTY styles result and suppress every fallback
 * tier below the endpoint in the editor style chain.
 */
export function stylesFromResponse(contentType: string | null, body: string): SiteStyles {
  if (!/^text\/css\b/i.test(contentType ?? '')) return [];
  return body ? [body] : [];
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
  }, [styles]);

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
 * URL is given. `cmsRoute` defaults to the route the CMS is mounted at.
 */
export function useFetchedSiteStyles(routeUrl: string | undefined, options: { cmsRoute?: string } = {}): SiteStyles {
  const [styles, setStyles] = useState<SiteStyles>([]);
  const cmsRoute = options.cmsRoute ?? getCmsRoute();

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
        const contentType = res.headers.get('content-type');
        return res.text().then((body) => {
          const styles = stylesFromResponse(contentType, body);
          // A non-CSS 200 means the endpoint doesn't exist on this origin
          // (a catch-all route answered the path). Warn so the fallthrough
          // is visible, and return empty so the fallback tiers stay reachable.
          if (styles.length === 0 && body) {
            console.warn(`[Conloca] Styles endpoint answered ${contentType ?? 'no content-type'} — ignoring.`);
          }
          return styles;
        });
      })
      .then((styles) => {
        if (cancelled) return;
        setStyles(styles);
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
 * Shape returned by the `/api/content-wrapper?url=…` endpoint — the
 * tag name and class list of the host page's content-root element.
 * Kept in lock-step with `ContentWrapperInfo` in
 * `packages/astro-cms/src/site-styles/content-wrapper-endpoint.ts`.
 */
export interface HostContentWrapper {
  tagName: string;
  className: string;
}

/**
 * Discovered host wrappers for a given route. `content` is the
 * prose-content wrapper (eg `.sl-markdown-content`). `codeBlock` is
 * the ordered chain of classed wrappers between the content wrapper
 * and `<pre>`, outermost first (eg `[.expressive-code, .frame ...]`).
 * Either may be null when not present on the page.
 */
export interface HostWrappers {
  content: HostContentWrapper | null;
  codeBlock: HostContentWrapper[] | null;
}

/**
 * Fetches the host page's wrappers for the given route URL. The
 * editor mirrors them: the contenteditable is wrapped in a clone of
 * `content` (via the `hostWrapperPlugin`), and the code-block frame
 * picks up the `codeBlock` classes so the host's code-block CSS
 * reaches via the cascade — no shipped mirror needed.
 *
 * Returns `{ content: null, codeBlock: null }` while the fetch is in
 * flight or when the host route has no discoverable wrappers.
 *
 * Re-fetches whenever `routeUrl` changes (eg locale switch / doc
 * switch). Errors are logged and swallowed; the caller falls back to
 * the no-wrapper render path. `cmsRoute` defaults to the route the CMS is
 * mounted at.
 */
export function useFetchedHostWrappers(
  routeUrl: string | undefined,
  options: { cmsRoute?: string } = {},
): HostWrappers {
  const [wrappers, setWrappers] = useState<HostWrappers>({ content: null, codeBlock: null });
  const cmsRoute = options.cmsRoute ?? getCmsRoute();

  useEffect(() => {
    if (!routeUrl) {
      setWrappers({ content: null, codeBlock: null });
      return;
    }

    let cancelled = false;
    const endpoint = `${cmsRoute}/api/content-wrapper?url=${encodeURIComponent(routeUrl)}`;

    fetch(endpoint)
      .then((res) => {
        if (!res.ok) throw new Error(`Content-wrapper endpoint returned ${res.status}`);
        return res.json() as Promise<HostWrappers>;
      })
      .then((data) => {
        if (cancelled) return;
        setWrappers({ content: data?.content ?? null, codeBlock: data?.codeBlock ?? null });
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn('[Conloca] Failed to fetch host wrappers:', err);
        setWrappers({ content: null, codeBlock: null });
      });

    return () => {
      cancelled = true;
    };
  }, [routeUrl, cmsRoute]);

  return wrappers;
}

/**
 * Put broad host CSS inside the editor surface instead of letting it style
 * the surrounding admin app. Root selectors are moved onto the scope root so
 * host variables and root theme selectors still work inside the editor.
 */
export function scopeHostCss(css: string, scopeSelector: string): string {
  const selectorBoundary = String.raw`(?=$|[\s.#:[>+~,{])`;
  const selectorStart = String.raw`(^[ \t]*|[{};]\s*|,\s*|\/\*[\s\S]*?\*\/\s*)`;
  const rebasedRoots = css
    .replace(new RegExp(`${selectorStart}\\.dark${selectorBoundary}`, 'gm'), '$1:scope:is(.dark, .dark *)')
    // Same rebase for the attribute form. A host that keys its theme off
    // `[data-theme="dark"]` (Starlight, for one) writes it as
    // a bare compound, which inside `@scope` matches only DESCENDANTS of the
    // scope root — never the root itself. Its `:root` counterpart does get
    // rebased below, so the light tokens land and the dark ones silently do
    // not, leaving host rules that read those tokens resolving light inside a
    // dark editor.
    .replace(
      new RegExp(`${selectorStart}\\[data-theme=("|'|)([\\w-]+)\\2\\]${selectorBoundary}`, 'gm'),
      '$1:scope:is([data-theme="$3"], [data-theme="$3"] *)',
    )
    .replace(new RegExp(`${selectorStart}(?::root|:host|html|body)${selectorBoundary}`, 'gm'), '$1:scope')
    .replace(/(:scope:is\(\.dark, \.dark \*\))(?:\s*>\s*|\s+)(?:html|body)\b/g, '$1')
    .replace(/:scope([^,{}]*?)(?:\s*>\s*|\s+)(?:html|body)\b/g, ':scope$1');
  return `@scope (${scopeSelector}) {\n${rebasedRoots}\n}`;
}

/**
 * Typography bridged off the scope root once the host's own sheet has been
 * injected and applied. `editor-styles.css` already consumes every one of
 * these via `var(--conloca-host-*, …)` on the contenteditable, and the
 * computed-style probe already emits the same names — this is the same
 * contract, resolved from the scope root instead of a cross-origin iframe.
 *
 * Reading them here works because `scopeHostCss` rebases the host's `:root`
 * and `body` rules onto `:scope`, ie the scope root itself. So the host's own
 * page typography IS the computed style of that element, in the editor's
 * current theme, in this document. No iframe, no headless browser.
 *
 * Without this the contenteditable falls back to the L0 platform baseline
 * (`ui-sans-serif`, `#181818`) even when the host's face and ink are sitting
 * right there on the surround — the host's `body { font-family }` is layered
 * and inherited, and the editor's own unlayered rule overrides inheritance.
 *
 * All of these are INHERITED properties, which is what makes the
 * "did the host actually declare this?" test below possible.
 */
const HOST_TYPOGRAPHY_BRIDGE: readonly (readonly [property: string, variable: string])[] = [
  ['font-family', '--conloca-host-font-family'],
  ['font-size', '--conloca-host-font-size'],
  ['font-weight', '--conloca-host-font-weight'],
  ['font-style', '--conloca-host-font-style'],
  ['line-height', '--conloca-host-line-height'],
  ['letter-spacing', '--conloca-host-letter-spacing'],
];

/**
 * Every variable this bridge may write, for cleanup.
 *
 * `--conloca-host-body-bg` is the surround region's paint (main.css,
 * FragmentEditor) and predates the rest, but the probe publishes it too, so it
 * sits inside the `bridgeHostVars` gate with every other shared name.
 *
 * `--conloca-host-prose-bg` is the one name here the probe does NOT share, so
 * be explicit about why that is not a fork for one setup: it belongs to the
 * prose-surface tier's paper, and that tier only exists when live discovery
 * did NOT deliver — a host app on another origin AND a production build alike.
 * Where the probe runs, the tier is empty (`deriveProseSurfaceStyles` is
 * gated in `CMSMDXEditor`), so there is no paper to colour and nothing for the
 * probe to publish. It is scoped to the tier it serves, not to a setup. Merging
 * it into `--conloca-host-body-bg` would be wrong in the other direction: that
 * one is published whenever the host paints anything, while the paper is
 * published only together with a host ink, so a light card can never end up
 * carrying light text.
 */
const HOST_BRIDGE_VARS: readonly string[] = [
  '--conloca-host-body-bg',
  '--conloca-host-prose-bg',
  '--conloca-host-color',
  ...HOST_TYPOGRAPHY_BRIDGE.map(([, variable]) => variable),
];

/**
 * Inject host CSS strings into the current document's `<head>` while the
 * calling component is mounted. Each stylesheet can be wrapped in a named
 * cascade layer and confined to one editor subtree.
 *
 * `@import` statements are hoisted to the top of the injected `<style>` tag
 * because they must come before other rules to be valid. Hosts using
 * Tailwind / Google Fonts depend on this.
 *
 * `bridgeHostVars` controls the `--conloca-host-*` bridge below, and defaults
 * to on. Pass `false` when the computed-style probe has delivered: the probe
 * reads the REAL rendered page, which is strictly better than anything this
 * bridge can derive from a stylesheet, and the two write the same variable
 * names. Without the gate the bridge wins by accident rather than by design —
 * it writes inline properties on `<html>` while the probe emits a `:root`
 * rule, and inline outranks any stylesheet. That would silently supersede the
 * probe on a same-origin site, where it works.
 */
export function useInjectHostStyles(
  layerName: string,
  styles: SiteStyles,
  options?: { layered?: boolean; scopeSelector?: string; bridgeHostVars?: boolean },
): void {
  const scopeSelector = options?.scopeSelector;
  const layered = options?.layered !== false;
  const bridgeHostVars = options?.bridgeHostVars !== false;
  useEffect(() => {
    if (typeof document === 'undefined' || styles.length === 0) return;

    const tags: HTMLStyleElement[] = [];
    const marker = `data-conloca-host-styles-${layerName}`;

    for (const css of styles) {
      const imports: string[] = [];
      // Both `@import` shapes, via the same regex the canvas layer uses. The
      // `url(…)`-only pattern this used to carry missed the minified
      // bare-string form (`@import"https://fonts.googleapis.com/…"`) that real
      // Astro output opens with, leaving it stranded after the `@layer`
      // prelude where the parser drops it.
      const cleaned = css.replace(IMPORT_RE, (m) => {
        imports.push(m.trim());
        return '';
      });
      // Probe typography stays unlayered so it can beat the editor's prose
      // defaults. Full host CSS is both layered and scoped to the editor
      // surface; broad host resets and utility names never reach admin chrome.
      const scoped = scopeSelector ? scopeHostCss(cleaned, scopeSelector) : cleaned;
      const body = layered ? `@layer ${layerName} {\n${scoped}\n}` : scoped;
      const wrapped = `${imports.join('\n')}\n${body}`;
      const tag = document.createElement('style');
      tag.setAttribute(marker, '');
      tag.textContent = wrapped;
      document.head.appendChild(tag);
      tags.push(tag);
    }

    /**
     * Bridge the host page's own resolved typography and background into CSS
     * custom properties the editor's content surround and contenteditable
     * read. Works together with the `hostWrapperPlugin` (which mirrors the
     * host's `<main>`/marked element around the contenteditable):
     *
     *   - Editor's chrome wrapper paints `bg-page` (the CMS grey).
     *   - Inside the chrome, the content column paints the host body
     *     bg via this bridged var (`--conloca-host-body-bg`).
     *   - Inside that surround, the host's content wrapper (eg
     *     `<main>`) is rendered around the contenteditable. Hosts who
     *     paint a card surface on that wrapper get the paint; hosts
     *     like Starlight whose `<main>` is transparent rely on the
     *     surround's body bg showing through.
     *
     * Written as inline custom properties on `<html>` so they outrank the
     * prose-surface tier's platform fallbacks.
     *
     * Defers a frame so the freshly-appended `<style>` tags actually
     * apply before we read the scoped replacement for the host body.
     */
    const rafId = scopeSelector
      ? requestAnimationFrame(() => {
          const scopeRoot = document.querySelector<HTMLElement>(scopeSelector);
          if (!scopeRoot) return;
          const computed = getComputedStyle(scopeRoot);

          // Everything below is the contract the PROBE also fills, so it is
          // gated: when the probe delivered, it wins.
          if (!bridgeHostVars) return;

          // The surround region's paint (main.css `.conloca-mdx-editor-surround`,
          // also referenced by FragmentEditor). Inside the gate with the rest:
          // the probe publishes this same variable as a `:root` rule, and the
          // inline value written here outranks that rule permanently, latching
          // whatever this read-back caught on its first frame — which would
          // leave a light paper under the probe's dark ink. Gating costs a
          // same-origin surround nothing: where the probe runs, its own rule
          // paints the region. `background-color` is not inherited, so
          // transparency is a real "host painted nothing" sentinel.
          const background = computed.backgroundColor;
          const painted = background && background !== 'rgba(0, 0, 0, 0)' && background !== 'transparent';
          if (painted) document.documentElement.style.setProperty('--conloca-host-body-bg', background);

          // "Did the host actually declare this?" — the whole correctness of
          // the bridge. For INHERITED properties every element computes a
          // value, so a host that declares no `body { color }` still reports
          // one here: the admin chrome's, inherited, which is near-white in
          // the SPA's dark theme. Publishing that as the host's ink would put
          // near-white text on a light paper — the very defect this fixes.
          //
          // `scopeHostCss` rebases the host's `:root`/`body` rules onto
          // `:scope`, ie onto this element, so a host declaration is exactly
          // what makes this element differ from its parent. No guessing.
          const outer = scopeRoot.parentElement ? getComputedStyle(scopeRoot.parentElement) : null;
          const hostDeclared = (property: string): string | null => {
            const value = computed.getPropertyValue(property);
            if (!value || value === 'normal' || value === 'none') return null;
            if (outer && value === outer.getPropertyValue(property)) return null;
            return value;
          };

          for (const [property, variable] of HOST_TYPOGRAPHY_BRIDGE) {
            const value = hostDeclared(property);
            if (value !== null) document.documentElement.style.setProperty(variable, value);
          }

          // The prose surface's ink and paper, published as a PAIR or not at
          // all. Mixing them is what makes text vanish: the host's dark page
          // background under the platform's dark ink floor is as unreadable
          // as the platform's light paper under a host's light ink. When
          // either half is missing, both stay on the platform pairing, which
          // is contrast-checked by construction (light paper, dark ink).
          const ink = hostDeclared('color');
          if (painted && ink !== null) {
            document.documentElement.style.setProperty('--conloca-host-prose-bg', background);
            document.documentElement.style.setProperty('--conloca-host-color', ink);
          }
        })
      : null;

    return () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        for (const variable of HOST_BRIDGE_VARS) {
          document.documentElement.style.removeProperty(variable);
        }
      }
      for (const tag of tags) tag.remove();
    };
  }, [styles, layerName, layered, scopeSelector, bridgeHostVars]);
}
