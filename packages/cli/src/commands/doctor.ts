import { readdir, readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { ContentIndex, FileSystemReaderBackend, type SitesConfig } from '@conloca/content-api/node';
import { contentRootOf } from '../lib/content-root.js';
import { isRecord } from '../lib/is-record.js';
import { messageOf } from '../lib/message-of.js';
import { runAstroChecks } from './doctor-astro.js';
import { runExtensionChecks } from './doctor-extensions.js';

export interface DoctorProblem {
  check: string;
  level: 'error' | 'warn';
  message: string;
  path?: string;
}

export interface CheckOutcome {
  id: string;
  label: string;
  problems: DoctorProblem[];
  /** Extra context for the human pass/fail line, e.g. an indexed-file count. */
  detail?: string;
  /** Why a prerequisite (unusable sites.json, no astro config) kept the check from running. */
  skipped?: string;
}

export interface DoctorReport {
  ok: boolean;
  checks: CheckOutcome[];
  problems: DoctorProblem[];
}

/** Top-level content directories that are not sites. */
export const RESERVED_CONTENT_DIRS = new Set(['fragments', 'data']);

// What the CMS actually indexes: .vxjson/.mdx anywhere, .json only under
// data/. The reader backend's default glob matches every .json, which would
// report sites.json itself as broken content.
const CONTENT_GLOB = '{**/*.{vxjson,mdx},data/**/*.json}';

function isLocaleList(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((locale) => typeof locale === 'string' && locale.trim() !== '')
  );
}

function counted(count: number, noun: string): string {
  return count === 1 ? `1 ${noun}` : `${count} ${noun}s`;
}

/**
 * C3 — sites.json exists, parses, and declares defaultLocale plus a non-empty
 * locales list for every site. Returns the parsed config for the later checks,
 * or null when the file is unusable.
 */
async function checkSitesFile(contentRoot: string): Promise<{ outcome: CheckOutcome; config: SitesConfig | null }> {
  const path = join(contentRoot, 'sites.json');
  const problems: DoctorProblem[] = [];
  const outcome: CheckOutcome = { id: 'C3', label: 'sites.json is present and complete', problems };

  let raw: string;
  try {
    raw = await readFile(path, 'utf-8');
  } catch {
    problems.push({
      check: 'C3',
      level: 'error',
      message: `sites.json not found — expected it at ${path} (conloca init creates it)`,
      path,
    });
    return { outcome, config: null };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    problems.push({ check: 'C3', level: 'error', message: `sites.json is not valid JSON: ${messageOf(error)}`, path });
    return { outcome, config: null };
  }

  if (!isRecord(parsed) || !isRecord(parsed.sites)) {
    problems.push({ check: 'C3', level: 'error', message: 'sites.json has no "sites" object', path });
    return { outcome, config: null };
  }

  for (const [siteName, site] of Object.entries(parsed.sites)) {
    if (!isRecord(site)) {
      problems.push({ check: 'C3', level: 'error', message: `site "${siteName}" entry is not an object`, path });
      continue;
    }
    if (typeof site.defaultLocale !== 'string' || site.defaultLocale === '') {
      problems.push({ check: 'C3', level: 'error', message: `site "${siteName}" is missing "defaultLocale"`, path });
    }
    if (!isLocaleList(site.locales)) {
      problems.push({
        check: 'C3',
        level: 'error',
        message: `site "${siteName}" must declare a non-empty "locales" array of non-empty strings`,
        path,
      });
    } else if (typeof site.defaultLocale === 'string' && !site.locales.includes(site.defaultLocale)) {
      problems.push({
        check: 'C3',
        level: 'error',
        message: `site "${siteName}" defaultLocale must appear in its locales array`,
        path,
      });
    }
  }

  if (!Array.isArray(parsed.globalLocales) || parsed.globalLocales.length === 0) {
    problems.push({
      check: 'C3',
      level: 'warn',
      message: 'sites.json is missing a non-empty "globalLocales" array; the CMS falls back to ["en"]',
      path,
    });
  }

  if (Array.isArray(parsed.globalLocales) && parsed.globalLocales.length > 0 && !isLocaleList(parsed.globalLocales)) {
    problems.push({ check: 'C3', level: 'error', message: 'globalLocales must contain only non-empty strings', path });
  }

  if (problems.some((problem) => problem.level === 'error')) {
    return { outcome, config: null };
  }

  const globalLocales =
    Array.isArray(parsed.globalLocales) && parsed.globalLocales.length > 0 ? parsed.globalLocales : ['en'];
  return { outcome, config: { sites: parsed.sites, globalLocales } as SitesConfig };
}

/**
 * C4 — every configured site has a pages directory on disk, and every on-disk
 * site-shaped directory has a sites.json entry (the disk half of C2; the
 * astro-config half is a separate check).
 */
async function checkSiteDirs(contentRoot: string, config: SitesConfig | null): Promise<CheckOutcome> {
  const problems: DoctorProblem[] = [];
  const outcome: CheckOutcome = { id: 'C4', label: 'site directories match sites.json', problems };
  if (!config) {
    outcome.skipped = 'sites.json is unusable';
    return outcome;
  }

  for (const site of Object.keys(config.sites)) {
    const pagesPath = join(contentRoot, site, 'pages');
    const stats = await stat(pagesPath).catch(() => null);
    if (!stats?.isDirectory()) {
      problems.push({
        check: 'C4',
        level: 'error',
        message: `site "${site}" has no pages directory — expected ${pagesPath}`,
        path: pagesPath,
      });
    }
  }

  const entries = await readdir(contentRoot, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory() || RESERVED_CONTENT_DIRS.has(entry.name) || Object.hasOwn(config.sites, entry.name))
      continue;
    problems.push({
      check: 'C4',
      level: 'warn',
      message: `directory "${entry.name}" has no sites.json entry — any pages inside are invisible to the CMS`,
      path: join(contentRoot, entry.name),
    });
  }

  return outcome;
}

/**
 * C12 — every content file indexes cleanly through the read-only hydration
 * path (ContentIndex.indexAll over the filesystem reader backend). A file
 * reported here is one the CMS and the build silently drop. Unlike the legacy
 * loader, this path never repairs, renames, or rewrites anything on disk.
 */
async function checkContentIndex(contentRoot: string, config: SitesConfig | null): Promise<CheckOutcome> {
  const problems: DoctorProblem[] = [];
  const outcome: CheckOutcome = { id: 'C12', label: 'content files index cleanly', problems };

  // Without a usable sites.json the page buckets are unknown, but parse and
  // duplicate-id failures are still detectable, so the scan runs regardless.
  const sitesConfig = config ?? { sites: {}, globalLocales: ['en'] };
  try {
    const index = ContentIndex.createUncached(sitesConfig);
    const backend = new FileSystemReaderBackend({ contentRoot });
    const { indexed } = await index.indexAll(backend, {
      glob: CONTENT_GLOB,
      onError: (path, reason, message) => {
        problems.push({
          check: 'C12',
          level: 'error',
          message: `${message} (${reason})`,
          path: join(contentRoot, path),
        });
      },
    });
    outcome.detail = counted(indexed, 'file');
  } catch (error) {
    problems.push({ check: 'C12', level: 'error', message: `content scan failed: ${messageOf(error)}` });
  }

  return outcome;
}

export interface DoctorOptions {
  /** Let extensions contact the services they configure. Off by default: doctor itself never networks. */
  live: boolean;
}

/** Run every health check against a project and its content root. Never touches the disk beyond reads. */
export async function runDoctor(
  projectDir: string,
  contentRoot: string,
  options: DoctorOptions,
): Promise<DoctorReport> {
  const sitesFile = await checkSitesFile(contentRoot);
  const checks: CheckOutcome[] = [sitesFile.outcome];
  checks.push(await checkSiteDirs(contentRoot, sitesFile.config));
  checks.push(await checkContentIndex(contentRoot, sitesFile.config));
  checks.push(...(await runAstroChecks(projectDir, sitesFile.config ? Object.keys(sitesFile.config.sites) : null)));
  checks.push(...(await runExtensionChecks(projectDir, contentRoot, options.live)));

  const problems = checks.flatMap((check) => check.problems);
  return { ok: !problems.some((problem) => problem.level === 'error'), checks, problems };
}

/** Prints the human-readable doctor report for a content root. */
export function printReport(contentRoot: string, report: DoctorReport): void {
  console.log(`Checking ${contentRoot}`);
  for (const check of report.checks) {
    if (check.skipped) {
      console.log(`- ${check.id} ${check.label} (skipped: ${check.skipped})`);
      continue;
    }
    const hasErrors = check.problems.some((problem) => problem.level === 'error');
    const mark = hasErrors ? '✗' : check.problems.length > 0 ? '!' : '✓';
    console.log(`${mark} ${check.id} ${check.label}${check.detail ? ` (${check.detail})` : ''}`);
    for (const problem of check.problems) {
      console.log(`    ${problem.level}: ${problem.message}`);
    }
  }

  const errorCount = report.problems.filter((problem) => problem.level === 'error').length;
  const warnCount = report.problems.length - errorCount;
  console.log('');
  if (report.problems.length === 0) {
    console.log('✓ No problems found');
  } else {
    console.log(`Found ${counted(errorCount, 'error')}, ${counted(warnCount, 'warning')}`);
  }
}

export async function doctor(directory: string, options: { json: boolean; live: boolean }): Promise<void> {
  const projectDir = resolve(directory);
  const contentRoot = contentRootOf(directory);
  const report = await runDoctor(projectDir, contentRoot, { live: options.live });

  if (options.json) {
    console.log(JSON.stringify({ ok: report.ok, problems: report.problems }));
  } else {
    printReport(contentRoot, report);
  }

  if (!report.ok) {
    process.exit(1);
  }
}
