import { join, resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { isPathWithinBase } from '../src/path-validation.js';

describe('isPathWithinBase', () => {
  // Use a realistic base directory for testing
  const base = resolve('/tmp/test-spa/dist/spa');

  test('rejects path traversal escaping base (../../etc/passwd)', () => {
    const target = resolve(base, '../../etc/passwd');
    expect(isPathWithinBase(base, target)).toBe(false);
  });

  test('allows legitimate asset path (main.js)', () => {
    const target = resolve(base, 'main.js');
    expect(isPathWithinBase(base, target)).toBe(true);
  });

  test('allows nested asset path (assets/index.css)', () => {
    const target = resolve(base, 'assets/index.css');
    expect(isPathWithinBase(base, target)).toBe(true);
  });

  test('rejects deep traversal (../../../etc/shadow)', () => {
    const target = resolve(base, '../../../etc/shadow');
    expect(isPathWithinBase(base, target)).toBe(false);
  });

  test('rejects traversal that escapes base via intermediate directory (foo/../../bar.js)', () => {
    // foo/../../bar.js resolves to ../bar.js which is outside base
    const target = resolve(base, 'foo/../../bar.js');
    expect(isPathWithinBase(base, target)).toBe(false);
  });

  test('allows path that stays inside base via intermediate traversal (foo/../bar.js)', () => {
    // foo/../bar.js resolves to bar.js which is inside base
    const target = resolve(base, 'foo/../bar.js');
    expect(isPathWithinBase(base, target)).toBe(true);
  });

  test('rejects sibling directory with shared prefix (dist/spa-admin)', () => {
    // Ensures we check basePath + sep, not just basePath prefix
    const siblingTarget = resolve('/tmp/test-spa/dist/spa-admin/evil.js');
    expect(isPathWithinBase(base, siblingTarget)).toBe(false);
  });

  test('allows exact base path match', () => {
    expect(isPathWithinBase(base, base)).toBe(true);
  });

  test('works with join-constructed paths', () => {
    const spaBase = join('/tmp/test-spa', 'dist/spa');
    const assetPath = join(spaBase, 'assets/chunk-abc123.js');
    expect(isPathWithinBase(spaBase, assetPath)).toBe(true);
  });
});
