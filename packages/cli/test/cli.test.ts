import { describe, expect, test } from 'bun:test';
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { $ } from 'bun';

describe('Conloca CLI', () => {
  test('shows help when no arguments provided', async () => {
    const result = await $`./dist/conloca.js`.cwd(`${import.meta.dir}/..`).quiet();
    expect(result.stdout.toString()).toContain('Usage: conloca <command> [options]');
    expect(result.stdout.toString()).toContain('doctor');
    expect(result.exitCode).toBe(0);
  });

  test('shows help with --help flag', async () => {
    const result = await $`./dist/conloca.js --help`.cwd(`${import.meta.dir}/..`).quiet();
    expect(result.stdout.toString()).toContain('Usage: conloca <command> [options]');
    expect(result.exitCode).toBe(0);
  });

  test('errors on unknown command', async () => {
    const result = await $`./dist/conloca.js unknown`
      .cwd(`${import.meta.dir}/..`)
      .quiet()
      .nothrow();
    expect(result.stderr.toString()).toContain("unknown command 'unknown'");
    expect(result.exitCode).toBe(1);
  });

  test('init command requires directory argument', async () => {
    const result = await $`./dist/conloca.js init`
      .cwd(`${import.meta.dir}/..`)
      .quiet()
      .nothrow();
    expect(result.stderr.toString()).toContain("missing required argument 'directory'");
    expect(result.exitCode).toBe(1);
  });

  test('init command requires site name argument', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'conloca-cli-init-nosite-test-'));
    try {
      const result = await $`./dist/conloca.js init ${tempDir}`
        .cwd(`${import.meta.dir}/..`)
        .quiet()
        .nothrow();
      expect(result.stderr.toString()).toContain("missing required argument 'site'");
      expect(result.exitCode).toBe(1);
    } finally {
      await rm(tempDir, { recursive: true });
    }
  });

  test('init command creates content structure with custom site name', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'conloca-cli-init-custom-test-'));
    try {
      const result = await $`./dist/conloca.js init ${tempDir} mysite`.cwd(`${import.meta.dir}/..`).quiet();
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

  test('astro setup tells the user which options to add', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'conloca-setup-'));
    try {
      const result = await $`./dist/conloca.js astro setup ${dir}`
        .cwd(`${import.meta.dir}/..`)
        .quiet()
        .nothrow();

      const output = result.stdout.toString();
      expect(output).toContain('puckConfigPath');
      expect(output).toContain('./src/puck.config.tsx');
      expect(output).toContain('schemasPath');
      expect(output).toContain('./src/schemas/data.ts');
      expect(output).toContain('content.config.ts');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('astro setup prints a content config that declares every collection', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'conloca-setup-collections-'));
    try {
      const result = await $`./dist/conloca.js astro setup ${dir}`
        .cwd(`${import.meta.dir}/..`)
        .quiet()
        .nothrow();

      expect(result.exitCode).toBe(0);
      const output = result.stdout.toString();

      // The specifier the snippet imports from is the line most likely to rot:
      // the factories live behind the node-only subpath, not the package root.
      expect(output).toContain("from '@conloca/astro-cms/node/content'");

      // Content the config does not declare fails the build, so the printed
      // snippet has to cover all three kinds: pages, the data collections the
      // generated schemas file declares, and the fragments aggregate the
      // renderer reads.
      expect(output).toContain('pages: conlocaPages()');
      expect(output).toContain('...conlocaData({ dataSchemas })');
      expect(output).toContain('...conlocaFragments()');

      // The printed import must resolve to the schemas file setup itself wrote,
      // relative to the src/content.config.ts the user is told to create.
      expect(output).toContain("import { dataSchemas } from './schemas/data';");
      expect(await readFile(join(dir, 'src', 'schemas', 'data.ts'), 'utf-8')).toContain('export const dataSchemas');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('astro setup writes the page layout the layout option names', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'conloca-setup-layout-'));
    try {
      const result = await $`./dist/conloca.js astro setup ${dir}`
        .cwd(`${import.meta.dir}/..`)
        .quiet()
        .nothrow();

      // Without this file the layout option has nothing to point at, and content
      // pages render with no <html>, <head> or styles — silently.
      const layout = await readFile(join(dir, 'src', 'layouts', 'Layout.astro'), 'utf-8');
      expect(layout).toContain('interface Props');
      expect(layout).toContain('const { title, description } = Astro.props;');
      expect(layout).toContain('<slot />');

      // The printed config must name the file setup just wrote.
      expect(result.stdout.toString()).toContain("layout: './src/layouts/Layout.astro'");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('the generated Puck layout does not share a name with the page layout', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'conloca-setup-puck-layout-'));
    try {
      await $`./dist/conloca.js astro setup ${dir}`
        .cwd(`${import.meta.dir}/..`)
        .quiet()
        .nothrow();

      const puckLayout = await readFile(join(dir, 'src', 'components', 'ComponentLayout.tsx'), 'utf-8');
      expect(puckLayout).toContain('export { ComponentLayout }');
      expect(await stat(join(dir, 'src', 'components', 'Layout.tsx')).catch(() => null)).toBeNull();

      // A single missed import here ships a scaffold that will not compile.
      const entries = await readdir(join(dir, 'src'), { recursive: true, withFileTypes: true });
      const sources = entries.filter((entry) => entry.isFile());
      expect(sources.length).toBeGreaterThan(0);
      for (const entry of sources) {
        const source = await readFile(join(entry.parentPath, entry.name), 'utf-8');
        expect(source).not.toContain("from '../Layout'");
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('astro setup writes the sites.json the CMS needs to build collections', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'conloca-setup-sites-'));
    try {
      const result = await $`./dist/conloca.js astro setup ${dir}`
        .cwd(`${import.meta.dir}/..`)
        .quiet()
        .nothrow();

      const sitesConfig = JSON.parse(await readFile(join(dir, 'content', 'sites.json'), 'utf-8'));
      expect(sitesConfig).toEqual({
        sites: {
          default: {
            locales: ['en', 'nl', 'de', 'fr'],
            defaultLocale: 'en',
          },
        },
        globalLocales: ['en', 'nl', 'de', 'fr'],
      });

      // init is now for the second site, not a step the first one depends on.
      expect(result.stdout.toString()).not.toContain('conloca init . <site-name>` to create content directory');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('astro setup leaves an existing sites.json alone', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'conloca-setup-sites-existing-'));
    try {
      await Bun.write(
        join(dir, 'content', 'sites.json'),
        JSON.stringify({ sites: { default: { locales: ['en'], defaultLocale: 'en' } }, globalLocales: ['en'] }),
      );

      await $`./dist/conloca.js astro setup ${dir}`
        .cwd(`${import.meta.dir}/..`)
        .quiet()
        .nothrow();

      const sitesConfig = JSON.parse(await readFile(join(dir, 'content', 'sites.json'), 'utf-8'));
      expect(sitesConfig).toEqual({
        sites: { default: { locales: ['en'], defaultLocale: 'en' } },
        globalLocales: ['en'],
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // The agent skill scaffolded by `astro setup` tells its readers to run
  // `conloca doctor` to verify the result, so setup must leave a project doctor
  // calls clean. C4 is the check at stake: setup registers the default site in
  // sites.json, and C4 wants that site's pages directory on disk.
  test('doctor finds no problem in a project astro setup just scaffolded', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'conloca-setup-doctor-'));
    try {
      const setupResult = await $`./dist/conloca.js astro setup ${dir}`
        .cwd(`${import.meta.dir}/..`)
        .quiet()
        .nothrow();
      expect(setupResult.exitCode).toBe(0);

      const doctorResult = await $`./dist/conloca.js doctor ${dir} --json`
        .cwd(`${import.meta.dir}/..`)
        .quiet()
        .nothrow();

      const report = JSON.parse(doctorResult.stdout.toString());
      expect(report.problems).toEqual([]);
      expect(report.ok).toBe(true);
      expect(doctorResult.exitCode).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('init --help describes init, not the global usage', async () => {
    const result = await $`./dist/conloca.js init --help`.cwd(`${import.meta.dir}/..`).quiet();
    expect(result.stdout.toString()).toContain('conloca init');
    expect(result.stdout.toString()).not.toContain('Usage: conloca <command> [options]');
    expect(result.exitCode).toBe(0);
  });

  test('init does not double the content segment', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'conloca-init-'));
    try {
      await $`./dist/conloca.js init ${join(dir, 'content')} mysite`.cwd(`${import.meta.dir}/..`).quiet();
      const doubled = await stat(join(dir, 'content', 'content')).catch(() => null);
      expect(doubled).toBeNull();
      const pages = await stat(join(dir, 'content', 'mysite', 'pages'));
      expect(pages.isDirectory()).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('the advertised --site flag is gone, since nothing read it', async () => {
    const result = await $`./dist/conloca.js --help`.cwd(`${import.meta.dir}/..`).quiet();
    expect(result.stdout.toString()).not.toContain('--site');
  });

  test('the retired verify command is gone', async () => {
    const result = await $`./dist/conloca.js verify /tmp`
      .cwd(`${import.meta.dir}/..`)
      .quiet()
      .nothrow();
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("unknown command 'verify'");
  });
});
