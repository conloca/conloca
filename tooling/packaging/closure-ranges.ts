import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const SCOPE = '@conloca/';

export type PackedManifest = {
  name: string;
  version: string;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

const isRanges = (value: unknown): value is Record<string, string> =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  Object.values(value).every((range) => typeof range === 'string');

/** The manifest a package was installed with, checked field by field since it is untyped JSON. */
export const readPackedManifest = (directory: string): PackedManifest => {
  const path = join(directory, 'package.json');
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  assert.ok(
    typeof parsed === 'object' &&
      parsed !== null &&
      'name' in parsed &&
      typeof parsed.name === 'string' &&
      'version' in parsed &&
      typeof parsed.version === 'string',
    `${path}: no string name and version`,
  );
  const dependencies = 'dependencies' in parsed ? parsed.dependencies : {};
  const peerDependencies = 'peerDependencies' in parsed ? parsed.peerDependencies : {};
  assert.ok(isRanges(dependencies) && isRanges(peerDependencies), `${path}: ranges are not all strings`);
  return { name: parsed.name, version: parsed.version, dependencies, peerDependencies };
};

/**
 * Every `@conloca` dependency or peer range, as a packed manifest declares it,
 * that the version packed for that member does not satisfy. Members release on
 * their own versions, so what must hold is the range, not a shared version.
 */
export const unsatisfiedClosureRanges = (manifests: PackedManifest[]) => {
  const packed = new Map(manifests.map((manifest) => [manifest.name, manifest.version]));
  const problems: string[] = [];
  for (const manifest of manifests) {
    for (const [name, range] of Object.entries({ ...manifest.dependencies, ...manifest.peerDependencies })) {
      const version = packed.get(name);
      if (!name.startsWith(SCOPE) || (version !== undefined && Bun.semver.satisfies(version, range))) {
        continue;
      }
      problems.push(`${manifest.name} wants ${name}@${range}, but the closure packs ${version ?? 'nothing'}`);
    }
  }
  return problems;
};
