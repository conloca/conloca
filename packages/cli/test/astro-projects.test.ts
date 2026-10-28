import { describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { listAstroProjects } from '../src/lib/astro-projects.js';

const CMS_CONFIG = `import { conlocaCMS } from '@conloca/astro-cms/node';
// conlocaCloud() is not called here.
export default { integrations: [conlocaCMS({ contentRoot: './content' })] };
`;
const PLAIN_CONFIG = `import { defineConfig } from 'astro/config';
export default defineConfig({});
`;

/** A git repository holding `files`, the `tracked` ones added to the index. */
async function inRepo<T>(
  files: Record<string, string>,
  tracked: string[],
  work: (root: string) => Promise<T>,
): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), 'conloca-astro-projects-'));
  try {
    await Promise.all(
      Object.entries(files).map(async ([path, text]) => {
        await mkdir(dirname(join(root, path)), { recursive: true });
        await writeFile(join(root, path), text);
      }),
    );
    execFileSync('git', ['init', '-q'], { cwd: root });
    if (tracked.length > 0) execFileSync('git', ['add', ...tracked], { cwd: root });
    return await work(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe('listAstroProjects', () => {
  test('lists every tracked astro config outside node_modules with what it calls', async () => {
    const files = {
      'site/astro.config.mjs': CMS_CONFIG,
      'other/astro.config.ts': PLAIN_CONFIG,
      'node_modules/x/astro.config.mjs': CMS_CONFIG,
    };
    const projects = await inRepo(files, ['-f', ...Object.keys(files)], listAstroProjects);
    expect(projects).toEqual([
      { dir: 'other', configFile: 'other/astro.config.ts', hasCms: false, hasEditorIntegration: false },
      { dir: 'site', configFile: 'site/astro.config.mjs', hasCms: true, hasEditorIntegration: false },
    ]);
  });

  test('includes an untracked config git would add', async () => {
    const projects = await inRepo(
      { 'astro.config.mjs': CMS_CONFIG, 'ignored/astro.config.mjs': CMS_CONFIG, '.gitignore': 'ignored/\n' },
      [],
      listAstroProjects,
    );
    expect(projects).toEqual([{ dir: '.', configFile: 'astro.config.mjs', hasCms: true, hasEditorIntegration: false }]);
  });
});
