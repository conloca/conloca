import { describe, expect, it } from 'bun:test';
import netlify from '@astrojs/netlify';
import vercel from '@astrojs/vercel';
import type { AstroConfig } from 'astro';
import {
  adapterMiddlewareMode,
  d8ConfigRefusal,
  d8EdgeRefusal,
  darkenIsrPrefix,
  vercelIsrCatchesPrefix,
} from '../d8-guards.js';

const ISR =
  '@astrojs/vercel isr caches /_conloca/preview/ by path, ignoring the preview cookie, so drafts could be served to anyone. Add the prefix to isr.exclude in astro.config: isr: { exclude: [/^\\/_conloca\\/preview(\\/.*)?$/] }';
const EDGE =
  "draft preview does not run in edge middleware (middlewareMode: 'edge' / edgeMiddleware): its middleware does not bundle into the edge function, and the adapter serializes locals to JSON. Remove the option to turn preview on.";
const unreadable = (adapter: string) =>
  `couldn't read middlewareMode from astro.config; write the ${adapter} options literally to turn preview on.`;
const config = (body: string) => `import vercel from '@astrojs/vercel';\nexport default defineConfig({ ${body} });\n`;

describe('d8ConfigRefusal', () => {
  it('refuses Vercel isr', () => {
    expect(d8ConfigRefusal(config('adapter: vercel({ isr: true })'), '@astrojs/vercel')).toBe(ISR);
  });

  it('names the base in the isr prefix', () => {
    expect(d8ConfigRefusal(config('adapter: vercel({ isr: true })'), '@astrojs/vercel', '/docs/')).toContain(
      'caches /docs/_conloca/preview/ by path',
    );
    expect(d8ConfigRefusal(config('adapter: vercel({ isr: true })'), '@astrojs/vercel', '/docs')).toContain(
      'exclude: [/^\\/docs\\/_conloca\\/preview(\\/.*)?$/]',
    );
  });

  it('allows isr that excludes the preview prefix', () => {
    const text = config('adapter: vercel({ isr: { exclude: [/^\\/_conloca\\/preview(\\/.*)?$/] } })');
    expect(d8ConfigRefusal(text, '@astrojs/vercel')).toBeNull();
  });

  it('allows isr: false', () => {
    expect(d8ConfigRefusal(config('adapter: vercel({ isr: false })'), '@astrojs/vercel')).toBeNull();
  });

  it('refuses edge middleware on Vercel and Netlify', () => {
    expect(d8ConfigRefusal(config("adapter: vercel({ middlewareMode: 'edge' })"), '@astrojs/vercel')).toBe(EDGE);
    expect(d8ConfigRefusal(config('adapter: netlify({ edgeMiddleware: true })'), '@astrojs/netlify')).toBe(EDGE);
  });

  it('ignores an option inside a comment', () => {
    const text = config("adapter: vercel({ /* isr: true, middlewareMode: 'edge' */ }), // isr: true");
    expect(d8ConfigRefusal(text, '@astrojs/vercel')).toBeNull();
  });

  it('refuses nothing on other adapters', () => {
    expect(d8ConfigRefusal(config("adapter: node({ isr: true, middlewareMode: 'edge' })"), '@astrojs/node')).toBeNull();
  });
});

describe('adapterMiddlewareMode', () => {
  const fields = {
    root: new URL('file:///site/'),
    build: { server: new URL('file:///site/dist/server/'), serverEntry: 'entry.mjs' },
  };
  // SAFETY: both adapters' astro:config:done read only root and build from the config.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- same reason as the SAFETY note.
  const astroConfig = fields as AstroConfig;

  it("reads 'edge' from the adapter's own resolution", async () => {
    expect(await adapterMiddlewareMode(vercel({ middlewareMode: 'edge' }), astroConfig)).toBe('edge');
    expect(await adapterMiddlewareMode(netlify({ edgeMiddleware: true }), astroConfig)).toBe('edge');
    // A computed option, as the config text can't read it.
    const computed = process.env.CONLOCA_UNSET_MODE === 'classic' ? 'classic' : 'edge';
    expect(await adapterMiddlewareMode(vercel({ middlewareMode: computed }), astroConfig)).toBe('edge');
  });

  it("reads 'classic' by default", async () => {
    expect(await adapterMiddlewareMode(vercel(), astroConfig)).toBe('classic');
    expect(await adapterMiddlewareMode(netlify(), astroConfig)).toBe('classic');
  });

  it('is undefined when the adapter sets none, or its hook throws', async () => {
    expect(await adapterMiddlewareMode({ name: 'x', hooks: {} }, astroConfig)).toBeUndefined();
    const throwing = {
      name: '@astrojs/vercel',
      hooks: {
        'astro:config:done': () => {
          throw new Error('boom');
        },
      },
    };
    expect(await adapterMiddlewareMode(throwing, astroConfig)).toBeUndefined();
  });
});

describe('d8EdgeRefusal', () => {
  it('refuses a probed edge mode', () => {
    expect(d8EdgeRefusal('edge', '', '@astrojs/vercel')).toBe(EDGE);
    expect(d8EdgeRefusal('classic', 'vercel(opts)', '@astrojs/vercel')).toBeNull();
  });

  it("fails closed when the mode can't be read and the text doesn't prove classic", () => {
    expect(d8EdgeRefusal(undefined, config('adapter: vercel(opts)'), '@astrojs/vercel')).toBe(
      unreadable('@astrojs/vercel'),
    );
    expect(d8EdgeRefusal(undefined, config('adapter: vercel({ ...opts })'), '@astrojs/vercel')).toBe(
      unreadable('@astrojs/vercel'),
    );
    expect(d8EdgeRefusal(undefined, config('adapter: netlify(opts)'), '@astrojs/netlify')).toBe(
      unreadable('@astrojs/netlify'),
    );
    expect(d8EdgeRefusal(undefined, config('adapter: netlify({ edgeMiddleware: true })'), '@astrojs/netlify')).toBe(
      EDGE,
    );
  });

  it('accepts text that proves classic', () => {
    expect(d8EdgeRefusal(undefined, config('adapter: vercel()'), '@astrojs/vercel')).toBeNull();
    expect(d8EdgeRefusal(undefined, config('adapter: vercel({ isr: false })'), '@astrojs/vercel')).toBeNull();
    expect(
      d8EdgeRefusal(undefined, config("adapter: vercel({ middlewareMode: 'classic' })"), '@astrojs/vercel'),
    ).toBeNull();
  });

  it('never refuses another adapter', () => {
    expect(d8EdgeRefusal(undefined, config('adapter: node(opts)'), '@astrojs/node')).toBeNull();
  });
});

// The spike's two .vercel/output/config.json route lists (spike-results row 13).
const isrRoutes = {
  version: 3,
  routes: [
    { src: '^/_astro/(.*)$', headers: { 'cache-control': 'public, max-age=31536000, immutable' }, continue: true },
    { handle: 'filesystem' },
    { src: '^(/_conloca/preview(?:/(.*?))?/?)$', dest: '/_isr?x_astro_path=$1' },
    { src: '^/.*$', dest: '/_isr?x_astro_path=$0' },
  ],
};
const excludedRoutes = {
  version: 3,
  routes: [
    { handle: 'filesystem' },
    { src: '^/_conloca/preview(?:/(.*?))?$', dest: '_render' },
    { src: '^/.*$', dest: '/_isr?x_astro_path=$0' },
  ],
};

const fs = { handle: 'filesystem' };
const isr = (src: string) => ({ src, dest: '/_isr' });

describe('vercelIsrCatchesPrefix', () => {
  it('is true when the prefix is routed to an _isr function', () => {
    expect(vercelIsrCatchesPrefix(isrRoutes, '/')).toBe(true);
  });

  it('is false when isr.exclude sends the prefix to _render', () => {
    expect(vercelIsrCatchesPrefix(excludedRoutes, '/')).toBe(false);
  });

  it('is false for anything that is not a route list', () => {
    expect(vercelIsrCatchesPrefix(null, '/')).toBe(false);
    expect(vercelIsrCatchesPrefix({ routes: 'x' }, '/')).toBe(false);
  });

  it('skips dest-less and continue routes, stops at the next handle, and checks the bare prefix', () => {
    expect(
      vercelIsrCatchesPrefix(
        {
          routes: [fs, { src: '^/.*$', headers: {} }, { src: '^/.*$', dest: '/_render', continue: true }, isr('^/.*$')],
        },
        '/',
      ),
    ).toBe(true);
    expect(vercelIsrCatchesPrefix({ routes: [fs, { handle: 'miss' }, isr('^/.*$')] }, '/')).toBe(false);
    expect(vercelIsrCatchesPrefix({ routes: [fs, isr('^/_conloca/preview$')] }, '/')).toBe(true);
    expect(vercelIsrCatchesPrefix({ routes: [fs, isr('^/_conloca/preview/$')] }, '/')).toBe(true);
  });
});

const dark = (src: string) => ({ src, dest: '/404.html', status: 404 });

describe('darkenIsrPrefix', () => {
  it('answers the prefix with a static 404 first after filesystem, every other route unchanged', () => {
    expect(darkenIsrPrefix(isrRoutes, '/')).toEqual({
      ...isrRoutes,
      routes: [
        isrRoutes.routes[0],
        isrRoutes.routes[1],
        dark('^/_conloca/preview(?:/.*)?$'),
        isrRoutes.routes[2],
        isrRoutes.routes[3],
      ],
    });
  });

  it('darkens the prefix when only an isr catch-all serves it, leaving other pages to the catch-all', () => {
    const catchAll = { routes: [{ handle: 'filesystem' }, { src: '^/.*$', dest: '/_isr?x_astro_path=$0' }] };
    expect(vercelIsrCatchesPrefix(catchAll, '/')).toBe(true);
    const darkened = darkenIsrPrefix(catchAll, '/');
    expect(darkened).toEqual({
      routes: [catchAll.routes[0], dark('^/_conloca/preview(?:/.*)?$'), catchAll.routes[1]],
    });
    // Vercel serves the first match after filesystem.
    const served = (path: string) =>
      darkened.routes.slice(1).find((route) => typeof route.src === 'string' && new RegExp(route.src).test(path))?.dest;
    expect(served('/_conloca/preview')).toBe('/404.html');
    expect(served('/_conloca/preview/en/draft')).toBe('/404.html');
    expect(served('/about')).toBe('/_isr?x_astro_path=$0');
    expect(served('/_conloca/previewer')).toBe('/_isr?x_astro_path=$0');
  });

  it('darkens the prefix under base', () => {
    const based = {
      routes: [
        { handle: 'filesystem' },
        { src: '^(/docs/_conloca/preview(?:/(.*?))?/?)$', dest: '/_isr?x_astro_path=$1' },
        { src: '^/docs(?:/(.*?))?$', dest: '/_isr?x_astro_path=$0' },
      ],
    };
    expect(vercelIsrCatchesPrefix(based, '/docs/')).toBe(true);
    expect(darkenIsrPrefix(based, '/docs/')).toEqual({
      routes: [based.routes[0], dark('^/docs/_conloca/preview(?:/.*)?$'), based.routes[1], based.routes[2]],
    });
  });
});
