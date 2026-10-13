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
}

const COMMANDS: Record<PackageManager, PackageManagerCommands> = {
  bun: { install: 'bun install', frozenInstall: 'bun install --frozen-lockfile', run: 'bun run' },
  npm: { install: 'npm install', frozenInstall: 'npm ci', run: 'npm run' },
  pnpm: { install: 'pnpm install', frozenInstall: 'pnpm install --frozen-lockfile', run: 'pnpm run' },
  yarn: { install: 'yarn install', frozenInstall: 'yarn install --frozen-lockfile', run: 'yarn' },
};

export function packageManagerCommands(pm: PackageManager): PackageManagerCommands {
  return COMMANDS[pm];
}
