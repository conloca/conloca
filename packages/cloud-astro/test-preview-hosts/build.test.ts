import { beforeAll, describe, expect, it } from 'bun:test';
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { gzipSync } from 'node:zlib';
import { snapshotTree } from '../test-editor-build/fixture-site.js';
import { type Adapter, type BuiltFixture, buildFixture, isServerShape, SHAPES, type Shape } from './fixtures.js';

/** One adapter per run (`CONLOCA_FIXTURE_ADAPTER`): each Nx target builds one adapter's fixtures. */
const ADAPTERS = ['vercel', 'netlify', 'node', 'cloudflare'] as const;
const named = ADAPTERS.find((adapter) => adapter === process.env.CONLOCA_FIXTURE_ADAPTER);
if (named === undefined) throw new Error(`set CONLOCA_FIXTURE_ADAPTER to one of ${ADAPTERS.join(', ')}`);
const ADAPTER: Adapter = named;

const PREFIX = '/_conloca/preview/[...path]';
const SUITE_TIMEOUT = 600_000;
const BUILDS_AT_ONCE = 4;

/** The fixtures only this adapter has, beside the shared shapes. */
const EXTRA = {
  vercel: ['static-404', 'isr', 'isr-excluded', 'edge', 'nosite'],
  netlify: ['edge', 'static-cache', 'nosite'],
  node: [],
  cloudflare: ['static-routed'],
} satisfies Record<Adapter, Shape[]>;
const extra: readonly Shape[] = EXTRA[ADAPTER];
const REFUSED = new Set<Shape>(['isr', 'edge']);
/** Built twice without preview, too: the paths where those two agree are the ones a preview build must not change. */
const EDGE: Shape[] = ADAPTER === 'vercel' || ADAPTER === 'netlify' ? ['edge'] : [];
/** Where a d8 build also publishes the original of the CMS layout's image (`<adapter> <shape>`). */
const ORIGINAL_ADDED = new Set(
  (['node', 'vercel'] as const).flatMap((adapter) =>
    ['static', 'static-base', 'server', 'server-i18n'].map((shape) => `${adapter} ${shape}`),
  ),
);

const key = (shape: Shape, preview: boolean, copy = '') => `${shape}:${preview}${copy}`;
const built = new Map<string, BuiltFixture>();
const fixture = (shape: Shape, preview: boolean, copy = '') => {
  const found = built.get(key(shape, preview, copy));
  if (found === undefined) throw new Error(`${ADAPTER}-${shape} (${preview ? 'preview' : 'plain'}${copy}) not built`);
  return found;
};

/** Every file under `dir`, relative, skipping `node_modules`. */
function files(dir: string, root = dir): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === 'node_modules') return [];
    return statSync(path).isDirectory() ? files(path, root) : [relative(root, path)];
  });
}

/** A JSON file the build wrote; each caller annotates the shape the adapter documents. */
const readJson = (path: string) => JSON.parse(readFileSync(path, 'utf8'));

/** Where the adapter puts the files a host serves as they are. */
function clientDir(dir: string): string {
  if (ADAPTER === 'vercel') return join(dir, '.vercel/output/static');
  return existsSync(join(dir, 'dist/client')) ? join(dir, 'dist/client') : join(dir, 'dist');
}

/** The deployable server: the function folder, or Node's and Cloudflare's server build. */
function functionDir(dir: string): string {
  return join(
    dir,
    {
      vercel: '.vercel/output/functions/_render.func',
      netlify: '.netlify/v1/functions',
      node: 'dist/server',
      cloudflare: 'dist/server',
    }[ADAPTER],
  );
}

interface ManifestRoute {
  route: string;
  component: string;
  prerender: boolean;
  pattern: string;
}

/** Every `"routeData":{…}` object in the server bundle, brace-matched and parsed; Astro's default 404 when bundled. */
function manifestRoutes(dir: string): ManifestRoute[] {
  const server = join(
    dir,
    ADAPTER === 'netlify'
      ? '.netlify/build'
      : ADAPTER === 'vercel'
        ? '.vercel/output/functions/_render.func'
        : 'dist/server',
  );
  const seen = new Map<string, ManifestRoute>();
  let default404 = false;
  for (const file of files(server)) {
    if (!/\.m?js$/u.test(file)) continue;
    const text = readFileSync(join(server, file), 'utf8');
    default404 ||= text.includes('"astro-default-404.astro"');
    for (let at = text.indexOf('"routeData":{'); at !== -1; at = text.indexOf('"routeData":{', at + 1)) {
      const start = text.indexOf('{', at);
      let depth = 0;
      let inString = false;
      let end = start;
      for (; end < text.length; end++) {
        const c = text[end];
        if (inString) {
          if (c === '\\') end++;
          else if (c === '"') inString = false;
        } else if (c === '"') inString = true;
        else if (c === '{') depth++;
        else if (c === '}' && --depth === 0) break;
      }
      const data: ManifestRoute = JSON.parse(text.slice(start, end + 1));
      seen.set(`${data.route} ${data.component}`, data);
    }
  }
  // Astro adds its default /404 to the app at runtime, with no routeData in the manifest.
  if (default404 && ![...seen.values()].some((r) => r.route === '/404')) {
    seen.set('/404', {
      route: '/404',
      component: 'astro-default-404.astro',
      prerender: false,
      pattern: '^\\/404\\/?$',
    });
  }
  return [...seen.values()];
}

interface VercelRoute {
  src?: string;
  dest?: string;
  status?: number;
}
function vercelRoutes(dir: string): VercelRoute[] {
  const config: { routes: VercelRoute[] } = readJson(join(dir, '.vercel/output/config.json'));
  return config.routes;
}

/** The routes the deploy sends to the function, as Astro routes; any route under the preview prefix as the prefix. */
function functionRoutes(dir: string): string[] {
  const manifest = manifestRoutes(dir);
  const routes =
    ADAPTER === 'vercel'
      ? vercelRoutes(dir)
          .filter(
            (r) =>
              r.src !== undefined &&
              r.dest !== undefined &&
              existsSync(join(dir, '.vercel/output/functions', `${r.dest}.func`)),
          )
          .map((r) => manifest.find((m) => m.pattern.replaceAll('\\/', '/') === r.src)?.route ?? `raw:${r.src}`)
      : manifest.filter((r) => !r.prerender).map((r) => r.route);
  return [...new Set(routes.map((route) => (route.includes('/_conloca/preview') ? PREFIX : route)))];
}

function previewMode(dir: string): string {
  const config: { preview: { mode: string } } = readJson(
    join(clientDir(dir), ...(fixtureBase(dir) ? ['docs'] : []), '_conloca/editor/conloca.json'),
  );
  return config.preview.mode;
}
/** Cloudflare writes a based site under `<client>/<base>/`. */
const fixtureBase = (dir: string) => ADAPTER === 'cloudflare' && existsSync(join(clientDir(dir), 'docs/_conloca'));

/**
 * Every file under `dir`, `node_modules` included: what the host deploys. Once each: the recursive listing also walks
 * the function's package symlinks (Bun's isolated layout), which the host deploys as links, not copies.
 */
const deployedFiles = (dir: string) => [
  ...new Set(
    readdirSync(dir, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => realpathSync(join(entry.parentPath, entry.name))),
  ),
];

beforeAll(async () => {
  const jobs: [Shape, boolean, string][] = [
    ...[...SHAPES, ...extra].flatMap((shape): [Shape, boolean, string][] => [
      [shape, true, ''],
      [shape, false, ''],
    ]),
    ...EDGE.map((shape): [Shape, boolean, string] => [shape, false, '-again']),
  ];
  let next = 0;
  await Promise.all(
    Array.from({ length: BUILDS_AT_ONCE }, async () => {
      for (let job = jobs[next++]; job !== undefined; job = jobs[next++]) {
        const [shape, preview, copy] = job;
        // oxlint-disable-next-line no-await-in-loop -- each worker builds one fixture at a time.
        built.set(key(shape, preview, copy), await buildFixture(ADAPTER, shape, { preview, copy }));
      }
    }),
  );
}, SUITE_TIMEOUT);

describe(`${ADAPTER}: d8 fixture builds`, () => {
  for (const shape of SHAPES) {
    it(`${shape}: the function reaches the prefix and nothing prerendered`, () => {
      const preview = fixture(shape, true).dir;
      const plain = fixture(shape, false).dir;
      const prerendered = new Set(
        manifestRoutes(preview)
          .filter((r) => r.prerender)
          .map((r) => r.route),
      );
      const reachable = functionRoutes(preview);
      expect(reachable.filter((route) => prerendered.has(route))).toEqual([]);
      const before = new Set(functionRoutes(plain));
      const added = reachable.filter((route) => !before.has(route));
      // A static site gains Astro's island route and its default 404; Vercel's misses go to /404.html instead, and
      // Node's and Netlify's static builds already ship a function holding both.
      const ownFunction = ADAPTER === 'node' || ADAPTER === 'netlify';
      if (ownFunction) expect([...before]).toEqual(expect.arrayContaining(['/_server-islands/[name]', '/404']));
      const expected =
        shape === 'hybrid' || isServerShape(shape) || ownFunction
          ? [PREFIX]
          : ['/_server-islands/[name]', PREFIX, ...(ADAPTER === 'vercel' ? [] : ['/404'])];
      expect(new Set(added)).toEqual(new Set(expected));
      // Moved under the prefix on a static site; the hybrid site's own endpoint stays in both builds.
      expect(reachable.includes('/_image')).toBe(
        shape === 'hybrid' || isServerShape(shape) ? before.has('/_image') : false,
      );
    });

    it(`${shape}: changes no published byte but the handler's scripts and the editor's lists`, () => {
      const allowed = new RegExp(
        `(^|/)(_astro/preview-page-handler[^/]*|_conloca/editor/conloca\\.json${ADAPTER === 'cloudflare' ? '|_conloca/editor/site-pages\\.json' : ''})$`,
        'u',
      );
      const now = clientDir(fixture(shape, true).dir);
      const base = clientDir(fixture(shape, false).dir);
      const a = new Set(files(now));
      const b = new Set(files(base));
      const diffs = [...new Set([...a, ...b])]
        .filter((f) => !f.includes('_conloca/preview'))
        .filter((f) => !a.has(f) || !b.has(f) || !readFileSync(join(now, f)).equals(readFileSync(join(base, f))))
        .filter((f) => !(a.has(f) && allowed.test(f)))
        // A static Cloudflare build is an assets-only deploy, its config beside the assets; d8 makes it a Worker.
        .filter((f) => !(ADAPTER === 'cloudflare' && !a.has(f) && /^(docs\/)?wrangler\.json$/u.test(f)))
        // Added only, on the node and vercel shapes where it happens: the original of the layout's image, which a
        // draft renders on demand and its image URL names.
        .filter(
          (f) =>
            !(
              ORIGINAL_ADDED.has(`${ADAPTER} ${shape}`) &&
              a.has(f) &&
              !b.has(f) &&
              /(^|\/)_astro\/dot\.[^/.]+\.png$/u.test(f)
            ),
        );
      expect(diffs).toEqual([]);
    });
  }

  it('lists the site pages beside the server entry', () => {
    const shapes = [...SHAPES, ...extra.filter((shape) => !REFUSED.has(shape))];
    for (const shape of shapes) {
      const dir = fixture(shape, true).dir;
      const lists =
        ADAPTER === 'node'
          ? [join(dir, 'dist/server/site-pages.json')]
          : ADAPTER === 'cloudflare'
            ? [join(clientDir(dir), ...(fixtureBase(dir) ? ['docs'] : []), '_conloca/editor/site-pages.json')]
            : files(functionDir(dir))
                .filter((file) => file.endsWith('/entry.mjs') || file === 'entry.mjs')
                .map((file) => join(functionDir(dir), file.replace(/entry\.mjs$/u, 'site-pages.json')));
      expect(lists.length, shape).toBeGreaterThan(0);
      for (const list of lists) {
        const { pages }: { pages: string[] } = readJson(list);
        const base = shape === 'static-base' ? '/docs' : '';
        expect(pages, `${shape} ${list}`).toContain(`${base}/contact`);
        // The CMS pages, `/` and `/about`, are drafts: never in the list.
        expect(pages, `${shape} ${list}`).not.toContain(`${base}/about`);
        expect(pages, `${shape} ${list}`).not.toContain(base || '/');
      }
    }
  });

  it('keeps the function small', () => {
    const limit = { vercel: 60e6, netlify: 40e6, node: 5e6, cloudflare: 3e6 }[ADAPTER];
    for (const shape of ['static', 'server'] as const) {
      const dir = functionDir(fixture(shape, true).dir);
      const bytes = deployedFiles(dir).reduce(
        (sum, file) => sum + (ADAPTER === 'cloudflare' ? gzipSync(readFileSync(file)).length : statSync(file).size),
        0,
      );
      console.info(
        `${ADAPTER}-${shape} function ${(bytes / 1e6).toFixed(1)} MB${ADAPTER === 'cloudflare' ? ' gz' : ''}`,
      );
      expect(bytes, shape).toBeLessThan(limit);
    }
  });

  if (ADAPTER === 'vercel') {
    it('sends misses on a static site to its 404 page, and leaves a server site and a site 404 alone', () => {
      expect(vercelRoutes(fixture('static', true).dir).at(-1)).toEqual({
        src: '^/.*$',
        dest: '/404.html',
        status: 404,
      });
      expect(vercelRoutes(fixture('static-404', true).dir).at(-1)).toEqual({
        src: '^/.*$',
        dest: '/404.html',
        status: 404,
      });
      expect(fixture('static-404', true).log).not.toContain('misses on this site run the preview function');
      expect(vercelRoutes(fixture('server', true).dir).at(-1)).toEqual(
        vercelRoutes(fixture('server', false).dir).at(-1),
      );
    });

    it('serves drafts when isr excludes the prefix', () => {
      expect(previewMode(fixture('isr-excluded', true).dir)).toBe('d8');
    });
  }

  if (ADAPTER === 'cloudflare') {
    it('copies the routing a static site needs into dist/server/wrangler.json, and warns about none', () => {
      const { dir, log } = fixture('static-routed', true);
      const wrangler: { assets: { run_worker_first: string[]; not_found_handling: string } } = readJson(
        join(dir, 'dist/server/wrangler.json'),
      );
      expect(wrangler.assets.run_worker_first).toEqual(
        expect.arrayContaining(['/_conloca/preview', '/_conloca/preview/*', '/_server-islands/*']),
      );
      expect(wrangler.assets.not_found_handling).toBe('404-page');
      expect(log).not.toContain('conloca connect --update');
    });
  }

  for (const shape of extra.filter((s) => REFUSED.has(s))) {
    it(`${shape}: builds with preview off, and a warning`, () => {
      const { dir, log } = fixture(shape, true);
      expect(log).toContain('preview is off for this build');
      expect(previewMode(dir)).toBe('off');
    });
  }

  for (const shape of EDGE) {
    it(`${shape}: the preview build equals the no-preview build`, async () => {
      for (const out of ['dist', '.vercel/output', '.netlify']) {
        // oxlint-disable-next-line no-await-in-loop -- one output folder at a time keeps a failure attributable.
        const [preview, plain, again] = await Promise.all(
          [fixture(shape, true), fixture(shape, false), fixture(shape, false, '-again')].map(async ({ dir }) => {
            if (!existsSync(join(dir, out))) return new Map<string, string>();
            // The function bundle holds the fixture's own folder, whose name differs per build, and chunks importing
            // it get a new content hash each build.
            const name = basename(dir);
            const tree = await snapshotTree(join(dir, out), () => false);
            return new Map(
              [...tree].map(([path, hash]) => [
                path.replaceAll(name, 'FIXTURE').replace(/_[\w-]{8}\.mjs$/u, '_HASH.mjs'),
                hash,
              ]),
            );
          }),
        );
        for (const [path, hash] of plain) {
          if (again.get(path) === hash) expect(preview.get(path), `${out}/${path}`).toBe(hash);
        }
        // d8 adds no file of its own.
        expect(
          [...preview.keys()].filter((path) => !plain.has(path)),
          out,
        ).toEqual([]);
      }
    });
  }
});
