import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import type { AstroI18nLocales, StaticPageRoute } from '@conloca/astro-cms/checks';
import type { JsonValue, SitesConfig } from '@conloca/content-api/node';
import {
  balancedSlice,
  type CallOptions,
  callOptions,
  containsOutsideStrings,
  parseObjectEntries,
  skipValue,
  stringLiteral,
  stripComments,
} from '../lib/config-text.js';
import { ASTRO_CONFIG_FILES } from '../lib/connect/astro-config.js';
import { contentRootOf } from '../lib/content-root.js';
import { isRecord } from '../lib/is-record.js';
import { componentFindings, hasPuckItems, readSiteComponents } from '../lib/page-components.js';
import { type ProjectPackage, readProjectDependencies } from '../lib/project-dependencies.js';
import { type ConlocaPageRef, readFileRoutes, siteRoutes } from '../lib/site-routes.js';
import type { CheckOutcome, DoctorProblem } from './doctor.js';

/** The project's astro config path, in the order Astro and connect pick one; undefined when there is none. */
export function findAstroConfig(projectDir: string): string | undefined {
  return ASTRO_CONFIG_FILES.map((name) => join(projectDir, name)).find((path) => existsSync(path));
}

/** Astro's `output` from the config text: 'unknown' when it is set but not a plain string literal. */
export function astroOutputOf(configText: string): 'server' | 'other' | 'unknown' {
  const keyMatch = /\boutput\s*:/.exec(configText);
  if (!keyMatch) return 'other';
  const literal = /^(['"])([^'"]*)\1/.exec(configText.slice(keyMatch.index + keyMatch[0].length).trimStart());
  if (!literal) return 'unknown';
  return literal[2] === 'server' ? 'server' : 'other';
}

/** The literal `i18n: { locales: [...], defaultLocale: '...' }` of defineConfig; undefined when absent or not plain literals. */
export function astroI18nOf(configText: string): AstroI18nLocales | undefined {
  const config = callOptions(configText, 'defineConfig');
  if (config.state !== 'literal') return undefined;
  const i18n = parseObjectEntries(config.entries.get('i18n') ?? '');
  const defaultLocale = stringLiteral(i18n?.entries.get('defaultLocale') ?? '');
  const list = i18n?.entries.get('locales') ?? '';
  if (defaultLocale === null || !list.startsWith('[') || balancedSlice(list, 0) !== list) return undefined;

  const body = list.slice(1, -1);
  const locales: (string | { path: string })[] = [];
  for (let i = 0; i < body.length; ) {
    if (/[\s,]/.test(body[i])) {
      i += 1;
      continue;
    }
    const end = skipValue(body, i);
    const raw = body.slice(i, end).trim();
    i = end;
    const path = raw.startsWith('{') ? stringLiteral(parseObjectEntries(raw)?.entries.get('path') ?? '') : null;
    const locale = path === null ? stringLiteral(raw) : { path };
    if (locale === null) return undefined;
    locales.push(locale);
  }
  return { locales, defaultLocale };
}

/** Peers @conloca/astro-cms declares that projects forget most often. */
const CMS_PEERS = ['@vitejs/plugin-react'];

const PAGE_FILE_RE = /\.(?:astro|ts|md|mdx)$/;

const STYLESHEET_RE = /\.(?:css|scss|sass|less|styl)$/;

const SRC_PAGES_UNREADABLE = 'src/pages could not be read';

/** The calls a `collections` member may be, for the config text to show every collection it makes. */
const IN_VIEW_COLLECTION_CALLS = new Set(['conlocaPages', 'conlocaData', 'conlocaFragments', 'defineCollection']);

/** True when `value` is exactly one call to a function in IN_VIEW_COLLECTION_CALLS. */
function isInViewCollectionCall(value: string): boolean {
  const call = /^([$A-Za-z_][$\w]*)\s*\(/.exec(value);
  if (call === null || !IN_VIEW_COLLECTION_CALLS.has(call[1])) return false;
  const argsStart = call[0].length - 1;
  return balancedSlice(value, argsStart) === value.slice(argsStart);
}

/**
 * True when the config's `collections` object literal has only keys and
 * spreads whose value is a call in IN_VIEW_COLLECTION_CALLS. Any other member
 * — `blog`, `blog: blogCollection`, `...extraCollections`, a helper's result —
 * may hold a collection made in another file, which the text cannot see.
 */
function collectionsAllInView(text: string): boolean {
  const declaration = /\b(?:const|let|var)\s+collections\s*=\s*/.exec(text);
  const start = declaration === null ? -1 : declaration.index + declaration[0].length;
  const objectText = text[start] === '{' ? balancedSlice(text, start) : null;
  if (objectText === null) return false;
  const body = objectText.slice(1, -1);
  for (let i = 0; i < body.length; ) {
    const end = skipValue(body, i);
    const member = body.slice(i, end).trim();
    i = end + 1;
    if (member === '') continue;
    const key = /^(?:\.\.\.|(?:[$A-Za-z_][$\w]*|'[^']*'|"[^"]*")\s*:)/.exec(member);
    if (key === null || !isInViewCollectionCall(member.slice(key[0].length).trim())) return false;
  }
  return true;
}

/**
 * The page collections a content config's `conlocaPages(...)` calls declare,
 * read as text, or null when the text cannot tell: no call at all, a call
 * whose collection is not a plain string, a `collections` object that may
 * hold collections made elsewhere (see collectionsAllInView), or a config
 * that also declares pages another way (discovery, a hand-wired loader, a
 * renamed import).
 */
export function declaredPageCollections(configText: string): Set<string> | null {
  const text = stripComments(configText);
  if (['createConlocaCollections', 'conlocaLoader'].some((marker) => containsOutsideStrings(text, marker))) {
    return null;
  }
  if (/\bconlocaPages\s+as\b/.test(text) || !collectionsAllInView(text)) return null;
  const declared = new Set<string>();
  for (const call of text.matchAll(/\bconlocaPages\s*\(/g)) {
    const args = balancedSlice(text, call.index + call[0].length - 1);
    if (args === null) return null;
    const inner = args.slice(1, -1).trim().replace(/,$/, '').trim();
    if (inner === '') {
      declared.add('pages');
      continue;
    }
    const objectText = inner.startsWith('{') ? balancedSlice(inner, 0) : null;
    const options = objectText === inner ? parseObjectEntries(objectText) : null;
    if (options === null || options.hasSpread) return null;
    const raw = options.entries.get('collection');
    // A shorthand `{ collection }` never reaches the entries.
    if (raw === undefined && /\bcollection\b/.test(inner)) return null;
    const name = raw === undefined ? 'pages' : stringLiteral(raw);
    if (name === null) return null;
    declared.add(name);
  }
  return declared.size > 0 ? declared : null;
}

/** Insertion order is the report order. */
const ASTRO_CHECK_LABELS = {
  C1: 'content config registers Conloca collections',
  C2: 'siteName matches a sites.json entry',
  C5: 'conlocaCMS is imported from @conloca/astro-cms/node',
  C6: 'conlocaCMS options are complete',
  C7: 'react() is wired before conlocaCMS()',
  C8: 'CMS peer dependencies are declared',
  C9: 'tsconfig compilerOptions.jsx suits Puck components',
  C10: 'server-output pages declare prerender',
  C11: 'no Conloca page is hidden behind a src/pages file',
  C13: 'the site has Conloca pages to edit',
  C14: 'pages use only components and fields the Puck config declares',
  C15: 'siteStyles styles Conloca pages in the editor',
} satisfies Record<string, string>;

function outcomeOf(id: keyof typeof ASTRO_CHECK_LABELS): CheckOutcome {
  return { id, label: ASTRO_CHECK_LABELS[id], problems: [] };
}

/** C1 — the content config exists and registers Conloca's collections. */
async function checkContentConfig(projectDir: string): Promise<CheckOutcome> {
  const outcome = outcomeOf('C1');
  // Lazy so `doctor` on a non-astro project never loads @conloca/astro-cms.
  const { CONTENT_CONFIG_SNIPPET, findContentConfigProblem } = await import('@conloca/astro-cms/checks');
  const problem = findContentConfigProblem(projectDir);
  if (problem === 'missing') {
    outcome.problems.push({
      check: 'C1',
      level: 'error',
      message: `no content config found — without it every CMS page 404s; create src/content.config.ts:\n${CONTENT_CONFIG_SNIPPET}`,
      path: join(projectDir, 'src', 'content.config.ts'),
    });
  } else if (problem === 'not-wired') {
    outcome.problems.push({
      check: 'C1',
      level: 'error',
      message: `the content config never registers Conloca's collections, so every CMS page 404s — wire it like:\n${CONTENT_CONFIG_SNIPPET}`,
    });
  }
  return outcome;
}

type SiteNameResolution = { kind: 'literal'; name: string } | { kind: 'absent' } | { kind: 'undeterminable' };

/** siteName from the options text: routing.siteName first, then top level, like the plugin. */
function resolveSiteNameText(options: { entries: Map<string, string>; hasSpread: boolean }): SiteNameResolution {
  const candidates: string[] = [];
  let undeterminable = options.hasSpread;
  const routingRaw = options.entries.get('routing');
  if (routingRaw !== undefined && routingRaw !== 'true' && routingRaw !== 'false') {
    const routing = routingRaw.startsWith('{') ? parseObjectEntries(balancedSlice(routingRaw, 0) ?? '') : null;
    if (routing === null) {
      undeterminable = true;
    } else {
      if (routing.hasSpread) undeterminable = true;
      const nested = routing.entries.get('siteName');
      if (nested !== undefined) candidates.push(nested);
    }
  }
  const topLevel = options.entries.get('siteName');
  if (topLevel !== undefined) candidates.push(topLevel);
  if (candidates.length === 0) return undeterminable ? { kind: 'undeterminable' } : { kind: 'absent' };
  const name = stringLiteral(candidates[0]);
  return name === null ? { kind: 'undeterminable' } : { kind: 'literal', name };
}

/** C2 (astro half) — the siteName the config implies exists in sites.json. */
function checkSiteName(options: CallOptions, siteNames: string[] | null): CheckOutcome {
  const outcome = outcomeOf('C2');
  if (siteNames === null) {
    outcome.skipped = 'sites.json is unusable';
    return outcome;
  }
  if (options.state === 'no-call') {
    outcome.skipped = 'conlocaCMS is not called in the astro config';
    return outcome;
  }
  if (options.state === 'dynamic') {
    outcome.problems.push({
      check: 'C2',
      level: 'warn',
      message:
        'doctor could not determine siteName — the conlocaCMS options are not a plain object literal; check manually that siteName matches a sites.json entry',
    });
    return outcome;
  }
  const resolution = resolveSiteNameText(options);
  if (resolution.kind === 'undeterminable') {
    outcome.problems.push({
      check: 'C2',
      level: 'warn',
      message:
        'doctor could not determine siteName (not a plain string literal) — check manually that it matches a sites.json entry',
    });
  } else if (resolution.kind === 'absent') {
    if (siteNames.length === 0) {
      outcome.problems.push({
        check: 'C2',
        level: 'error',
        message: 'sites.json declares no sites — add a site entry so the CMS has a site to serve',
      });
    } else {
      outcome.detail = `defaults to first site "${siteNames[0]}"`;
    }
  } else if (siteNames.includes(resolution.name)) {
    outcome.detail = `siteName "${resolution.name}"`;
  } else {
    outcome.problems.push({
      check: 'C2',
      level: 'error',
      message: `siteName "${resolution.name}" has no sites.json entry — add it to sites.json or set siteName to one of: ${siteNames.join(', ')}`,
    });
  }
  return outcome;
}

/** C5 — conlocaCMS comes from '@conloca/astro-cms/node', not the package root. */
function checkImportSource(configText: string): CheckOutcome {
  const outcome = outcomeOf('C5');
  const importRe = /import\s+([^;]*?)\s+from\s*(['"])([^'"]+)\2/g;
  for (const match of configText.matchAll(importRe)) {
    if (!/\bconlocaCMS\b/.test(match[1])) continue;
    const specifier = match[3];
    if (specifier === '@conloca/astro-cms/node') return outcome;
    if (specifier === '@conloca/astro-cms') {
      outcome.problems.push({
        check: 'C5',
        level: 'error',
        message:
          "conlocaCMS is imported from '@conloca/astro-cms' (the package root, which throws at runtime) — import it from '@conloca/astro-cms/node' instead",
      });
    } else {
      outcome.problems.push({
        check: 'C5',
        level: 'warn',
        message: `conlocaCMS is imported from '${specifier}' — doctor expects '@conloca/astro-cms/node' and cannot verify indirect imports`,
      });
    }
    return outcome;
  }
  if (/\bconlocaCMS\b/.test(configText)) {
    outcome.problems.push({
      check: 'C5',
      level: 'warn',
      message:
        "conlocaCMS is referenced but doctor could not find its import — make sure it comes from '@conloca/astro-cms/node'",
    });
  } else {
    outcome.problems.push({
      check: 'C5',
      level: 'error',
      message:
        'conlocaCMS is not imported in the astro config — add "import { conlocaCMS } from \'@conloca/astro-cms/node\'" and call it in integrations',
    });
  }
  return outcome;
}

/** C6 — the conlocaCMS options carry contentRoot, puckConfigPath, and routing or layout. */
function checkCmsOptions(options: CallOptions): CheckOutcome {
  const outcome = outcomeOf('C6');
  if (options.state === 'no-call') {
    outcome.problems.push({
      check: 'C6',
      level: 'error',
      message:
        'conlocaCMS(...) is never called in the astro config — add it to the integrations array with contentRoot and puckConfigPath',
    });
    return outcome;
  }
  if (options.state === 'dynamic') {
    outcome.problems.push({
      check: 'C6',
      level: 'warn',
      message:
        'doctor could not determine the conlocaCMS options (not a plain object literal) — check manually that contentRoot and puckConfigPath are set and a routing block or layout is present',
    });
    return outcome;
  }
  const hints: Record<string, string> = {
    contentRoot: "add contentRoot: './content' so the CMS knows where the content lives",
    puckConfigPath: "add puckConfigPath: './src/puck.config.tsx' so the editor knows the component config",
  };
  for (const [key, hint] of Object.entries(hints)) {
    if (options.entries.has(key)) continue;
    outcome.problems.push({
      check: 'C6',
      level: options.hasSpread ? 'warn' : 'error',
      message: options.hasSpread
        ? `doctor could not confirm the ${key} option (the options object uses a spread) — check that it is set`
        : `the conlocaCMS options are missing ${key} — ${hint}`,
    });
  }
  if (!options.entries.has('routing') && !options.entries.has('layout')) {
    outcome.problems.push({
      check: 'C6',
      level: options.hasSpread ? 'warn' : 'error',
      message: options.hasSpread
        ? 'doctor could not confirm a routing block or layout option (the options object uses a spread) — check that one is set'
        : 'the conlocaCMS options set neither routing nor layout — add a routing block (or a top-level layout) so CMS pages get rendered routes',
    });
  }
  return outcome;
}

/** C7 — @astrojs/react is declared and react() runs before conlocaCMS(). */
function checkReactIntegration(projectDir: string, configText: string, pkg: ProjectPackage): CheckOutcome {
  const outcome = outcomeOf('C7');
  if (pkg === 'missing') {
    outcome.problems.push({
      check: 'C7',
      level: 'error',
      message: `@astrojs/react is not declared — no package.json found at ${join(projectDir, 'package.json')}; add @astrojs/react to the project's dependencies`,
    });
  } else if (pkg === 'unreadable') {
    outcome.problems.push({
      check: 'C7',
      level: 'warn',
      message: 'doctor could not parse package.json — check manually that @astrojs/react is a dependency',
    });
  } else if (!pkg.deps.has('@astrojs/react')) {
    outcome.problems.push({
      check: 'C7',
      level: 'error',
      message:
        '@astrojs/react is missing from package.json — add it to dependencies; conlocaCMS renders components through the react integration',
    });
  }

  const integrationsKey = /\bintegrations\s*:/.exec(configText);
  if (!integrationsKey) {
    outcome.problems.push({
      check: 'C7',
      level: 'error',
      message:
        'react() is missing — the astro config has no integrations array; add integrations: [react(), conlocaCMS({...})]',
    });
    return outcome;
  }
  const valueText = configText.slice(integrationsKey.index + integrationsKey[0].length).trimStart();
  const arrayText = valueText.startsWith('[') ? balancedSlice(valueText, 0) : null;
  if (arrayText === null) {
    outcome.problems.push({
      check: 'C7',
      level: 'warn',
      message:
        'doctor could not read the integrations array (not a plain array literal) — check manually that react() comes before conlocaCMS()',
    });
    return outcome;
  }
  const reactIndex = arrayText.search(/\breact\s*\(/);
  const cmsIndex = arrayText.search(/\bconlocaCMS\s*\(/);
  if (reactIndex === -1) {
    if (containsOutsideStrings(arrayText, '...')) {
      outcome.problems.push({
        check: 'C7',
        level: 'warn',
        message:
          'doctor could not confirm react() in the integrations array (it uses a spread) — check that react() comes before conlocaCMS()',
      });
    } else {
      outcome.problems.push({
        check: 'C7',
        level: 'error',
        message:
          'react() is missing from the integrations array — add react() (from @astrojs/react) before conlocaCMS(); the CMS needs it to render React components',
      });
    }
  } else if (cmsIndex !== -1 && reactIndex > cmsIndex) {
    outcome.problems.push({
      check: 'C7',
      level: 'error',
      message:
        'react() comes after conlocaCMS() in the integrations array — move react() before conlocaCMS() so the react integration registers first',
    });
  }
  return outcome;
}

/** C8 — the peers @conloca/astro-cms needs are declared in the project. */
function checkPeers(pkg: ProjectPackage): CheckOutcome {
  const outcome = outcomeOf('C8');
  if (pkg === 'unreadable') {
    outcome.problems.push({
      check: 'C8',
      level: 'warn',
      message: `doctor could not parse package.json — check manually that ${CMS_PEERS.join(' and ')} are installed`,
    });
    return outcome;
  }
  const deps = pkg === 'missing' ? new Set<string>() : pkg.deps;
  for (const peer of CMS_PEERS) {
    if (!deps.has(peer)) {
      outcome.problems.push({
        check: 'C8',
        level: 'error',
        message: `${peer} is missing from package.json — add it to dependencies or devDependencies; @conloca/astro-cms requires it as a peer`,
      });
    }
  }
  return outcome;
}

/**
 * C9 — advisory only. Puck components have been reported to fail under
 * Astro's default `jsx: "preserve"`, but sites that keep that preset untouched
 * work, so a hard error here would fail working projects. Until that failure
 * is reproduced, anything other than an explicit react-jsx is a warning, never
 * an error.
 */
async function checkTsconfigJsx(projectDir: string): Promise<CheckOutcome> {
  const outcome = outcomeOf('C9');
  const path = join(projectDir, 'tsconfig.json');
  let raw: string;
  try {
    raw = await readFile(path, 'utf-8');
  } catch {
    outcome.problems.push({
      check: 'C9',
      level: 'warn',
      message:
        'tsconfig.json not found — if Puck .tsx components misrender or fail typecheck, create it with compilerOptions.jsx set to react-jsx',
      path,
    });
    return outcome;
  }
  let parsed: unknown;
  try {
    // tsconfig.json is JSONC: tolerate comments and trailing commas.
    parsed = JSON.parse(stripComments(raw).replace(/,(\s*[}\]])/g, '$1'));
  } catch {
    outcome.problems.push({
      check: 'C9',
      level: 'warn',
      message: 'doctor could not parse tsconfig.json — check manually that compilerOptions.jsx is react-jsx',
      path,
    });
    return outcome;
  }
  const compilerOptions = isRecord(parsed) && isRecord(parsed.compilerOptions) ? parsed.compilerOptions : undefined;
  const jsx = compilerOptions?.jsx;
  if (jsx === 'react-jsx') return outcome;
  outcome.problems.push({
    check: 'C9',
    level: 'warn',
    message:
      jsx === undefined
        ? 'compilerOptions.jsx is not set (Astro presets use preserve) — if Puck .tsx components misrender or fail typecheck, set it to react-jsx'
        : `compilerOptions.jsx is ${JSON.stringify(jsx)} — if Puck .tsx components misrender or fail typecheck, set it to react-jsx`,
    path,
  });
  return outcome;
}

/** C10 — with output: 'server', every file under src/pages declares prerender. */
async function checkPrerender(projectDir: string, configText: string): Promise<CheckOutcome> {
  const outcome = outcomeOf('C10');
  const output = astroOutputOf(configText);
  if (output === 'unknown') {
    outcome.problems.push({
      check: 'C10',
      level: 'warn',
      message:
        "the astro config sets output but doctor could not read its value — if it is 'server', every file under src/pages must set prerender",
    });
    return outcome;
  }
  if (output === 'other') {
    outcome.skipped = "output is not 'server'";
    return outcome;
  }
  const pagesDir = join(projectDir, 'src', 'pages');
  const names = await readdir(pagesDir, { recursive: true }).catch(() => [] as string[]);
  for (const name of names.filter((entry) => PAGE_FILE_RE.test(entry)).sort()) {
    const filePath = join(pagesDir, name);
    const text = await readFile(filePath, 'utf-8').catch(() => null);
    if (text === null) {
      outcome.problems.push({
        check: 'C10',
        level: 'warn',
        message: `doctor could not read src/pages/${name} — check its prerender setting manually`,
        path: filePath,
      });
    } else if (!text.includes('prerender')) {
      outcome.problems.push({
        check: 'C10',
        level: 'error',
        message: `src/pages/${name} does not set prerender — with output: 'server' add "export const prerender = true" (or false on purpose) so its render mode is explicit`,
        path: filePath,
      });
    }
  }
  return outcome;
}

/** C11 — no default-locale Conloca page of the site shares its path with a src/pages file, which always wins. */
function checkHiddenPages(
  projectDir: string,
  options: CallOptions,
  fileRoutes: readonly StaticPageRoute[] | null,
  pages: readonly ConlocaPageRef[],
  site: string,
): CheckOutcome {
  const outcome = outcomeOf('C11');
  if (options.state === 'no-call') {
    outcome.skipped = 'conlocaCMS is not called in the astro config';
    return outcome;
  }
  if (fileRoutes === null) {
    outcome.skipped = SRC_PAGES_UNREADABLE;
    return outcome;
  }
  for (const { route, file, pageId, hidden } of siteRoutes(fileRoutes, pages, site)) {
    if (!hidden || file === undefined) continue;
    outcome.problems.push({
      check: 'C11',
      level: 'warn',
      message: `${file} hides the Conloca page ${route} (${pageId}) — a src/pages file always wins over a Conloca page at the same path; delete the file in the same change that makes the Conloca page live`,
      path: join(projectDir, file),
    });
  }
  return outcome;
}

/** C13 — a site with static src/pages routes has at least one Conloca page for the editor. */
function checkHasPages(fileRoutes: readonly StaticPageRoute[] | null, pages: readonly ConlocaPageRef[]): CheckOutcome {
  const outcome = outcomeOf('C13');
  if (fileRoutes === null) {
    outcome.skipped = SRC_PAGES_UNREADABLE;
    return outcome;
  }
  const routes = [...new Set(fileRoutes.map(({ route }) => route))];
  if (routes.length === 0 || pages.length > 0) return outcome;
  const listed = routes.length > 5 ? `${routes.slice(0, 5).join(', ')}, …` : routes.join(', ');
  outcome.problems.push({
    check: 'C13',
    level: 'warn',
    message: `src/pages has ${routes.length} static page${routes.length === 1 ? '' : 's'} (${listed}) and no Conloca pages yet, so the editor has none to show — to make one editable, follow "Converting an existing Astro page" in .claude/skills/conloca/SKILL.md`,
  });
  return outcome;
}

/** The stored `content.puckData` of a page file; undefined when it cannot be read or parsed. */
async function readPuckData(file: string): Promise<JsonValue | undefined> {
  const text = await readFile(file, 'utf-8').catch(() => null);
  if (text === null) return undefined;
  try {
    const page: JsonValue = JSON.parse(text);
    const content = isRecord(page) ? page.content : undefined;
    return isRecord(content) ? content.puckData : undefined;
  } catch {
    return undefined;
  }
}

/** C14 — the components and props Puck pages store are ones the Puck config declares. */
async function checkPageComponents(
  projectDir: string,
  options: CallOptions,
  pages: readonly ConlocaPageRef[],
): Promise<CheckOutcome> {
  const outcome = outcomeOf('C14');
  const stored = await Promise.all(
    pages
      .filter((page) => page.type === 'puck')
      .map(async (page) => ({ page, puckData: await readPuckData(page.file) })),
  );
  const filled = stored.filter(({ puckData }) => hasPuckItems(puckData));
  // Reading the config loads the TypeScript compiler, so pages without content never pay for it.
  if (filled.length === 0) return outcome;
  const site = await readSiteComponents(projectDir, options);
  if ('reason' in site) {
    outcome.skipped = site.reason;
    return outcome;
  }
  const { manifest } = site;
  // Warnings, never errors: stale props are common, and `conloca upgrade` rolls back on doctor errors.
  if (manifest.unreadable && Object.keys(manifest.components).length === 0) {
    outcome.problems.push({
      check: 'C14',
      level: 'warn',
      message: `could not read the Puck config (${manifest.unreadableReason}), so page components were not checked`,
    });
    return outcome;
  }
  const contentRoot = contentRootOf(projectDir);
  for (const { page, puckData } of filled) {
    const file = relative(contentRoot, page.file).split(sep).join('/');
    for (const { component, field } of componentFindings(puckData, manifest)) {
      const fields = Object.keys(manifest.components[component]?.fields ?? {}).join(', ') || 'none';
      outcome.problems.push({
        check: 'C14',
        level: 'warn',
        message:
          field === undefined
            ? `${file}: component "${component}" is not in the Puck config — it renders as nothing`
            : `${file}: ${component} has no field "${field}" (fields: ${fields}) — its value is never shown`,
        path: page.file,
      });
    }
  }
  return outcome;
}

/** C15 — when Conloca pages exist and the project has a stylesheet, siteStyles brings it into the editor. */
async function checkSiteStyles(
  projectDir: string,
  cms: CallOptions,
  conlocaCloud: CallOptions,
  pages: readonly ConlocaPageRef[],
): Promise<CheckOutcome> {
  const outcome = outcomeOf('C15');
  if (cms.state === 'no-call') {
    outcome.skipped = 'conlocaCMS is not called in the astro config';
    return outcome;
  }
  const both = [cms, conlocaCloud];
  if (both.some((call) => call.state === 'literal' && call.entries.has('siteStyles'))) return outcome;
  if (both.some((call) => call.state === 'dynamic' || (call.state === 'literal' && call.hasSpread))) {
    outcome.skipped = 'the conlocaCMS or conlocaCloud options are not a plain object literal';
    return outcome;
  }
  if (pages.length === 0) return outcome;
  // Only a missing src/ means no stylesheets; any other failure to list it must not pass silently.
  const names = await readdir(join(projectDir, 'src'), { recursive: true }).catch(
    (error: NodeJS.ErrnoException): string[] | string =>
      error.code === 'ENOENT' ? [] : `src/ could not be read (${error.code ?? error.message})`,
  );
  if (typeof names === 'string') {
    outcome.skipped = names;
    return outcome;
  }
  const stylesheets = names.filter((name) => STYLESHEET_RE.test(name));
  if (stylesheets.length === 0) return outcome;
  const first = stylesheets
    .reduce((a, b) => (b < a ? b : a))
    .split(sep)
    .join('/');
  outcome.problems.push({
    check: 'C15',
    level: 'warn',
    message: `Conloca pages exist but siteStyles is not set, so they look unstyled in the editor — add siteStyles: './src/${first}' to conlocaCMS(...)`,
  });
  return outcome;
}

/**
 * The astro-side doctor checks. All of them skip when the project has no
 * astro config, so doctor stays useful on content-only directories.
 * `sites` is null when sites.json was unusable.
 */
export async function runAstroChecks(
  projectDir: string,
  sites: SitesConfig | null,
  pages: readonly ConlocaPageRef[],
): Promise<CheckOutcome[]> {
  const configPath = findAstroConfig(projectDir);
  if (configPath === undefined) {
    return Object.entries(ASTRO_CHECK_LABELS).map(([id, label]) => ({
      id,
      label,
      problems: [],
      skipped: 'no astro.config found',
    }));
  }

  const source = await readFile(configPath, 'utf-8').catch(() => null);
  if (source === null) {
    // The config exists but is unreadable: never a silent pass.
    const problem: DoctorProblem = {
      check: 'C5',
      level: 'warn',
      message: `doctor could not read ${configPath} — check its file permissions`,
      path: configPath,
    };
    return Object.entries(ASTRO_CHECK_LABELS).map(([id, label]) =>
      id === 'C5'
        ? { id, label, problems: [problem] }
        : { id, label, problems: [], skipped: 'astro config could not be read' },
    );
  }

  const configText = stripComments(source);
  const options = callOptions(configText, 'conlocaCMS');
  const pkg = await readProjectDependencies(projectDir);
  const siteNames = sites ? Object.keys(sites.sites) : null;
  const siteName = options.state === 'literal' ? resolveSiteNameText(options) : undefined;
  const site = siteName?.kind === 'literal' ? siteName.name : (siteNames?.[0] ?? '');
  const fileRoutes = await readFileRoutes(
    projectDir,
    { serverOutput: astroOutputOf(configText) === 'server', i18n: astroI18nOf(configText) },
    sites ?? { sites: {}, globalLocales: ['en'] },
    site,
  ).catch(() => null);
  const sitePages = pages.filter((page) => page.site === site);

  return [
    await checkContentConfig(projectDir),
    checkSiteName(options, siteNames),
    checkImportSource(configText),
    checkCmsOptions(options),
    checkReactIntegration(projectDir, configText, pkg),
    checkPeers(pkg),
    await checkTsconfigJsx(projectDir),
    await checkPrerender(projectDir, configText),
    checkHiddenPages(projectDir, options, fileRoutes, sitePages, site),
    checkHasPages(fileRoutes, sitePages),
    await checkPageComponents(projectDir, options, sitePages),
    await checkSiteStyles(projectDir, options, callOptions(configText, 'conlocaCloud'), sitePages),
  ];
}
