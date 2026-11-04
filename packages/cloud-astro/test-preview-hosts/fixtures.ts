import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import {
  createFixtureSite,
  type FixtureAdapter,
  type FixtureSiteOptions,
  PNG_1X1,
} from '../test-editor-build/fixture-site.js';
import { MEDIA_HERO } from './fake-conloca.js';

export type Adapter = FixtureAdapter;

/** Every adapter's shapes, then the single-adapter fixtures the brief names `<adapter>-<shape>`. */
export const SHAPES = ['static', 'static-base', 'server', 'server-i18n', 'hybrid'] as const;
export type Shape =
  | (typeof SHAPES)[number]
  | 'static-404'
  | 'isr'
  | 'isr-excluded'
  | 'edge'
  | 'static-cache'
  | 'static-routed'
  | 'nosite';

/** Whether a shape renders the site's own pages on demand (it has an SSR function without preview). */
export const isServerShape = (shape: Shape): boolean =>
  shape === 'server' || shape === 'server-i18n' || shape === 'isr' || shape === 'isr-excluded' || shape === 'edge';

/** A CMS page's `.vxjson`, id `vx-<title in lower case>`, holding one Hero. */
export const cmsPage = (title: string) =>
  `${JSON.stringify({
    created: '2026-04-20T00:00:00.000Z',
    id: `vx-${title.toLowerCase()}`,
    meta: { title },
    modified: '2026-04-20T00:00:00.000Z',
    type: 'puck',
    content: { puckData: { content: [{ type: 'Hero', props: { id: `Hero-${title}` } }], root: {}, zones: {} } },
  })}\n`;

const IMAGE_PAGE = (prerender: boolean) =>
  [
    '---',
    "import { Image } from 'astro:assets';",
    "import dot from '../assets/dot.png';",
    `export const prerender = ${prerender};`,
    '---',
    '<html><body><Image src={dot} alt="" /></body></html>',
    '',
  ].join('\n');

const STATIC_PATHS_PAGE = [
  '---',
  'export const prerender = true;',
  "export function getStaticPaths() { return [{ params: { slug: 'hello' }, props: { title: 'Hello' } }]; }",
  'const { title } = Astro.props;',
  '---',
  '<html><body><h1>{title}</h1></body></html>',
  '',
].join('\n');

/**
 * The CMS pages' layout: a local `<Image>` (rendered on demand only in a draft) and what the render saw, in `data-*`
 * attributes no link rewrite touches. Under i18n it adds the language switcher a site derives from `Astro.url`.
 */
export const LAYOUT = (i18n: boolean) =>
  [
    '---',
    "import { Image } from 'astro:assets';",
    ...(i18n ? ["import { getRelativeLocaleUrl } from 'astro:i18n';"] : []),
    "import dot from '../assets/dot.png';",
    ...(i18n
      ? [
          "const page = Astro.url.pathname.replace(/^\\/(?:en|fr|bg)(?=\\/)/u, '');",
          "const switcher = getRelativeLocaleUrl(Astro.currentLocale ?? 'en', page);",
        ]
      : ['const switcher = undefined;']),
    '---',
    '<html data-pathname={Astro.url.pathname} data-locale={Astro.currentLocale} data-switcher={switcher} data-origin={Astro.originPathname}>',
    '<head><title>{Astro.props.title}</title></head>',
    '<body><Image src={dot} alt="" /><slot /></body>',
    '</html>',
    '',
  ].join('\n');

const ON_DEMAND_CATCH_ALL = [
  '---',
  'export const prerender = false;',
  '---',
  '<html><body><h1>{Astro.params.slug}</h1></body></html>',
  '',
].join('\n');

/** Cloudflare routing a d8 static site needs (the D3 shape without `/_image`, which moved under the prefix). */
const ROUTED_WRANGLER = `${JSON.stringify(
  {
    name: 'fixture',
    send_metrics: false,
    compatibility_date: '2026-03-15',
    compatibility_flags: ['nodejs_compat'],
    assets: {
      not_found_handling: '404-page',
      run_worker_first: ['/_conloca/preview', '/_conloca/preview/*', '/_server-islands/*'],
    },
  },
  null,
  2,
)}\n`;

/** The adapter call's argument a shape names; the adapter's default otherwise. */
const ADAPTER_OPTIONS = new Map<Shape, string>([
  ['isr', '{ isr: true }'],
  ['isr-excluded', '{ isr: { exclude: [/^\\/_conloca\\/preview(\\/.*)?$/] } }'],
  ['edge', "{ middlewareMode: 'edge' }"],
  ['static-cache', '{ cacheOnDemandPages: true }'],
]);

function shapeOptions(adapter: Adapter, shape: Shape): FixtureSiteOptions {
  const server = isServerShape(shape);
  const files: NonNullable<FixtureSiteOptions['extraFiles']> = {
    'content/default/pages/index.en.vxjson': cmsPage('Home'),
    'content/default/pages/about.en.vxjson': cmsPage('About'),
    'src/layouts/Layout.astro': LAYOUT(shape === 'server-i18n'),
    'src/components/Hero.tsx': MEDIA_HERO,
    'src/assets/dot.png': PNG_1X1,
    'src/pages/contact.astro': IMAGE_PAGE(true),
    'src/pages/blog/[slug].astro': STATIC_PATHS_PAGE,
  };
  if (server) {
    files['src/pages/api/hello.ts'] =
      "export const prerender = false;\nexport const GET = () => new Response('hello');\n";
    // Under a folder: at the root it would collide with the CMS route's own `/[...slug]`.
    files['src/pages/items/[...slug].astro'] = ON_DEMAND_CATCH_ALL;
  }
  if (shape === 'hybrid') files['src/pages/live.astro'] = IMAGE_PAGE(false);
  if (shape === 'static-404') files['src/pages/404.astro'] = '<h1>Not found</h1>\n';
  if (shape === 'static-routed') files['wrangler.jsonc'] = ROUTED_WRANGLER;
  // The one remote host the image endpoint may answer: the fake Conloca serves an image there.
  const extraConfig: string[] = ["image: { domains: ['127.0.0.1'] },"];
  if (shape === 'server-i18n') {
    files['content/sites.json'] =
      '{"sites":{"default":{"locales":["en","fr","bg"],"defaultLocale":"en"}},"globalLocales":["en","fr","bg"]}\n';
    // A page under a locale's folder: the branch `n` has the slug `bg`, which is also a locale.
    files['content/default/pages/fr/about.en.vxjson'] = cmsPage('Apropos');
    extraConfig.push("i18n: { locales: ['en', 'fr', 'bg'], defaultLocale: 'en' },");
  }
  const adapterOptions = ADAPTER_OPTIONS.get(shape);
  return {
    adapter,
    output: server ? 'server' : 'static',
    ...(adapterOptions === undefined ? {} : { adapterOptions }),
    ...(shape === 'static-base' ? { base: '/docs' } : {}),
    ...(shape === 'nosite' ? { withoutSite: true } : {}),
    extraConfig,
    cmsOptions:
      "routing: { routes: { pages: { pattern: '/[...slug]', collection: 'pages', layout: './src/layouts/Layout.astro' } } }",
    extraFiles: files,
  };
}

export interface BuiltFixture {
  dir: string;
  ms: number;
  /** The build's stdout and stderr, for its warnings. */
  log: string;
}

/** Runs the site's own `astro build` without blocking, so builds can overlap; `env` adds deploy settings. */
function astroBuild(cwd: string, env: Record<string, string>): Promise<{ status: number | null; log: string }> {
  const astroPackage = createRequire(join(cwd, 'package.json')).resolve('astro/package.json');
  const { bin }: { bin: { astro: string } } = JSON.parse(readFileSync(astroPackage, 'utf8'));
  return new Promise((resolve, reject) => {
    const child = spawn('node', [join(dirname(astroPackage), bin.astro), 'build'], {
      cwd,
      // No key and no deploy setting unless named: only what a process needs, and the branch.
      env: {
        PATH: process.env.PATH ?? '',
        HOME: process.env.HOME ?? '',
        ...(process.env.TMPDIR ? { TMPDIR: process.env.TMPDIR } : {}),
        GITHUB_REF_NAME: 'main',
        ...env,
      },
    });
    let log = '';
    child.stdout.on('data', (chunk) => (log += chunk));
    child.stderr.on('data', (chunk) => (log += chunk));
    child.on('error', reject);
    child.on('close', (status) => resolve({ status, log }));
  });
}

/**
 * Writes and builds `<adapter>-<shape>` under `tmp/d8/`, with preview (d8) on or off; `copy` names a second build of
 * the same fixture, `env` the deploy settings it builds with (e.g. `VERCEL_ENV`), `endpoint` the Conloca it calls,
 * `files` extra site files and `beforeBuild` what runs in the written site before its build. Throws when the build fails.
 */
export async function buildFixture(
  adapter: Adapter,
  shape: Shape,
  {
    preview,
    copy = '',
    env = {},
    endpoint,
    files = {},
    beforeBuild,
  }: {
    preview: boolean;
    copy?: string;
    env?: Record<string, string>;
    endpoint?: string;
    files?: Record<string, string | Uint8Array>;
    beforeBuild?: (dir: string) => Promise<void>;
  },
): Promise<BuiltFixture> {
  const name = `d8-${adapter}-${shape}-${preview ? 'preview' : 'plain'}${copy}`;
  const options = shapeOptions(adapter, shape);
  const dir = await createFixtureSite(name, {
    ...options,
    extraFiles: { ...options.extraFiles, ...files },
    integrationOptions: `{ repoUri: 'acme/fixture'${preview ? ', previewBuild: {}' : ''}${
      endpoint === undefined ? '' : `, endpoint: ${JSON.stringify(endpoint)}`
    } }`,
  });
  // The base fixture's own about page: here `/about` is a CMS page.
  await rm(join(dir, 'src/pages/about.astro'));
  await beforeBuild?.(dir);
  const start = performance.now();
  const { status, log } = await astroBuild(dir, env);
  const ms = Math.round(performance.now() - start);
  if (status !== 0) throw new Error(`${name}: astro build exited ${status}\n${log}`);
  return { dir, ms, log };
}
