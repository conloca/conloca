import { describe, expect, test } from 'bun:test';
import type { PackageManager } from '../src/lib/package-manager.js';
import { detectPackageManager, packageManagerCommands } from '../src/lib/package-manager.js';

describe('detectPackageManager', () => {
  test('an explicit --pm wins over the user agent', () => {
    expect(detectPackageManager({ flag: 'pnpm', userAgent: 'bun/1.3.14 npm/? node/v22' })).toBe('pnpm');
  });

  test.each<[string, PackageManager]>([
    ['bun/1.3.14 npm/? node/v22.0.0', 'bun'],
    ['pnpm/9.1.0 npm/? node/v22.0.0', 'pnpm'],
    ['yarn/1.22.22 npm/? node/v22.0.0', 'yarn'],
    ['npm/10.8.0 node/v22.0.0 darwin arm64', 'npm'],
  ])('reads the package manager from the user agent %s', (userAgent, expected) => {
    expect(detectPackageManager({ userAgent })).toBe(expected);
  });

  test('falls back to npm when nothing identifies the caller', () => {
    expect(detectPackageManager({})).toBe('npm');
    expect(detectPackageManager({ userAgent: 'something/else' })).toBe('npm');
  });

  test('rejects an unknown --pm value', () => {
    expect(() => detectPackageManager({ flag: 'cargo' })).toThrow("unknown package manager 'cargo'");
  });
});

describe('packageManagerCommands', () => {
  test('knows the install, frozen install, and run forms of each manager', () => {
    expect(packageManagerCommands('bun')).toEqual({
      install: 'bun install',
      frozenInstall: 'bun install --frozen-lockfile',
      run: 'bun run',
    });
    expect(packageManagerCommands('npm')).toEqual({ install: 'npm install', frozenInstall: 'npm ci', run: 'npm run' });
    expect(packageManagerCommands('pnpm')).toEqual({
      install: 'pnpm install',
      frozenInstall: 'pnpm install --frozen-lockfile',
      run: 'pnpm run',
    });
    expect(packageManagerCommands('yarn')).toEqual({
      install: 'yarn install',
      frozenInstall: 'yarn install --frozen-lockfile',
      run: 'yarn',
    });
  });
});
