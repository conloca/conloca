import { isRecord } from './is-record.js';

const NUMERIC = /^\d+$/;

/** Compare two prerelease identifiers: numeric ones by value and before alphanumeric ones. */
function compareIdentifiers(a: string, b: string): number {
  const aNumeric = NUMERIC.test(a);
  const bNumeric = NUMERIC.test(b);
  if (aNumeric && bNumeric) return Number(a) - Number(b);
  if (aNumeric !== bNumeric) return aNumeric ? -1 : 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Order two versions by semver precedence; negative when `a` comes first, 0 when equal. */
export function compareVersions(a: string, b: string): number {
  const [aCore = '', ...aPre] = a.split('+')[0]?.split('-') ?? [];
  const [bCore = '', ...bPre] = b.split('+')[0]?.split('-') ?? [];
  const aParts = aCore.split('.').map(Number);
  const bParts = bCore.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (aParts[i] ?? 0) - (bParts[i] ?? 0);
    if (diff !== 0) return diff;
  }
  // Rejoin on '-' since hyphens are legal inside prerelease identifiers.
  const aIds = aPre.length > 0 ? aPre.join('-').split('.') : [];
  const bIds = bPre.length > 0 ? bPre.join('-').split('.') : [];
  // A release sorts after any of its prereleases.
  if (aIds.length === 0 || bIds.length === 0) return bIds.length - aIds.length;
  for (let i = 0; i < Math.min(aIds.length, bIds.length); i++) {
    const diff = compareIdentifiers(aIds[i] ?? '', bIds[i] ?? '');
    if (diff !== 0) return diff;
  }
  return aIds.length - bIds.length;
}

/** The version a dependency spec starts from, or null for a tag such as `latest` or `*`. */
export function versionFloor(spec: string): string | null {
  return spec.match(/\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?/)?.[0] ?? null;
}

const SECTIONS = ['dependencies', 'devDependencies', 'optionalDependencies'] as const;

/** The dependency sections of a parsed `package.json`, still unchecked. */
interface DependencySections {
  dependencies?: unknown;
  devDependencies?: unknown;
  optionalDependencies?: unknown;
}

/** Every `@conloca/*` entry in a package manifest with the section it sits in. */
export function conlocaDependencies(
  manifest: DependencySections,
): { section: (typeof SECTIONS)[number]; name: string; spec: string }[] {
  return SECTIONS.flatMap((section) => {
    const deps = manifest[section];
    if (!isRecord(deps)) return [];
    return Object.entries(deps).flatMap(([name, spec]) =>
      name.startsWith('@conloca/') && typeof spec === 'string' ? [{ section, name, spec }] : [],
    );
  });
}
