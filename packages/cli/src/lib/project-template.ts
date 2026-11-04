import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { type PackageManager, packageManagerCommands } from './package-manager.js';

/**
 * Third-party ranges a created project starts with. Kept equal to
 * example/website-with-cms/package.json by a test, so the scaffold and the
 * canonical example never drift apart; ttsc and @ttsc/unplugin alone run ahead.
 */
export const THIRD_PARTY_VERSIONS = {
  astro: '^7.3.1',
  '@astrojs/node': '11.1.9',
  '@astrojs/react': '^6.0.5',
  '@puckeditor/core': '^0.23.0',
  '@vitejs/plugin-react': '^5.2.0',
  react: '19.2.8',
  'react-dom': '19.2.8',
  typia: '^14.0.6',
  // Exact and equal to ttsc: a newer @ttsc/unplugin asks for a newer ttsc peer, which npm refuses against the pin.
  // 0.35, ahead of the workspace's smoo-pinned 0.34.1: 0.34 asks for TypeScript 7, which @astrojs/check refuses.
  '@ttsc/unplugin': '0.35.0',
  ttsc: '0.35.0',
} as const;

/**
 * The adapter release `conloca connect` installs for draft previews on each host. Exact, so the astro floor in
 * ADAPTER_ASTRO_FLOORS is the floor of what gets installed (a caret would take a later release with a higher one).
 */
export const ADAPTER_VERSIONS = {
  '@astrojs/vercel': '11.0.18',
  '@astrojs/netlify': '8.2.11',
  '@astrojs/cloudflare': '14.3.2',
  '@astrojs/node': '11.1.9',
} as const;

// No @astrojs/check: a created project runs no `astro check`, and its TypeScript <=6 peer would hold the project below
// the native TypeScript 7 ttsc compiles with, so it would need a second, aliased TypeScript.
const DEV_ONLY = new Set(['@ttsc/unplugin', 'ttsc']);

// Where this module sits inside the package differs between the shipped bundle
// (one file at dist/conloca.js) and the source the tests import (src/lib/), so
// the manifest is one level up in the first case and two in the second.
const MANIFEST_CANDIDATES = ['../package.json', '../../package.json'];

export interface CliManifest {
  version: string;
  dependencies?: Record<string, string>;
  /** Optional peers the CLI names a matching release of without installing it, e.g. `@conloca/cloud-astro`. */
  peerDependencies?: Record<string, string>;
}

/**
 * The manifest with its pins as npm reads them. Inside this repo a pin is still `workspace:*`, which becomes a version
 * only at pack time; the workspace links that sibling at its own version, so that is read from its manifest beside this
 * package's. Each package releases on its own version, so the CLI's own version stands in for none of them.
 */
async function withWorkspacePins(manifest: CliManifest, location: URL): Promise<CliManifest> {
  const pinsOf = async (specs: Record<string, string> | undefined) => {
    if (specs === undefined) return undefined;
    const pins = await Promise.all(
      Object.entries(specs).map(async ([name, spec]): Promise<[string, string]> => {
        if (!spec.startsWith('workspace:')) return [name, spec];
        // shortcut: every workspace spec reads as an exact version, as `workspace:*` packs; a `workspace:^` would pack a range.
        const sibling: Partial<CliManifest> = JSON.parse(
          await readFile(new URL(`../${basename(name)}/package.json`, location), 'utf-8'),
        );
        if (typeof sibling.version !== 'string') {
          throw new Error(`could not read the version of workspace package ${name}`);
        }
        return [name, sibling.version];
      }),
    );
    return Object.fromEntries(pins);
  };
  const [dependencies, peerDependencies] = await Promise.all([
    pinsOf(manifest.dependencies),
    pinsOf(manifest.peerDependencies),
  ]);
  return { version: manifest.version, dependencies, peerDependencies };
}

/** Reads this CLI's own manifest: it names both the CLI version and the Conloca releases a created project must pin. */
export async function readCliManifest(): Promise<CliManifest> {
  for (const candidate of MANIFEST_CANDIDATES) {
    let manifest: Partial<CliManifest>;
    try {
      manifest = JSON.parse(await readFile(new URL(candidate, import.meta.url), 'utf-8'));
    } catch {
      continue;
    }
    if (typeof manifest.version === 'string') {
      return withWorkspacePins(
        { version: manifest.version, dependencies: manifest.dependencies, peerDependencies: manifest.peerDependencies },
        new URL(candidate, import.meta.url),
      );
    }
  }
  throw new Error('could not read the version of @conloca/cli from its own package.json');
}

/** A directory basename as a valid npm package name: lowercase, dashes for anything else. */
export function packageNameOf(directory: string): string {
  const name = basename(directory)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[._-]+|[._-]+$/g, '');
  return name === '' ? 'conloca-site' : name;
}

/** The Conloca packages a created project depends on directly. @conloca/mdx is deliberately absent: astro-cms brings it. */
const SCAFFOLD_CONLOCA_PACKAGES = ['@conloca/astro-cms', '@conloca/content-api'] as const;

/**
 * What a site should ask npm for: each package has its own version, and this CLI's manifest pins the set that goes
 * together (pack time writes exact versions). This CLI pins itself at its own version; any other name it does not pin
 * is undefined, and callers leave that entry alone.
 */
export function conlocaRange(manifest: CliManifest, name: string): string | undefined {
  if (name === '@conloca/cli') return manifest.version;
  return manifest.dependencies?.[name] ?? manifest.peerDependencies?.[name];
}

/** The package.json a created project starts with: Conloca pinned to what this CLI depends on, everything else to the example site. */
export function renderPackageJson(input: { name: string; manifest: CliManifest }): string {
  const dependencies: Record<string, string> = {};
  for (const name of SCAFFOLD_CONLOCA_PACKAGES) {
    const range = conlocaRange(input.manifest, name);
    if (range !== undefined) dependencies[name] = range;
  }
  const devDependencies: Record<string, string> = { '@conloca/cli': input.manifest.version };
  for (const [name, range] of Object.entries(THIRD_PARTY_VERSIONS)) {
    (DEV_ONLY.has(name) ? devDependencies : dependencies)[name] = range;
  }
  // Declared, not left to ttsc's peer: a TypeScript below 7 already installed (a workspace root's) would stand in for it.
  devDependencies.typescript = '^7.0.2';
  const sorted = (record: Record<string, string>) =>
    Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)));
  return `${JSON.stringify(
    {
      name: input.name,
      version: '0.0.1',
      private: true,
      type: 'module',
      scripts: { dev: 'astro dev', build: 'astro build', preview: 'astro preview', doctor: 'conloca doctor' },
      dependencies: sorted(dependencies),
      devDependencies: sorted(devDependencies),
    },
    null,
    2,
  )}\n`;
}

const SETUP_STEPS: Record<PackageManager, string> = {
  bun: `      - uses: oven-sh/setup-bun@v2
`,
  npm: `      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
`,
  pnpm: `      - uses: pnpm/action-setup@v4
        with:
          version: 10
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
`,
  yarn: `      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: yarn
`,
};

/** GitHub Actions workflow: doctor + build. */
export function renderWorkflow(pm: PackageManager): string {
  const commands = packageManagerCommands(pm);
  return `name: Conloca

on: [push, pull_request]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          # On a pull request, build the branch's own commit rather than GitHub's
          # temporary merge commit, so a build that reports its commit names a real one.
          ref: \${{ github.event.pull_request.head.sha || github.sha }}
${SETUP_STEPS[pm]}      - run: ${commands.frozenInstall}
      - run: ${commands.run} doctor
      - run: ${commands.run} build
`;
}
