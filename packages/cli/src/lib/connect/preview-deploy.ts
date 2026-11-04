import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { applyEdits, type JSONPath, modify, parse } from 'jsonc-parser';
import { type CallOptions, parseObjectEntries } from '../config-text.js';
import { isRecord } from '../is-record.js';
import { type AdapterName, HOST_ADAPTERS } from './adapter.js';
import type { StepResult } from './step.js';

/** wrangler.jsonc `main`: the dispatcher module `@conloca/cloud-astro` writes on every build. */
export const DISPATCHER_MAIN = '.conloca/dispatcher/index.mjs';

/** The dispatcher's rate-limit binding on the preview route: 60 requests per 10 s per client IP, not configurable. */
export const PREVIEW_LIMIT = { name: 'conlocaPreviewLimit', simple: { limit: 60, period: 10 } } as const;

/** Cloudflare's cap on `run_worker_first` entries. */
const MAX_WORKER_FIRST = 100;

/**
 * The `run_worker_first` entries that belong to the preview, not the site, for the route `prefix`
 * (`<base>/_conloca/preview`): the route itself and the image endpoint, which only draft pages use.
 */
export function previewOwnEntries(prefix: string): string[] {
  return [prefix, `${prefix}/*`, `${prefix.slice(0, -'/_conloca/preview'.length)}/_image`];
}

/**
 * A rate-limit namespace id for one Cloudflare Worker: unique per account is all Cloudflare asks, and taking it from
 * the name of that Cloudflare Worker means a rerun of connect writes the same id.
 */
export function previewLimitNamespace(workerName: string): string {
  const digest = createHash('sha256').update(`conloca-preview-limit:${workerName}`).digest();
  return String(1001 + (digest.readUInt32BE(0) % 1_000_000_000));
}

/** The block's `ratelimits` with the preview binding in it, or null when it is there already, exactly. */
function withPreviewLimit(block: unknown, workerName: string): unknown[] | null {
  const list: unknown[] = isRecord(block) && Array.isArray(block.ratelimits) ? block.ratelimits : [];
  const index = list.findIndex((entry) => isRecord(entry) && entry.name === PREVIEW_LIMIT.name);
  const existing = index === -1 ? undefined : list[index];
  // The same rule as the build's check and doctor's CC22: a positive integer, no leading zero.
  const keptId =
    isRecord(existing) && typeof existing.namespace_id === 'string' && /^[1-9]\d*$/u.test(existing.namespace_id)
      ? existing.namespace_id
      : null;
  const simple = isRecord(existing) && isRecord(existing.simple) ? existing.simple : {};
  if (keptId !== null && simple.limit === PREVIEW_LIMIT.simple.limit && simple.period === PREVIEW_LIMIT.simple.period) {
    return null;
  }
  const wanted = {
    name: PREVIEW_LIMIT.name,
    namespace_id: keptId ?? previewLimitNamespace(workerName),
    simple: { ...PREVIEW_LIMIT.simple },
  };
  return index === -1 ? [...list, wanted] : list.map((entry, at) => (at === index ? wanted : entry));
}

/**
 * The block's `ratelimits` without the preview binding, for a site on the Free plan (blocked requests still count
 * against its daily quota, so the limiter adds nothing there); `undefined` removes the key when nothing else is left,
 * and null means there was nothing to remove.
 */
function withoutPreviewLimit(block: unknown): unknown[] | undefined | null {
  const list: unknown[] = isRecord(block) && Array.isArray(block.ratelimits) ? block.ratelimits : [];
  const kept = list.filter((entry) => !(isRecord(entry) && entry.name === PREVIEW_LIMIT.name));
  if (kept.length === list.length) return null;
  return kept.length === 0 ? undefined : kept;
}

/** How the site's preview build serves, as conlocaCloud's and Astro's options read: d8 renders drafts through the adapter. */
export type PreviewSetup =
  | { kind: 'off'; refusal?: string }
  | { kind: 'd3'; prefix: string }
  /** `refusal`: previewBuild.adapter beside `separate: true`, which the build refuses. */
  | { kind: 'd4'; prefix: string; refusal?: string }
  | { kind: 'd8'; prefix: string; adapter: AdapterName };

/** `code` is the comment-stripped astro.config, whose imports say which package the adapter call comes from. */
export function previewSetupOf(
  integration: CallOptions,
  astro: CallOptions,
  base: string | null,
  code: string,
): PreviewSetup {
  if (integration.state !== 'literal') return { kind: 'off' };
  const raw = integration.entries.get('previewBuild');
  if (raw === undefined || raw.trim() === 'false') return { kind: 'off' };
  const prefix = `${(base ?? '/').replace(/\/+$/u, '')}/_conloca/preview`;
  const { separate, adapter: misplaced } = previewBuildKeys(raw);
  // The build refuses previewBuild.adapter: drafts render through the adapter in astro.config.
  const refusal = "remove previewBuild.adapter: drafts render through the adapter in astro.config's adapter option";
  const adapter = siteAdapterOf(astro, code);
  if (separate && (adapter === '@astrojs/vercel' || adapter === '@astrojs/netlify')) {
    // The build's own refusal (cloud-astro `separateRefusal`), which the CLI cannot import.
    return {
      kind: 'off',
      refusal: `previewBuild.separate is not supported with ${adapter}: the separate preview build would write its output where ${adapter} deploys the live site. Remove separate: true; with ${adapter} drafts render in the site's own build.`,
    };
  }
  if (separate) return misplaced ? { kind: 'd4', prefix, refusal } : { kind: 'd4', prefix };
  if (misplaced) return { kind: 'off', refusal };
  if (adapter === undefined) return { kind: 'd3', prefix };
  // shortcut: a third-party adapter, or one imported other than as a default import, reads as off.
  return adapter === 'other' ? { kind: 'off' } : { kind: 'd8', prefix, adapter };
}

/** What previewBuild's own object (not one nested in it, such as `config`) sets. */
export interface PreviewBuildKeys {
  /** `separate: true`: a separate preview deploy (D4). */
  separate: boolean;
  /** A top-level `adapter`, which the build refuses. */
  adapter: boolean;
}

export function previewBuildKeys(raw: string): PreviewBuildKeys {
  const parsed = parseObjectEntries(raw.trim());
  if (parsed === null) return { separate: false, adapter: false };
  const adapter = parsed.entries.has('adapter') || parsed.shorthands.has('adapter');
  return { separate: parsed.entries.get('separate') === 'true', adapter };
}

/**
 * The official adapter astro.config's `adapter:` calls, from the default import of its call; 'other' for any other
 * adapter, undefined when there is none. `code` is the comment-stripped config.
 */
export function siteAdapterOf(astro: CallOptions, code: string): AdapterName | 'other' | undefined {
  const own = astro.state === 'literal' ? astro.entries.get('adapter') : undefined;
  if (own === undefined) return undefined;
  const call = /^\s*([\w$]+)\s*\(/u.exec(own)?.[1];
  const source =
    call === undefined
      ? undefined
      : new RegExp(`\\bimport\\s+${call.replaceAll('$', '\\$')}\\s+from\\s+['"]([^'"]+)['"]`, 'u').exec(code)?.[1];
  return Object.values(HOST_ADAPTERS).find((entry) => entry.name === source)?.name ?? 'other';
}

export type WranglerFile =
  | { kind: 'jsonc'; path: string; text: string }
  | { kind: 'toml'; path: string }
  | { kind: 'none' };

export async function readWranglerFile(projectDir: string): Promise<WranglerFile> {
  const jsonc = ['wrangler.jsonc', 'wrangler.json']
    .map((name) => join(projectDir, name))
    .find((path) => existsSync(path));
  if (jsonc !== undefined) return { kind: 'jsonc', path: jsonc, text: await readFile(jsonc, 'utf8') };
  const toml = join(projectDir, 'wrangler.toml');
  return existsSync(toml) ? { kind: 'toml', path: toml } : { kind: 'none' };
}

export interface PreviewDeployInput {
  file: WranglerFile;
  setup: PreviewSetup;
  /** The list the last build wrote (`.conloca/dispatcher/run_worker_first.json`); null before a build. */
  routes: readonly string[] | null;
  /** How the site builds, for the D4 instructions. */
  buildCommand: string;
  /** How the project runs a binary it installed (`npx`, `bunx`, `pnpm exec`), for the D4 instructions. */
  exec: string;
  /** Whether sites.json names a previewUrl. */
  previewUrl: boolean;
  /** The owner asked for `not_found_handling: "none"` (`--negotiate-404`): misses go to the dispatcher. */
  negotiate404: boolean;
  /**
   * The recorded Cloudflare plan: `paid` writes and keeps the rate limit, `free` writes none and removes the one a
   * Paid run wrote. Unknown keeps the binding, as the build's check expects.
   */
  cfPlan: 'free' | 'paid' | undefined;
}

const needs = (message: string, lines: string[] = []): StepResult => ({
  state: 'needs-you',
  message,
  lines,
  edits: [],
});

/** A wrangler.jsonc value as the site wrote it, for a message. */
const shown = (value: unknown) => (typeof value === 'string' ? value : JSON.stringify(value));

/** `text` with `path` set to `value` (or removed, for `undefined`), comments and layout kept. */
export function setIn(text: string, path: JSONPath, value: unknown): string {
  const tabs = /^\t/mu.test(text);
  const tabSize = /^( +)\S/mu.exec(text)?.[1]?.length ?? 2;
  return applyEdits(
    text,
    modify(text, path, value, { formattingOptions: { insertSpaces: !tabs, tabSize, eol: '\n' } }),
  );
}

function d4Lines(buildCommand: string, exec: string): string[] {
  return [
    'Add a second Cloudflare Workers Builds project for this repository, with:',
    // CLOUDFLARE_ENV picks the Wrangler environment at build time, not at deploy.
    `  Build command: CONLOCA_PREVIEW_BUILD=1 CLOUDFLARE_ENV=preview ${buildCommand}`,
    `  Deploy command: ${exec} wrangler deploy`,
    'Then put its address in sites.json: "previewUrl": { "<locale>": "https://<its address>" }',
  ];
}

/** The D4 edit: the preview environment, with the bindings env blocks don't inherit, and no D3 dispatcher left over. */
function d4Step(
  input: PreviewDeployInput,
  file: { path: string; text: string },
  config: unknown,
  prefix: string,
): StepResult {
  const name = basename(file.path);
  if (!isRecord(config) || typeof config.name !== 'string') return needs(`${name} names no Cloudflare Worker`);
  const env = isRecord(config.env) ? config.env : {};
  let after = file.text;
  if (env.preview === undefined) {
    after = setIn(after, ['env', 'preview'], {
      name: `${config.name}-preview`,
      workers_dev: true,
      routes: [],
      ...(config.vars === undefined ? {} : { vars: config.vars }),
      ...(config.services === undefined ? {} : { services: config.services }),
    });
  }
  // A site that moves from D3 to D4: its main deploy no longer runs the dispatcher, and env.preview inherits `main`.
  const removed = config.main === DISPATCHER_MAIN;
  const assets = isRecord(config.assets) ? config.assets : {};
  const listed = assets.run_worker_first;
  const own = previewOwnEntries(prefix);
  const kept = Array.isArray(listed) ? listed.filter((entry) => !own.includes(entry)) : [];
  // With no script left, Wrangler refuses an assets binding and any run_worker_first, even an empty one.
  const scriptless = removed || config.main === undefined;
  if (scriptless && (listed === true || kept.length > 0)) {
    const entries = listed === true ? 'run_worker_first: true' : kept.map(shown).join(', ');
    return needs(
      `${name}: ${entries} needs a Worker script, and a separate preview deploy (D4) leaves the main deploy with none: remove ${listed === true ? 'it' : 'those entries'} (and the on-demand routes they serve), or set main to a script of your own`,
    );
  }
  if (removed) after = setIn(after, ['main'], undefined);
  if (Array.isArray(listed) && kept.length !== listed.length) {
    after = setIn(after, ['assets', 'run_worker_first'], kept.length > 0 ? kept : undefined);
  }
  if (scriptless && assets.binding === 'ASSETS') after = setIn(after, ['assets', 'binding'], undefined);
  const edits = after === file.text ? [] : [{ path: file.path, before: file.text, after }];
  const note = removed ? '; removed the D3 dispatcher (main and the preview route)' : '';
  if (input.previewUrl) {
    return {
      state: edits.length > 0 ? 'changed' : 'done',
      message: `${name} has the preview deploy's environment${note}`,
      edits,
    };
  }
  return {
    state: 'needs-you',
    message: `${name}: the separate preview deploy needs its own Cloudflare Workers Builds project${note}`,
    lines: d4Lines(input.buildCommand, input.exec),
    edits,
  };
}

/**
 * The d8 deploy step: the host's own rate limit on the preview route, set in its dashboard, or for the Cloudflare
 * adapter the routing the build reports (run_worker_first and not_found_handling "404-page"), with no `main`, rate-limit
 * binding or plan, since the adapter's Cloudflare Worker serves the route.
 */
function d8Step(input: PreviewDeployInput, prefix: string, adapter: AdapterName): StepResult {
  if (adapter === '@astrojs/vercel') {
    return needs('Vercel: rate-limit the preview route in the project firewall', [
      `Firewall → Add rule → If Request Path starts with ${prefix}/ → Rate Limit, ${PREVIEW_LIMIT.simple.limit} requests per ${PREVIEW_LIMIT.simple.period} seconds per IP → Deny`,
    ]);
  }
  if (adapter === '@astrojs/netlify') {
    return needs('Netlify: rate-limit the preview route', [
      `Rate limiting rule: path ${prefix}/*, 60 requests per 60 seconds per IP`,
      "every missing URL on this site, images included, runs your site's function",
    ]);
  }
  if (adapter === '@astrojs/node') {
    return needs('your own server: drafts render in the site server', [
      'start the server with `node dist/server/entry.mjs`',
    ]);
  }
  const { file } = input;
  if (file.kind !== 'jsonc') {
    return needs(
      file.kind === 'toml'
        ? "wrangler.toml can't carry the preview routing: convert it to wrangler.jsonc, then run `conloca connect` again"
        : 'this project has no wrangler.jsonc for the preview routing',
    );
  }
  const name = basename(file.path);
  if (input.routes === null) {
    // Before a build (or with --no-build) the routes are unknown: drafts would 404 until they are written.
    return needs(`${name}: the preview routing needs the routes a build reports`, ['conloca connect --update --yes']);
  }
  // An SSR site (on-demand routes of its own in the build's list) already sends every miss to its Cloudflare Worker; the build
  // checks the routing only when there are none (`siteRoutesOnDemand.length === 0`).
  const base = prefix.slice(0, -'/_conloca/preview'.length);
  const runtime = new Set([...previewOwnEntries(prefix), `${base}/_server-islands/*`]);
  if (input.routes.some((entry) => !runtime.has(entry))) {
    return {
      state: 'done',
      message: `${name}: the Cloudflare Worker already gets every miss, the preview included`,
      edits: [],
    };
  }
  const config: unknown = parse(file.text, [], { allowTrailingComma: true });
  if (!isRecord(config)) return needs(`${name} is not a JSON object`);
  const assets = isRecord(config.assets) ? config.assets : {};
  const listed = assets.run_worker_first;
  if (listed !== undefined && listed !== true && !Array.isArray(listed)) {
    return needs(`${name} has its own run_worker_first; add ${JSON.stringify(input.routes)} to it`);
  }
  const current: unknown[] = Array.isArray(listed) ? listed : [];
  const missing = listed === true ? [] : input.routes.filter((entry) => !current.includes(entry));
  if (current.length + missing.length > MAX_WORKER_FIRST) {
    return needs(
      `${name}: run_worker_first would have more than ${MAX_WORKER_FIRST} entries, Cloudflare's cap; merge some into wider patterns`,
    );
  }
  let after = file.text;
  if (missing.length > 0) after = setIn(after, ['assets', 'run_worker_first'], [...current, ...missing]);
  // As for D3: "none" only on --negotiate-404, and a "none" the site has already stays.
  const handling = input.negotiate404 || assets.not_found_handling === 'none' ? 'none' : '404-page';
  if (assets.not_found_handling !== handling) after = setIn(after, ['assets', 'not_found_handling'], handling);
  if (after === file.text) {
    return { state: 'done', message: `${name} routes the preview through the Cloudflare adapter`, edits: [] };
  }
  return {
    state: 'changed',
    message: `${name}: the preview runs on ${prefix}/* through the Cloudflare adapter, misses get ${handling === 'none' ? 'the Cloudflare Worker (not_found_handling "none")' : 'the 404 page'}`,
    edits: [{ path: file.path, before: file.text, after }],
  };
}

/**
 * The wrangler.jsonc settings a D3 or D4 preview needs, merged into the site's own: what it sets is added, what the
 * site set is kept, and a setting that conflicts is reported, never overwritten. A TOML config is never edited. d8
 * gets its host's deploy step.
 */
export function previewDeployStep(input: PreviewDeployInput): StepResult {
  const { file, setup } = input;
  if (setup.kind === 'off') {
    return { state: 'skipped', message: 'previewBuild serves no draft preview', edits: [] };
  }
  if (setup.kind === 'd8') return d8Step(input, setup.prefix, setup.adapter);
  const pair = [setup.prefix, `${setup.prefix}/*`];
  // A route list from the build starts with the prefix pair: dropped here so each entry is listed once.
  const wanted = [...pair, ...(input.routes ?? []).filter((r) => !r.startsWith(setup.prefix))];
  if (file.kind === 'none') {
    return needs(
      'this project has no wrangler.jsonc: draft previews of a static site run on Cloudflare Workers, so deploy it to Cloudflare Workers with one',
    );
  }
  if (file.kind === 'toml') {
    // Newer Wrangler settings need a JSON config, and the build's own check reads only wrangler.jsonc.
    return needs(
      "wrangler.toml can't carry the preview settings: convert it to wrangler.jsonc, then run `conloca connect` again",
    );
  }
  const config: unknown = parse(file.text, [], { allowTrailingComma: true });
  const name = basename(file.path);
  if (!isRecord(config)) return needs(`${name} is not a JSON object`);
  if (config.pages_build_output_dir !== undefined) {
    return needs(`${name} configures Cloudflare Pages; draft previews need Cloudflare Workers with static assets`);
  }
  if (setup.kind === 'd4') return d4Step(input, file, config, setup.prefix);

  const envs = isRecord(config.env) ? config.env : {};
  for (const [envName, block] of Object.entries(envs)) {
    if (isRecord(block) && (block.main !== undefined || block.assets !== undefined)) {
      return needs(
        `${name}: env.${envName} sets main or assets, which replaces the dispatcher's; remove them from the env block`,
      );
    }
  }
  const assets = isRecord(config.assets) ? config.assets : {};
  if (config.main !== undefined && config.main !== DISPATCHER_MAIN) {
    return needs(
      `${name} sets its own main (${shown(config.main)}); the preview dispatcher needs main: "${DISPATCHER_MAIN}"`,
    );
  }
  if (assets.not_found_handling === 'single-page-application') {
    return needs(
      `${name} uses single-page-application 404 handling, which serves index.html for every miss; previews need "404-page" (or "none")`,
    );
  }
  const listed = assets.run_worker_first;
  // `true` already runs every path through the dispatcher: accepted, as the build's guard and CC17 accept it.
  const everything = listed === true;
  if (!everything && listed !== undefined && !(Array.isArray(listed) && listed.includes(`${setup.prefix}/*`))) {
    return needs(`${name} has its own run_worker_first; add ${JSON.stringify(wanted)} to it`);
  }
  const current: unknown[] = Array.isArray(listed) ? listed : [];
  const excluded = current.find(
    (entry) => typeof entry === 'string' && entry.startsWith('!') && entry.slice(1).startsWith(setup.prefix),
  );
  if (typeof excluded === 'string') {
    return needs(`${name}: run_worker_first excludes the preview route (${excluded}); remove that entry`);
  }
  const missing = everything ? [] : wanted.filter((entry) => !current.includes(entry));
  if (current.length + missing.length > MAX_WORKER_FIRST) {
    return needs(
      `${name}: run_worker_first would have more than ${MAX_WORKER_FIRST} entries, Cloudflare's cap; merge some into wider patterns`,
    );
  }
  if (assets.binding !== undefined && assets.binding !== 'ASSETS') {
    return needs(`${name} binds the assets as ${shown(assets.binding)}; the preview dispatcher reads them as ASSETS`);
  }
  const directory = assets.directory;
  if (
    directory !== undefined &&
    !(typeof directory === 'string' && ['dist', './dist', 'dist/', './dist/'].includes(directory))
  ) {
    return needs(`${name} serves ${shown(directory)}; the static site and the dispatcher are served from ./dist`);
  }

  let after = file.text;
  // What this run sets besides the routes and the rate limit, for the summary.
  const wrote: string[] = [];
  const put = (path: JSONPath, value: unknown, label: string) => {
    after = setIn(after, path, value);
    wrote.push(label);
  };
  if (config.main === undefined) put(['main'], DISPATCHER_MAIN, 'main');
  const flags = Array.isArray(config.compatibility_flags) ? config.compatibility_flags : [];
  if (!flags.includes('nodejs_compat')) put(['compatibility_flags'], [...flags, 'nodejs_compat'], 'nodejs_compat');
  if (assets.directory === undefined) put(['assets', 'directory'], './dist', 'assets.directory');
  if (assets.binding === undefined) put(['assets', 'binding'], 'ASSETS', 'assets.binding');
  // "none" only when the site owner asks: with it a failed preview build fails the site's build, so a text heuristic
  // must never switch it. A "none" the site has already stays.
  const negotiated = input.negotiate404 && assets.not_found_handling !== 'none';
  if (negotiated) put(['assets', 'not_found_handling'], 'none', 'not_found_handling');
  else if (assets.not_found_handling !== '404-page' && assets.not_found_handling !== 'none') {
    put(['assets', 'not_found_handling'], '404-page', 'not_found_handling');
  }
  if (missing.length > 0) after = setIn(after, ['assets', 'run_worker_first'], [...current, ...missing]);
  // Wrangler does not inherit bindings into env blocks: each gets the binding under the name of its Cloudflare Worker.
  // On the Free plan there is none, and one a Paid run wrote goes.
  const workerName = typeof config.name === 'string' ? config.name : 'site';
  const limited = input.cfPlan !== 'free';
  const top = limited ? withPreviewLimit(config, workerName) : withoutPreviewLimit(config);
  if (top !== null) after = setIn(after, ['ratelimits'], top);
  for (const [envName, block] of Object.entries(envs)) {
    if (!isRecord(block)) continue;
    const list = limited
      ? withPreviewLimit(block, typeof block.name === 'string' ? block.name : `${workerName}-${envName}`)
      : withoutPreviewLimit(block);
    if (list !== null) after = setIn(after, ['env', envName, 'ratelimits'], list);
  }
  const limitNote = limited
    ? `, limited to ${PREVIEW_LIMIT.simple.limit} requests per ${PREVIEW_LIMIT.simple.period} s per visitor`
    : ', with no rate limit (Cloudflare Workers Free plan)';
  if (after === file.text) {
    return {
      state: 'done',
      message: `${name} runs the preview dispatcher on ${setup.prefix}/*${limitNote}`,
      edits: [],
    };
  }
  const negotiation = negotiated
    ? '; every miss now runs the dispatcher (not_found_handling "none", --negotiate-404): add the page paths your middleware negotiates (for example "/blog/*") to run_worker_first'
    : '';
  const settings = wrote.length > 0 ? ` sets ${wrote.join(', ')};` : '';
  return {
    state: 'changed',
    message: `${name}:${settings} the preview dispatcher runs on ${missing.length > 0 ? missing.join(', ') : `${setup.prefix}/*`}${limitNote}${negotiation}`,
    edits: [{ path: file.path, before: file.text, after }],
  };
}
