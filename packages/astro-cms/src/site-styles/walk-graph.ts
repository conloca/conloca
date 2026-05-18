import type { ViteDevServer } from 'vite';

/**
 * Resolve the CSS that applies to a route by reusing Astro's own dev-time
 * CSS discovery — the same data Astro consumes to inject `<link>` tags
 * when it renders a page.
 *
 * The mechanism: Astro's CSS Vite plugin generates a virtual module
 * `virtual:astro:dev-css-all` that exports `devCSSMap`, a Map keyed by
 * component path. Each entry is an async importer that returns the
 * complete CSS set for that component — including styles brought in
 * via dynamic/layout dispatch that a naive static graph walk misses.
 *
 * We SSR-load the virtual module, look up the route's component path,
 * invoke the importer, then fetch each CSS file via `transformRequest`
 * so we get the compiled output (Tailwind, PostCSS, scoped styles all
 * resolved).
 */

export interface DiscoveredStyle {
  /** Vite module URL — stable per stylesheet. */
  url: string;
  /** Compiled CSS source. */
  css: string;
}

interface AstroCssEntry {
  id: string;
  url: string;
  content?: string;
}

interface DevCssModule {
  devCSSMap: Map<string, () => Promise<{ css: Iterable<AstroCssEntry> }>>;
}

const ASTRO_STYLE_RE = /\?astro&type=style/;

/**
 * Look up and load the CSS for a route's component, then compile each
 * stylesheet to a string. Returns an empty array if Astro hasn't surfaced
 * a CSS entry for the component (eg the route is unknown to the manifest
 * or hasn't been seen yet).
 */
export async function walkCssForComponent(server: ViteDevServer, componentPath: string): Promise<DiscoveredStyle[]> {
  let devCss: DevCssModule;
  try {
    devCss = (await server.ssrLoadModule('virtual:astro:dev-css-all')) as DevCssModule;
  } catch (err) {
    console.warn('[conloca:css] virtual:astro:dev-css-all unavailable:', err);
    return [];
  }

  const importer = devCss.devCSSMap.get(componentPath);
  if (!importer) return [];

  let entries: Iterable<AstroCssEntry>;
  try {
    entries = (await importer()).css;
  } catch (err) {
    console.warn(`[conloca:css] importer failed for ${componentPath}:`, err);
    return [];
  }

  const collected: DiscoveredStyle[] = [];
  for (const entry of entries) {
    const css = entry.content ? entry.content : await fetchCss(server, entry.id);
    if (css) collected.push({ url: entry.url, css });
  }
  return collected;
}

async function fetchCss(server: ViteDevServer, id: string): Promise<string | null> {
  // Astro virtual style modules (`Foo.astro?astro&type=style&...&lang.css`)
  // and `?direct`-wrapped CSS module ids both return their compiled CSS as
  // the `code` of a `transformRequest` result. SSR transform path matches
  // how Astro itself reads them during dev render.
  try {
    const result = await server.transformRequest(id, { ssr: true });
    if (!result) return null;
    if (ASTRO_STYLE_RE.test(id)) return result.code;
    // For real .css files Vite returns a JS wrapper unless `?direct` is set;
    // try `?inline` via ssrLoadModule to get the raw string. Skip if we
    // already have CSS as the code (some transforms emit it directly).
    if (looksLikeCss(result.code)) return result.code;
    const inlineUrl = id.includes('?') ? `${id}&inline` : `${id}?inline`;
    const mod = (await server.ssrLoadModule(inlineUrl)) as { default?: string };
    return typeof mod.default === 'string' ? mod.default : null;
  } catch (err) {
    console.warn(`[conloca:css] fetch failed for ${id}:`, err);
    return null;
  }
}

function looksLikeCss(code: string): boolean {
  // Heuristic: Vite's CSS plugin emits JS like `import {...} from "/@vite/client";`
  // when not requested as `?direct`/`?inline`. Raw CSS doesn't have JS import
  // statements at the top level.
  const head = code.slice(0, 200);
  return !head.includes('import ') && !head.includes('export ');
}
