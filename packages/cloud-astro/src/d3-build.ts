/**
 * The site's build finishing a D3 preview: the preview server was built next to the static site (a child build),
 * and this writes what Cloudflare Workers needs to serve both: the preview build's `_astro` files merged into the
 * site's, the route list `wrangler.jsonc` must run the dispatcher on, and the dispatcher module and its config.
 */

import { existsSync } from 'node:fs';
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { isRecord } from '@conloca/content-api/component-vocabulary';
import { readSitesConfig } from '@conloca/content-api/node';
import { PACKAGE_NAME } from './constants.js';
import { parseWranglerConfig, wranglerConfigPath } from './preview/cloudflare-adapter.js';
import type { DispatcherConfig, DispatcherExit } from './preview/dispatcher.js';
import { previewRoutePrefix } from './preview/preview-path.js';

/** What the preview build tells the site's build: its pages, its on-demand routes and the exit values it baked. */
export interface PreviewRoutes {
  /** Request paths without a trailing slash, under the base. */
  prerendered: string[];
  /** `run_worker_first` globs under the base. */
  onDemand: string[];
  /** What the dispatcher's exit route answers with. */
  exit: DispatcherExit;
}

const ROUTES_FILE = 'routes.json';
/** The binding `conloca connect` writes and the dispatcher reads (`DispatcherEnv`). */
const LIMIT_BINDING = 'conlocaPreviewLimit';

/**
 * The routes the live site must hand to its dispatcher: everything the preview build renders on demand, except the
 * CMS pages (prerendered in production), the preview route itself, redirects (the static site writes them as pages)
 * and Astro's internals other than islands, actions and the image endpoint draft pages use.
 */
export function onDemandPatterns(
  routes: readonly { pattern: string; isPrerendered: boolean; origin: string; entrypoint: string; type: string }[],
): string[] {
  return routes
    .filter((route) => !route.isPrerendered && route.type !== 'redirect')
    .filter((route) => !route.entrypoint.endsWith('/internal/page-handler.astro'))
    .filter((route) => !/preview-handler(\.astro)?$/u.test(route.entrypoint))
    .filter((route) => route.origin !== 'internal' || /^\/_(server-islands|actions|image)(\/|$)/u.test(route.pattern))
    .map((route) => route.pattern);
}

/** An Astro route pattern as a `run_worker_first` glob under the base: from the first dynamic segment on, `*`. */
export function workerFirstPattern(pattern: string, base: string): string {
  const segments = pattern.split('/');
  const dynamic = segments.findIndex((segment) => segment.includes('['));
  const path = dynamic === -1 ? pattern : `${segments.slice(0, dynamic).join('/')}/*`;
  return `${base.replace(/\/+$/u, '')}${path}`;
}

export async function writePreviewRoutes(previewOut: string, routes: PreviewRoutes): Promise<void> {
  await mkdir(previewOut, { recursive: true });
  await writeFile(join(previewOut, ROUTES_FILE), `${JSON.stringify(routes, null, 2)}\n`);
}

function isStrings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isExit(value: unknown): value is DispatcherExit {
  return (
    isRecord(value) &&
    typeof value.repo === 'string' &&
    typeof value.siteId === 'string' &&
    typeof value.branch === 'string' &&
    typeof value.audience === 'string' &&
    (value.issuer === undefined || typeof value.issuer === 'string')
  );
}

/** The preview build's report, or undefined when it wrote none (it failed, or is from an older release). */
export async function readPreviewRoutes(previewOut: string): Promise<PreviewRoutes | undefined> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(join(previewOut, ROUTES_FILE), 'utf8'));
  } catch {
    return undefined;
  }
  return isRecord(value) && isStrings(value.prerendered) && isStrings(value.onDemand) && isExit(value.exit)
    ? { prerendered: value.prerendered, onDemand: value.onDemand, exit: value.exit }
    : undefined;
}

/**
 * Copies the preview build's built files into the site's, so the drafts' scripts and styles load from the one asset
 * set the site serves. Content-hashed names mean the same name holds the same bytes; a name that holds other bytes
 * copies nothing and answers false.
 */
export async function mergeAssets(from: string, to: string): Promise<boolean> {
  if (!existsSync(from)) return true;
  const files = (await readdir(from, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => relative(from, join(entry.parentPath, entry.name)));
  const clashes = await Promise.all(
    files.map(
      async (file) =>
        existsSync(join(to, file)) && !(await readFile(join(to, file))).equals(await readFile(join(from, file))),
    ),
  );
  if (clashes.includes(true)) return false;
  await Promise.all(
    files.map(async (file) => {
      if (existsSync(join(to, file))) return;
      await mkdir(dirname(join(to, file)), { recursive: true });
      await copyFile(join(from, file), join(to, file));
    }),
  );
  return true;
}

/** The config's blocks a deploy can use, labelled: the top level, and each env block (the build selects one). */
function blocksOf(config: unknown): { label: string; block: unknown; inherited: unknown }[] {
  if (!isRecord(config)) return [];
  const env = isRecord(config.env) ? config.env : {};
  return [
    { label: '', block: config, inherited: undefined },
    ...Object.entries(env).map(([name, block]) => ({ label: ` (env.${name})`, block, inherited: config })),
  ];
}

/** `run_worker_first` of a block's own `assets`, else what it inherits; `true` covers every path. */
function workerFirstOf(block: unknown, inherited: unknown): readonly unknown[] | true | undefined {
  const own = isRecord(block) && isRecord(block.assets) ? block.assets : undefined;
  const assets = own ?? (isRecord(inherited) && isRecord(inherited.assets) ? inherited.assets : undefined);
  if (assets === undefined) return undefined;
  if (assets.run_worker_first === true) return true;
  return Array.isArray(assets.run_worker_first) ? assets.run_worker_first : [];
}

function hasLimit(block: unknown): boolean {
  if (!isRecord(block) || !Array.isArray(block.ratelimits)) return false;
  return block.ratelimits.some(
    (entry) =>
      isRecord(entry) &&
      entry.name === LIMIT_BINDING &&
      typeof entry.namespace_id === 'string' &&
      /^[1-9]\d*$/u.test(entry.namespace_id),
  );
}

/**
 * What `wrangler.jsonc` lacks for D3, as fix messages: `run_worker_first` entries per block that has its own
 * `assets` (an env block's replaces the top level's), and, when the plan needs it, the rate limit in every block
 * (bindings are not inherited).
 */
export function deployProblems(config: unknown, expected: readonly string[], needsLimit: boolean): string[] {
  const problems: string[] = [];
  for (const { label, block, inherited } of blocksOf(config)) {
    const ownAssets = isRecord(block) && isRecord(block.assets);
    if (label === '' || ownAssets) {
      const listed = workerFirstOf(block, inherited);
      const missing = listed === true ? [] : expected.filter((entry) => !(listed ?? []).includes(entry));
      if (missing.length > 0) problems.push(`wrangler.jsonc run_worker_first lacks ${missing.join(', ')}${label}`);
    }
    if (needsLimit && !hasLimit(block)) problems.push(`wrangler.jsonc lacks the ${LIMIT_BINDING} rate limit${label}`);
  }
  return problems;
}

/** The site's recorded Cloudflare plan (`package.json` `conloca.cfPlan`, written by `conloca connect`), or undefined. */
export async function recordedCfPlan(root: string): Promise<'free' | 'paid' | undefined> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  } catch {
    return undefined;
  }
  const plan = isRecord(value) && isRecord(value.conloca) ? value.conloca.cfPlan : undefined;
  return plan === 'free' || plan === 'paid' ? plan : undefined;
}

/**
 * What the preview server serves for the live site beyond the preview route, per the config: `run_worker_first`
 * entries past the prefix pair and the image endpoint (only drafts use it), and `not_found_handling: "none"` (it
 * answers every miss). A failed preview build must not ship over any of these.
 */
export function servedBeyondPrefix(config: unknown, base: string): string[] {
  const prefix = previewRoutePrefix(base);
  const own = new Set([prefix, `${prefix}/*`, `${base.replace(/\/+$/u, '')}/_image`]);
  const served = new Set<string>();
  for (const { block, inherited } of blocksOf(config)) {
    const listed = workerFirstOf(block, inherited);
    if (listed === true) served.add('run_worker_first: true');
    for (const entry of listed === true || listed === undefined ? [] : listed) {
      if (typeof entry === 'string' && !entry.startsWith('!') && !own.has(entry)) served.add(entry);
    }
    const assets = isRecord(block) && isRecord(block.assets) ? block.assets : undefined;
    if (assets?.not_found_handling === 'none') served.add('not_found_handling "none"');
  }
  return [...served];
}

/** The module `wrangler.jsonc` `main` names. Its preview server import is lazy, so a slow one never delays start-up. */
export function dispatcherModule(serverEntry: string | null): string {
  const load = serverEntry === null ? 'null' : `() => import(${JSON.stringify(serverEntry)})`;
  return [
    '// Written by @conloca/cloud-astro on every build.',
    "import { createDispatcher } from '@conloca/cloud-astro/dispatcher';",
    "import config from './dispatcher.json';",
    '',
    `export default createDispatcher(config, ${load});`,
    '',
  ].join('\n');
}

/** Every host sites.json declares: links to them are links to this site. */
async function declaredDomains(): Promise<string[]> {
  const contentRoot = process.env.CONLOCA_CONTENT_ROOT;
  if (!contentRoot) return [];
  const { sites } = await readSitesConfig(contentRoot);
  return [...new Set(Object.values(sites).flatMap((site) => Object.values(site.domains ?? {})))];
}

/** A plain `wrangler deploy` follows `.wrangler/deploy/config.json`; one the preview build left would ship it as the site. */
async function dropDeployRedirect(root: string, previewOut: string, logger: { info(message: string): void }) {
  const redirect = join(root, '.wrangler', 'deploy', 'config.json');
  if (!existsSync(redirect)) return;
  let target: string | undefined;
  try {
    const value: unknown = JSON.parse(await readFile(redirect, 'utf8'));
    target =
      isRecord(value) && typeof value.configPath === 'string'
        ? resolve(dirname(redirect), value.configPath)
        : undefined;
  } catch {
    target = undefined;
  }
  if (target === undefined || !target.startsWith(`${resolve(previewOut)}${sep}`)) return;
  await rm(redirect);
  logger.info('removed .wrangler/deploy/config.json: it pointed a plain `wrangler deploy` at the preview server');
}

export interface FinishD3Input {
  root: string;
  dist: string;
  previewOut: string;
  base: string;
  endpoint: string;
  /** Whether the preview build succeeded. */
  built: boolean;
  logger: { info(message: string): void; warn(message: string): void };
}

const FIX = 'run `conloca connect --update --yes`';

/** D3: everything after the preview build; it fails the site's build only where shipping would break it. */
export async function finishD3Build(input: FinishD3Input): Promise<void> {
  const { root, dist, previewOut, base, logger } = input;
  const prefix = previewRoutePrefix(base);
  const routes = input.built ? await readPreviewRoutes(previewOut) : undefined;
  let serving = routes !== undefined;
  if (input.built && routes === undefined)
    logger.warn('the preview build wrote no routes.json, so no preview is served');
  if (serving && !(await mergeAssets(join(previewOut, 'client', '_astro'), join(dist, '_astro')))) {
    serving = false;
    logger.warn(`the preview build's _astro files clash with the site's, so ${prefix}/ answers "preview unavailable"`);
  }
  await dropDeployRedirect(root, previewOut, logger);

  const outDir = join(root, '.conloca', 'dispatcher');
  await mkdir(outDir, { recursive: true });
  const expected = [prefix, `${prefix}/*`, ...(serving && routes !== undefined ? routes.onDemand : [])];
  await writeFile(join(outDir, 'run_worker_first.json'), `${JSON.stringify(expected, null, 2)}\n`);

  const configPath = wranglerConfigPath(root);
  const config = configPath === undefined ? undefined : parseWranglerConfig(await readFile(configPath, 'utf8'));
  // Production safety first: with no preview server, every route it serves for the live site would 404.
  if (!serving) {
    const served = servedBeyondPrefix(config, base);
    if (served.length > 0) {
      throw new Error(
        `${PACKAGE_NAME}: the preview build failed and it serves this site's on-demand routes (${served.join(', ')}); fixing it is required to deploy`,
      );
    }
  }
  const problems =
    configPath === undefined
      ? [
          existsSync(join(root, 'wrangler.toml'))
            ? "wrangler.toml can't carry the preview settings: convert it to wrangler.jsonc, then"
            : 'no wrangler.jsonc:',
        ]
      : // A Free site carries no binding (a blocked request still counts against its quota); one with no recorded plan needs it.
        deployProblems(config, expected, (await recordedCfPlan(root)) !== 'free').map((problem) => `${problem}:`);
  for (const problem of problems) {
    const message = `${PACKAGE_NAME}: ${problem} ${FIX}`;
    // `conloca connect` builds to learn the routes it then writes; any other build must not ship a route that 404s.
    if (process.env.CONLOCA_CONNECT === '1') logger.warn(message);
    else throw new Error(message);
  }
  for (const glob of routes?.onDemand ?? []) {
    if (glob === `${base.replace(/\/+$/u, '')}/*`) {
      logger.warn(
        `${PACKAGE_NAME}: the on-demand route ${glob} covers every path, so every visitor starts a Worker; give it a fixed first segment`,
      );
    }
  }

  const dispatcher: DispatcherConfig = {
    base,
    endpoint: input.endpoint,
    prerendered: serving && routes !== undefined ? routes.prerendered : [],
    domains: await declaredDomains(),
    exit: serving && routes !== undefined ? routes.exit : null,
  };
  await writeFile(join(outDir, 'dispatcher.json'), `${JSON.stringify(dispatcher, null, 2)}\n`);
  const entry = relative(outDir, join(previewOut, 'server', 'entry.mjs'))
    .split(sep)
    .join('/');
  await writeFile(join(outDir, 'index.mjs'), dispatcherModule(serving ? entry : null));
  logger.info(`preview dispatcher written to .conloca/dispatcher/${serving ? '' : ' (preview unavailable)'}`);
}
