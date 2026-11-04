import { basename, dirname, join } from 'node:path';
import { isRecord } from '@conloca/content-api/component-vocabulary';
import { REFUSED_PREVIEW_ADAPTERS } from '../constants.js';
import { D8_TESTED_ADAPTERS, d8RateLimitLines } from '../d8-adapters.js';
import { D8_EDGE_REFUSAL, d8ConfigRefusal, d8EdgeRefusal } from '../d8-guards.js';
import { parseWranglerConfig } from '../preview/cloudflare-adapter.js';
import { previewRoutePrefix } from '../preview/preview-path.js';
import { separateRefusal } from '../preview-build.js';
import { INTEGRATION_NOT_CALLED, PREVIEW_BUILD_ADAPTER } from './checks-offline.js';
import {
  type ConfigScan,
  previewBuildSetting,
  previewBuildText,
  previewServeSetting,
  type ReadScan,
  separateRefused,
  siteAdapter,
} from './config-scan.js';
import { type CheckId, type CheckOutcome, type DoctorDeps, outcomeOf, skipped } from './types.js';

type D8Deps = Pick<DoctorDeps, 'exists' | 'readFile'>;
const IDS: readonly CheckId[] = ['CC25', 'CC26', 'CC27', 'CC28'];

type Official = keyof typeof D8_TESTED_ADAPTERS;
const isOfficial = (name: string): name is Official => Object.hasOwn(D8_TESTED_ADAPTERS, name);
/** The page files Astro builds a `src/pages/404` route from. */
const NOT_FOUND_PAGES = ['astro', 'md', 'mdx', 'html', 'js', 'ts'].map((extension) => `404.${extension}`);

/** previewBuild options the site's own build ignores. */
const NO_EFFECT = ['config', 'outDir', 'required'] as const;
const UPDATE = '— run `conloca connect --update --yes`';
const UNREADABLE_MODE =
  "doctor can't read middlewareMode from astro.config; the build reads it from the adapter and turns preview off if it is edge";
const NO_SITE =
  'your own (non-CMS) pages open the published page instead of staying in the preview: set site in astro.config (on Vercel and Netlify, conloca connect proposes it from sites.json or --site-url and writes it only on your yes in a terminal, never under --yes, since site also changes canonical, sitemap, RSS and Open Graph URLs on your live pages)';

function read(deps: D8Deps, path: string): string | undefined {
  try {
    return deps.readFile(path);
  } catch {
    return undefined;
  }
}

/** A JSON file's object, or undefined; the return type is `isRecord`'s narrowing. */
function jsonRecord(deps: D8Deps, path: string) {
  const text = read(deps, path);
  if (text === undefined) return undefined;
  try {
    const value: unknown = JSON.parse(text);
    return isRecord(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

/** A package's manifest as the project installs it: the nearest node_modules from the project up, as Node resolves it. */
function installedManifest(deps: D8Deps, projectDir: string, name: string) {
  for (let dir = projectDir; ; dir = dirname(dir)) {
    const found = jsonRecord(deps, join(dir, 'node_modules', name, 'package.json'));
    if (found !== undefined || dir === dirname(dir)) return found;
  }
}

/** `[major, minor, patch]` of a version or range floor; undefined when it names none. */
function versionParts(text: string): [number, number, number] | undefined {
  const match = /(\d+)\.(\d+)\.(\d+)/u.exec(text);
  return match === null ? undefined : [Number(match[1]), Number(match[2]), Number(match[3])];
}

function below(a: [number, number, number], b: [number, number, number]): boolean {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return (a[i] ?? 0) < (b[i] ?? 0);
  return false;
}

/** CC25: an official adapter, in the release range draft preview is tested with, on an astro it accepts. */
function adapterCheck(name: string | null, deps: D8Deps, projectDir: string): CheckOutcome {
  const outcome = outcomeOf('CC25');
  const warn = (message: string) => outcome.problems.push({ check: 'CC25', level: 'warn', message });
  if (name === null) {
    warn("doctor can't tell which adapter astro.config uses: import it by default and call it in adapter");
    return outcome;
  }
  if (!isOfficial(name)) {
    warn(`unsupported adapter ${name}: draft preview may work, Conloca doesn't test it`);
    return outcome;
  }
  const manifest = installedManifest(deps, projectDir, name);
  const version = typeof manifest?.version === 'string' ? manifest.version : undefined;
  if (version === undefined) {
    warn(`${name} is not installed: install the site's packages, then run doctor again`);
    return outcome;
  }
  const tested = D8_TESTED_ADAPTERS[name];
  const have = versionParts(version);
  const want = versionParts(tested);
  if (have === undefined || want === undefined || have[0] !== want[0] || below(have, want)) {
    warn(`${name} ${version} is outside the range Conloca tests draft preview with (^${tested})`);
  }
  const peers = isRecord(manifest?.peerDependencies) ? manifest.peerDependencies : {};
  const floor = typeof peers.astro === 'string' ? versionParts(peers.astro) : undefined;
  const astroManifest = installedManifest(deps, projectDir, 'astro');
  const astro = typeof astroManifest?.version === 'string' ? astroManifest.version : undefined;
  const astroParts = astro === undefined ? undefined : versionParts(astro);
  if (floor !== undefined && astro !== undefined && astroParts !== undefined && below(astroParts, floor)) {
    outcome.problems.push({
      check: 'CC25',
      level: 'error',
      message: `${name} ${version} needs astro ${floor.join('.')} or later; this site has ${astro}`,
    });
  }
  outcome.detail = `${name} ${version}`;
  return outcome;
}

/** CC26: what the build turns preview off for. */
function guardCheck(scan: ReadScan, name: string | null | undefined, base: string): CheckOutcome {
  const outcome = outcomeOf('CC26');
  const add = (level: 'error' | 'warn', message: string) => outcome.problems.push({ check: 'CC26', level, message });
  if (previewBuildSetting(scan) === 'adapter') {
    add('error', PREVIEW_BUILD_ADAPTER);
    return outcome;
  }
  const options = previewBuildText(scan) ?? '';
  if (name && REFUSED_PREVIEW_ADAPTERS.includes(name) && /\bseparate\s*:\s*true\b/u.test(options)) {
    add('error', separateRefusal(name));
    return outcome;
  }
  if (name) {
    const { text } = scan.config;
    const refusal = d8ConfigRefusal(text, name, base);
    if (refusal !== null) add('error', refusal);
    else {
      const edge = d8EdgeRefusal(undefined, text, name);
      if (edge === D8_EDGE_REFUSAL) add('error', edge);
      else if (edge !== null) add('warn', UNREADABLE_MODE);
    }
  }
  for (const key of NO_EFFECT) {
    if (new RegExp(`\\b${key}\\s*:`, 'u').test(options)) {
      add('warn', `previewBuild.${key} has no effect: drafts render in the site's own build`);
    }
  }
  return outcome;
}

/** CC27: how the host routes the preview route and the site's misses. Notes go in `detail`, the doctor's info. */
function routingCheck(scan: ReadScan, name: Official, deps: D8Deps, projectDir: string, base: string): CheckOutcome {
  const outcome = outcomeOf('CC27');
  const warn = (message: string) => outcome.problems.push({ check: 'CC27', level: 'warn', message });
  const notes: string[] = [];
  const prefix = previewRoutePrefix(base);
  const { site, text } = scan.config;
  const isStatic = site.output === 'static';
  if (name === '@astrojs/vercel') {
    if (/\bformat\s*:\s*['"]file['"]/u.test(text)) {
      warn("@astrojs/vercel builds build.format 'file' as 'directory', so page addresses lose their .html");
    }
    const pages = join(projectDir, 'src', 'pages');
    if (isStatic && !NOT_FOUND_PAGES.some((file) => deps.exists(join(pages, file)))) {
      notes.push(
        'misses run the preview function unless the build can restore the static 404 route; add src/pages/404.astro',
      );
    }
    notes.push(...d8RateLimitLines(name, prefix));
  }
  if (name === '@astrojs/netlify') {
    notes.push("every missing URL, images included, runs your site's function");
    notes.push(...d8RateLimitLines(name, prefix));
  }
  // A computed site (null) may well be set at build time; only an absent one is certain.
  if ((name === '@astrojs/vercel' || name === '@astrojs/netlify') && site.url === undefined) warn(NO_SITE);
  if (name === '@astrojs/cloudflare' && isStatic) {
    // The build's list is the truth: it leaves out `<base>_image` once the image endpoint moved under the prefix.
    const reported = jsonStrings(deps, join(projectDir, '.conloca', 'dispatcher', 'run_worker_first.json'));
    const wanted = reported ?? [prefix, `${prefix}/*`];
    const path = ['wrangler.jsonc', 'wrangler.json'].map((file) => join(projectDir, file)).find((p) => deps.exists(p));
    if (path === undefined && deps.exists(join(projectDir, 'wrangler.toml'))) {
      warn('convert wrangler.toml to wrangler.jsonc, then run conloca connect --update --yes');
      if (notes.length > 0) outcome.detail = notes.join('; ');
      return outcome;
    }
    const config = path === undefined ? undefined : parseWranglerConfig(read(deps, path) ?? '');
    const assets = isRecord(config?.assets) ? config.assets : {};
    const listed: unknown[] = Array.isArray(assets.run_worker_first) ? assets.run_worker_first : [];
    const missing = assets.run_worker_first === true ? [] : wanted.filter((entry) => !listed.includes(entry));
    if (missing.length > 0 || (assets.not_found_handling !== '404-page' && assets.not_found_handling !== 'none')) {
      warn(
        `${path === undefined ? 'wrangler.jsonc' : basename(path)} does not route the preview to the Cloudflare Worker: add ${(missing.length > 0 ? missing : wanted).join(', ')} to assets.run_worker_first and set assets.not_found_handling to "404-page" ${UPDATE}`,
      );
    }
  }
  if (notes.length > 0) outcome.detail = notes.join('; ');
  return outcome;
}

/** A JSON file's array of strings, or undefined. */
function jsonStrings(deps: D8Deps, path: string): string[] | undefined {
  const text = read(deps, path);
  if (text === undefined) return undefined;
  try {
    const value: unknown = JSON.parse(text);
    return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : undefined;
  } catch {
    return undefined;
  }
}

/** CC28: Node checks the forwarded host against `security.allowedDomains`, so a TLS proxy needs the site's domains there. */
function nodeCheck(scan: ReadScan): CheckOutcome {
  const outcome = outcomeOf('CC28');
  const { text } = scan.config;
  if (!/\ballowedDomains\s*:/u.test(text)) {
    outcome.problems.push({
      check: 'CC28',
      level: 'error',
      message:
        'add security.allowedDomains with your domains (connect writes it): without it every preview entry fails behind a TLS proxy',
    });
  } else if (/\ballowedDomains\s*:\s*\[\s*\]/u.test(text)) {
    outcome.problems.push({
      check: 'CC28',
      level: 'warn',
      message: 'security.allowedDomains is empty: add your domains, or every preview entry fails behind a TLS proxy',
    });
  }
  return outcome;
}

/** CC25–CC28: what drafts rendered in the site's own build (d8) need from its adapter and host. Never networks. */
export function runD8Checks(scan: ConfigScan, projectDir: string, deps: D8Deps): CheckOutcome[] {
  const mode = previewServeSetting(scan);
  const misplaced = previewBuildSetting(scan) === 'adapter';
  const refusedSeparate = separateRefused(scan) !== undefined;
  if (scan.kind !== 'read' || (mode !== 'd8' && !misplaced && !refusedSeparate)) {
    const reason =
      scan.kind === 'read' && scan.config.conlocaCloud === 'absent'
        ? INTEGRATION_NOT_CALLED
        : "only drafts rendered in the site's own build, through its adapter (d8), need these";
    return IDS.map((id) => skipped(id, reason));
  }
  const name = siteAdapter(scan);
  const base = scan.config.site.base ?? '/';
  const guards = guardCheck(scan, name, base);
  if (mode !== 'd8') {
    return [skipped('CC25', 'no d8 build'), guards, skipped('CC27', 'no d8 build'), skipped('CC28', 'no d8 build')];
  }
  return [
    adapterCheck(name ?? null, deps, projectDir),
    guards,
    name && isOfficial(name)
      ? routingCheck(scan, name, deps, projectDir, base)
      : skipped('CC27', 'not an adapter Conloca knows the routing of'),
    name === '@astrojs/node' ? nodeCheck(scan) : skipped('CC28', 'not @astrojs/node'),
  ];
}
