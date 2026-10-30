import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { $ } from 'bun';

const CLI = join(import.meta.dir, '..', 'dist', 'conloca.js');

const SITES = JSON.stringify({ sites: { default: { locales: ['en'], defaultLocale: 'en' } }, globalLocales: ['en'] });

function pageFile(id: string): string {
  return JSON.stringify({
    id,
    type: 'puck',
    created: '2026-01-01T00:00:00.000Z',
    modified: '2026-01-01T00:00:00.000Z',
    meta: { title: id },
    content: {},
  });
}

function astroConfig(extra = ''): string {
  return `import { defineConfig } from 'astro/config';\n\nexport default defineConfig({${extra}});\n`;
}

describe('conloca routes', () => {
  let dir: string;
  let emptyDir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'conloca-routes-'));
    emptyDir = await mkdtemp(join(tmpdir(), 'conloca-routes-empty-'));
    await Bun.write(join(dir, 'content', 'sites.json'), SITES);
    await Bun.write(join(dir, 'content', 'default', 'pages', 'pricing.en.vxjson'), pageFile('pricing'));
    await Bun.write(join(dir, 'content', 'default', 'pages', 'about.en.vxjson'), pageFile('about'));
    await Bun.write(join(dir, 'astro.config.mjs'), astroConfig());
    await Bun.write(join(dir, 'src', 'pages', 'index.astro'), '<h1>Home</h1>\n');
    await Bun.write(join(dir, 'src', 'pages', 'pricing.astro'), '<h1>Pricing</h1>\n');
    await Bun.write(join(dir, 'src', 'pages', 'blog', '[slug].astro'), '<h1>Post</h1>\n');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
    await rm(emptyDir, { recursive: true, force: true });
  });

  test('--json lists file routes and Conloca pages, marking the hidden one', async () => {
    const report = JSON.parse((await $`${CLI} routes --json ${dir}`.quiet()).stdout.toString());
    expect(report).toEqual({
      ok: true,
      site: 'default',
      routes: [
        { route: '/', file: 'src/pages/index.astro', prerendered: true },
        { route: '/about', pageId: 'about' },
        { route: '/pricing', file: 'src/pages/pricing.astro', prerendered: true, pageId: 'pricing', hidden: true },
      ],
    });
  });

  test('prints one line per route and names the hiding file', async () => {
    const out = (await $`${CLI} routes ${dir}`.quiet()).stdout.toString();
    expect(out).toContain('/pricing');
    expect(out).toContain('src/pages/pricing.astro hides Conloca page pricing');
  });

  test('fails without an astro config', async () => {
    const result = await $`${CLI} routes ${emptyDir}`.quiet().nothrow();
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain('astro.config');
  });

  test('leaves out folders of Astro i18n locales that sites.json does not declare', async () => {
    await Bun.write(
      join(dir, 'astro.config.mjs'),
      astroConfig(` i18n: { defaultLocale: 'en', locales: ['en', 'de'] } `),
    );
    await Bun.write(join(dir, 'src', 'pages', 'de', 'preise.astro'), '<h1>Preise</h1>\n');
    const report = JSON.parse((await $`${CLI} routes --json ${dir}`.quiet()).stdout.toString());
    expect(report.routes.map((r: { route: string }) => r.route)).not.toContain('/de/preise');
  });

  test('reads an astro.config.mts', async () => {
    await rename(join(dir, 'astro.config.mjs'), join(dir, 'astro.config.mts'));
    expect((await $`${CLI} routes --json ${dir}`.quiet().nothrow()).exitCode).toBe(0);
  });
});
