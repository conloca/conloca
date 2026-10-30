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

describe('migrationsSince', () => {
  test('runs the keyless step for a 0.2.1 site and skips it for a 0.2.3 site', () => {
    expect(migrationsSince('0.2.1').map((m) => m.id)).toEqual(['keyless', 'data-schemas']);
    expect(migrationsSince('0.2.3').map((m) => m.id)).toEqual(['data-schemas']);
  });

  test('runs the 0.2.4 step for a site on a 0.2.4 prerelease', () => {
    expect(migrationsSince('0.2.4-next.0').map((m) => m.id)).toEqual(['data-schemas']);
  });

  test('needs none when the site is on the newest migration release', () => {
    expect(migrationsSince('0.2.4')).toEqual([]);
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
