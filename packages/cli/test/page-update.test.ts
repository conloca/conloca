import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SitesConfig } from '@conloca/content-api';
import { FileSystemContentAPI } from '@conloca/content-api/node';
import { $ } from 'bun';

const CLI = join(import.meta.dir, '..', 'dist', 'conloca.js');

const SITES = { sites: { default: { locales: ['en'], defaultLocale: 'en' } }, globalLocales: ['en'] };
const ABOUT_FILE = join('content', 'default', 'pages', 'about.en.vxjson');
const FIRST_CONTENT = { root: {}, content: [{ type: 'Heading', props: { id: 'Heading-1' } }], zones: {} };
const NEW_CONTENT = { root: { props: {} }, content: [{ type: 'Text', props: { id: 'Text-1' } }], zones: {} };

const dirs: string[] = [];

afterEach(async () => {
  FileSystemContentAPI.clearCaches();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function makeProject(sites: SitesConfig = SITES): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'conloca-page-update-'));
  dirs.push(dir);
  await Bun.write(join(dir, 'content', 'sites.json'), JSON.stringify(sites));
  await Bun.write(join(dir, 'first.json'), JSON.stringify(FIRST_CONTENT));
  await Bun.write(join(dir, 'new.json'), JSON.stringify(NEW_CONTENT));
  return dir;
}

/** A project holding /about, created with content and metadata; returns the page id. */
async function makeProjectWithAbout(): Promise<{ dir: string; id: string }> {
  const dir = await makeProject();
  const result =
    await $`${CLI} page create --json --site default --collection pages --pathname /about --title About --content ${join(dir, 'first.json')} --description Old --robots noindex ${dir}`.quiet();
  return { dir, id: JSON.parse(result.stdout.toString()).id };
}

async function readAbout(dir: string) {
  return JSON.parse(await readFile(join(dir, ABOUT_FILE), 'utf-8'));
}

describe('conloca page update', () => {
  test('replaces the content of the page at a pathname and keeps its metadata', async () => {
    const { dir } = await makeProjectWithAbout();
    const result = await $`${CLI} page update /about ${dir} --site default --content ${join(dir, 'new.json')}`.quiet();
    expect(result.exitCode).toBe(0);
    const page = await readAbout(dir);
    expect(page.content.puckData).toEqual(NEW_CONTENT);
    expect(page.meta).toEqual({ title: 'About', description: 'Old', robots: 'noindex' });
  });

  test('sets and clears metadata by id without touching content', async () => {
    const { dir, id } = await makeProjectWithAbout();
    const result = await $`${CLI} page update ${id} ${dir} --description New --robots ${''}`.quiet();
    expect(result.exitCode).toBe(0);
    const page = await readAbout(dir);
    expect(page.meta).toEqual({ title: 'About', description: 'New' });
    expect(page.content.puckData).toEqual(FIRST_CONTENT);
  });

  test('finds /about/ as /about', async () => {
    const { dir } = await makeProjectWithAbout();
    const result = await $`${CLI} page update /about/ ${dir} --title Renamed`.quiet();
    expect(result.exitCode).toBe(0);
    expect((await readAbout(dir)).meta.title).toBe('Renamed');
  });

  test('refuses a data entry id', async () => {
    const dir = await makeProject();
    const api = await FileSystemContentAPI.create({ contentRoot: join(dir, 'content') });
    const created = await api.createContent({
      kind: 'data',
      type: 'json',
      collection: 'bakeries',
      name: 'corner',
      locales: { en: { meta: { title: 'Corner' }, content: { data: { name: 'Corner' } } } },
    });
    const file = join(dir, 'content', 'data', 'bakeries', 'corner.en.json');
    const before = await readFile(file, 'utf-8');

    const result = await $`${CLI} page update ${created.id ?? ''} ${dir} --title X`.quiet().nothrow();
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toMatch(/is a data entry, not a page/);
    expect(await readFile(file, 'utf-8')).toBe(before);
  });

  test('refuses --content on an MDX page', async () => {
    const mdxRoot = await mkdtemp(join(tmpdir(), 'conloca-page-update-mdx-'));
    dirs.push(mdxRoot);
    const dir = await makeProject({
      sites: { default: { locales: ['en'], defaultLocale: 'en', mdxPages: mdxRoot } },
      globalLocales: ['en'],
    });
    const api = await FileSystemContentAPI.create({ contentRoot: join(dir, 'content') });
    await api.createContent({
      kind: 'page',
      type: 'mdx',
      site: 'default',
      collection: 'pages',
      locales: { en: { pathname: '/guide', meta: { title: 'Guide' }, content: { mdx: '# Guide' } } },
    });
    const file = join(mdxRoot, 'guide.mdx');
    const before = await readFile(file, 'utf-8');

    const result = await $`${CLI} page update /guide ${dir} --content ${join(dir, 'new.json')}`.quiet().nothrow();
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toMatch(/is an MDX page/);
    expect(await readFile(file, 'utf-8')).toBe(before);
  });

  test('uses the default site when --site is left out', async () => {
    const { dir } = await makeProjectWithAbout();
    const result = await $`${CLI} page update /about ${dir} --image /media/a.jpg`.quiet();
    expect(result.exitCode).toBe(0);
    expect((await readAbout(dir)).meta.ogImage).toBe('/media/a.jpg');
  });

  test('says there is no page for an unknown pathname', async () => {
    const { dir } = await makeProjectWithAbout();
    const result = await $`${CLI} page update /missing ${dir} --title X`.quiet().nothrow();
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toMatch(/no page "\/missing" in site default/);
  });

  test('refuses a call with nothing to update', async () => {
    const { dir } = await makeProjectWithAbout();
    const result = await $`${CLI} page update /about ${dir}`.quiet().nothrow();
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain('nothing to update: pass --content, --title or a metadata flag');
  });

  test('--content that is not Puck data fails naming the flag and changes nothing', async () => {
    const { dir } = await makeProjectWithAbout();
    const before = await readFile(join(dir, ABOUT_FILE), 'utf-8');
    await Bun.write(join(dir, 'bad.json'), '{"content":[]}');
    const result = await $`${CLI} page update /about ${dir} --content ${join(dir, 'bad.json')}`.quiet().nothrow();
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain('--content must be Puck data { root, content, zones }');
    expect(await readFile(join(dir, ABOUT_FILE), 'utf-8')).toBe(before);
  });

  test('--json prints ok, id and path', async () => {
    const { dir, id } = await makeProjectWithAbout();
    const result = await $`${CLI} page update --json /about --canonical https://example.com/about`.cwd(dir).quiet();
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout.toString())).toEqual({ ok: true, id, path: ABOUT_FILE });
  });
});
