import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PACKAGE_MANAGERS, type PackageManager, packageManagerCommands } from '../src/lib/package-manager.js';
import {
  packageNameOf,
  readCliManifest,
  renderPackageJson,
  renderWorkflow,
  THIRD_PARTY_VERSIONS,
} from '../src/lib/project-template.js';
import { renderAstroConfig } from '../src/templates/project-files.js';

const EXAMPLE_PACKAGE_JSON = join(import.meta.dir, '..', '..', '..', 'example', 'website-with-cms', 'package.json');

describe('renderPackageJson', () => {
  test('pins third-party packages to the example site ranges so the two cannot drift', async () => {
    const example = JSON.parse(await Bun.file(EXAMPLE_PACKAGE_JSON).text());
    const exampleRanges = { ...example.dependencies, ...example.devDependencies };
    for (const [name, range] of Object.entries(THIRD_PARTY_VERSIONS)) {
      expect({ name, range }).toEqual({ name, range: exampleRanges[name] });
    }
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

  test('leaves @conloca/mdx out: astro-cms brings it, and the CLI declares no range that could name it', () => {
    const rendered = JSON.parse(
      renderPackageJson({
        name: 'my-site',
        manifest: { version: '0.1.17', dependencies: { '@conloca/astro-cms': '0.1.16' } },
      }),
    );
    expect(rendered.dependencies['@conloca/mdx']).toBeUndefined();
    expect(rendered.devDependencies['@conloca/mdx']).toBeUndefined();
  });

  test('falls back to the CLI version for a dependency still carrying the workspace protocol', () => {
    // Inside this repo the manifest reads `workspace:*`, which is not installable.
    const rendered = JSON.parse(
      renderPackageJson({
        name: 'my-site',
        manifest: {
          version: '0.1.15',
          dependencies: { '@conloca/astro-cms': 'workspace:*', '@conloca/content-api': 'workspace:*' },
        },
      }),
    );
    expect(rendered.dependencies['@conloca/astro-cms']).toBe('0.1.15');
    expect(rendered.dependencies['@conloca/content-api']).toBe('0.1.15');
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

describe('packageNameOf', () => {
  test('turns a directory basename into a valid npm name', () => {
    expect(packageNameOf('/tmp/My Site!')).toBe('my-site');
    expect(packageNameOf('/tmp/blog')).toBe('blog');
    expect(packageNameOf('/tmp/.hidden')).toBe('hidden');
  });
});

describe('renderWorkflow', () => {
  test.each<PackageManager>([...PACKAGE_MANAGERS])(
    'renders a parseable workflow for %s with the build-token slot',
    (pm) => {
      const workflow = Bun.YAML.parse(renderWorkflow(pm)) as {
        on: unknown;
        jobs: {
          build: {
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
      const steps = workflow.jobs.build.steps;
      const build = steps.find((step) => step.run?.endsWith('run build') || step.run === 'yarn build');
      // biome-ignore lint/suspicious/noTemplateCurlyInString: a GitHub Actions expression the workflow must carry literally
      expect(build?.env?.CONLOCA_BUILD_TOKEN).toBe('${{ secrets.CONLOCA_BUILD_TOKEN }}');
      expect(steps.some((step) => step.run?.endsWith('run doctor') || step.run === 'yarn doctor')).toBe(true);
      expect(steps.some((step) => step.run === packageManagerCommands(pm).frozenInstall)).toBe(true);
      if (pm === 'bun') expect(steps.some((step) => step.uses?.startsWith('oven-sh/setup-bun@'))).toBe(true);
      if (pm === 'pnpm') {
        // action-setup fails the job when no pnpm version is pinned and the project declares none.
        expect(
          steps.some((step) => step.uses?.startsWith('pnpm/action-setup@') && step.with?.version !== undefined),
        ).toBe(true);
      }
      // The comment must not promise what the scaffold cannot do: the
      // integration that reads this secret is not among the packages it installs.
      expect(renderWorkflow(pm)).toContain('not part of this scaffold');
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
  test('reads the version and dependencies of this very package', async () => {
    const expected = JSON.parse(await Bun.file(join(import.meta.dir, '..', 'package.json')).text());
    const manifest = await readCliManifest();
    expect(manifest.version).toBe(expected.version);
    expect(manifest.dependencies).toEqual(expected.dependencies);
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
