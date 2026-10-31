import { beforeAll, describe, expect, it } from 'bun:test';
import { existsSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import {
  BUILD_TIMEOUT,
  createFixtureSite,
  type FixtureSiteOptions,
  runAstroBuild,
  runWrangler,
  snapshotTree,
} from '../test-editor-build/fixture-site.js';

/** The preview's rate limit, as `conloca connect` writes it. */
const LIMIT = [{ name: 'conlocaPreviewLimit', namespace_id: '1001', simple: { limit: 60, period: 10 } }];

const WRANGLER = (extra: readonly string[] = []) =>
  `${JSON.stringify(
    {
      name: 'fixture',
      send_metrics: false,
      compatibility_date: '2026-03-15',
      compatibility_flags: ['nodejs_compat'],
      main: '.conloca/dispatcher/index.mjs',
      ratelimits: LIMIT,
      assets: {
        directory: './dist',
        binding: 'ASSETS',
        not_found_handling: '404-page',
        // `/_image` is preview-only: draft pages emit it, published pages never do.
        run_worker_first: ['/_conloca/preview', '/_conloca/preview/*', '/_image', ...extra],
      },
    },
    null,
    2,
  )}\n`;

const STATIC_PATHS_PAGE = [
  '---',
  "export function getStaticPaths() { return [{ params: { slug: 'hello' }, props: { title: 'Hello' } }]; }",
  'const { title } = Astro.props;',
  '---',
  '<html><body><h1>{title}</h1></body></html>',
  '',
].join('\n');

/** An on-demand API route only the preview build has: its server serves it for the live site under D3. */
const API_ROUTE = [
  "{ name: 'fixture-api', hooks: { 'astro:config:setup': ({ injectRoute }) => { if (process.env.CONLOCA_PREVIEW_BUILD === '1') injectRoute({ pattern: '/api/ping', entrypoint: './src/api-ping.ts', prerender: false }); } } }",
];
const API_PING = "export const GET = () => new Response('pong');\n";
/** Fails the preview build only. Not a page that throws: the Cloudflare adapter prerenders in workerd, where the flag isn't set. */
const BREAKS_PREVIEW =
  "{ name: 'fixture-broken-preview', hooks: { 'astro:config:setup': () => { if (process.env.CONLOCA_PREVIEW_BUILD === '1') throw new Error('broken only in the preview build'); } } }";

/** An endpoint whose output comes from getStaticPaths props: rendered on demand, it would lose them. */
const STATIC_PATHS_ENDPOINT = [
  "export function getStaticPaths() { return [{ params: { slug: 'hello' }, props: { title: 'Hello' } }]; }",
  'export const GET = ({ props }) => Response.json({ title: props.title });',
  '',
].join('\n');

const D3: FixtureSiteOptions = {
  integrationOptions: "{ repoUri: 'acme/fixture', previewBuild: {} }",
  // A static site's endpoints and redirects are files in production; the dispatcher must never run on them.
  redirects: { '/old': '/about' },
  extraFiles: {
    'wrangler.jsonc': WRANGLER(),
    'src/pages/404.astro': '<h1>Not found</h1>\n',
    'src/pages/blog/[slug].astro': STATIC_PATHS_PAGE,
    'src/pages/rss.xml.js':
      "export const GET = () => new Response('<rss/>', { headers: { 'content-type': 'application/xml' } });\n",
    'src/pages/data/[slug].json.ts': STATIC_PATHS_ENDPOINT,
  },
};

let site = '';
beforeAll(async () => {
  site = await createFixtureSite('d3', D3);
  const built = runAstroBuild(site);
  expect(built.status, built.stderr).toBe(0);
}, BUILD_TIMEOUT);

describe('a D3 build', () => {
  it("leaves the site's endpoints and redirects static, and off the dispatcher's routes", async () => {
    const routes: string[] = JSON.parse(
      await readFile(join(site, '.conloca/dispatcher/run_worker_first.json'), 'utf8'),
    );
    expect(routes).toEqual(['/_conloca/preview', '/_conloca/preview/*', '/_image']);
    expect(await readFile(join(site, 'dist/rss.xml'), 'utf8')).toBe('<rss/>');
    expect(JSON.parse(await readFile(join(site, 'dist/data/hello.json'), 'utf8'))).toEqual({ title: 'Hello' });
    expect(existsSync(join(site, 'dist/old/index.html'))).toBe(true);
  });

  it(
    'starts within 300 ms locally, the preview server imported lazily',
    async () => {
      const bundle = join(site, '.conloca/startup/dispatcher.bundle');
      const built = runWrangler(site, ['deploy', '--dry-run', '--outfile', bundle]);
      expect(built.status, built.stderr).toBe(0);
      const checked = runWrangler(site, [
        'check',
        'startup',
        '--workerBundle',
        bundle,
        '--outfile',
        join(site, '.conloca/startup/startup.cpuprofile'),
      ]);
      expect(checked.status, checked.stderr).toBe(0);
      const report = `${checked.stdout}${checked.stderr}`;
      const window = /Profile window: ([\d.]+) ms/u.exec(report)?.[1];
      const active = /Active: ([\d.]+) ms/u.exec(report)?.[1];
      expect(active, report).toBeDefined();
      console.info(
        `D3 dispatcher bundle ${(await stat(bundle)).size} bytes, local startup ${active} ms active in a ${window} ms window`,
      );
      // The CPU the startup spends, as Cloudflare's startup limit counts it. The window is wall time: other builds
      // running alongside stretch its idle part far past the work.
      expect(Number(active)).toBeLessThanOrEqual(300);
    },
    BUILD_TIMEOUT,
  );

  it('writes the dispatcher, which imports the preview server lazily', async () => {
    expect(await readFile(join(site, '.conloca/dispatcher/index.mjs'), 'utf8')).toContain(
      'import("../preview-server/server/entry.mjs")',
    );
    expect(existsSync(join(site, '.conloca/preview-server/server/entry.mjs'))).toBe(true);
  });

  it('lists the pages the preview build prerendered, getStaticPaths pages included', async () => {
    const config = JSON.parse(await readFile(join(site, '.conloca/dispatcher/dispatcher.json'), 'utf8'));
    expect(config.prerendered).toEqual(expect.arrayContaining(['/about', '/blog/hello']));
  });

  it('bakes the exit values the preview server checks passes against', async () => {
    const config = JSON.parse(await readFile(join(site, '.conloca/dispatcher/dispatcher.json'), 'utf8'));
    expect(config.exit).toEqual({
      repo: 'acme/fixture',
      siteId: 'default',
      branch: expect.any(String),
      audience: 'acme/fixture',
    });
  });

  it("merges the preview build's _astro files into the site's, byte for byte", async () => {
    const preview = join(site, '.conloca/preview-server/client/_astro');
    for (const entry of await readdir(preview, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const name = join(entry.parentPath, entry.name).slice(preview.length + 1);
      // oxlint-disable-next-line no-await-in-loop -- one case at a time keeps a failure attributable.
      expect((await readFile(join(site, 'dist/_astro', name))).equals(await readFile(join(preview, name))), name).toBe(
        true,
      );
    }
  });

  it('leaves no deploy redirect that would ship the preview server as the site', () => {
    expect(existsSync(join(site, '.wrangler/deploy/config.json'))).toBe(false);
  });

  it(
    'changes no published byte',
    async () => {
      const plain = await createFixtureSite('d3-plain', { ...D3, integrationOptions: "{ repoUri: 'acme/fixture' }" });
      const built = runAstroBuild(plain);
      expect(built.status, built.stderr).toBe(0);
      const before = await snapshotTree(join(plain, 'dist'), () => false);
      const after = await snapshotTree(join(site, 'dist'), () => false);
      for (const [path, hash] of before) {
        if (path !== '_conloca/editor/conloca.json') expect(after.get(path), path).toBe(hash);
      }
    },
    BUILD_TIMEOUT,
  );

  it(
    'deploys only dist and the dispatcher with a plain wrangler deploy',
    () => {
      const out = runWrangler(site, ['deploy', '--dry-run', '--outdir', '.conloca/dry-run']);
      expect(out.status, out.stderr).toBe(0);
      expect(`${out.stdout}${out.stderr}`).not.toContain('redirected');
      expect(existsSync(join(site, '.conloca/dry-run/index.js'))).toBe(true);
    },
    BUILD_TIMEOUT,
  );
});

describe('when the preview build fails', () => {
  it(
    'still ships a prefix-only site, and the dispatcher answers "preview unavailable"',
    async () => {
      const broken = await createFixtureSite('d3-broken', { ...D3, extraIntegrations: [BREAKS_PREVIEW] });
      const built = runAstroBuild(broken);
      expect(built.status, built.stderr).toBe(0);
      expect(`${built.stdout}${built.stderr}`).toContain('the preview build failed');
      expect(existsSync(join(broken, 'dist/about/index.html'))).toBe(true);
      expect(await readFile(join(broken, '.conloca/dispatcher/index.mjs'), 'utf8')).toContain(
        'createDispatcher(config, null)',
      );
    },
    BUILD_TIMEOUT * 2,
  );

  it(
    'fails the build when the preview server also serves an on-demand route, even under conloca connect',
    async () => {
      const broken = await createFixtureSite('d3-broken-api', {
        ...D3,
        extraIntegrations: [...API_ROUTE, BREAKS_PREVIEW],
        extraFiles: {
          ...D3.extraFiles,
          'wrangler.jsonc': WRANGLER(['/api/ping']),
          'src/api-ping.ts': API_PING,
        },
      });
      const envs: Record<string, string>[] = [{}, { CONLOCA_CONNECT: '1' }];
      for (const env of envs) {
        const built = runAstroBuild(broken, env);
        expect(built.status).not.toBe(0);
        expect(`${built.stdout}${built.stderr}`).toContain(
          "the preview build failed and it serves this site's on-demand routes (/api/ping); fixing it is required to deploy",
        );
      }
    },
    BUILD_TIMEOUT * 3,
  );
});

describe('the run_worker_first check', () => {
  it(
    'fails a build whose wrangler.jsonc lacks an on-demand route, and only warns while conloca connect builds',
    async () => {
      const stale = await createFixtureSite('d3-stale', {
        ...D3,
        extraIntegrations: API_ROUTE,
        extraFiles: { ...D3.extraFiles, 'src/api-ping.ts': API_PING },
      });
      const refused = runAstroBuild(stale);
      expect(refused.status).not.toBe(0);
      expect(`${refused.stdout}${refused.stderr}`).toContain(
        'wrangler.jsonc run_worker_first lacks /api/ping: run `conloca connect --update --yes`',
      );
      const connecting = runAstroBuild(stale, { CONLOCA_CONNECT: '1' });
      expect(connecting.status, connecting.stderr).toBe(0);
      expect(JSON.parse(await readFile(join(stale, '.conloca/dispatcher/run_worker_first.json'), 'utf8'))).toEqual(
        expect.arrayContaining(['/_conloca/preview', '/_conloca/preview/*', '/api/ping']),
      );
    },
    BUILD_TIMEOUT * 3,
  );
});

describe('a separate preview deploy (D4)', () => {
  it(
    'runs no preview build in the site, and builds the preview server with its own conloca.json',
    async () => {
      const d4 = await createFixtureSite('d4', {
        integrationOptions: "{ repoUri: 'acme/fixture', previewBuild: { separate: true } }",
        extraIntegrations: API_ROUTE,
        extraFiles: {
          'src/pages/blog/[slug].astro': STATIC_PATHS_PAGE,
          'src/api-ping.ts': API_PING,
          'wrangler.jsonc': `${JSON.stringify({ name: 'fixture', compatibility_date: '2026-03-15', compatibility_flags: ['nodejs_compat'], env: { preview: { name: 'fixture-preview', workers_dev: true, routes: [] } } }, null, 2)}\n`,
        },
      });
      const siteBuild = runAstroBuild(d4);
      expect(siteBuild.status, siteBuild.stderr).toBe(0);
      expect(existsSync(join(d4, '.conloca/preview-server'))).toBe(false);
      const read = async (path: string) => JSON.parse(await readFile(join(d4, path), 'utf8')).preview;
      expect(await read('dist/_conloca/editor/conloca.json')).toEqual({ mode: 'd4', protocol: 2 });
      const previewBuild = runAstroBuild(d4, { CONLOCA_PREVIEW_BUILD: '1' });
      expect(previewBuild.status, previewBuild.stderr).toBe(0);
      expect(await read('.conloca/preview-server/client/_conloca/editor/conloca.json')).toEqual({
        mode: 'd4',
        protocol: 2,
      });
      // The static site's pages stay prerendered in its preview deploy, getStaticPaths props included.
      expect(await readFile(join(d4, '.conloca/preview-server/client/blog/hello/index.html'), 'utf8')).toContain(
        '<h1>Hello</h1>',
      );
      // Its on-demand endpoint stays on demand: no static file, and the server's manifest renders it.
      expect(existsSync(join(d4, '.conloca/preview-server/client/api/ping'))).toBe(false);
      const chunks = await readdir(join(d4, '.conloca/preview-server/server/chunks'));
      const manifests = await Promise.all(
        chunks.map((name) => readFile(join(d4, '.conloca/preview-server/server/chunks', name), 'utf8')),
      );
      expect(manifests.some((text) => /"route":"\/api\/ping".{0,300}"prerender":false/u.test(text))).toBe(true);
    },
    BUILD_TIMEOUT * 2,
  );
});
