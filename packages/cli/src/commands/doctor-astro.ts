import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isRecord } from '../lib/is-record.js';
import { type ProjectPackage, readProjectDependencies } from '../lib/project-dependencies.js';
import type { CheckOutcome, DoctorProblem } from './doctor.js';

const ASTRO_CONFIG_NAMES = ['astro.config.mjs', 'astro.config.ts', 'astro.config.js'];

/** Peers @conloca/astro-cms declares that projects forget most often. */
const CMS_PEERS = ['zod', '@vitejs/plugin-react'];

const PAGE_FILE_RE = /\.(?:astro|ts|md|mdx)$/;

const OPENERS: Record<string, string> = { '(': ')', '{': '}', '[': ']' };
const CLOSERS = new Set([')', '}', ']']);
const QUOTES = new Set(["'", '"', '`']);

// The astro config is scanned as TEXT, never imported: user configs may import
// anything and run side effects. Every scanner below has three outcomes —
// pass, fail, or a could-not-determine warning — so unparseable input is never
// a silent pass.

/** Index just past the string literal whose opening quote sits at `index`. */
function skipString(text: string, index: number): number {
  const quote = text[index];
  let i = index + 1;
  while (i < text.length) {
    if (text[i] === '\\') i += 2;
    else if (text[i] === quote) return i + 1;
    else i += 1;
  }
  return i;
}

/**
 * Blank out comments while leaving strings and character offsets intact, so
 * scans neither match commented-out config nor mistake the `//` inside a URL
 * string for a comment. Also good enough to turn JSONC into parseable JSON.
 */
function stripComments(source: string): string {
  const chars = source.split('');
  let i = 0;
  while (i < chars.length) {
    if (QUOTES.has(chars[i])) {
      i = skipString(source, i);
    } else if (chars[i] === '/' && chars[i + 1] === '/') {
      while (i < chars.length && chars[i] !== '\n') chars[i++] = ' ';
    } else if (chars[i] === '/' && chars[i + 1] === '*') {
      while (i < chars.length && !(chars[i] === '*' && chars[i + 1] === '/')) {
        if (chars[i] !== '\n') chars[i] = ' ';
        i += 1;
      }
      if (i < chars.length) {
        chars[i] = ' ';
        chars[i + 1] = ' ';
        i += 2;
      }
    } else {
      i += 1;
    }
  }
  return chars.join('');
}

/** The balanced bracket slice starting at openIndex, or null when it never closes. */
function balancedSlice(text: string, openIndex: number): string | null {
  const closer = OPENERS[text[openIndex]];
  let depth = 0;
  let i = openIndex;
  while (i < text.length) {
    const ch = text[i];
    if (QUOTES.has(ch)) {
      i = skipString(text, i);
      continue;
    }
    if (OPENERS[ch]) {
      depth += 1;
    } else if (CLOSERS.has(ch)) {
      depth -= 1;
      if (depth === 0) return ch === closer ? text.slice(openIndex, i + 1) : null;
    }
    i += 1;
  }
  return null;
}

/** Index just past a value: everything up to the next comma at this nesting depth. */
function skipValue(text: string, start: number): number {
  let depth = 0;
  let i = start;
  while (i < text.length) {
    const ch = text[i];
    if (QUOTES.has(ch)) {
      i = skipString(text, i);
      continue;
    }
    if (OPENERS[ch]) depth += 1;
    else if (CLOSERS.has(ch)) depth -= 1;
    else if (ch === ',' && depth === 0) return i;
    i += 1;
  }
  return i;
}

/** True when `needle` appears in the text outside string literals. */
function containsOutsideStrings(text: string, needle: string): boolean {
  let i = 0;
  while (i < text.length) {
    if (QUOTES.has(text[i])) {
      i = skipString(text, i);
      continue;
    }
    if (text.startsWith(needle, i)) return true;
    i += 1;
  }
  return false;
}

interface ObjectEntries {
  entries: Map<string, string>;
  hasSpread: boolean;
}

/**
 * The top-level key/value pairs of an object literal, values as raw text.
 * Depth-1 only — nested objects stay inside their value text. Methods,
 * computed keys and shorthands are skipped; spreads are flagged because they
 * can carry any key, which downgrades "missing" findings to warnings.
 */
function parseObjectEntries(objectText: string): ObjectEntries | null {
  if (!objectText.startsWith('{') || !objectText.endsWith('}')) return null;
  const body = objectText.slice(1, -1);
  const entries = new Map<string, string>();
  let hasSpread = false;
  let i = 0;
  while (i < body.length) {
    if (/[\s,]/.test(body[i])) {
      i += 1;
      continue;
    }
    if (body.startsWith('...', i)) {
      hasSpread = true;
      i = skipValue(body, i + 3);
      continue;
    }
    const keyMatch = /^(?:([$A-Za-z_][$\w]*)|'([^']*)'|"([^"]*)")\s*:/.exec(body.slice(i));
    if (!keyMatch) {
      i = skipValue(body, i);
      continue;
    }
    const valueStart = i + keyMatch[0].length;
    const valueEnd = skipValue(body, valueStart);
    entries.set(keyMatch[1] ?? keyMatch[2] ?? keyMatch[3] ?? '', body.slice(valueStart, valueEnd).trim());
    i = valueEnd;
  }
  return { entries, hasSpread };
}

/** The contents of a plain single- or double-quoted string literal, else null. */
function stringLiteral(raw: string): string | null {
  const match = /^(?:'([^'\\]*)'|"([^"\\]*)")$/.exec(raw.trim());
  return match === null ? null : (match[1] ?? match[2] ?? '');
}

type CmsOptions =
  | { state: 'no-call' }
  | { state: 'dynamic' }
  | { state: 'literal'; entries: Map<string, string>; hasSpread: boolean };

/** The conlocaCMS(...) argument, parsed when it is a plain object literal. */
function extractCmsOptions(configText: string): CmsOptions {
  const call = /\bconlocaCMS\s*\(/.exec(configText);
  if (!call) return { state: 'no-call' };
  const args = balancedSlice(configText, call.index + call[0].length - 1);
  if (args === null) return { state: 'dynamic' };
  const inner = args.slice(1, -1).trim();
  if (inner === '') return { state: 'literal', entries: new Map(), hasSpread: false };
  if (!inner.startsWith('{')) return { state: 'dynamic' };
  const objectText = balancedSlice(inner, 0);
  const parsed = objectText === null ? null : parseObjectEntries(objectText);
  return parsed === null ? { state: 'dynamic' } : { state: 'literal', ...parsed };
}

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
const ASTRO_CHECK_LABELS: Record<string, string> = {
  C1: 'content config registers Conloca collections',
  C2: 'siteName matches a sites.json entry',
  C5: 'conlocaCMS is imported from @conloca/astro-cms/node',
  C6: 'conlocaCMS options are complete',
  C7: 'react() is wired before conlocaCMS()',
  C8: 'CMS peer dependencies are declared',
  C9: 'tsconfig compilerOptions.jsx suits Puck components',
  C10: 'server-output pages declare prerender',
  C11: 'no static page shadows the CMS home',
};

function outcomeOf(id: string): CheckOutcome {
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
function checkSiteName(options: CmsOptions, siteNames: string[] | null): CheckOutcome {
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
function checkCmsOptions(options: CmsOptions): CheckOutcome {
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
  const keyMatch = /\boutput\s*:/.exec(configText);
  if (!keyMatch) {
    outcome.skipped = "output is not 'server'";
    return outcome;
  }
  const valueText = configText.slice(keyMatch.index + keyMatch[0].length).trimStart();
  const literal = /^(['"])([^'"]*)\1/.exec(valueText);
  if (!literal) {
    outcome.problems.push({
      check: 'C10',
      level: 'warn',
      message:
        "the astro config sets output but doctor could not read its value — if it is 'server', every file under src/pages must set prerender",
    });
    return outcome;
  }
  if (literal[2] !== 'server') {
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

type HomeRouteVerdict = { kind: 'catch-all'; pattern: string } | { kind: 'clear' } | { kind: 'undeterminable' };

/** Whether the configured CMS routing serves '/', mirroring the plugin's routing defaults. */
function homeRouteVerdict(options: CmsOptions): HomeRouteVerdict {
  if (options.state !== 'literal') return { kind: 'undeterminable' };
  const routingRaw = options.entries.get('routing');
  if (routingRaw === undefined) {
    // A top-level layout alone enables routing with the default catch-all.
    if (options.entries.has('layout')) return { kind: 'catch-all', pattern: '/[...slug]' };
    return options.hasSpread ? { kind: 'undeterminable' } : { kind: 'clear' };
  }
  if (routingRaw === 'false') return { kind: 'clear' };
  if (routingRaw === 'true') return { kind: 'catch-all', pattern: '/[...slug]' };
  if (!routingRaw.startsWith('{')) return { kind: 'undeterminable' };
  const patternValues = [...routingRaw.matchAll(/\bpattern\s*:\s*(['"])([^'"]*)\1/g)].map((match) => match[2]);
  const catchAll = patternValues.find((pattern) => pattern === '/' || pattern.startsWith('/[...'));
  if (catchAll !== undefined) return { kind: 'catch-all', pattern: catchAll };
  const patternKeyCount = (routingRaw.match(/\bpattern\s*:/g) ?? []).length;
  if (patternKeyCount > patternValues.length || containsOutsideStrings(routingRaw, '...')) {
    return { kind: 'undeterminable' };
  }
  return { kind: 'clear' };
}

/** C11 — a static src/pages/index.astro must not shadow the CMS home page. */
function checkHomeShadow(projectDir: string, options: CmsOptions): CheckOutcome {
  const outcome = outcomeOf('C11');
  const indexPath = join(projectDir, 'src', 'pages', 'index.astro');
  if (!existsSync(indexPath)) return outcome;
  if (options.state === 'no-call') {
    outcome.skipped = 'conlocaCMS is not called in the astro config';
    return outcome;
  }
  const verdict = homeRouteVerdict(options);
  if (verdict.kind === 'catch-all') {
    outcome.problems.push({
      check: 'C11',
      level: 'warn',
      message: `src/pages/index.astro shadows the CMS home page — the conlocaCMS pattern '${verdict.pattern}' also serves '/' and the static file wins; delete src/pages/index.astro or manage the home page in the CMS`,
      path: indexPath,
    });
  } else if (verdict.kind === 'undeterminable') {
    outcome.problems.push({
      check: 'C11',
      level: 'warn',
      message:
        "src/pages/index.astro exists but doctor could not determine the conlocaCMS routing pattern — if it is a catch-all like '/[...slug]', the static file shadows the CMS home page",
      path: indexPath,
    });
  }
  return outcome;
}

/**
 * The astro-side doctor checks. All of them skip when the project has no
 * astro config, so doctor stays useful on content-only directories.
 * `siteNames` is null when sites.json was unusable.
 */
export async function runAstroChecks(projectDir: string, siteNames: string[] | null): Promise<CheckOutcome[]> {
  const configPath = ASTRO_CONFIG_NAMES.map((name) => join(projectDir, name)).find((path) => existsSync(path));
  if (configPath === undefined) {
    return Object.keys(ASTRO_CHECK_LABELS).map((id) => ({ ...outcomeOf(id), skipped: 'no astro.config found' }));
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
    return Object.keys(ASTRO_CHECK_LABELS).map((id) =>
      id === 'C5'
        ? { ...outcomeOf(id), problems: [problem] }
        : { ...outcomeOf(id), skipped: 'astro config could not be read' },
    );
  }

  const configText = stripComments(source);
  const options = extractCmsOptions(configText);
  const pkg = await readProjectDependencies(projectDir);

  return [
    await checkContentConfig(projectDir),
    checkSiteName(options, siteNames),
    checkImportSource(configText),
    checkCmsOptions(options),
    checkReactIntegration(projectDir, configText, pkg),
    checkPeers(pkg),
    await checkTsconfigJsx(projectDir),
    await checkPrerender(projectDir, configText),
    checkHomeShadow(projectDir, options),
  ];
}
