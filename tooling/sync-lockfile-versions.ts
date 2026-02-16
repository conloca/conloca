/**
 * Workaround for bun issue #20477:
 * https://github.com/oven-sh/bun/issues/20477
 *
 * `bun publish` / `bun pm pack` resolves `workspace:*` and `workspace:^`
 * from bun.lock instead of from the on-disk package.json version.
 * After bumping versions, the lockfile retains stale versions, causing
 * published packages to reference old dependency versions.
 *
 * This script reads each workspace package's version from its package.json
 * and patches the corresponding version field in bun.lock.
 *
 * Run this AFTER version bumps and BEFORE publishing:
 *   bun tooling/sync-lockfile-versions.ts
 *
 * Remove this script once the bun fix (PR #26797) is released.
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const LOCKFILE_PATH = join(ROOT, 'bun.lock');

// Workspace directories that contain publishable packages
const WORKSPACE_DIRS = ['packages'];

interface PackageJson {
  name: string;
  version: string;
}

function getWorkspacePackages(): Map<string, { path: string; version: string }> {
  const packages = new Map<string, { path: string; version: string }>();

  for (const dir of WORKSPACE_DIRS) {
    const fullDir = join(ROOT, dir);
    let entries: string[];
    try {
      entries = readdirSync(fullDir);
    } catch {
      continue;
    }

    for (const entry of entries) {
      const pkgJsonPath = join(fullDir, entry, 'package.json');
      try {
        const pkg: PackageJson = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));
        const relativePath = `${dir}/${entry}`;
        packages.set(relativePath, { path: relativePath, version: pkg.version });
      } catch {
        // Not a package directory
      }
    }
  }

  return packages;
}

function syncLockfileVersions(): void {
  const packages = getWorkspacePackages();
  let lockfile = readFileSync(LOCKFILE_PATH, 'utf-8');
  let updated = 0;

  for (const [relativePath, { version }] of packages) {
    // Match: "packages/foo": { ... "version": "X.Y.Z" ...
    // The version field appears within the workspace entry block
    const pattern = new RegExp(
      `("${relativePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}":\\s*\\{[^}]*"version":\\s*")([^"]+)(")`,
    );

    const match = lockfile.match(pattern);
    if (!match) {
      console.log(`  skip: ${relativePath} (not found in lockfile)`);
      continue;
    }

    const lockVersion = match[2];
    if (lockVersion === version) {
      console.log(`  ok:   ${relativePath} = ${version}`);
      continue;
    }

    lockfile = lockfile.replace(pattern, `$1${version}$3`);
    console.log(`  fix:  ${relativePath}: ${lockVersion} -> ${version}`);
    updated++;
  }

  if (updated > 0) {
    writeFileSync(LOCKFILE_PATH, lockfile);
    console.log(`\nUpdated ${updated} workspace version(s) in bun.lock`);
  } else {
    console.log('\nAll workspace versions already in sync.');
  }
}

console.log('Syncing workspace versions in bun.lock...\n');
syncLockfileVersions();
