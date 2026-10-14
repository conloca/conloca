import { describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { $ } from 'bun';

const CLI = join(import.meta.dir, '..', 'dist', 'conloca.js');

const VALID_SITES = JSON.stringify({
  sites: { default: { locales: ['en'], defaultLocale: 'en' } },
  globalLocales: ['en'],
});
const NO_SITES = JSON.stringify({ sites: {}, globalLocales: ['en'] });

async function makeProject(prefix: string, sites = VALID_SITES): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  await Bun.write(join(dir, 'content', 'sites.json'), sites);
  await Bun.write(join(dir, 'content', 'default', 'pages', '.gitkeep'), '');
  return dir;
}

describe('conloca page create', () => {
  test('--json reports invalid site configuration when API initialization throws', async () => {
    const dir = await makeProject('conloca-page-create-invalid-locales-');
    try {
      await Bun.write(
        join(dir, 'content', 'sites.json'),
        JSON.stringify({ sites: { default: { locales: 42, defaultLocale: 'en' } }, globalLocales: ['en'] }),
      );
      const result =
        await $`${CLI} page create --json --site default --collection pages --pathname /about --title About ${dir}`
          .quiet()
          .nothrow();
      expect(result.exitCode).toBe(1);
      const report = JSON.parse(result.stdout.toString());
      expect(report.ok).toBe(false);
      expect(report.error).toBeString();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('--json reports malformed sites.json as one error object', async () => {
    const dir = await makeProject('conloca-page-create-broken-sites-');
    try {
      await Bun.write(join(dir, 'content', 'sites.json'), '{broken');
      const result =
        await $`${CLI} page create --json --site default --collection pages --pathname /about --title About ${dir}`
          .quiet()
          .nothrow();
      expect(result.exitCode).toBe(1);
      const report = JSON.parse(result.stdout.toString());
      expect(report.ok).toBe(false);
      expect(report.error).toContain('sites.json');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('--json reports a filesystem failure as one error object', async () => {
    const dir = await makeProject('conloca-page-create-blocked-');
    try {
      await rm(join(dir, 'content', 'default', 'pages'), { recursive: true });
      await Bun.write(join(dir, 'content', 'default', 'pages'), 'not a directory');
      const result =
        await $`${CLI} page create --json --site default --collection pages --pathname /about --title About ${dir}`
          .quiet()
          .nothrow();
      expect(result.exitCode).toBe(1);
      const report = JSON.parse(result.stdout.toString());
      expect(report.ok).toBe(false);
      expect(report.error).toBeString();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('page create --help describes the command and its options', async () => {
    const result = await $`${CLI} page create --help`.quiet();
    const output = result.stdout.toString();
    expect(output).toContain('conloca page create');
    expect(output).toContain('--site');
    expect(output).toContain('--collection');
    expect(output).toContain('--pathname');
    expect(output).toContain('--title');
    expect(output).toContain('--json');
    expect(result.exitCode).toBe(0);
  });

  test('creates a page the indexer accepts and doctor passes afterwards', async () => {
    const dir = await makeProject('conloca-page-create-ok-');
    try {
      const result =
        await $`${CLI} page create --site default --collection pages --pathname /about --title ${'About Us'} ${dir}`.quiet();
      expect(result.exitCode).toBe(0);

      const filePath = join(dir, 'content', 'default', 'pages', 'about.en.vxjson');
      const output = result.stdout.toString();
      expect(output).toContain('about.en.vxjson');
      expect(output).toContain('vx-');
      expect(output).toContain('editable in the CMS');

      const parsed = JSON.parse(await readFile(filePath, 'utf-8'));
      expect(parsed.meta.title).toBe('About Us');
      expect(parsed.type).toBe('puck');
      expect(parsed.id).toMatch(/^vx-[A-Za-z0-9_-]{8}$/);
      // The canonical empty Puck payload the CMS itself writes for a new page.
      expect(parsed.content.puckData).toEqual({ root: {}, content: [], zones: {} });

      // Pathname round-trip: the created file indexes cleanly (doctor C12).
      const doctorResult = await $`${CLI} doctor ${dir}`.quiet();
      expect(doctorResult.exitCode).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('creates the collection directory when it does not exist yet', async () => {
    const dir = await makeProject('conloca-page-create-newcoll-');
    try {
      const result =
        await $`${CLI} page create --site default --collection landing --pathname /launch --title Launch ${dir}`.quiet();
      expect(result.exitCode).toBe(0);
      const created = await stat(join(dir, 'content', 'default', 'landing', 'launch.en.vxjson'));
      expect(created.isFile()).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('a second create at the same pathname fails with exit 1', async () => {
    const dir = await makeProject('conloca-page-create-dup-');
    try {
      await $`${CLI} page create --site default --collection pages --pathname /about --title About ${dir}`.quiet();
      const result =
        await $`${CLI} page create --site default --collection pages --pathname /about --title About ${dir}`
          .quiet()
          .nothrow();
      expect(result.exitCode).toBe(1);
      expect(result.stderr.toString()).toContain('already exists');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('a pathname without a leading slash is rejected', async () => {
    const dir = await makeProject('conloca-page-create-badpath-');
    try {
      const result = await $`${CLI} page create --site default --collection pages --pathname about --title About ${dir}`
        .quiet()
        .nothrow();
      expect(result.exitCode).toBe(1);
      expect(result.stderr.toString()).toContain("must start with '/'");
      const created = await stat(join(dir, 'content', 'default', 'pages', 'about.en.vxjson')).catch(() => null);
      expect(created).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('an unknown site fails naming the sites that do exist', async () => {
    const dir = await makeProject('conloca-page-create-nosite-');
    try {
      const result =
        await $`${CLI} page create --site missing --collection pages --pathname /about --title About ${dir}`
          .quiet()
          .nothrow();
      expect(result.exitCode).toBe(1);
      const stderr = result.stderr.toString();
      expect(stderr).toContain('missing');
      expect(stderr).toContain('default');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("an empty sites.json points at the 'conloca init' that fixes it", async () => {
    const dir = await makeProject('conloca-page-create-nosites-', NO_SITES);
    try {
      const result = await $`${CLI} page create --site default --collection pages --pathname /x --title X ${dir}`
        .quiet()
        .nothrow();
      expect(result.exitCode).toBe(1);
      const stderr = result.stderr.toString();
      expect(stderr).toContain("run 'conloca init");
      expect(stderr).toContain('default');

      const jsonResult =
        await $`${CLI} page create --json --site default --collection pages --pathname /x --title X ${dir}`
          .quiet()
          .nothrow();
      expect(jsonResult.exitCode).toBe(1);
      const report = JSON.parse(jsonResult.stdout.toString());
      expect(report.ok).toBe(false);
      expect(report.error).toContain('conloca init');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('a missing required option is a commander error', async () => {
    const dir = await makeProject('conloca-page-create-noopt-');
    try {
      const result = await $`${CLI} page create --site default --collection pages --pathname /about ${dir}`
        .quiet()
        .nothrow();
      expect(result.exitCode).toBe(1);
      expect(result.stderr.toString()).toContain("required option '--title <title>' not specified");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('--json success prints one object with ok, id and the cwd-relative path', async () => {
    const dir = await makeProject('conloca-page-create-json-');
    try {
      const result =
        await $`${CLI} page create --json --site default --collection pages --pathname /about --title About`
          .cwd(dir)
          .quiet();
      expect(result.exitCode).toBe(0);

      const report = JSON.parse(result.stdout.toString());
      expect(report.ok).toBe(true);
      expect(report.id).toMatch(/^vx-[A-Za-z0-9_-]{8}$/);
      expect(report.path).toBe(join('content', 'default', 'pages', 'about.en.vxjson'));
      const created = await stat(join(dir, report.path));
      expect(created.isFile()).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('--json failure prints one object with ok false and the offending field', async () => {
    const dir = await makeProject('conloca-page-create-json-fail-');
    try {
      const result =
        await $`${CLI} page create --json --site default --collection pages --pathname about --title About ${dir}`
          .quiet()
          .nothrow();
      expect(result.exitCode).toBe(1);

      const report = JSON.parse(result.stdout.toString());
      expect(report.ok).toBe(false);
      expect(report.error).toContain("must start with '/'");
      expect(report.field).toBe('pathname');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('--json unknown-site failure carries the site field', async () => {
    const dir = await makeProject('conloca-page-create-json-site-');
    try {
      const result =
        await $`${CLI} page create --json --site missing --collection pages --pathname /about --title About ${dir}`
          .quiet()
          .nothrow();
      expect(result.exitCode).toBe(1);

      const report = JSON.parse(result.stdout.toString());
      expect(report.ok).toBe(false);
      expect(report.error).toContain('default');
      expect(report.field).toBe('site');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

/**
 * A content config whose `collections` object is `entries`, importing the
 * factories the way the README writes them and site modules the cases use.
 */
function contentConfig(entries: string): string {
  return `import { conlocaFragments, conlocaPages } from '@conloca/astro-cms/node/content';
import { defineCollection } from 'astro:content';
import { blog, blogCollection, blogPages, extraCollections } from './collections';
import { docsLoader, options, pageSchemas } from './schemas';

export const collections = {
${entries}
};
`;
}

/**
 * The build fails on content in a page collection the content config does
 * not declare. page create reads the config as text, never running it, and
 * warns only when the text plainly leaves the collection out.
 */
describe('conloca page create — a collection the content config does not declare', () => {
  async function createBlogPage(config: string | null, json: boolean) {
    const dir = await makeProject('conloca-page-create-undeclared-');
    try {
      if (config !== null) await Bun.write(join(dir, 'src', 'content.config.ts'), config);
      const flags = json ? ['--json'] : [];
      const result =
        await $`${CLI} page create ${flags} --site default --collection blog --pathname /blog/hello --title Hello ${dir}`
          .quiet()
          .nothrow();
      const created = await stat(join(dir, 'content', 'default', 'blog', 'blog', 'hello.en.vxjson')).catch(() => null);
      return { result, created };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  test.each([
    ['declares only the default pages collection', contentConfig('  pages: conlocaPages({ pageSchemas }),')],
    [
      'declares other page collections',
      contentConfig("  pages: conlocaPages(),\n  landing: conlocaPages({ collection: 'landing' }),"),
    ],
    [
      'declares the collection only in a comment',
      contentConfig("  pages: conlocaPages(),\n  // blog: conlocaPages({ collection: 'blog' }),"),
    ],
    [
      'also declares a collection of its own',
      contentConfig(
        "  pages: conlocaPages(),\n  docs: defineCollection({ loader: docsLoader() }),\n  ...conlocaFragments('general'),",
      ),
    ],
  ])('--json still creates the page and carries a warning when the config %s', async (_label, config) => {
    const { result, created } = await createBlogPage(config, true);
    expect(result.exitCode).toBe(0);
    expect(created?.isFile()).toBe(true);
    const report = JSON.parse(result.stdout.toString());
    expect(report.ok).toBe(true);
    expect(report.warnings).toHaveLength(1);
    expect(report.warnings[0]).toContain('"blog"');
    expect(report.warnings[0]).toContain("conlocaPages({ collection: 'blog' })");
    expect(result.stderr.toString()).toContain(`Warning: ${report.warnings[0]}`);
  });

  test('without --json the warning goes to stderr and the page is still created', async () => {
    const { result, created } = await createBlogPage(contentConfig('  pages: conlocaPages(),'), false);
    expect(result.exitCode).toBe(0);
    expect(created?.isFile()).toBe(true);
    expect(result.stderr.toString()).toContain("conlocaPages({ collection: 'blog' })");
    expect(result.stdout.toString()).not.toContain('conlocaPages');
  });

  test.each([
    ['declares it', contentConfig("  pages: conlocaPages(),\n  blog: conlocaPages({ collection: 'blog' }),")],
    ['names it with a variable', contentConfig('  blog: conlocaPages({ collection: options.name }),')],
    ['names it with a shorthand', contentConfig('  blog: conlocaPages({ collection }),')],
    ['spreads options into the call', contentConfig('  blog: conlocaPages({ ...options }),')],
    ['passes options as a variable', contentConfig('  blog: conlocaPages(options),')],
    [
      'imports the factory under another name',
      contentConfig('  pages: conlocaPages(),\n  blog: pagesOf(options),').replace(
        'conlocaPages }',
        'conlocaPages, conlocaPages as pagesOf }',
      ),
    ],
    ['discovers its collections', 'export const { collections } = await createConlocaCollections();\n'],
    // A collection made in another file is declared when the build imports that file.
    [
      'takes a collection from another file',
      contentConfig('  pages: conlocaPages(),\n  blog,\n  ...conlocaFragments(),'),
    ],
    ['names a collection from another file', contentConfig('  pages: conlocaPages(),\n  blog: blogCollection,')],
    ['spreads collections from another file', contentConfig('  pages: conlocaPages(),\n  ...extraCollections,')],
    ['builds a collection with a helper', contentConfig('  pages: conlocaPages(),\n  blog: blogPages(),')],
    [
      'builds the collections object some other way',
      "import { conlocaPages } from '@conloca/astro-cms/node/content';\nimport { extraCollections } from './collections';\n\nexport const collections = Object.assign({ pages: conlocaPages() }, extraCollections);\n",
    ],
    ['never calls conlocaPages', contentConfig('  ...conlocaFragments(),')],
    ['does not exist', null],
  ])('--json carries no warning when the config %s', async (_label, config) => {
    const { result, created } = await createBlogPage(config, true);
    expect(result.exitCode).toBe(0);
    expect(created?.isFile()).toBe(true);
    const report = JSON.parse(result.stdout.toString());
    expect(report.ok).toBe(true);
    expect(report.warnings).toBeUndefined();
  });
});
