import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { type PackageManager, packageManagerCommands } from './package-manager.js';

/**
 * Third-party ranges a created project starts with. Kept equal to
 * example/website-with-cms/package.json by a test, so the scaffold and the
 * canonical example never drift apart.
 */
export const THIRD_PARTY_VERSIONS = {
  astro: '^7.3.1',
  '@astrojs/node': '^11.1.5',
  '@astrojs/react': '^6.0.5',
  '@puckeditor/core': '^0.23.0',
  '@vitejs/plugin-react': '^5.2.0',
  react: '19.2.8',
  'react-dom': '19.2.8',
  zod: '^4.5.4',
  '@astrojs/check': '^0.9.10',
} as const;

const DEV_ONLY = new Set(['@astrojs/check']);

// Where this module sits inside the package differs between the shipped bundle
// (one file at dist/conloca.js) and the source the tests import (src/lib/), so
// the manifest is one level up in the first case and two in the second.
const MANIFEST_CANDIDATES = ['../package.json', '../../package.json'];

export interface CliManifest {
  version: string;
  dependencies?: Record<string, string>;
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
      return { version: manifest.version, dependencies: manifest.dependencies };
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
 * What a created project should ask npm for. The CLI's own dependency range is the only version
 * of a sibling package known to exist: releases are independent, so the CLI can be published on
 * its own and its own version then names a release nobody ever cut. Inside this repo the range is
 * still `workspace:*`, which becomes a real version only at pack time, so it falls back.
 */
function conlocaRange(manifest: CliManifest, name: string): string {
  const declared = manifest.dependencies?.[name];
  return declared === undefined || declared.startsWith('workspace:') ? manifest.version : declared;
}

/** The package.json a created project starts with: Conloca pinned to what this CLI depends on, everything else to the example site. */
export function renderPackageJson(input: { name: string; manifest: CliManifest }): string {
  const dependencies: Record<string, string> = {};
  for (const name of SCAFFOLD_CONLOCA_PACKAGES) {
    dependencies[name] = conlocaRange(input.manifest, name);
  }
  const devDependencies: Record<string, string> = { '@conloca/cli': input.manifest.version };
  for (const [name, range] of Object.entries(THIRD_PARTY_VERSIONS)) {
    (DEV_ONLY.has(name) ? devDependencies : dependencies)[name] = range;
  }
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

/** GitHub Actions workflow: doctor + build, both with the build-token slot (unused until a site adds an integration that reads it). */
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
      # Slot for a build integration that is not part of this scaffold; nothing reads
      # this secret until you add one. Given to doctor and the build only, never to
      # dependency install scripts.
      - run: ${commands.run} doctor
        env:
          CONLOCA_BUILD_TOKEN: \${{ secrets.CONLOCA_BUILD_TOKEN }}
      - run: ${commands.run} build
        env:
          CONLOCA_BUILD_TOKEN: \${{ secrets.CONLOCA_BUILD_TOKEN }}
`;
}
