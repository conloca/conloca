import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PACKAGE_MANAGERS, type PackageManager, packageManagerCommands } from '../src/lib/package-manager.js';
import {
  conlocaRange,
  packageNameOf,
  readCliManifest,
  renderPackageJson,
  renderWorkflow,
  THIRD_PARTY_VERSIONS,
} from '../src/lib/project-template.js';
import { renderAstroConfig } from '../src/templates/project-files.js';
import { unsatisfiablePeers } from './peer-ranges.js';

const EXAMPLE_PACKAGE_JSON = join(import.meta.dir, '..', '..', '..', 'example', 'website-with-cms', 'package.json');

describe('renderPackageJson', () => {
  test('pins third-party packages to the example site ranges so the two cannot drift', async () => {
    const example = JSON.parse(await Bun.file(EXAMPLE_PACKAGE_JSON).text());
    const exampleRanges = { ...example.dependencies, ...example.devDependencies };
    // The workspace's ttsc is smoo's pin, which still asks for TypeScript 7; the peer test below covers the scaffold's.
    const ahead = new Set(['@ttsc/unplugin', 'ttsc']);
    for (const [name, range] of Object.entries(THIRD_PARTY_VERSIONS).filter(([pkg]) => !ahead.has(pkg))) {
      expect({ name, range }).toEqual({ name, range: exampleRanges[name] });
    }
  });

  test('pins @ttsc/unplugin to exactly the ttsc release, so npm finds the ttsc peer it asks for', () => {
    const { '@ttsc/unplugin': unplugin, ttsc } = THIRD_PARTY_VERSIONS;
    expect(unplugin).toMatch(/^\d+\.\d+\.\d+$/);
    expect(unplugin).toBe(ttsc);
  });

  test('declares no two packages whose peer ranges for one package no version satisfies, so npm installs without ERESOLVE', async () => {
    const rendered = JSON.parse(renderPackageJson({ name: 'my-site', manifest: await readCliManifest() }));
    expect(await unsatisfiablePeers({ ...rendered.dependencies, ...rendered.devDependencies })).toEqual([]);
  });

  test('pins Conloca packages to the releases this CLI itself depends on, not to its own version', () => {
    // The shape npm publishes: pack time rewrites `workspace:*` to the sibling version
    // that was on disk at the release commit, so an independent CLI bump names a release
    // that exists instead of one that was never published.
    const rendered = JSON.parse(
      renderPackageJson({
        name: 'my-site',
        manifest: {
          version: '0.1.17',
          dependencies: { '@conloca/astro-cms': '0.1.16', '@conloca/content-api': '0.1.16' },
        },
      }),
    );
    expect(rendered.name).toBe('my-site');
    expect(rendered.version).toBe('0.0.1');
    expect(rendered.private).toBe(true);
    expect(rendered.type).toBe('module');
    expect(rendered.dependencies['@conloca/astro-cms']).toBe('0.1.16');
    expect(rendered.dependencies['@conloca/content-api']).toBe('0.1.16');
    expect(rendered.devDependencies['@conloca/cli']).toBe('0.1.17');
    expect(rendered.scripts).toEqual({
      dev: 'astro dev',
      build: 'astro build',
      preview: 'astro preview',
      doctor: 'conloca doctor',
    });
    for (const name of Object.keys(THIRD_PARTY_VERSIONS)) {
      expect(rendered.dependencies[name] ?? rendered.devDependencies[name]).toBe(
        THIRD_PARTY_VERSIONS[name as keyof typeof THIRD_PARTY_VERSIONS],
      );
    }
  });

  test("declares the native TypeScript 7 ttsc compiles with: a TypeScript 6 already installed would meet ttsc's peer", async () => {
    const rendered = JSON.parse(renderPackageJson({ name: 'my-site', manifest: await readCliManifest() }));
    expect(rendered.devDependencies.typescript).toBe('^7.0.2');
  });

  test('leaves @conloca/mdx out of a created project: astro-cms brings it', () => {
    const rendered = JSON.parse(
      renderPackageJson({
        name: 'my-site',
        manifest: { version: '0.1.17', dependencies: { '@conloca/astro-cms': '0.1.16' } },
      }),
    );
    expect(rendered.dependencies['@conloca/mdx']).toBeUndefined();
    expect(rendered.devDependencies['@conloca/mdx']).toBeUndefined();
  });

  test('this CLI depends on every Conloca package the scaffold pins, so a release always has a version to write', async () => {
    const manifest = await readCliManifest();
    const pinned = Object.keys(
      JSON.parse(renderPackageJson({ name: 'my-site', manifest })).dependencies as Record<string, string>,
    ).filter((name) => name.startsWith('@conloca/'));
    for (const name of pinned) {
      expect({ name, declared: manifest.dependencies?.[name] !== undefined }).toEqual({ name, declared: true });
    }
  });
});

describe('conlocaRange', () => {
  test('pins the siblings a site may list without the CLI installing them, as optional peers', async () => {
    const manifest = JSON.parse(await Bun.file(join(import.meta.dir, '..', 'package.json')).text());
    const cli = await readCliManifest();
    for (const name of ['@conloca/mdx', '@conloca/cms-spa', '@conloca/content-api-client']) {
      expect({ name, range: manifest.peerDependencies[name], meta: manifest.peerDependenciesMeta[name] }).toEqual({
        name,
        range: 'workspace:*',
        meta: { optional: true },
      });
      expect(conlocaRange(cli, name)).toBeDefined();
    }
  });

  test('names no version for a package this CLI does not pin, and its own version for itself', () => {
    const manifest = { version: '0.2.6', dependencies: { '@conloca/astro-cms': '0.2.5' } };
    expect(conlocaRange(manifest, '@conloca/astro-cms')).toBe('0.2.5');
    expect(conlocaRange(manifest, '@conloca/mdx')).toBeUndefined();
    expect(conlocaRange(manifest, '@conloca/cli')).toBe('0.2.6');
  });
});

describe('packageNameOf', () => {
  test('turns a directory basename into a valid npm name', () => {
    expect(packageNameOf('/tmp/My Site!')).toBe('my-site');
    expect(packageNameOf('/tmp/blog')).toBe('blog');
    expect(packageNameOf('/tmp/.hidden')).toBe('hidden');
  });
});

describe('renderWorkflow', () => {
  test.each<PackageManager>([...PACKAGE_MANAGERS])(
    'renders a parseable workflow for %s with doctor and build, no build key, and a pull request built from its own commit',
    (pm) => {
      const workflow = Bun.YAML.parse(renderWorkflow(pm)) as {
        on: unknown;
        jobs: {
          build: {
            env?: Record<string, string>;
            steps: {
              name?: string;
              run?: string;
              uses?: string;
              with?: Record<string, unknown>;
              env?: Record<string, string>;
            }[];
          };
        };
      };
      expect(workflow.on).toEqual(['push', 'pull_request']);
      const job = workflow.jobs.build;
      const steps = job.steps;
      const doctor = steps.find((step) => step.run?.endsWith('run doctor') || step.run === 'yarn doctor');
      const build = steps.find((step) => step.run?.endsWith('run build') || step.run === 'yarn build');
      const install = steps.find((step) => step.run === packageManagerCommands(pm).frozenInstall);
      expect(install).toBeDefined();
      expect(doctor).toBeDefined();
      expect(build).toBeDefined();
      expect(job.env).toBeUndefined();
      const checkout = steps.find((step) => step.uses?.startsWith('actions/checkout@'));
      // A pull request builds the branch's own commit, not GitHub's temporary merge commit.
      // biome-ignore lint/suspicious/noTemplateCurlyInString: a GitHub Actions expression the workflow must carry literally
      expect(checkout?.with?.ref).toBe('${{ github.event.pull_request.head.sha || github.sha }}');
      if (pm === 'bun') expect(steps.some((step) => step.uses?.startsWith('oven-sh/setup-bun@'))).toBe(true);
      if (pm === 'pnpm') {
        // action-setup fails the job when no pnpm version is pinned and the project declares none.
        expect(
          steps.some((step) => step.uses?.startsWith('pnpm/action-setup@') && step.with?.version !== undefined),
        ).toBe(true);
      }
      // The workflow no longer names a build key: the editor page needs none.
      expect(renderWorkflow(pm)).not.toContain('CONLOCA_BUILD_TOKEN');
      expect(renderWorkflow(pm)).not.toContain('Slot for a build integration');
    },
  );
});

describe('renderAstroConfig', () => {
  test('names the site and wires every generated file', () => {
    const config = renderAstroConfig('marketing');
    expect(config).toContain("siteName: 'marketing'");
    expect(config).toContain("contentRoot: './content'");
    expect(config).toContain("puckConfigPath: './src/puck.config.tsx'");
    expect(config).toContain("schemasPath: './src/schemas/data.ts'");
    expect(config).toContain("assetsPath: './public/media'");
    expect(config).toContain("layout: './src/layouts/Layout.astro'");
    expect(config.indexOf('react()')).toBeLessThan(config.indexOf('conlocaCMS('));
  });

  test('escapes the site name so no name can render broken JavaScript', async () => {
    expect(renderAstroConfig("it's")).toContain("siteName: 'it\\'s'");
    const dir = await mkdtemp(join(tmpdir(), 'conloca-template-'));
    try {
      const file = join(dir, 'astro.config.mjs');
      await Bun.write(file, renderAstroConfig("it's"));
      expect(Bun.spawnSync(['node', '--check', file]).exitCode).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('readCliManifest', () => {
  test("reads the version and dependencies of this very package, each workspace pin as that sibling's own version", async () => {
    // Inside this repo a pin reads `workspace:*`, and the workspace links the sibling at its own version, which is
    // what `bun pm pack` writes. The packages release on their own versions, so the CLI's version is not that.
    const expected = JSON.parse(await Bun.file(join(import.meta.dir, '..', 'package.json')).text());
    const manifest = await readCliManifest();
    expect(manifest.version).toBe(expected.version);
    const pinned = await Promise.all(
      Object.entries<string>({ ...expected.dependencies, ...expected.peerDependencies }).map(async ([name, spec]) => {
        const sibling = join(import.meta.dir, '..', '..', name.slice('@conloca/'.length), 'package.json');
        return [name, spec.startsWith('workspace:') ? JSON.parse(await Bun.file(sibling).text()).version : spec];
      }),
    );
    expect({ ...manifest.dependencies, ...manifest.peerDependencies }).toEqual(Object.fromEntries(pinned));
  });
});

describe('THIRD_PARTY_VERSIONS against @conloca/astro-cms peers', () => {
  test('every scaffolded range starts inside the peer range astro-cms declares, so npm and pnpm can install it', async () => {
    const astroCms = JSON.parse(
      await Bun.file(join(import.meta.dir, '..', '..', 'astro-cms', 'package.json')).text(),
    ) as {
      peerDependencies: Record<string, string>;
    };
    for (const [name, peerRange] of Object.entries(astroCms.peerDependencies)) {
      const range = (THIRD_PARTY_VERSIONS as Record<string, string>)[name];
      // Peers the scaffold does not declare directly (vite arrives through astro) are astro's business.
      if (range === undefined) continue;
      const floor = range.replace(/^[\^~]/, '');
      expect({ name, floor, peerRange, satisfies: Bun.semver.satisfies(floor, peerRange) }).toEqual({
        name,
        floor,
        peerRange,
        satisfies: true,
      });
    }
  });
});
