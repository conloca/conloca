import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const PACKAGE_DIR = dirname(Bun.resolveSync('@conloca/cloud-astro/package.json', import.meta.dir));

/** The workflow `conloca create` wrote while the build key was there. */
export const OLD_WORKFLOW = `name: Conloca
on: [push, pull_request]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      # Slot for a build integration that is not part of this scaffold; nothing reads
      # this secret until you add one. Given to doctor and the build only, never to
      # dependency install scripts.
      - run: npm run doctor
        env:
          CONLOCA_BUILD_TOKEN: \${{ secrets.CONLOCA_BUILD_TOKEN }}
      - run: npm run build
        env:
          CONLOCA_BUILD_TOKEN: \${{ secrets.CONLOCA_BUILD_TOKEN }}
`;

/**
 * A git checkout with a GitHub origin holding `files`; `installAt` folders get @conloca/cloud-astro installed. The
 * caller removes the returned folder.
 */
export async function makeRepo(files: Record<string, string>, installAt: string[] = ['.']): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'conloca-connect-'));
  const all = { '.gitignore': 'node_modules/\ndist/\n', ...files };
  await Promise.all(
    Object.entries(all).map(async ([path, text]) => {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), text);
    }),
  );
  await Promise.all(
    installAt.map(async (dir) => {
      await mkdir(join(root, dir, 'node_modules', '@conloca'), { recursive: true });
      await symlink(PACKAGE_DIR, join(root, dir, 'node_modules', '@conloca', 'cloud-astro'), 'dir');
    }),
  );
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['remote', 'add', 'origin', 'https://github.com/o/r.git'], { cwd: root });
  return root;
}

/** Every file outside .git and node_modules with the hash of its bytes. */
export async function treeHashes(dir: string): Promise<Record<string, string>> {
  const files = (await readdir(dir, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name).slice(dir.length + 1))
    .filter((path) => !path.split('/').some((part) => part === '.git' || part === 'node_modules'));
  const hashes = await Promise.all(
    files.map(async (path) => [
      path,
      createHash('sha256')
        .update(await readFile(join(dir, path)))
        .digest('hex'),
    ]),
  );
  return Object.fromEntries(hashes);
}
