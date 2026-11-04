import { dirname, join, resolve, sep } from 'node:path';
import { isRecord } from '@conloca/content-api/component-vocabulary';
import { parseWranglerConfig } from '../preview/cloudflare-adapter.js';
import { previewOwnEntries, previewRoutePrefix } from '../preview/preview-path.js';
import { INTEGRATION_NOT_CALLED } from './checks-offline.js';
import { type ConfigScan, previewServeSetting, separateRefused } from './config-scan.js';
import { type CheckId, type CheckOutcome, type DoctorDeps, outcomeOf, skipped } from './types.js';

type PreviewDeps = Pick<DoctorDeps, 'exists' | 'readFile' | 'git'>;
const IDS: readonly CheckId[] = ['CC15', 'CC16', 'CC17', 'CC18', 'CC19', 'CC20', 'CC21'];
const DISPATCHER_MAIN = '.conloca/dispatcher/index.mjs';
const UPDATE = '— run `conloca connect --update --yes`';
/** Cloudflare's cap on `run_worker_first` entries. */
const MAX_WORKER_FIRST = 100;
/** Script hosts and snippets of tag managers and analytics loaders. */
const TAG_MANAGERS =
  /googletagmanager\.com|gtag\(|cdn\.segment\.com|connect\.facebook\.net|static\.hotjar\.com|js\.hs-scripts\.com|plausible\.io\/js|@builder\.io\/partytown/u;
const SOURCE = /\.(astro|html|[cm]?[jt]sx?|mdx?)$/u;
const MIDDLEWARE_FILES = ['src/middleware.ts', 'src/middleware.js', 'src/middleware.mjs'];

function read(deps: PreviewDeps, path: string): string | undefined {
  try {
    return deps.readFile(path);
  } catch {
    return undefined;
  }
}

/** A JSON file's object, or undefined; the return type is `isRecord`'s narrowing, never written out. */
function jsonRecord(deps: PreviewDeps, path: string) {
  const text = read(deps, path);
  if (text === undefined) return undefined;
  try {
    const value: unknown = JSON.parse(text);
    return isRecord(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

/** A JSON file's array of strings, or undefined. */
function jsonStrings(deps: PreviewDeps, path: string): string[] | undefined {
  const text = read(deps, path);
  if (text === undefined) return undefined;
  try {
    const value: unknown = JSON.parse(text);
    return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : undefined;
  } catch {
    return undefined;
  }
}

/** A heuristic: the site's middleware reads `Accept`, or answers a 404 body of its own. Doctor only warns on it. */
function middlewareNegotiates(deps: PreviewDeps, projectDir: string): boolean {
  const text = MIDDLEWARE_FILES.map((name) => read(deps, join(projectDir, name))).find((found) => found !== undefined);
  return (
    text !== undefined && (/\.get\(\s*['"`]accept['"`]\s*\)/iu.test(text) || /\bstatus\s*={2,3}\s*404\b/u.test(text))
  );
}

const onlyD3 = (id: CheckId) => skipped(id, 'a separate preview deploy (D4) runs no dispatcher');

/** CC15–CC21: the settings a D3 or D4 preview deploy needs, read from the project's files. Never networks. */
export function runPreviewChecks(scan: ConfigScan, projectDir: string, deps: PreviewDeps): CheckOutcome[] {
  const mode = previewServeSetting(scan);
  if (mode !== 'd3' && mode !== 'd4') {
    const refused = separateRefused(scan);
    const reason =
      scan.kind === 'read' && scan.config.conlocaCloud === 'absent'
        ? INTEGRATION_NOT_CALLED
        : refused !== undefined
          ? `the build refuses separate: true under ${refused} (see CC26)`
          : mode === 'unknown'
            ? 'doctor cannot read previewBuild from the config text'
            : mode === 'd8'
              ? "drafts render in the site's own build (d8): CC25–CC28 check its adapter and host"
              : 'only a static site previewing next to itself (D3) or on a separate deploy (D4) needs these';
    return IDS.map((id) => skipped(id, reason));
  }
  const base = scan.kind === 'read' ? (scan.config.site.base ?? '/') : '/';
  const prefix = previewRoutePrefix(base);
  const path = ['wrangler.jsonc', 'wrangler.json'].map((name) => join(projectDir, name)).find((p) => deps.exists(p));
  const text = path === undefined ? undefined : read(deps, path);
  const config = text === undefined ? undefined : parseWranglerConfig(text);
  const assets = isRecord(config?.assets) ? config.assets : {};
  const everything = assets.run_worker_first === true;
  const listed: unknown[] = Array.isArray(assets.run_worker_first) ? assets.run_worker_first : [];

  // CC15
  const deployTarget = outcomeOf('CC15');
  if (config === undefined && deps.exists(join(projectDir, 'wrangler.toml'))) {
    deployTarget.problems.push({
      check: 'CC15',
      level: 'error',
      message:
        "wrangler.toml can't carry the preview settings: convert it to wrangler.jsonc, then run `conloca connect --update --yes`",
    });
  } else if (config === undefined) {
    deployTarget.problems.push({
      check: 'CC15',
      level: 'error',
      message:
        'no wrangler.jsonc: draft previews of a static site deploy to Cloudflare Workers — run `conloca connect --yes`',
    });
  } else if (config.pages_build_output_dir !== undefined) {
    deployTarget.problems.push({
      check: 'CC15',
      level: 'error',
      message:
        'wrangler.jsonc configures Cloudflare Pages (pages_build_output_dir); draft previews need Cloudflare Workers with static assets',
      path,
    });
  } else {
    deployTarget.detail = 'Cloudflare Workers';
  }

  // CC16: array run_worker_first needs 4.20, the ratelimits binding 4.36; D4 uses neither.
  let version: CheckOutcome;
  if (mode === 'd4') version = onlyD3('CC16');
  else {
    version = outcomeOf('CC16');
    const manifest = [projectDir, join(projectDir, '..'), join(projectDir, '..', '..')]
      .map((dir) => jsonRecord(deps, join(dir, 'node_modules', 'wrangler', 'package.json')))
      .find((found) => found !== undefined);
    const installed = typeof manifest?.version === 'string' ? manifest.version : undefined;
    const [major = 0, minor = 0] = (installed ?? '').split('.').map(Number);
    if (installed === undefined) {
      version.problems.push({
        check: 'CC16',
        level: 'warn',
        message:
          'wrangler is not installed in this project: the deploy uses whichever wrangler it finds, and the preview settings need 4.36 or newer',
      });
    } else if (major < 4 || (major === 4 && minor < 36)) {
      version.problems.push({
        check: 'CC16',
        level: 'error',
        message: `wrangler ${installed} cannot deploy the preview settings: run_worker_first patterns and the ratelimits binding need wrangler 4.36 or newer`,
      });
    } else {
      version.detail = `wrangler ${installed}`;
    }
  }

  // CC17
  const dispatcher = {
    ...(config === undefined ? skipped('CC17', 'no wrangler.jsonc (see CC15)') : outcomeOf('CC17')),
    ...(mode === 'd4' ? { label: 'wrangler.jsonc keeps no D3 dispatcher settings' } : {}),
  };
  const add = (message: string) => dispatcher.problems.push({ check: 'CC17', level: 'error', message, path });
  if (mode === 'd4' && config?.main === DISPATCHER_MAIN) {
    add(
      `main is the D3 dispatcher, which a separate preview deploy (D4) inherits and its main deploy no longer builds ${UPDATE}`,
    );
  }
  // An assets-only deploy: Wrangler refuses both settings without a script to run.
  if (mode === 'd4' && config !== undefined && config.main === undefined) {
    // `conloca connect --update` removes only what the D3 dispatcher left: an ASSETS binding and the preview's own entries.
    const own = previewOwnEntries(base);
    if (assets.binding !== undefined) {
      const fix = assets.binding === 'ASSETS' ? UPDATE : '— remove assets.binding';
      add(`assets.binding without main: Wrangler refuses an assets binding on a deploy with no script ${fix}`);
    }
    if (assets.run_worker_first !== undefined) {
      const ours = listed.length > 0 && listed.every((entry) => typeof entry === 'string' && own.includes(entry));
      const fix = ours ? UPDATE : '— remove it, or set main to a script of your own';
      add(`run_worker_first without main: Wrangler refuses it on a deploy with no script ${fix}`);
    }
  }
  if (mode === 'd3' && config !== undefined) {
    if (config.main !== DISPATCHER_MAIN) add(`main is not ${DISPATCHER_MAIN} ${UPDATE}`);
    if (!(Array.isArray(config.compatibility_flags) && config.compatibility_flags.includes('nodejs_compat'))) {
      add(`compatibility_flags lacks nodejs_compat ${UPDATE}`);
    }
    if (assets.binding !== 'ASSETS') add(`assets.binding is not ASSETS ${UPDATE}`);
    const missing = everything ? [] : [prefix, `${prefix}/*`].filter((entry) => !listed.includes(entry));
    if (missing.length > 0) add(`run_worker_first lacks ${missing.join(', ')} ${UPDATE}`);
    if (assets.not_found_handling === 'single-page-application') {
      add(`not_found_handling is single-page-application; previews need "404-page" or "none" ${UPDATE}`);
    }
    for (const [envName, block] of Object.entries(isRecord(config.env) ? config.env : {})) {
      if (isRecord(block) && (block.main !== undefined || block.assets !== undefined)) {
        add(`env.${envName} sets main or assets, which replaces the dispatcher's — remove them from the env block`);
      }
    }
    const excluded = listed.find(
      (entry) => typeof entry === 'string' && entry.startsWith('!') && entry.slice(1).startsWith(prefix),
    );
    if (typeof excluded === 'string') {
      add(`run_worker_first excludes the preview route (${excluded}) — remove that entry`);
    }
    if (listed.length > MAX_WORKER_FIRST) {
      add(
        `run_worker_first has ${listed.length} entries, past Cloudflare's cap of ${MAX_WORKER_FIRST} — merge some into wider patterns`,
      );
    }
  }

  // CC18
  const reported = jsonStrings(deps, join(projectDir, '.conloca', 'dispatcher', 'run_worker_first.json'));
  let routes: CheckOutcome;
  if (mode === 'd4') routes = onlyD3('CC18');
  else if (reported === undefined) routes = skipped('CC18', 'no build yet: build the site, then run doctor');
  else {
    routes = outcomeOf('CC18');
    const missing = everything ? [] : reported.filter((entry) => !listed.includes(entry) && !entry.startsWith(prefix));
    if (missing.length > 0) {
      routes.problems.push({
        check: 'CC18',
        level: 'error',
        message: `run_worker_first lacks ${missing.join(', ')}, which the last build renders on demand ${UPDATE}`,
        path,
      });
    }
  }

  // CC19
  const redirectPath = join(projectDir, '.wrangler', 'deploy', 'config.json');
  const redirect = jsonRecord(deps, redirectPath);
  const ships = mode === 'd4' ? onlyD3('CC19') : outcomeOf('CC19');
  const target =
    typeof redirect?.configPath === 'string' ? resolve(dirname(redirectPath), redirect.configPath) : undefined;
  if (
    mode === 'd3' &&
    target !== undefined &&
    target.startsWith(`${resolve(projectDir, '.conloca', 'preview-server')}${sep}`)
  ) {
    ships.problems.push({
      check: 'CC19',
      level: 'error',
      message:
        'a plain `wrangler deploy` would ship the preview server as the site: delete .wrangler/deploy/config.json and build again with this release',
      path: redirectPath,
    });
  }

  // CC20: a heuristic, so a warning. The detection of middleware negotiation lives here too.
  let misses: CheckOutcome;
  const negotiates = middlewareNegotiates(deps, projectDir);
  if (mode === 'd4') misses = onlyD3('CC20');
  else if (assets.not_found_handling === 'none') {
    misses = {
      ...outcomeOf('CC20'),
      detail: negotiates
        ? 'not_found_handling is "none": every miss reaches the dispatcher, so the middleware negotiates them; its negotiated pages need run_worker_first entries too'
        : 'not_found_handling is "none": every miss reaches the dispatcher, which answers it',
    };
  } else {
    misses = outcomeOf('CC20');
    // A build holds the 404 page however it is made (a CMS page, src/pages/404.ts, [lang]/404.astro); before one, the
    // source files.
    const built = deps.exists(join(projectDir, 'dist', 'index.html'));
    const sources = [
      'src/pages/404.astro',
      'src/pages/404.md',
      'src/pages/404.mdx',
      'src/pages/404.html',
      'src/pages/404.ts',
      'public/404.html',
    ];
    // shortcut: a Starlight site counts as having its own 404 page before a build; the build's dist/404.html settles it.
    const starlight = scan.kind === 'read' && /\bstarlight\s*\(/u.test(read(deps, scan.config.path) ?? '');
    const hasPage = built
      ? deps.exists(join(projectDir, 'dist', '404.html'))
      : starlight || sources.some((page) => deps.exists(join(projectDir, page)));
    if (!hasPage) {
      misses.problems.push({
        check: 'CC20',
        level: 'warn',
        message:
          'no 404 page: with not_found_handling "404-page" Cloudflare answers a miss with an empty 404 and never starts the dispatcher — add src/pages/404.astro',
      });
    }
    if (negotiates) {
      misses.problems.push({
        check: 'CC20',
        level: 'warn',
        // A heuristic, so only a warning naming the flag: connect never switches "none" on its own.
        message:
          'the middleware negotiates responses: either (a) run `conloca connect --update --yes --negotiate-404` (not_found_handling "none") and list the negotiated paths in run_worker_first, or (b) keep "404-page" and accept static responses',
      });
    }
  }

  // CC21
  let tags: CheckOutcome;
  if (mode === 'd4') tags = skipped('CC21', 'a separate preview deploy (D4) serves no visitors');
  else {
    tags = outcomeOf('CC21');
    const files = (deps.git(['ls-files', '--', 'src', 'public'], projectDir) ?? '')
      .split('\n')
      .filter((file) => SOURCE.test(file));
    for (const file of files) {
      const match = TAG_MANAGERS.exec(read(deps, join(projectDir, file)) ?? '');
      if (match === null) continue;
      tags.problems.push({
        check: 'CC21',
        level: 'warn',
        message: `${file} loads a tag manager (${match[0]}): it runs on draft pages and can read them — previewBuild: { separate: true } keeps drafts on a deploy no tag reads`,
        path: join(projectDir, file),
      });
      break;
    }
  }

  return [deployTarget, version, dispatcher, routes, ships, misses, tags];
}
