import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isRecord } from '../lib/is-record.js';
import { messageOf } from '../lib/message-of.js';
import { readProjectDependencies } from '../lib/project-dependencies.js';
import type { CheckOutcome, DoctorProblem } from './doctor.js';

/** The contract this CLI speaks. An extension answering another version yields one warning, never a crash. */
export const DOCTOR_CONTRACT_VERSION = 1;

/**
 * What an extension's default export receives. Structural on purpose: the CLI
 * ships no type package, the contract is documented in the README.
 */
export interface DoctorExtensionContext {
  contractVersion: typeof DOCTOR_CONTRACT_VERSION;
  projectDir: string;
  contentRoot: string;
  /** True only under --live; without it an extension must stay offline. */
  live: boolean;
}

interface ExtensionManifest {
  name: string;
  dir: string;
  entry: string;
}

/** Seam-level findings (load failures, contract mismatches) share one check id; the label names the package. */
const SEAM_CHECK_ID = 'EXT';

function seamWarning(name: string, message: string): CheckOutcome {
  return {
    id: SEAM_CHECK_ID,
    label: `doctor extension ${name}`,
    problems: [{ check: SEAM_CHECK_ID, level: 'warn', message }],
  };
}

function unexpectedShape(name: string): CheckOutcome {
  return seamWarning(name, `${name}'s doctor extension returned an unexpected shape — update the package`);
}

/**
 * The dependency's package.json, resolved FROM THE PROJECT. A package whose
 * exports map hides package.json falls back to the node_modules walk.
 */
function resolveManifestPath(
  require: ReturnType<typeof createRequire>,
  projectDir: string,
  name: string,
): string | null {
  try {
    return require.resolve(`${name}/package.json`);
  } catch {
    let dir = projectDir;
    for (;;) {
      const candidate = join(dir, 'node_modules', name, 'package.json');
      if (existsSync(candidate)) return candidate;
      const parent = dirname(dir);
      if (parent === dir) return null;
      dir = parent;
    }
  }
}

/**
 * Every dependency (dependencies + devDependencies) whose own package.json
 * declares a `conloca.doctor` entry. Resolution starts at the project, never
 * at the CLI's own install: the CLI is usually global, and a bare import from
 * here would silently find nothing.
 */
async function discoverExtensions(projectDir: string): Promise<ExtensionManifest[]> {
  const pkg = await readProjectDependencies(projectDir);
  // A missing or broken package.json is not this seam's finding (C7/C8 report it for Astro projects).
  if (pkg === 'missing' || pkg === 'unreadable') return [];
  const require = createRequire(join(projectDir, 'package.json'));
  const manifests: ExtensionManifest[] = [];
  for (const name of [...pkg.deps].sort()) {
    const manifestPath = resolveManifestPath(require, projectDir, name);
    if (manifestPath === null) continue;
    let manifest: unknown;
    try {
      manifest = JSON.parse(await readFile(manifestPath, 'utf-8'));
    } catch {
      continue;
    }
    const entry = isRecord(manifest) && isRecord(manifest.conloca) ? manifest.conloca.doctor : undefined;
    if (typeof entry !== 'string' || entry === '') continue;
    manifests.push({ name, dir: dirname(manifestPath), entry });
  }
  return manifests;
}

function isProblem(value: unknown): value is DoctorProblem {
  return (
    isRecord(value) &&
    typeof value.check === 'string' &&
    (value.level === 'error' || value.level === 'warn') &&
    typeof value.message === 'string' &&
    (value.path === undefined || typeof value.path === 'string')
  );
}

function isCheckOutcome(value: unknown): value is CheckOutcome {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.label === 'string' &&
    Array.isArray(value.problems) &&
    value.problems.every(isProblem) &&
    (value.detail === undefined || typeof value.detail === 'string') &&
    (value.skipped === undefined || typeof value.skipped === 'string')
  );
}

/** Load one extension and run it. Every failure mode is one warning naming the package. */
async function runExtension(manifest: ExtensionManifest, context: DoctorExtensionContext): Promise<CheckOutcome[]> {
  // Unlike the astro config, which doctor-astro scans as text because a user
  // config may run arbitrary side effects, an extension is executed on
  // purpose: a conloca.doctor module is built to be run by doctor, and it is
  // already-installed dependency code whose install scripts ran with full
  // rights, so running it grants no trust the project has not already given.
  let loaded: unknown;
  try {
    loaded = await import(pathToFileURL(resolve(manifest.dir, manifest.entry)).href);
  } catch (error) {
    return [
      seamWarning(
        manifest.name,
        `${manifest.name} declares a doctor extension at ${manifest.entry} that could not be loaded — reinstall or update the package (${messageOf(error)})`,
      ),
    ];
  }
  const run = isRecord(loaded) ? loaded.default : undefined;
  if (typeof run !== 'function') {
    return [
      seamWarning(
        manifest.name,
        `${manifest.name}'s doctor extension has no default export function — update the package`,
      ),
    ];
  }
  let result: unknown;
  try {
    result = await (run as (context: DoctorExtensionContext) => unknown)(context);
  } catch (error) {
    return [seamWarning(manifest.name, `${manifest.name}'s doctor extension failed: ${messageOf(error)}`)];
  }
  if (!isRecord(result)) return [unexpectedShape(manifest.name)];
  if (result.contractVersion !== DOCTOR_CONTRACT_VERSION) {
    return [
      seamWarning(
        manifest.name,
        `extension ${manifest.name} speaks doctor contract ${JSON.stringify(result.contractVersion)}, this CLI speaks ${DOCTOR_CONTRACT_VERSION} — update the older side`,
      ),
    ];
  }
  if (!Array.isArray(result.checks)) return [unexpectedShape(manifest.name)];
  const checks = result.checks.filter(isCheckOutcome);
  const dropped = result.checks.length - checks.length;
  return dropped === 0
    ? checks
    : [
        ...checks,
        seamWarning(
          manifest.name,
          `${dropped} result(s) from ${manifest.name}'s doctor extension were malformed and ignored — update the package`,
        ),
      ];
}

/** Run every doctor extension the project depends on, in package-name order, and return their checks. */
export async function runExtensionChecks(
  projectDir: string,
  contentRoot: string,
  live: boolean,
): Promise<CheckOutcome[]> {
  const context: DoctorExtensionContext = { contractVersion: DOCTOR_CONTRACT_VERSION, projectDir, contentRoot, live };
  const outcomes: CheckOutcome[] = [];
  for (const manifest of await discoverExtensions(projectDir)) {
    outcomes.push(...(await runExtension(manifest, context)));
  }
  return outcomes;
}
