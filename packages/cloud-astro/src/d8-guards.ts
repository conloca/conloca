import { existsSync, readFileSync } from 'node:fs';
import type { AstroConfig, AstroIntegration, AstroIntegrationLogger } from 'astro';
import { balancedSlice, containsOutsideStrings, stripComments } from './doctor/config-scan.js';
import { PREVIEW_ROUTE_SEGMENT } from './preview/preview-path.js';

/** The adapters whose middleware can run at the edge, and the call that names each in astro.config. */
const EDGE_ADAPTER_CALLS = new Map([
  ['@astrojs/vercel', 'vercel'],
  ['@astrojs/netlify', 'netlify'],
]);
const EDGE_OPTION = /middlewareMode\s*:\s*['"]edge['"]|edgeMiddleware\s*:\s*true/;

export const D8_EDGE_REFUSAL =
  "draft preview does not run in edge middleware (middlewareMode: 'edge' / edgeMiddleware): its middleware does not " +
  'bundle into the edge function, and the adapter serializes locals to JSON. Remove the option to turn preview on.';

/** Astro's preview prefix under `base`, as served. */
function previewPrefix(base: string): string {
  return `${base.replace(/\/+$/u, '')}${PREVIEW_ROUTE_SEGMENT}`;
}

/** The isr refusal, naming the exclude entry that covers `<base>_conloca/preview(/.*)?`. */
export function d8IsrRefusal(base: string): string {
  const prefix = previewPrefix(base);
  return (
    `@astrojs/vercel isr caches ${prefix}/ by path, ignoring the preview cookie, so drafts could be served to anyone. ` +
    `Add the prefix to isr.exclude in astro.config: isr: { exclude: [/^${prefix.replaceAll('/', '\\/')}(\\/.*)?$/] }`
  );
}

/** The text of the astro.config Astro loads from `root` (its own search order), or '' when there is none. */
export function readAstroConfigText(root: URL): string {
  // shortcut: a config passed with `astro build --config <file>` is not seen; the probe and the build:done backstop still run.
  const file = ['mjs', 'js', 'ts', 'mts']
    .map((ext) => new URL(`astro.config.${ext}`, root))
    .find((url) => existsSync(url));
  return file === undefined ? '' : readFileSync(file, 'utf8');
}

/** The parenthesized arguments of the adapter's call in comment-stripped config text, or null without one. */
function adapterArgs(text: string, adapterName: string): string | null {
  const name = EDGE_ADAPTER_CALLS.get(adapterName);
  if (name === undefined) return null;
  const code = stripComments(text);
  const call = new RegExp(`\\b${name}\\s*\\(`).exec(code);
  return call === null ? null : balancedSlice(code, call.index + call[0].length - 1);
}

/** The config-text refusal for d8 on this adapter, or null. `text` is the astro.config file Astro loaded. Doctor (Plan 50) reuses it. */
export function d8ConfigRefusal(text: string, adapterName: string, base = '/'): string | null {
  const args = adapterArgs(text, adapterName);
  if (args === null) return null;
  if (adapterName === '@astrojs/vercel' && /\bisr\s*:(?!\s*false\b)/.test(args)) {
    const exclude = /\bexclude\s*:\s*\[/.exec(args);
    const list = exclude === null ? null : balancedSlice(args, exclude.index + exclude[0].length - 1);
    if (!(list?.includes('_conloca') && list.includes('preview'))) return d8IsrRefusal(base);
  }
  return EDGE_OPTION.test(args) ? D8_EDGE_REFUSAL : null;
}

/** A logger that drops everything: the probe's adapter hook must not log twice. */
const silentLogger: AstroIntegrationLogger = {
  options: { destination: { write: () => undefined }, level: 'silent' },
  label: 'probe',
  fork: () => silentLogger,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
  flush: () => undefined,
  close: () => undefined,
};

/** The adapter's resolved middleware mode, read by calling its own `astro:config:done` with a capturing `setAdapter`; undefined when that yields no `adapterFeatures.middlewareMode`. */
export async function adapterMiddlewareMode(
  adapter: AstroIntegration,
  config: AstroConfig,
): Promise<'classic' | 'edge' | undefined> {
  let mode: 'classic' | 'edge' | undefined;
  try {
    await adapter.hooks['astro:config:done']?.({
      config,
      buildOutput: 'static',
      setAdapter: (resolved) => {
        mode = resolved.adapterFeatures?.middlewareMode;
      },
      injectTypes: () => new URL('noop', config.root),
      logger: silentLogger,
    });
  } catch {
    return undefined;
  }
  return mode;
}

/** The edge refusal for this build, or null: `probed === 'edge'` → edge text; `probed === undefined` on vercel/netlify → `d8ConfigRefusal`'s edge text when the text names edge, else the unreadable text unless the text proves classic. */
export function d8EdgeRefusal(
  probed: 'classic' | 'edge' | undefined,
  text: string,
  adapterName: string,
): string | null {
  if (probed === 'edge') return D8_EDGE_REFUSAL;
  if (probed === 'classic' || !EDGE_ADAPTER_CALLS.has(adapterName)) return null;
  const args = adapterArgs(text, adapterName);
  if (args !== null && EDGE_OPTION.test(args)) return D8_EDGE_REFUSAL;
  const inner = args?.slice(1, -1).trim();
  // Classic is proven by no argument, or one spread-free object literal whose mode keys are absent or literally classic.
  const classic =
    inner === '' ||
    (inner?.startsWith('{') === true &&
      balancedSlice(inner, 0) === inner &&
      !containsOutsideStrings(inner, '...') &&
      !/\b(?:middlewareMode|edgeMiddleware)\b/.test(
        inner.replace(/\bmiddlewareMode\s*:\s*(['"])classic\1|\bedgeMiddleware\s*:\s*false\b/g, ''),
      ));
  return classic
    ? null
    : `couldn't read middlewareMode from astro.config; write the ${adapterName} options literally to turn preview on.`;
}

interface VercelRoute {
  src?: unknown;
  dest?: unknown;
  handle?: unknown;
  status?: unknown;
  continue?: unknown;
}

/** A `.vercel/output/config.json` after the prefix is darkened: its other keys as the adapter wrote them. */
interface VercelOutputConfig {
  routes: VercelRoute[];
}

/** The routes of a `.vercel/output/config.json`, or [] when it holds none. */
function vercelRoutes(configJson: unknown): VercelRoute[] {
  if (typeof configJson !== 'object' || configJson === null || !('routes' in configJson)) return [];
  return Array.isArray(configJson.routes)
    ? configJson.routes.filter((route): route is VercelRoute => typeof route === 'object' && route !== null)
    : [];
}

/** Whether a Vercel route src matches the path. Srcs are PCRE: compiled without 'u', and one JS can't read matches nothing. */
function srcMatches(src: unknown, path: string): boolean {
  if (typeof src !== 'string') return false;
  try {
    return new RegExp(src).test(path);
  } catch {
    return false;
  }
}

/** True when `.vercel/output/config.json` sends the preview route to an `_isr` function. */
export function vercelIsrCatchesPrefix(configJson: unknown, base: string): boolean {
  const routes = vercelRoutes(configJson);
  const prefix = previewPrefix(base);
  const after = routes.slice(routes.findIndex((route) => route.handle === 'filesystem') + 1);
  const end = after.findIndex((route) => route.handle !== undefined);
  // Only the filesystem phase's routes that serve: a dest without `continue` ends the lookup.
  const serving = (end < 0 ? after : after.slice(0, end)).filter(
    (route) => typeof route.dest === 'string' && route.continue !== true,
  );
  return [prefix, `${prefix}/`, `${prefix}/slug/page`].some((sample) => {
    const served = serving.find((route) => srcMatches(route.src, sample));
    return typeof served?.dest === 'string' && served.dest.startsWith('/_isr');
  });
}

/** The config with a static 404 for `<prefix>(/.*)?` placed first after `handle: filesystem`, so no route below it (the prefix's own `_isr` route or an `_isr` catch-all) ever serves or caches the prefix. Every other route is unchanged. */
export function darkenIsrPrefix(configJson: unknown, base: string): VercelOutputConfig {
  const src = `^${previewPrefix(base).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:/.*)?$`;
  const routes = vercelRoutes(configJson);
  const at = routes.findIndex((route) => route.handle === 'filesystem') + 1;
  const darkened = [...routes.slice(0, at), { src, dest: '/404.html', status: 404 }, ...routes.slice(at)];
  return typeof configJson === 'object' && configJson !== null
    ? { ...configJson, routes: darkened }
    : { routes: darkened };
}
