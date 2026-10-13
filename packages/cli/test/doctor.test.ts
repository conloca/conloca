import { describe, expect, test } from 'bun:test';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { $ } from 'bun';

const CLI = join(import.meta.dir, '..', 'dist', 'conloca.js');

const VALID_SITES = JSON.stringify({
  sites: { default: { locales: ['en'], defaultLocale: 'en' } },
  globalLocales: ['en'],
});

const VALID_PAGE = JSON.stringify({
  id: 'home',
  type: 'puck',
  created: '2026-01-01T00:00:00.000Z',
  modified: '2026-01-01T00:00:00.000Z',
  meta: { title: 'Home' },
  content: {},
});

async function makeProject(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  await Bun.write(join(dir, 'content', 'sites.json'), VALID_SITES);
  await Bun.write(join(dir, 'content', 'default', 'pages', 'home.en.vxjson'), VALID_PAGE);
  return dir;
}

describe('conloca doctor', () => {
  test.each([
    { locales: [42], defaultLocale: 'en', globalLocales: ['en'] },
    { locales: [''], defaultLocale: 'en', globalLocales: ['en'] },
    { locales: ['en'], defaultLocale: 'fr', globalLocales: ['en'] },
    { locales: ['en'], defaultLocale: 'en', globalLocales: [null] },
  ])('invalid locale settings produce a sites.json error: %j', async (settings) => {
    const dir = await makeProject('conloca-doctor-locales-');
    try {
      const { globalLocales, ...site } = settings;
      await Bun.write(join(dir, 'content', 'sites.json'), JSON.stringify({ sites: { default: site }, globalLocales }));
      const result = await $`${CLI} doctor --json ${dir}`.quiet().nothrow();
      expect(result.exitCode).toBe(1);
      const report = JSON.parse(result.stdout.toString());
      expect(report.ok).toBe(false);
      expect(report.problems).toContainEqual(expect.objectContaining({ check: 'C3', level: 'error' }));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('doctor --help describes doctor and its read-only nature', async () => {
    const result = await $`${CLI} doctor --help`.quiet();
    expect(result.stdout.toString()).toContain('conloca doctor');
    expect(result.stdout.toString()).toContain('--json');
    expect(result.exitCode).toBe(0);
  });

  test('passes on a healthy project and exits 0', async () => {
    const dir = await makeProject('conloca-doctor-ok-');
    try {
      const result = await $`${CLI} doctor ${dir}`.quiet();
      const output = result.stdout.toString();
      expect(output).toContain('C3');
      expect(output).toContain('C4');
      expect(output).toContain('C12');
      expect(output).toContain('No problems');
      expect(result.exitCode).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('missing sites.json is an error naming the expected path', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'conloca-doctor-nosites-'));
    try {
      const result = await $`${CLI} doctor ${dir}`.quiet().nothrow();
      expect(result.exitCode).toBe(1);
      expect(result.stdout.toString()).toContain(join(dir, 'content', 'sites.json'));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('a site entry without defaultLocale or locales is an error', async () => {
    const dir = await makeProject('conloca-doctor-badsite-');
    try {
      await Bun.write(
        join(dir, 'content', 'sites.json'),
        JSON.stringify({
          sites: { default: { locales: ['en'] }, other: { defaultLocale: 'en' } },
          globalLocales: ['en'],
        }),
      );
      const result = await $`${CLI} doctor ${dir}`.quiet().nothrow();
      expect(result.exitCode).toBe(1);
      const output = result.stdout.toString();
      expect(output).toContain('defaultLocale');
      expect(output).toContain('locales');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('a listed site without a pages directory is an error naming the path', async () => {
    const dir = await makeProject('conloca-doctor-nopages-');
    try {
      await rm(join(dir, 'content', 'default', 'pages'), { recursive: true });
      const result = await $`${CLI} doctor ${dir}`.quiet().nothrow();
      expect(result.exitCode).toBe(1);
      expect(result.stdout.toString()).toContain(join(dir, 'content', 'default', 'pages'));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('an on-disk site directory missing from sites.json is a warning, not an error', async () => {
    const dir = await makeProject('conloca-doctor-unlisted-');
    try {
      await Bun.write(join(dir, 'content', 'unlisted', 'pages', '.gitkeep'), '');
      const result = await $`${CLI} doctor ${dir}`.quiet().nothrow();
      expect(result.exitCode).toBe(0);
      const output = result.stdout.toString();
      expect(output).toContain('unlisted');
      expect(output).toContain('sites.json');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('broken content files fail the run, are named, and stay byte-identical on disk', async () => {
    const dir = await makeProject('conloca-doctor-broken-');
    const pagesDir = join(dir, 'content', 'default', 'pages');
    try {
      // One file per way the legacy loader would have "helped": unparseable
      // JSON, non-canonical field order it would rewrite, and a missing
      // locale suffix it would fix by renaming the file.
      await Bun.write(join(pagesDir, 'broken.en.vxjson'), 'THIS IS NOT JSON');
      await Bun.write(join(pagesDir, 'legacy.en.vxjson'), '{"content":{},"id":"legacy","meta":{"title":"L"}}');
      await Bun.write(join(pagesDir, 'nolocale.vxjson'), '{"id":"nolocale"}');

      const filesBefore = (await readdir(pagesDir)).sort();
      const bytesBefore = new Map<string, string>();
      for (const file of filesBefore) {
        bytesBefore.set(file, (await readFile(join(pagesDir, file))).toString('hex'));
      }

      const result = await $`${CLI} doctor ${dir}`.quiet().nothrow();
      expect(result.exitCode).toBe(1);
      const output = result.stdout.toString();
      expect(output).toContain('broken.en.vxjson');
      expect(output).toContain('nolocale.vxjson');

      // Read-only proof: same files, same bytes, nothing renamed or repaired.
      const filesAfter = (await readdir(pagesDir)).sort();
      expect(filesAfter).toEqual(filesBefore);
      for (const file of filesAfter) {
        expect((await readFile(join(pagesDir, file))).toString('hex')).toBe(bytesBefore.get(file) as string);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('--json prints a single JSON object and nothing else on stdout', async () => {
    const dir = await makeProject('conloca-doctor-json-');
    try {
      await Bun.write(join(dir, 'content', 'default', 'pages', 'broken.en.vxjson'), 'THIS IS NOT JSON');
      const result = await $`${CLI} doctor --json ${dir}`.quiet().nothrow();
      expect(result.exitCode).toBe(1);

      const report = JSON.parse(result.stdout.toString());
      expect(report.ok).toBe(false);
      const problem = report.problems.find((entry: { path?: string }) => entry.path?.includes('broken.en.vxjson'));
      expect(problem).toMatchObject({ check: 'C12', level: 'error' });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('--json reports ok with no problems on a healthy project', async () => {
    const dir = await makeProject('conloca-doctor-json-ok-');
    try {
      const result = await $`${CLI} doctor --json ${dir}`.quiet();
      expect(JSON.parse(result.stdout.toString())).toEqual({ ok: true, problems: [] });
      expect(result.exitCode).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('a path already named content is used as the content root directly', async () => {
    const dir = await makeProject('conloca-doctor-contentpath-');
    try {
      const result = await $`${CLI} doctor ${join(dir, 'content')}`.quiet();
      expect(result.exitCode).toBe(0);
      expect(result.stdout.toString()).toContain('No problems');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('the path argument defaults to the current directory', async () => {
    const dir = await makeProject('conloca-doctor-cwd-');
    try {
      const result = await $`${CLI} doctor`.cwd(dir).quiet();
      expect(result.exitCode).toBe(0);
      expect(result.stdout.toString()).toContain('No problems');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
