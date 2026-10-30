import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { $ } from 'bun';
import type { RouteResult } from '../src/lib/page-compare.js';

const CLI = join(import.meta.dir, '..', 'dist', 'conloca.js');

const SITES = JSON.stringify({ sites: { default: { locales: ['en'], defaultLocale: 'en' } }, globalLocales: ['en'] });

const PRICING = '<h1>Pricing</h1>\n<p>Pro plan €49</p>\n<a href="/book">Book</a>';

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

function sourcePage(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><title>${title}</title></head><body>${body}</body></html>\n`;
}

/** Writes every page into `out` with a fresh asset hash and build time, as a real build does. */
function buildScript(out = 'dist'): string {
  return `import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
const hash = Math.random().toString(36).slice(2, 10).padEnd(8, '0');
const stamp = new Date().toISOString();
for (const name of ['index', 'pricing', 'about']) {
  const html = readFileSync('pages-src/' + name + '.html', 'utf8')
    .replace('</head>', '<script type="module" src="/_astro/app.' + hash + '.js"></script></head>')
    .replace('</body>', '<footer>Built ' + stamp + '</footer></body>');
  const file = name === 'index' ? '${out}/index.html' : '${out}/' + name + '/index.html';
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, html);
}
mkdirSync('${out}/_astro', { recursive: true });
writeFileSync('${out}/_astro/app.' + hash + '.js', '');
`;
}

async function run(dir: string, ...args: string[]) {
  const result = await $`${CLI} compare ${dir} ${args}`.quiet().nothrow();
  return { exitCode: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
}

async function report(dir: string) {
  const result = await run(dir, '--json');
  return JSON.parse(result.stdout);
}

describe('conloca compare', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'conloca-compare-'));
    await Bun.write(join(dir, 'bun.lock'), '');
    await Bun.write(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'site', private: true, scripts: { build: 'bun build-site.mjs' } }),
    );
    await Bun.write(join(dir, 'build-site.mjs'), buildScript());
    await Bun.write(join(dir, 'pages-src', 'index.html'), sourcePage('Home', '<h1>Hello there</h1>'));
    await Bun.write(join(dir, 'pages-src', 'pricing.html'), sourcePage('Pricing', PRICING));
    await Bun.write(join(dir, 'pages-src', 'about.html'), sourcePage('About', '<h1>About us</h1>'));
    await Bun.write(join(dir, 'content', 'sites.json'), SITES);
    await Bun.write(
      join(dir, 'astro.config.mjs'),
      "import { defineConfig } from 'astro/config';\n\nexport default defineConfig({});\n",
    );
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test('the first run saves a baseline and an unchanged rebuild passes', async () => {
    const first = await run(dir, '--routes', '/pricing');
    expect(first.exitCode).toBe(0);
    expect(first.stdout).toContain('Saved the baseline (3 routes from dist; chosen: /pricing)');
    const second = await run(dir, '--json');
    expect(second.exitCode).toBe(0);
    expect(JSON.parse(second.stdout)).toMatchObject({
      ok: true,
      baseline: 'compared',
      chosenRoutes: ['/pricing'],
      missing: [],
      unchosen: [],
      hidden: [],
    });
  });

  test('a changed untouched route fails and names it', async () => {
    expect((await run(dir)).exitCode).toBe(0);
    await Bun.write(join(dir, 'pages-src', 'index.html'), sourcePage('Home', '<h1>Hello world</h1>'));
    const result = await report(dir);
    expect(result.ok).toBe(false);
    expect(result.routes.find((r: RouteResult) => r.route === '/').differences).not.toEqual([]);
  });

  test('a chosen route converted with new markup and the same facts passes', async () => {
    expect((await run(dir, '--routes', '/pricing')).exitCode).toBe(0);
    await Bun.write(join(dir, 'content', 'default', 'pages', 'pricing.en.vxjson'), pageFile('pricing'));
    await Bun.write(
      join(dir, 'pages-src', 'pricing.html'),
      sourcePage('Pricing', `<div class="puck"><div>${PRICING}</div></div>`),
    );
    const result = await report(dir);
    expect(result.ok).toBe(true);
    expect(result.routes.find((r: RouteResult) => r.route === '/pricing').kind).toBe('converted');
  });

  test('a route that became a Conloca page without being chosen fails', async () => {
    expect((await run(dir, '--routes', '/pricing')).exitCode).toBe(0);
    await Bun.write(join(dir, 'content', 'default', 'pages', 'about.en.vxjson'), pageFile('about'));
    const result = await report(dir);
    expect(result.ok).toBe(false);
    expect(result.unchosen).toEqual(['/about became a Conloca page but was not chosen']);
  });

  test('--routes with a baseline present asks for --reset', async () => {
    expect((await run(dir)).exitCode).toBe(0);
    const result = await run(dir, '--routes', '/about');
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('--reset');
  });

  test('--reset saves a new baseline with the new routes', async () => {
    expect((await run(dir)).exitCode).toBe(0);
    expect((await run(dir, '--reset', '--routes', '/about')).exitCode).toBe(0);
    expect((await report(dir)).chosenRoutes).toEqual(['/about']);
  });

  test('a Conloca page still hidden behind its src/pages file fails', async () => {
    expect((await run(dir, '--routes', '/pricing')).exitCode).toBe(0);
    await Bun.write(join(dir, 'content', 'default', 'pages', 'pricing.en.vxjson'), pageFile('pricing'));
    await Bun.write(join(dir, 'src', 'pages', 'pricing.astro'), '<h1>Pricing</h1>\n');
    const result = await report(dir);
    expect(result.ok).toBe(false);
    expect(result.hidden[0]).toContain('src/pages/pricing.astro');
  });

  describe('with a Conloca page already hidden at baseline', () => {
    beforeEach(async () => {
      await Bun.write(join(dir, 'content', 'default', 'pages', 'pricing.en.vxjson'), pageFile('pricing'));
      await Bun.write(join(dir, 'src', 'pages', 'pricing.astro'), '<h1>Pricing</h1>\n');
    });

    test('choosing it and deleting the hiding file converts the route', async () => {
      expect((await run(dir, '--routes', '/pricing')).exitCode).toBe(0);
      await unlink(join(dir, 'src', 'pages', 'pricing.astro'));
      const result = await report(dir);
      expect(result).toMatchObject({ ok: true, unchosen: [], hidden: [] });
      expect(result.routes.find((r: RouteResult) => r.route === '/pricing').kind).toBe('converted');
    });

    test('leaving it unchosen and untouched passes', async () => {
      expect((await run(dir)).exitCode).toBe(0);
      expect(await report(dir)).toMatchObject({ ok: true, unchosen: [], hidden: [] });
    });
  });

  test('a failing build saves no baseline', async () => {
    await Bun.write(join(dir, 'build-site.mjs'), 'process.exit(1);\n');
    const result = await run(dir);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('bun run build failed; fix the build');
    expect(existsSync(join(dir, 'node_modules', '.cache', 'conloca-compare'))).toBe(false);
  });

  test('a build that leaves dist untouched fails instead of comparing old output', async () => {
    expect((await run(dir)).exitCode).toBe(0);
    await Bun.write(join(dir, 'build-site.mjs'), buildScript('out'));
    const result = await run(dir);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('no fresh HTML');
  });

  test('picks dist/client when the build writes it', async () => {
    await Bun.write(join(dir, 'build-site.mjs'), buildScript('dist/client'));
    const first = await run(dir);
    expect(first.exitCode).toBe(0);
    expect(first.stdout).toContain('3 routes from dist/client');
    expect((await run(dir)).exitCode).toBe(0);
  });
});
