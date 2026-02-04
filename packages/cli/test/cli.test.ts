import { describe, expect, test } from 'bun:test';
import { $ } from 'bun';
import { mkdtemp, readFile, rm, stat } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

describe('Conloca CLI', () => {
  test('shows help when no arguments provided', async () => {
    const result = await $`./dist/conloca.js`.cwd(import.meta.dir + '/..').quiet();
    expect(result.stdout.toString()).toContain('Usage: conloca <command> [options]');
    expect(result.stdout.toString()).toContain('verify <directory>');
    expect(result.exitCode).toBe(0);
  });

  test('shows help with --help flag', async () => {
    const result = await $`./dist/conloca.js --help`.cwd(import.meta.dir + '/..').quiet();
    expect(result.stdout.toString()).toContain('Usage: conloca <command> [options]');
    expect(result.exitCode).toBe(0);
  });

  test('errors on unknown command', async () => {
    const result = await $`./dist/conloca.js unknown`
      .cwd(import.meta.dir + '/..')
      .quiet()
      .nothrow();
    expect(result.stderr.toString()).toContain("Unknown command 'unknown'");
    expect(result.exitCode).toBe(1);
  });

  test('verify command requires directory argument', async () => {
    const result = await $`./dist/conloca.js verify`
      .cwd(import.meta.dir + '/..')
      .quiet()
      .nothrow();
    expect(result.stderr.toString()).toContain('verify command requires a directory argument');
    expect(result.exitCode).toBe(1);
  });

  test('verify command errors on non-existent directory', async () => {
    const result = await $`./dist/conloca.js verify /does/not/exist`
      .cwd(import.meta.dir + '/..')
      .quiet()
      .nothrow();
    expect(result.stderr.toString()).toContain('Directory not found');
    expect(result.exitCode).toBe(1);
  });

  test('verify command works on empty directory', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'conloca-cli-test-'));
    try {
      const result = await $`./dist/conloca.js verify ${tempDir}`.cwd(import.meta.dir + '/..').quiet();
      expect(result.stdout.toString()).toContain('Content verification successful');
      expect(result.stdout.toString()).toContain('Verified 0 content items');
      expect(result.exitCode).toBe(0);
    } finally {
      await rm(tempDir, { recursive: true });
    }
  });

  test('init command requires directory argument', async () => {
    const result = await $`./dist/conloca.js init`
      .cwd(import.meta.dir + '/..')
      .quiet()
      .nothrow();
    expect(result.stderr.toString()).toContain('init command requires a directory argument');
    expect(result.exitCode).toBe(1);
  });

  test('init command requires site name argument', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'conloca-cli-init-nosite-test-'));
    try {
      const result = await $`./dist/conloca.js init ${tempDir}`
        .cwd(import.meta.dir + '/..')
        .quiet()
        .nothrow();
      expect(result.stderr.toString()).toContain('init command requires a site name argument');
      expect(result.exitCode).toBe(1);
    } finally {
      await rm(tempDir, { recursive: true });
    }
  });

  test('init command creates content structure with custom site name', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'conloca-cli-init-custom-test-'));
    try {
      const result = await $`./dist/conloca.js init ${tempDir} mysite`.cwd(import.meta.dir + '/..').quiet();
      expect(result.stdout.toString()).toContain("Initialized Conloca content structure for site 'mysite'");
      expect(result.exitCode).toBe(0);

      // Check that directories were created with custom site name
      const mysitePagesDir = await stat(join(tempDir, 'content', 'mysite', 'pages'));
      expect(mysitePagesDir.isDirectory()).toBe(true);

      // Check that sites.json contains the custom site
      const sitesJson = await readFile(join(tempDir, 'content', 'sites.json'), 'utf-8');
      const sitesConfig = JSON.parse(sitesJson);
      expect(sitesConfig).toEqual({
        sites: {
          mysite: {
            locales: ['en', 'nl', 'de', 'fr'],
            defaultLocale: 'en',
          },
        },
        globalLocales: ['en', 'nl', 'de', 'fr'],
      });
    } finally {
      await rm(tempDir, { recursive: true });
    }
  });
});
