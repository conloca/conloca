import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
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
});
