import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export const PACKAGE_MANAGERS = ['bun', 'npm', 'pnpm', 'yarn'] as const;
export type PackageManager = (typeof PACKAGE_MANAGERS)[number];

function isPackageManager(value: string): value is PackageManager {
  return (PACKAGE_MANAGERS as readonly string[]).includes(value);
}

/**
 * Which package manager to drive: an explicit flag, else the one that launched
 * the CLI (`npm_config_user_agent` starts with `bun/`, `pnpm/`, `yarn/` or
 * `npm/`), else npm — the one every Node install has.
 */
export function detectPackageManager(input: { flag?: string; userAgent?: string }): PackageManager {
  if (input.flag !== undefined) {
    if (!isPackageManager(input.flag)) {
      throw new Error(`unknown package manager '${input.flag}' — use one of ${PACKAGE_MANAGERS.join(', ')}`);
    }
    return input.flag;
  }
  const agent = input.userAgent?.split('/')[0];
  return agent !== undefined && isPackageManager(agent) ? agent : 'npm';
}

export interface PackageManagerCommands {
  install: string;
  /** The CI form that refuses to change the lockfile. */
  frozenInstall: string;
  /** Prefix that runs a package.json script, e.g. `npm run dev`. */
  run: string;
  /** Prefix that adds a dependency to package.json, e.g. `npm install @conloca/cloud-astro`. */
  add: string;
}

const COMMANDS = {
  bun: { install: 'bun install', frozenInstall: 'bun install --frozen-lockfile', run: 'bun run', add: 'bun add' },
  npm: { install: 'npm install', frozenInstall: 'npm ci', run: 'npm run', add: 'npm install' },
  pnpm: { install: 'pnpm install', frozenInstall: 'pnpm install --frozen-lockfile', run: 'pnpm run', add: 'pnpm add' },
  yarn: { install: 'yarn install', frozenInstall: 'yarn install --frozen-lockfile', run: 'yarn', add: 'yarn add' },
} satisfies Record<PackageManager, PackageManagerCommands>;

export function packageManagerCommands(pm: PackageManager): PackageManagerCommands {
  return COMMANDS[pm];
}

/** Where a project installs: the package manager its lockfile belongs to, that lockfile, and its folder. */
export interface LockfileInstall {
  packageManager: PackageManager;
  lockfile: string;
  installDir: string;
}

/** Lockfile names in the order one folder's files are tried. */
const LOCKFILES: [string, PackageManager][] = [
  ['bun.lock', 'bun'],
  ['bun.lockb', 'bun'],
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['package-lock.json', 'npm'],
];

/**
 * The lockfile nearest to `projectDir`, looking from it up to `repoRoot` and no further, so a workspace member
 * installs at its workspace's root; null when no folder on the way holds one. Paths are absolute.
 */
export function lockfileInstall(
  projectDir: string,
  repoRoot: string,
  exists: (path: string) => boolean = existsSync,
): LockfileInstall | null {
  const root = resolve(repoRoot);
  for (let dir = resolve(projectDir); ; dir = dirname(dir)) {
    for (const [name, packageManager] of LOCKFILES) {
      const lockfile = join(dir, name);
      if (exists(lockfile)) return { packageManager, lockfile, installDir: dir };
    }
    if (dir === root || dir === dirname(dir)) return null;
  }
}
