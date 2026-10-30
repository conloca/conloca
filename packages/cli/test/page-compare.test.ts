import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  compareOutputs,
  isComparedOutputFile,
  normalizeOutput,
  pageFacts,
  routeOfOutputFile,
  sitemapLocations,
} from '../src/lib/page-compare.js';

const PRICING_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Pricing</title>
<meta name="description" content="Plans and prices">
<link rel="canonical" href="https://example.com/pricing">
<link rel="stylesheet" href="/_astro/index.Ab12Cd_9.css">
<script type="application/ld+json">{ "@type": "Product",  "name": "Pro" }</script>
<script type="module" src="/_astro/page.Xy34Zw_1.js"></script>
</head>
<body>
<header><a href="/"><img src="/logo.svg" alt=""></a></header>
<main>
<h1><a href="/pricing">Pricing</a></h1>
<p>Pro plan <strong>€49</strong></p>
<a href="https://example.com/book"><img src="/team.jpg" alt="Team photo"></a>
</main>
<script>console.log('hi')</script>
<style>main { color: red }</style>
</body>
</html>`;

function page(body: string, head = '<title>Home</title>'): string {
  return `<!doctype html><html lang="en"><head>${head}<link rel="stylesheet" href="/_astro/index.Ab12Cd_9.css"></head><body>${body}</body></html>`;
}

function island(props: string): string {
  return page(`<astro-island uid="a1" component-url="/_astro/Card.Ab12Cd_9.js" props="${props}"></astro-island>`);
}

async function writeTree(dir: string, files: Record<string, string>): Promise<void> {
  await Promise.all(Object.entries(files).map(([path, text]) => Bun.write(join(dir, path), text)));
}

test('maps directory and file build formats to the same route', () => {
  expect(['index.html', 'about/index.html', 'about.html', 'rss.xml'].map(routeOfOutputFile)).toEqual([
    '/',
    '/about',
    '/about',
    '/rss.xml',
  ]);
  expect(isComparedOutputFile('_astro/x.js')).toBe(false);
  expect(isComparedOutputFile('_conloca/editor/index.html')).toBe(false);
  expect(isComparedOutputFile('about/index.html')).toBe(true);
});

test('normalises hashed asset names, timestamps and island ids', () => {
  expect(
    normalizeOutput(
      '<link href="/_astro/index.Ab12Cd_9.css"><time>2026-10-30T12:00:00.000Z</time><astro-island uid="Z1x">',
    ),
  ).toBe('<link href="/_astro/index.css"><time><time></time><astro-island uid="">');
});

test('reads a sitemap as a sorted set of locations', () => {
  expect(
    sitemapLocations(
      '<urlset><url><loc>https://x/b</loc><lastmod>2026-10-30</lastmod></url><url><loc>https://x/a</loc></url></urlset>',
    ),
  ).toEqual(['https://x/a', 'https://x/b']);
});

test('reads text with alt texts, links in order, head tags and status', () => {
  const facts = pageFacts(PRICING_HTML);
  expect(facts.status).toBe('page');
  expect(facts.text).toBe('Pricing Pro plan €49 Team photo');
  expect(facts.links).toEqual(['/', '/pricing', 'https://example.com/book']);
  expect(facts.head).toContain('link href=https://example.com/pricing rel=canonical');
  expect(facts.head).toContain('script type=application/ld+json {"@type":"Product","name":"Pro"}');
  expect(facts.head.some((tag) => tag.includes('/_astro/'))).toBe(false);
  expect(pageFacts('<meta http-equiv="refresh" content="0;url=/new">').status).toBe('redirect /new');
});

describe('compareOutputs', () => {
  let baselineDir: string;
  let currentDir: string;

  beforeEach(async () => {
    baselineDir = await mkdtemp(join(tmpdir(), 'conloca-compare-baseline-'));
    currentDir = await mkdtemp(join(tmpdir(), 'conloca-compare-current-'));
    await Bun.write(join(baselineDir, '_astro', 'index.Ab12Cd_9.css'), 'h1{color:red}');
  });

  afterEach(async () => {
    await rm(baselineDir, { recursive: true, force: true });
    await rm(currentDir, { recursive: true, force: true });
  });

  const compareWith = (convertedRoutes: string[] = []) =>
    compareOutputs({ baselineDir, currentDir, convertedRoutes: new Set(convertedRoutes) });

  test('an untouched route that only re-hashed is identical', async () => {
    await writeTree(baselineDir, {
      'index.html': page('<h1>Hello</h1><script src="/_astro/app.Ab12Cd_9.js"></script>'),
    });
    await writeTree(currentDir, {
      'index.html': page('<h1>Hello</h1><script src="/_astro/app.Zz98Yy_7.js"></script>').replaceAll(
        'Ab12Cd_9',
        'Qq11Ww_2',
      ),
      '_astro/index.Qq11Ww_2.css': 'h1{color:red}',
    });
    expect(await compareWith()).toEqual({
      routes: [{ route: '/', kind: 'untouched', differences: [], allowed: [] }],
      missing: [],
      added: [],
    });
  });

  test('an untouched route with changed text differs', async () => {
    await writeTree(baselineDir, { 'index.html': page('<h1>Hello there</h1>') });
    await writeTree(currentDir, {
      'index.html': page('<h1>Howdy there</h1>'),
      '_astro/index.Ab12Cd_9.css': 'h1{color:red}',
    });
    const [route] = (await compareWith()).routes;
    expect(route?.differences[0]).toContain('Howdy');
  });

  test('an untouched route whose linked stylesheet content changed differs', async () => {
    await writeTree(baselineDir, { 'index.html': page('<h1>Hello</h1>') });
    await writeTree(currentDir, {
      'index.html': page('<h1>Hello</h1>'),
      '_astro/index.Ab12Cd_9.css': 'h1{color:blue}',
    });
    const [route] = (await compareWith()).routes;
    expect(route?.differences).toHaveLength(1);
    expect(route?.differences[0]).toContain('stylesheet /_astro/');
  });

  test('an untouched route whose only change is island props passes with an allowed change', async () => {
    await writeTree(baselineDir, { 'index.html': island('{&quot;title&quot;:[0,&quot;Hi&quot;]}') });
    await writeTree(currentDir, {
      'index.html': island('{&quot;card&quot;:[0,{&quot;title&quot;:[0,&quot;Hi&quot;]}]}'),
      '_astro/index.Ab12Cd_9.css': 'h1{color:red}',
    });
    const [route] = (await compareWith()).routes;
    expect(route?.differences).toEqual([]);
    expect(route?.allowed[0]).toContain('island props');
  });

  test('a sitemap with reordered entries and new lastmod is identical', async () => {
    await writeTree(baselineDir, {
      'sitemap-0.xml':
        '<urlset><url><loc>https://x/a</loc><lastmod>2026-10-01</lastmod></url><url><loc>https://x/b</loc></url></urlset>',
    });
    await writeTree(currentDir, {
      'sitemap-0.xml':
        '<urlset><url><loc>https://x/b</loc></url><url><loc>https://x/a</loc><lastmod>2026-10-30</lastmod></url></urlset>',
    });
    const [route] = (await compareWith()).routes;
    expect(route).toEqual({ route: '/sitemap-0.xml', kind: 'untouched', differences: [], allowed: [] });
  });

  test('a converted route with new markup and the same facts passes', async () => {
    const head = '<title>Pricing</title><meta name="description" content="Plans">';
    await writeTree(baselineDir, { 'pricing/index.html': page('<h1>Pricing</h1><a href="/book">Book</a>', head) });
    await writeTree(currentDir, {
      'pricing/index.html': page(
        '<div class="puck"><div><h1 class="x">Pricing</h1></div><div><a class="btn" href="/book">Book</a></div></div>',
        head,
      ).replace('index.Ab12Cd_9.css', 'Page.Zz98Yy_7.css'),
    });
    const [route] = (await compareWith(['/pricing'])).routes;
    expect(route).toEqual({ route: '/pricing', kind: 'converted', differences: [], allowed: [] });
  });

  test('a converted route that lost its description differs in head', async () => {
    await writeTree(baselineDir, {
      'pricing/index.html': page('<h1>Pricing</h1>', '<title>Pricing</title><meta name="description" content="Plans">'),
    });
    await writeTree(currentDir, { 'pricing/index.html': page('<h1>Pricing</h1>', '<title>Pricing</title>') });
    const [route] = (await compareWith(['/pricing'])).routes;
    expect(route?.differences).toHaveLength(1);
    expect(route?.differences[0]).toStartWith('head');
    expect(route?.differences[0]).toContain('content=Plans name=description');
  });

  test('reports missing and added routes', async () => {
    await writeTree(baselineDir, { 'old.html': page('<h1>Old</h1>') });
    await writeTree(currentDir, { 'new/index.html': page('<h1>New</h1>') });
    const result = await compareWith();
    expect(result.missing).toEqual(['/old']);
    expect(result.added).toEqual(['/new']);
    expect(result.routes).toEqual([]);
  });
});
