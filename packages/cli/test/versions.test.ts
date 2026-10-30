import { describe, expect, test } from 'bun:test';
import { compareVersions, conlocaDependencies, versionFloor } from '../src/lib/versions.js';

describe('compareVersions', () => {
  test('orders releases and prereleases by semver', () => {
    expect(compareVersions('0.2.3', '0.2.4')).toBeLessThan(0);
    expect(compareVersions('0.2.4-next.0', '0.2.4')).toBeLessThan(0);
    expect(compareVersions('0.2.4-next.10', '0.2.4-next.9')).toBeGreaterThan(0);
    expect(compareVersions('0.10.0', '0.9.9')).toBeGreaterThan(0);
    expect(compareVersions('0.2.4', '0.2.4')).toBe(0);
  });
});

describe('versionFloor', () => {
  test('reads the version a range starts from', () => {
    expect(versionFloor('^0.2.1')).toBe('0.2.1');
    expect(versionFloor('~0.2.4-next.0')).toBe('0.2.4-next.0');
    expect(versionFloor('>=0.2.0 <0.3.0')).toBe('0.2.0');
  });

  test('has no floor for a tag', () => {
    expect(versionFloor('latest')).toBeNull();
    expect(versionFloor('*')).toBeNull();
  });
});

describe('conlocaDependencies', () => {
  test('lists every Conloca entry with the section it sits in', () => {
    const manifest = {
      dependencies: { '@conloca/astro-cms': '^0.2.1', astro: '^7.3.1' },
      devDependencies: { '@conloca/cli': '0.2.1' },
    };
    expect(conlocaDependencies(manifest)).toEqual([
      { section: 'dependencies', name: '@conloca/astro-cms', spec: '^0.2.1' },
      { section: 'devDependencies', name: '@conloca/cli', spec: '0.2.1' },
    ]);
  });
});
