import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { $ } from 'bun';

const CLI = join(import.meta.dir, '..', 'dist', 'conloca.js');

const SITE_DATA = { siteName: 'Corner Bakery', contactEmail: 'hello@example.com' };
const NEW_DATA = { siteName: 'Corner Bakery', contactEmail: 'orders@example.com' };

/** astro.config.mjs as `conloca connect` leaves a starter site, before data schemas are wired. */
const CONNECTED_CONFIG = `import react from '@astrojs/react';
import { conlocaCMS } from '@conloca/astro-cms/node';
import { conlocaCloud } from '@conloca/cloud-astro';
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://www.example.com',
  integrations: [
    react(),
    conlocaCMS({ contentRoot: './content', puckConfigPath: './src/puck.config.tsx', layout: './src/layouts/Layout.astro' }),
    conlocaCloud(),
  ],
});
`;

const CONNECTED = {
  'package.json': `${JSON.stringify({ name: 'site', dependencies: { astro: '^7.3.1' } }, null, 2)}\n`,
  'astro.config.mjs': CONNECTED_CONFIG,
  'src/content.config.ts': `import { conlocaFragments, conlocaPages } from '@conloca/astro-cms/node/content';

export const collections = {
  pages: conlocaPages(),
  ...conlocaFragments(),
};
`,
  'content/sites.json': JSON.stringify({
    sites: { default: { locales: ['en'], defaultLocale: 'en' } },
    globalLocales: ['en'],
  }),
};

const dirs: string[] = [];
/** One site made with `conloca create`, copied for every test that needs one: creating it takes seconds. */
let created = '';

beforeAll(async () => {
  created = join(await mkdtemp(join(tmpdir(), 'conloca-data-template-')), 'site');
  await $`${CLI} create --no-install --no-git ${created}`.quiet();
}, 60_000);

afterAll(async () => {
  await rm(dirname(created), { recursive: true, force: true });
});

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

/** A copy of the site made with `conloca create`, holding site.json and new.json beside it. */
async function makeCreatedSite(): Promise<string> {
  const dir = join(await tempDir('conloca-data-created-'), 'site');
  await cp(created, dir, { recursive: true });
  await writeFile(join(dir, 'site.json'), JSON.stringify(SITE_DATA));
  await writeFile(join(dir, 'new.json'), JSON.stringify(NEW_DATA));
  return dir;
}

/** A created site holding the settings entry `site`; returns its id. */
async function makeSiteWithEntry(): Promise<{ dir: string; id: string }> {
  const dir = await makeCreatedSite();
  const result =
    await $`${CLI} data create settings ${dir} --name site --data ${join(dir, 'site.json')} --json`.quiet();
  return { dir, id: JSON.parse(result.stdout.toString()).id };
}

async function makeConnectedSite(files: Record<string, string> = CONNECTED): Promise<string> {
  const dir = await tempDir('conloca-data-connected-');
  await Promise.all(
    Object.entries({ ...files, 'site.json': JSON.stringify(SITE_DATA) }).map(async ([path, text]) => {
      await mkdir(dirname(join(dir, path)), { recursive: true });
      await writeFile(join(dir, path), text);
    }),
  );
  return dir;
}

async function readEntry(dir: string, collection: string, name: string) {
  return JSON.parse(await readFile(join(dir, 'content', 'data', collection, `${name}.en.json`), 'utf-8'));
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

describe('conloca data create on a site made with conloca create', () => {
  test('writes the entry in the default locale, prints where and wires nothing', async () => {
    const dir = await makeCreatedSite();
    const result = await $`${CLI} data create settings ${dir} --name site --data ${join(dir, 'site.json')}`.quiet();
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain('✓ Created data entry settings/site');
    expect(result.stdout.toString()).toContain('site.en.json');
    // Not just 'Warning': node may print its own warnings on stderr, depending on the runner's environment.
    expect(result.stderr.toString()).not.toContain('declares no data collection');
    const entry = await readEntry(dir, 'settings', 'site');
    expect(entry.data).toEqual(SITE_DATA);
    expect(entry.meta.title).toBe('site');

    const json =
      await $`${CLI} data create settings ${dir} --name other --title Other --data ${join(dir, 'site.json')} --json`.quiet();
    const report = JSON.parse(json.stdout.toString());
    expect(report).toMatchObject({ ok: true, id: expect.stringMatching(/^vx-/) });
    expect(report.path).toEndWith(join('content', 'data', 'settings', 'other.en.json'));
    expect(report).not.toHaveProperty('wired');
    expect(report).not.toHaveProperty('command');
    expect((await readEntry(dir, 'settings', 'other')).meta.title).toBe('Other');
  });

  test('reads --data - from stdin', async () => {
    const dir = await makeCreatedSite();
    const input = Buffer.from(JSON.stringify(SITE_DATA));
    const result = await $`${CLI} data create settings ${dir} --name site --data - < ${input}`.quiet();
    expect(result.exitCode).toBe(0);
    expect((await readEntry(dir, 'settings', 'site')).data).toEqual(SITE_DATA);
  });

  test('refuses --data that is not a JSON object, writing nothing', async () => {
    const dir = await makeCreatedSite();
    await writeFile(join(dir, 'list.json'), '[1]');
    const result = await $`${CLI} data create settings ${dir} --name site --data ${join(dir, 'list.json')}`
      .quiet()
      .nothrow();
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toMatch(/--data must be a JSON object/);
    expect(await exists(join(dir, 'content', 'data', 'settings'))).toBe(false);
  });

  test('refuses a name another entry has in any letter case', async () => {
    const dir = await makeCreatedSite();
    await $`${CLI} data create settings ${dir} --name site --data ${join(dir, 'site.json')}`.quiet();
    const result = await $`${CLI} data create settings ${dir} --name Site --data ${join(dir, 'site.json')}`
      .quiet()
      .nothrow();
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toMatch(/already exists/);
  });

  test('warns when the schemas file does not declare the collection', async () => {
    const dir = await makeCreatedSite();
    const result = await $`${CLI} data create menus ${dir} --name lunch --data ${join(dir, 'site.json')}`.quiet();
    expect(result.exitCode).toBe(0);
    expect(result.stderr.toString()).toContain(
      'Warning: src/schemas/data.ts declares no data collection "menus", so the build fails on this entry.',
    );
    expect((await readEntry(dir, 'menus', 'lunch')).data).toEqual(SITE_DATA);
  });
});

describe('conloca data create on a connected site without data schemas', () => {
  test('--no-install writes the wiring, prints the install command and creates the entry', async () => {
    const dir = await makeConnectedSite();
    const result =
      await $`${CLI} data create settings ${dir} --name site --data ${join(dir, 'site.json')} --no-install --json`.quiet();
    expect(result.exitCode).toBe(0);
    const report = JSON.parse(result.stdout.toString());
    expect(report.ok).toBe(true);
    expect(report.wired).toEqual(
      expect.arrayContaining(['astro.config.mjs', 'src/content.config.ts', 'public/media/.gitkeep']),
    );
    expect(report.command).toMatch(/^npm install '@ttsc\/unplugin@/);
    expect((await readEntry(dir, 'settings', 'site')).data).toEqual(SITE_DATA);
    expect(await readFile(join(dir, 'astro.config.mjs'), 'utf-8')).toContain("schemasPath: './src/schemas/data.ts'");
  });

  test('a config it cannot edit stops before writing the entry', async () => {
    const dir = await makeConnectedSite({ ...CONNECTED, 'astro.config.mjs': 'export default makeConfig();\n' });
    const result = await $`${CLI} data create settings ${dir} --name site --data ${join(dir, 'site.json')} --no-install`
      .quiet()
      .nothrow();
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("schemasPath: './src/schemas/data.ts'");
    expect(await exists(join(dir, 'content', 'data'))).toBe(false);
  });
});

describe('conloca data update', () => {
  test('replaces the data of the entry named in its collection', async () => {
    const { dir, id } = await makeSiteWithEntry();
    const result = await $`${CLI} data update settings site ${dir} --data ${join(dir, 'new.json')} --json`.quiet();
    expect(result.exitCode).toBe(0);
    const report = JSON.parse(result.stdout.toString());
    expect(report).toMatchObject({ ok: true, id });
    expect(report.path).toEndWith(join('content', 'data', 'settings', 'site.en.json'));
    const entry = await readEntry(dir, 'settings', 'site');
    expect(entry.data).toEqual(NEW_DATA);
    expect(entry.meta.title).toBe('site');
  });

  test('finds the entry by id too', async () => {
    const { dir, id } = await makeSiteWithEntry();
    const result =
      await $`${CLI} data update settings ${id} ${dir} --data ${join(dir, 'new.json')} --title Site`.quiet();
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain(`✓ Updated data entry ${id} in settings`);
    expect(result.stdout.toString()).toContain('site.en.json');
    const entry = await readEntry(dir, 'settings', 'site');
    expect(entry.data).toEqual(NEW_DATA);
    expect(entry.meta.title).toBe('Site');
  });

  test('refuses an entry of another collection', async () => {
    const { dir, id } = await makeSiteWithEntry();
    const result = await $`${CLI} data update authors ${id} ${dir} --data ${join(dir, 'new.json')}`.quiet().nothrow();
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain(`"${id}" is not a data entry of "authors"`);
    expect((await readEntry(dir, 'settings', 'site')).data).toEqual(SITE_DATA);
  });

  test('says there is no entry for an unknown name', async () => {
    const { dir } = await makeSiteWithEntry();
    const result = await $`${CLI} data update settings nope ${dir} --data ${join(dir, 'new.json')}`.quiet().nothrow();
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain('no data entry "nope" in settings');
  });
});
