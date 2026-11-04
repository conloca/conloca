import { afterEach, describe, expect, test } from 'bun:test';
import { rm } from 'node:fs/promises';
import { relative } from 'node:path';
import { writeEdits } from '../src/lib/connect/step.js';
import { MIGRATIONS, type Migration, migrationsSince } from '../src/lib/migrations.js';
import { makeRepo, OLD_WORKFLOW, treeHashes } from './fixture-repo.js';

const KEYED_CONFIG = `import react from '@astrojs/react';
import { conlocaCMS } from '@conloca/astro-cms/node';
import { conlocaCloud } from '@conloca/cloud-astro';
import { defineConfig } from 'astro/config';

export default defineConfig({
  integrations: [react(), conlocaCMS({ contentRoot: './content' }), conlocaCloud({ buildToken: process.env.CONLOCA_BUILD_TOKEN })],
});
`;

const KEYLESS_CONFIG = KEYED_CONFIG.replace('{ buildToken: process.env.CONLOCA_BUILD_TOKEN }', '');

/** A key passed inline on a run line, which only a person can rewrite. */
const INLINE_WORKFLOW = `jobs:
  b:
    steps:
      - run: CONLOCA_BUILD_TOKEN=\${{ secrets.CONLOCA_BUILD_TOKEN }} npm run build
`;

function migration(id: string): Migration {
  const found = MIGRATIONS.find((m) => m.id === id);
  if (found === undefined) throw new Error(`no migration ${id}`);
  return found;
}

const keyless = migration('keyless');
let dir = '';

afterEach(async () => {
  if (dir !== '') await rm(dir, { recursive: true, force: true });
  dir = '';
});

/** A site's lowest declared version of the packages that introduced `keyless` and `data-schemas`. */
function site(keylessFloor: string, dataSchemasFloor: string): Map<string, string> {
  return new Map([
    ['@conloca/cloud-astro', keylessFloor],
    ['@conloca/astro-cms', dataSchemasFloor],
  ]);
}

describe('migrationsSince', () => {
  test('runs each migration while its own package is below the release that introduced it', () => {
    expect(migrationsSince(site('0.2.1', '0.2.1')).map((m) => m.id)).toEqual(['keyless', 'data-schemas', 'd8']);
    expect(migrationsSince(site('0.2.3', '0.2.1')).map((m) => m.id)).toEqual(['data-schemas', 'd8']);
    expect(migrationsSince(site('0.2.1', '0.2.4')).map((m) => m.id)).toEqual(['keyless', 'd8']);
    expect(migrationsSince(site('0.2.5', '0.2.4')).map((m) => m.id)).toEqual(['d8']);
  });

  test('runs the 0.2.4 step for a site on a 0.2.4 prerelease', () => {
    expect(migrationsSince(site('0.2.6-next.0', '0.2.4-next.0')).map((m) => m.id)).toEqual(['data-schemas']);
  });

  test('skips a migration whose package the site does not declare', () => {
    expect(migrationsSince(new Map([['@conloca/astro-cms', '0.2.1']])).map((m) => m.id)).toEqual(['data-schemas']);
  });

  test('needs none when every package is on its newest migration release', () => {
    expect(migrationsSince(site('0.2.6-next.0', '0.2.4'))).toEqual([]);
  });
});

describe('the keyless migration', () => {
  test('plans the deletion of the old key from the workflow and buildToken from conlocaCloud()', async () => {
    dir = await makeRepo({ '.github/workflows/conloca.yml': OLD_WORKFLOW, 'astro.config.mjs': KEYED_CONFIG }, []);
    const before = await treeHashes(dir);
    const plan = await keyless.plan({ projectDir: dir, repoRoot: dir });
    expect(plan.state).toBe('changed');
    expect(plan.packages).toEqual([]);
    expect(plan.edits.map((edit) => relative(dir, edit.path))).toEqual([
      '.github/workflows/conloca.yml',
      'astro.config.mjs',
    ]);
    expect(
      plan.edits.every((edit) => !edit.after.includes('CONLOCA_BUILD_TOKEN') && !edit.after.includes('buildToken')),
    ).toBe(true);
    expect(await treeHashes(dir)).toEqual(before);
  });

  test('needs a person for a key line it cannot delete, and still writes nothing', async () => {
    dir = await makeRepo({ '.github/workflows/ci.yml': INLINE_WORKFLOW, 'astro.config.mjs': KEYED_CONFIG }, []);
    const before = await treeHashes(dir);
    const plan = await keyless.plan({ projectDir: dir, repoRoot: dir });
    expect(plan.state).toBe('needs-you');
    expect(plan.lines).toEqual(['.github/workflows/ci.yml: line 4']);
    expect(await treeHashes(dir)).toEqual(before);
  });

  test('needs a person when conlocaCloud() takes a removed option it cannot edit', async () => {
    const config = KEYED_CONFIG.replace(
      'export default',
      'const opts = { buildToken: process.env.T };\n\nexport default',
    ).replace('conlocaCloud({ buildToken: process.env.CONLOCA_BUILD_TOKEN })', 'conlocaCloud(opts)');
    dir = await makeRepo({ 'astro.config.mjs': config }, []);
    const plan = await keyless.plan({ projectDir: dir, repoRoot: dir });
    expect(plan.state).toBe('needs-you');
    expect(plan.message).toContain('buildToken');
    expect(plan.lines).toEqual(['astro.config.mjs']);
    expect(plan.edits).toEqual([]);
  });

  test('keeps a conlocaCMS() fragmentPreviewRoute while it drops buildToken from conlocaCloud()', async () => {
    const config = KEYED_CONFIG.replace(
      "{ contentRoot: './content' }",
      "{ contentRoot: './content', fragmentPreviewRoute: '/x/' }",
    );
    dir = await makeRepo({ 'astro.config.mjs': config }, []);
    const plan = await keyless.plan({ projectDir: dir, repoRoot: dir });
    expect(plan.state).toBe('changed');
    expect(plan.edits).toHaveLength(1);
    expect(plan.edits[0]?.after).not.toContain('buildToken');
    expect(plan.edits[0]?.after).toContain("fragmentPreviewRoute: '/x/'");
  });

  test('is done when only conlocaCMS() names fragmentPreviewRoute', async () => {
    const config = KEYLESS_CONFIG.replace(
      "{ contentRoot: './content' }",
      "{ contentRoot: './content', fragmentPreviewRoute: '/x/' }",
    );
    dir = await makeRepo({ 'astro.config.mjs': config }, []);
    expect(await keyless.plan({ projectDir: dir, repoRoot: dir })).toMatchObject({ state: 'done', edits: [] });
  });

  test('is done when conlocaCloud(opts) takes no removed option and conlocaCMS() names fragmentPreviewRoute', async () => {
    const config = KEYED_CONFIG.replace('export default', 'const opts = {};\n\nexport default')
      .replace('conlocaCloud({ buildToken: process.env.CONLOCA_BUILD_TOKEN })', 'conlocaCloud(opts)')
      .replace("{ contentRoot: './content' }", "{ contentRoot: './content', fragmentPreviewRoute: '/x/' }");
    dir = await makeRepo({ 'astro.config.mjs': config }, []);
    expect(await keyless.plan({ projectDir: dir, repoRoot: dir })).toMatchObject({ state: 'done', edits: [] });
  });

  test('needs a person when the workflow edit is planned but the config needs one', async () => {
    const config = KEYED_CONFIG.replace(
      'export default',
      'const opts = { buildToken: process.env.T };\n\nexport default',
    ).replace('conlocaCloud({ buildToken: process.env.CONLOCA_BUILD_TOKEN })', 'conlocaCloud(opts)');
    dir = await makeRepo({ '.github/workflows/conloca.yml': OLD_WORKFLOW, 'astro.config.mjs': config }, []);
    const plan = await keyless.plan({ projectDir: dir, repoRoot: dir });
    expect(plan.state).toBe('needs-you');
    expect(plan.message).toMatch(/; remove buildToken from conlocaCloud\(\) in astro\.config\.mjs/);
    expect(plan.lines).toEqual(['astro.config.mjs']);
    expect(plan.edits.map((edit) => relative(dir, edit.path))).toEqual(['.github/workflows/conloca.yml']);
  });

  test('is done on a keyless site', async () => {
    dir = await makeRepo({ 'astro.config.mjs': KEYLESS_CONFIG }, []);
    expect(await keyless.plan({ projectDir: dir, repoRoot: dir })).toMatchObject({ state: 'done', edits: [] });
  });

  test('is done once its own plan is written', async () => {
    dir = await makeRepo({ '.github/workflows/conloca.yml': OLD_WORKFLOW, 'astro.config.mjs': KEYED_CONFIG }, []);
    await writeEdits((await keyless.plan({ projectDir: dir, repoRoot: dir })).edits);
    expect(await keyless.plan({ projectDir: dir, repoRoot: dir })).toMatchObject({ state: 'done', edits: [] });
  });
});

const D2_NODE_CONFIG = `import node from '@astrojs/node';
import { conlocaCloud } from '@conloca/cloud-astro';
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://www.example.com',
  adapter: node({ mode: 'standalone' }),
  integrations: [conlocaCloud({ previewBuild: { adapter: node(), outDir: 'x' } })],
});
`;
const sitesFile = `${JSON.stringify({ sites: { default: { locales: ['en'], defaultLocale: 'en', domains: { en: 'www.example.com' } } }, globalLocales: ['en'] }, null, 2)}\n`;
const D2_DOCKERFILE = 'FROM node:22\nCOPY . .\nCMD ["node", ".conloca/preview-server/server/entry.mjs"]\n';
const ORPHANED = 'open preview tabs from before this upgrade stop working; editors reopen Preview';
const ALREADY =
  'the preview mode already changed when @conloca/cloud-astro was updated: the next build serves d8, or turns preview off while previewBuild.adapter remains';

describe('the d8 migration', () => {
  const d8 = migration('d8');

  test('moves a D2 Node site: start command, dead previewBuild options and allowedDomains, without stopping the upgrade', async () => {
    dir = await makeRepo(
      { 'astro.config.mjs': D2_NODE_CONFIG, 'content/sites.json': sitesFile, Dockerfile: D2_DOCKERFILE },
      [],
    );
    const plan = await d8.plan({ projectDir: dir, repoRoot: dir });
    expect(plan.state).toBe('changed');
    const paths = plan.edits.map((edit) => relative(dir, edit.path));
    expect(paths).toHaveLength(2);
    expect(paths).toEqual(expect.arrayContaining(['Dockerfile', 'astro.config.mjs']));
    const after = (name: string) => plan.edits.find((edit) => relative(dir, edit.path) === name)?.after ?? '';
    expect(after('Dockerfile')).toContain('CMD ["node", "dist/server/entry.mjs"]');
    expect(after('astro.config.mjs')).not.toContain('outDir');
    expect(after('astro.config.mjs')).toContain('previewBuild: {}');
    expect(after('astro.config.mjs')).toContain("adapter: node({ mode: 'standalone' })");
    expect(after('astro.config.mjs')).toMatch(/allowedDomains: \[\{ hostname: ['"]www\.example\.com['"]/);
    expect(plan.message).toContain(ORPHANED);
    expect(plan.message).toContain(ALREADY);
    expect(plan.message).toContain(
      "if your host's dashboard, or any other file, starts .conloca/preview-server/server/entry.mjs, change it to dist/server/entry.mjs",
    );
  });

  test('keeps the import the site adapter still uses, even on one line with the config', async () => {
    const oneLine =
      "import node from '@astrojs/node'; import { conlocaCloud } from '@conloca/cloud-astro'; import { defineConfig } from 'astro/config'; export default defineConfig({ adapter: node({ mode: 'standalone' }), integrations: [conlocaCloud({ previewBuild: { adapter: node() } })] });\n";
    dir = await makeRepo({ 'astro.config.mjs': oneLine, 'content/sites.json': sitesFile }, []);
    const plan = await d8.plan({ projectDir: dir, repoRoot: dir });
    expect(plan.edits[0]?.after).toContain("import node from '@astrojs/node'");
  });

  test('is done once its own plan is written', async () => {
    dir = await makeRepo(
      { 'astro.config.mjs': D2_NODE_CONFIG, 'content/sites.json': sitesFile, Dockerfile: D2_DOCKERFILE },
      [],
    );
    await writeEdits((await d8.plan({ projectDir: dir, repoRoot: dir })).edits);
    expect(await d8.plan({ projectDir: dir, repoRoot: dir })).toMatchObject({ state: 'done', edits: [] });
  });

  test('changes nothing on a site without previewBuild', async () => {
    dir = await makeRepo({ 'astro.config.mjs': KEYLESS_CONFIG, Dockerfile: D2_DOCKERFILE }, []);
    const before = await treeHashes(dir);
    expect(await d8.plan({ projectDir: dir, repoRoot: dir })).toMatchObject({ state: 'done', edits: [] });
    expect(await treeHashes(dir)).toEqual(before);
  });

  test('only drops the dead options on a Cloudflare SSR site', async () => {
    const config = D2_NODE_CONFIG.replace(
      "import node from '@astrojs/node';",
      "import cloudflare from '@astrojs/cloudflare';",
    )
      .replace("adapter: node({ mode: 'standalone' })", 'adapter: cloudflare()')
      .replace("{ adapter: node(), outDir: 'x' }", '{ config: {}, required: true }');
    // A previewBuild held in a variable: nothing to read, nothing written.
    const shared = config.replace('previewBuild: { config: {}, required: true }', 'previewBuild: shared');
    const sharedDir = await makeRepo({ 'astro.config.mjs': shared }, []);
    const untouched = await d8.plan({ projectDir: sharedDir, repoRoot: sharedDir });
    await rm(sharedDir, { recursive: true, force: true });
    expect(untouched).toMatchObject({ state: 'done', edits: [] });
    dir = await makeRepo(
      { 'astro.config.mjs': config, 'content/sites.json': sitesFile, Dockerfile: D2_DOCKERFILE },
      [],
    );
    const plan = await d8.plan({ projectDir: dir, repoRoot: dir });
    expect(plan.edits.map((edit) => relative(dir, edit.path))).toEqual(['astro.config.mjs']);
    expect(plan.edits[0]?.after).toContain('previewBuild: {}');
    expect(plan.edits[0]?.after).not.toContain('allowedDomains');
  });

  for (const [name, options, files] of [
    ['D3 site', "{ outDir: 'x', required: false }", {}],
    ['D4 site', "{ separate: true, outDir: 'x' }", {}],
    [
      'D4 site on node() whose Dockerfile starts the preview server',
      "{ separate: true, outDir: 'x' }",
      { Dockerfile: D2_DOCKERFILE },
    ],
  ] as const) {
    test(`leaves a ${name} as it is`, async () => {
      const nodeSite = name.includes('node()');
      const base = nodeSite ? D2_NODE_CONFIG : D2_NODE_CONFIG.replace("  adapter: node({ mode: 'standalone' }),\n", '');
      const config = base.replace("{ adapter: node(), outDir: 'x' }", options);
      dir = await makeRepo({ 'astro.config.mjs': config, 'content/sites.json': sitesFile, ...files }, []);
      const before = await treeHashes(dir);
      const plan = await d8.plan({ projectDir: dir, repoRoot: dir });
      expect(plan).toMatchObject({ state: 'done', edits: [] });
      expect(plan.message).not.toContain('d8');
      expect(await treeHashes(dir)).toEqual(before);
    });
  }

  test('needs a person for previewBuild options it cannot edit', async () => {
    const config = D2_NODE_CONFIG.replace("{ adapter: node(), outDir: 'x' }", "makeOptions({ outDir: 'x' })");
    dir = await makeRepo({ 'astro.config.mjs': config, 'content/sites.json': sitesFile }, []);
    // A previewBuild built by a call: d8 by the site's adapter, with options the migration cannot see into.
    expect(await d8.plan({ projectDir: dir, repoRoot: dir })).toMatchObject({ state: 'needs-you', edits: [] });
  });

  test('rewrites the start command in fly.toml and the Procfile, and warns when a file still copies the preview server', async () => {
    const dockerfile =
      'FROM node:22\nCOPY .conloca/preview-server ./.conloca/preview-server\nCMD ["node", ".conloca/preview-server/server/entry.mjs"]\n';
    dir = await makeRepo(
      {
        'astro.config.mjs': D2_NODE_CONFIG,
        'content/sites.json': sitesFile,
        Dockerfile: dockerfile,
        Procfile: 'web: node .conloca/preview-server/server/entry.mjs\n',
        'fly.toml': '[processes]\napp = "node .conloca/preview-server/server/entry.mjs"\n',
      },
      [],
    );
    const plan = await d8.plan({ projectDir: dir, repoRoot: dir });
    const after = (file: string) => plan.edits.find((edit) => relative(dir, edit.path) === file)?.after ?? '';
    expect(after('Procfile')).toBe('web: node dist/server/entry.mjs\n');
    expect(after('fly.toml')).toContain('"node dist/server/entry.mjs"');
    expect(plan.message).toContain(
      'Dockerfile still names .conloca/preview-server: make sure dist/server is in the image',
    );
    expect(plan.message).toContain("if your host's dashboard, or any other file, starts");
  });

  test('leaves a D3 site whose previewBuild.config names an adapter as it is', async () => {
    const config = D2_NODE_CONFIG.replace("  adapter: node({ mode: 'standalone' }),\n", '').replace(
      "{ adapter: node(), outDir: 'x' }",
      "{ config: { adapter: 'x' }, outDir: 'x' }",
    );
    dir = await makeRepo({ 'astro.config.mjs': config }, []);
    const before = await treeHashes(dir);
    expect(await d8.plan({ projectDir: dir, repoRoot: dir })).toMatchObject({ state: 'done', edits: [] });
    expect(await treeHashes(dir)).toEqual(before);
  });

  test('drops only a top-level adapter from a separate preview deploy, and its import when nothing else uses it', async () => {
    const config = D2_NODE_CONFIG.replace(
      "import node from '@astrojs/node';",
      "import cloudflare from '@astrojs/cloudflare';\nimport node from '@astrojs/node';",
    )
      .replace("adapter: node({ mode: 'standalone' })", 'adapter: cloudflare()')
      .replace("{ adapter: node(), outDir: 'x' }", "{ separate: true, adapter: node(), outDir: 'x' }");
    dir = await makeRepo({ 'astro.config.mjs': config, Dockerfile: D2_DOCKERFILE }, []);
    const plan = await d8.plan({ projectDir: dir, repoRoot: dir });
    expect(plan.edits.map((edit) => relative(dir, edit.path))).toEqual(['astro.config.mjs']);
    const after = plan.edits[0]?.after ?? '';
    expect(after).toMatch(/previewBuild: \{\s*separate: true,\s*outDir: 'x',?\s*\}/u);
    expect(after).not.toContain('node()');
    expect(after).not.toContain("from '@astrojs/node'");
  });

  test('needs a person for a static site that ran its own D2 preview server', async () => {
    const config = D2_NODE_CONFIG.replace("  adapter: node({ mode: 'standalone' }),\n", '');
    dir = await makeRepo({ 'astro.config.mjs': config }, []);
    const plan = await d8.plan({ projectDir: dir, repoRoot: dir });
    expect(plan).toMatchObject({ state: 'needs-you', edits: [] });
    expect(plan.message).toContain(
      'a static site on its own server has no same-address preview: use previewBuild: { separate: true } (a Cloudflare preview deploy) or remove previewBuild',
    );
  });

  test('names D3 for a static site whose previewBuild.adapter is cloudflare()', async () => {
    const config = D2_NODE_CONFIG.replace("  adapter: node({ mode: 'standalone' }),\n", '')
      .replace("import node from '@astrojs/node';", "import cloudflare from '@astrojs/cloudflare';")
      .replace('adapter: node()', 'adapter: cloudflare()');
    dir = await makeRepo({ 'astro.config.mjs': config }, []);
    const plan = await d8.plan({ projectDir: dir, repoRoot: dir });
    expect(plan).toMatchObject({ state: 'needs-you', edits: [] });
    expect(plan.message).toStartWith(
      'a static site previews next to itself on Cloudflare (D3): remove previewBuild.adapter and run conloca connect',
    );
  });

  test('a Node site with no domain for allowedDomains gets the upgrade notes too', async () => {
    dir = await makeRepo({ 'astro.config.mjs': D2_NODE_CONFIG }, []);
    const plan = await d8.plan({ projectDir: dir, repoRoot: dir });
    expect(plan.state).toBe('needs-you');
    expect(plan.message).toContain(ALREADY);
  });
});
