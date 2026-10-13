import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { packageVersion } from '../package-version.js';

describe('packageVersion', () => {
  it('reads the version of this package from its own package.json', () => {
    const pkg = JSON.parse(readFileSync(join(import.meta.dir, '..', '..', 'package.json'), 'utf8')) as {
      version: string;
    };
    expect(packageVersion()).toBe(pkg.version);
    expect(packageVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });

  describe('in a copy running outside the package', () => {
    let dir: string;
    beforeEach(async () => {
      dir = await mkdtemp(join(tmpdir(), 'package-version-'));
      for (const file of ['package-version.ts', 'constants.ts']) {
        await copyFile(join(import.meta.dir, '..', file), join(dir, file));
      }
    });
    afterEach(async () => {
      await rm(dir, { recursive: true, force: true });
    });

    async function copiedPackageVersion(): Promise<string | undefined> {
      const copy = (await import(join(dir, 'package-version.ts'))) as typeof import('../package-version.js');
      return copy.packageVersion();
    }

    it('is undefined, not an error, when the package cannot be found', async () => {
      expect(await copiedPackageVersion()).toBeUndefined();
    });

    it('is undefined when the package.json it finds has no version string', async () => {
      const pkgDir = join(dir, 'node_modules', '@conloca', 'cloud-astro');
      await mkdir(pkgDir, { recursive: true });
      await writeFile(
        join(pkgDir, 'package.json'),
        JSON.stringify({ name: '@conloca/cloud-astro', version: 1, exports: { './package.json': './package.json' } }),
      );
      expect(await copiedPackageVersion()).toBeUndefined();
    });
  });
});
