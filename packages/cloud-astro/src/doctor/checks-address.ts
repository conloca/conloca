import { join, relative } from 'node:path';
import { addressSiteName, isValidSiteBase, type SitesConfig } from '@conloca/content-api';
import { isRecord } from '@conloca/content-api/component-vocabulary';
import { EDITOR_PAGE_PATH, editorUiOrigin, parentRoot } from '@conloca/content-api/editor-host';
import { findFramingBlockers, framingSnippets } from '../editor-page/framing.js';
import { baseMismatch } from '../editor-page/site-base.js';
import { INTEGRATION_NOT_CALLED } from './checks-offline.js';
import type { ConfigScan } from './config-scan.js';
import { type CheckOutcome, type DoctorDeps, outcomeOf, skipped } from './types.js';

/** The server's bare-host rule: lowercase dot-separated labels of letters, digits and inner hyphens; no scheme, port or path. */
const PLAIN_HOST = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/;

/**
 * Why the editor's address rule refuses a bare host, else undefined.
 * shortcut: the editor also refuses its own login host and private names; those surface only in the editor's setup
 * list, since doctor cannot tell them without the editor's settings.
 */
function refusedHost(host: string): string | undefined {
  // WHATWG rewrites IPv4 shorthands (`127.1`) and refuses a host ending in a number that is no IPv4.
  const parsed = URL.canParse(`https://${host}/`) ? new URL(`https://${host}/`).hostname : null;
  if (parsed !== host || /^\d+(\.\d+){3}$/.test(host)) return 'an IP address';
  if (host === 'localhost' || host.endsWith('.localhost')) return 'localhost';
  // Bare `conloca.com` is Conloca's own website, which the rule allows for that one repository.
  if (host.endsWith('.conloca.com')) return 'a conloca.com host';
  return undefined;
}

/** What the build key setup left behind: its environment variable and the options that went with it. */
const LEFTOVER_KEY_NAMES = [
  'CONLOCA_BUILD_TOKEN',
  'buildToken',
  'publicBaseUrl',
  'previewDomain',
  'requireRegistration',
] as const;
const LEFTOVER_RE = new RegExp(`\\b(?:${LEFTOVER_KEY_NAMES.join('|')})\\b`, 'g');

/** The fields of sites.json the address reads; the rest is the editor's business. */
function isSitesConfig(value: unknown): value is SitesConfig {
  return (
    isRecord(value) &&
    isRecord(value.sites) &&
    Object.values(value.sites).every(
      (site) =>
        isRecord(site) &&
        typeof site.defaultLocale === 'string' &&
        (site.domains === undefined || isRecord(site.domains)) &&
        (site.base === undefined || typeof site.base === 'string'),
    )
  );
}

/** CC9's outcome and, when it passed, the address the live checks contact. */
interface SiteAddressCheck {
  outcome: CheckOutcome;
  address?: string;
}

/**
 * CC9 — the address the editor frames, `https://<domains[defaultLocale]><base>` of the site `addressSiteName` picks,
 * by the same rule the server applies. Astro's own `site` and `base`, when the config text shows them, must agree.
 */
export function checkSiteAddress(
  scan: ConfigScan,
  contentRoot: string,
  deps: Pick<DoctorDeps, 'readFile'>,
): SiteAddressCheck {
  if (scan.kind === 'read' && scan.config.conlocaCloud === 'absent') {
    return { outcome: skipped('CC9', INTEGRATION_NOT_CALLED) };
  }
  const outcome = outcomeOf('CC9');
  const sitesPath = join(contentRoot, 'sites.json');
  const fail = (message: string) => {
    outcome.problems.push({ check: 'CC9', level: 'error', message, path: sitesPath });
    return { outcome };
  };
  let sites: unknown;
  try {
    sites = JSON.parse(deps.readFile(sitesPath));
  } catch {
    return fail(`${sitesPath} is missing or not JSON — run conloca connect`);
  }
  if (!isSitesConfig(sites)) return fail(`${sitesPath} has no readable sites map`);
  const name = addressSiteName(sites);
  const site = name === null ? undefined : sites.sites[name];
  if (name === null || site === undefined) {
    return fail(
      'sites.json lists several sites and none is named default, so the editor cannot tell which one gives the address',
    );
  }
  const locale = site.defaultLocale;
  const host = site.domains?.[locale];
  if (host === undefined) {
    return fail(
      `site "${name}" in sites.json has no domains.${locale} — run conloca connect, or add your site's host there`,
    );
  }
  if (typeof host !== 'string' || !PLAIN_HOST.test(host)) {
    return fail(`site "${name}" has domains.${locale} "${host}", which is not a bare host such as www.example.com`);
  }
  const refused = refusedHost(host);
  if (refused !== undefined) {
    return fail(
      `site "${name}" has domains.${locale} "${host}", which is ${refused}: the editor never frames a page there — use your site's public host`,
    );
  }
  const base = site.base ?? '/';
  if (!isValidSiteBase(base)) return fail(`site "${name}" has base "${base}", which is not a path such as /docs/`);
  const address = `https://${host}${base}`;
  outcome.detail = address;

  if (scan.kind === 'read') {
    const { url, base: astroBase } = scan.config.site;
    const warn = (message: string) =>
      outcome.problems.push({ check: 'CC9', level: 'warn', message, path: scan.config.path });
    const astroHost = typeof url === 'string' && URL.canParse(url) ? new URL(url).hostname : undefined;
    if (astroHost !== undefined && astroHost !== host) {
      warn(
        `Astro's site is ${url} but sites.json gives the site "${name}" the host ${host}: the workspace editor opens ${address}${EDITOR_PAGE_PATH.slice(1)}. Make them match.`,
      );
    }
    // An absent Astro base is `/`; a computed one is not judged.
    const mismatch = astroBase === null ? undefined : baseMismatch(sites, astroBase ?? '/');
    if (mismatch !== undefined) warn(mismatch);
  }
  return { outcome, address };
}

/** CC10 — a committed header rule that keeps the workspace editor from framing /_conloca/editor/, with the fix. */
export async function checkFramingHeaders(
  scan: ConfigScan,
  projectDir: string,
  endpoint: string | undefined,
  deps: Pick<DoctorDeps, 'exists'>,
): Promise<CheckOutcome> {
  if (scan.kind === 'read' && scan.config.conlocaCloud === 'absent') return skipped('CC10', INTEGRATION_NOT_CALLED);
  const origin = editorUiOrigin(endpoint);
  const editorRoot = origin === null ? null : parentRoot(origin);
  if (editorRoot === null) return skipped('CC10', 'no editor UI origin');
  const outcome = outcomeOf('CC10');
  const snippets = framingSnippets(editorRoot);
  // Netlify reads public/_headers too, but has no syntax for removing a header.
  const headersRule = deps.exists(join(projectDir, 'netlify.toml'))
    ? snippets.netlifyHeaders
    : snippets.cloudflareHeaders;
  for (const { file, header } of await findFramingBlockers(projectDir)) {
    const snippet = file === 'vercel.json' ? JSON.stringify(snippets.vercelHeaders, null, 2) : headersRule;
    // A second header cannot loosen a site-wide frame-ancestors, so connect never writes around that one.
    const fix =
      header === 'frame-ancestors' ? 'exclude /_conloca/editor/ from it, then add' : 'run conloca connect, or add';
    outcome.problems.push({
      check: 'CC10',
      level: 'error',
      message: `${file} sets ${header} for the whole site, so the workspace editor cannot frame /_conloca/editor/ — ${fix}:\n${snippet}`,
      path: join(projectDir, file),
    });
  }
  return outcome;
}

/** CC14 — each line of a tracked workflow or the astro config that still names the build key or one of its options. */
export function checkKeyLeftovers(scan: ConfigScan, projectDir: string, deps: DoctorDeps): CheckOutcome {
  const outcome = outcomeOf('CC14');
  // `:(top)` finds the repository's workflows from a project in a subfolder; git answers paths relative to projectDir.
  const tracked = deps.git(['ls-files', '--', ':(top).github/workflows'], projectDir)?.split('\n') ?? [];
  const paths = [
    ...tracked.filter((path) => /\.ya?ml$/.test(path)).map((path) => join(projectDir, path)),
    ...(scan.kind === 'read' ? [scan.config.path] : []),
  ];
  for (const path of paths) {
    let text: string;
    try {
      text = deps.readFile(path);
    } catch {
      continue;
    }
    for (const [index, line] of text.split('\n').entries()) {
      const names = [...new Set(line.match(LEFTOVER_RE))];
      if (names.length === 0) continue;
      outcome.problems.push({
        check: 'CC14',
        level: 'warn',
        message: `${relative(projectDir, path)}:${index + 1} still names ${names.join(', ')}, left from the build key the editor page no longer needs — remove it`,
        path,
      });
    }
  }
  return outcome;
}
