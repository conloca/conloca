// biome-ignore-all lint/suspicious/noTemplateCurlyInString: workflow text carries GitHub expressions literally
import { describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { legacyKeyFinding } from '../src/lib/legacy-key.js';

/** What `conloca create` wrote for npm while the workflow still passed the key. */
const OLD_NPM = `name: Conloca

on: [push, pull_request]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          # On a pull request, build the branch's own commit rather than GitHub's
          # temporary merge commit, so a build that reports its commit names a real one.
          ref: \${{ github.event.pull_request.head.sha || github.sha }}
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
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

const BUN_SITE = [
  'name: CI',
  'on: [push]',
  'jobs:',
  '  build:',
  '    runs-on: ubuntu-latest',
  '    steps:',
  '      - uses: actions/checkout@v4',
  '      - uses: oven-sh/setup-bun@v2',
  '      - run: bun install',
  '      - run: bunx @conloca/cli doctor',
  '        env:',
  '          CONLOCA_BUILD_TOKEN: ${{ secrets.CONLOCA_BUILD_TOKEN }}',
  '      - run: bun run build',
  '        env:',
  '          CONLOCA_BUILD_TOKEN: ${{ secrets.CONLOCA_BUILD_TOKEN }}',
  '          PUBLIC_SITE: https://example.com',
  '',
].join('\n');

describe('legacyKeyFinding', () => {
  test('deletes the key lines and the emptied env block of the old scaffold', async () => {
    const path = '.github/workflows/conloca.yml';
    const finding = legacyKeyFinding(path, OLD_NPM);
    expect(finding?.deleted).toEqual([19, 20, 21, 23, 24, 26, 27]);
    expect(finding?.manual).toEqual([]);
    expect(finding?.diff).toContain(`--- a/${path}`);
    expect(finding?.diff).toContain('-          CONLOCA_BUILD_TOKEN: ${{ secrets.CONLOCA_BUILD_TOKEN }}');

    const dir = await mkdtemp(join(tmpdir(), 'conloca-legacy-'));
    try {
      await mkdir(join(dir, '.github', 'workflows'), { recursive: true });
      await writeFile(join(dir, path), OLD_NPM);
      await writeFile(join(dir, 'fix.diff'), finding?.diff ?? '');
      execFileSync('git', ['init', '-q'], { cwd: dir });
      execFileSync('git', ['apply', 'fix.diff'], { cwd: dir });
      const expected = Bun.YAML.parse(OLD_NPM.replaceAll(/        env:\n          CONLOCA_BUILD_TOKEN:[^\n]*\n/g, ''));
      const migrated = await readFile(join(dir, path), 'utf8');
      expect(Bun.YAML.parse(migrated)).toEqual(expected);
      expect(legacyKeyFinding(path, migrated)).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('keeps an env block that still holds another variable', () => {
    expect(legacyKeyFinding('.github/workflows/conloca.yml', BUN_SITE)?.deleted).toEqual([11, 12, 15]);
  });

  test('leaves a key referenced outside env for the person', () => {
    const inline =
      'jobs:\n  b:\n    steps:\n      - run: CONLOCA_BUILD_TOKEN=${{ secrets.CONLOCA_BUILD_TOKEN }} npm run build\n';
    expect(legacyKeyFinding('ci.yml', inline)).toEqual({ path: 'ci.yml', deleted: [], manual: [4], diff: null });
  });

  test('leaves the key for the person where deleting its line alone would break the workflow', () => {
    const listItemEnv = [
      'jobs:',
      '  b:',
      '    steps:',
      '      - env:',
      '          CONLOCA_BUILD_TOKEN: ${{ secrets.CONLOCA_BUILD_TOKEN }}',
      '        run: npm run build',
      '',
    ].join('\n');
    expect(legacyKeyFinding('ci.yml', listItemEnv)).toEqual({ path: 'ci.yml', deleted: [], manual: [5], diff: null });
    const foldedValue = [
      'env:',
      '  CONLOCA_BUILD_TOKEN: >-',
      '    ${{ secrets.CONLOCA_BUILD_TOKEN }}',
      '  OTHER: x',
      '',
    ].join('\n');
    expect(legacyKeyFinding('ci.yml', foldedValue)).toEqual({
      path: 'ci.yml',
      deleted: [],
      manual: [2, 3],
      diff: null,
    });
  });

  test('returns null when the workflow never names the key', () => {
    expect(legacyKeyFinding('ci.yml', 'name: CI\n')).toBeNull();
  });
});
