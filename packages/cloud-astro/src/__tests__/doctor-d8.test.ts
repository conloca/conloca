import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { runD8Checks } from '../doctor/checks-d8.js';
import { scanAstroConfig } from '../doctor/config-scan.js';
import type { CheckOutcome } from '../doctor/types.js';

const P = '/proj';
const IMPORTS = {
  vercel: "import vercel from '@astrojs/vercel';",
  netlify: "import netlify from '@astrojs/netlify';",
  cloudflare: "import cloudflare from '@astrojs/cloudflare';",
  node: "import node from '@astrojs/node';",
} as const;
const SITE = "site: 'https://www.acme.test',";

/** astro.config with these Astro `settings`, conlocaCloud(`options`) and extra import lines. */
const config = (settings: string, imports = '', options = '{ previewBuild: {} }') =>
  [
    imports,
    "import { conlocaCloud } from '@conloca/cloud-astro';",
    `export default { ${settings} integrations: [conlocaCloud(${options})] };`,
  ].join('\n');
const installed = (name: string, version: string, astro = '^7.0.0') => ({
  [`node_modules/${name}/package.json`]: JSON.stringify({ version, peerDependencies: { astro } }),
});
const ASTRO = { 'node_modules/astro/package.json': '{"version":"7.3.1"}' };
const VERCEL = { ...ASTRO, ...installed('@astrojs/vercel', '11.0.18') };

function checks(files: Record<string, string>, dir = P): Map<string, CheckOutcome> {
  const all = Object.fromEntries(Object.entries(files).map(([path, text]) => [join(dir, path), text]));
  const deps = {
    exists: (path: string) => path in all,
    readFile: (path: string) => {
      const text = all[path];
      if (text === undefined) throw new Error(`ENOENT ${path}`);
      return text;
    },
  };
  return new Map(runD8Checks(scanAstroConfig(dir, deps), dir, deps).map((outcome) => [outcome.id, outcome]));
}
const problems = (outcome: CheckOutcome | undefined) => outcome?.problems.map((p) => `${p.level}: ${p.message}`) ?? [];
const vercelSite = (settings: string, files: Record<string, string> = {}) =>
  checks({ 'astro.config.mjs': config(`${SITE} ${settings}`, IMPORTS.vercel), ...VERCEL, ...files });

describe('runD8Checks', () => {
  it('skips CC25-CC28 unless the site renders drafts through its adapter (d8)', () => {
    // D3, preview off, a separate deploy (D4) and options doctor cannot read.
    for (const options of ['{ previewBuild: {} }', '{}', '{ previewBuild: { separate: true } }', 'options']) {
      const all = checks({ 'astro.config.mjs': config(SITE, '', options) });
      expect([...all.keys()]).toEqual(['CC25', 'CC26', 'CC27', 'CC28']);
      expect([...all.values()].every((outcome) => outcome.skipped !== undefined)).toBe(true);
    }
  });

  describe('CC25 the adapter', () => {
    it('passes an official adapter in its tested range on an astro above its floor', () => {
      const outcome = vercelSite('adapter: vercel(),').get('CC25');
      expect(outcome?.problems).toEqual([]);
      expect(outcome?.detail).toContain('@astrojs/vercel 11.0.18');
    });

    it('warns on an adapter Conloca does not test', () => {
      const text = config(`${SITE} adapter: deno(),`, "import deno from '@deno/astro-adapter';");
      expect(problems(checks({ 'astro.config.mjs': text, ...ASTRO }).get('CC25'))).toEqual([
        "warn: unsupported adapter @deno/astro-adapter: draft preview may work, Conloca doesn't test it",
      ]);
    });

    it('warns on a release outside the tested range', () => {
      const files = { ...ASTRO, ...installed('@astrojs/vercel', '12.0.0') };
      expect(
        problems(
          checks({ 'astro.config.mjs': config(`${SITE} adapter: vercel(),`, IMPORTS.vercel), ...files }).get('CC25'),
        ),
      ).toEqual(['warn: @astrojs/vercel 12.0.0 is outside the range Conloca tests draft preview with (^11.0.18)']);
    });

    it("errors when the site's astro is below the adapter's peer floor", () => {
      const files = { ...ASTRO, ...installed('@astrojs/cloudflare', '14.4.4', '^7.4.0') };
      const text = config(`${SITE} adapter: cloudflare(),`, IMPORTS.cloudflare);
      expect(problems(checks({ 'astro.config.mjs': text, ...files }).get('CC25'))).toContain(
        'error: @astrojs/cloudflare 14.4.4 needs astro 7.4.0 or later; this site has 7.3.1',
      );
    });
  });

  describe('CC26 what turns preview off', () => {
    it('errors on isr without the preview route excluded', () => {
      expect(problems(vercelSite('adapter: vercel({ isr: true }),').get('CC26'))[0]).toStartWith(
        'error: @astrojs/vercel isr caches /_conloca/preview/',
      );
    });

    it('errors on edge middleware', () => {
      expect(problems(vercelSite("adapter: vercel({ middlewareMode: 'edge' }),").get('CC26'))[0]).toStartWith(
        'error: draft preview does not run in edge middleware',
      );
    });

    it('warns, never errors, on computed adapter options', () => {
      for (const adapter of ['adapter: vercel(opts),', 'adapter: vercel({ ...opts }),']) {
        expect(problems(vercelSite(adapter).get('CC26'))).toEqual([
          "warn: doctor can't read middlewareMode from astro.config; the build reads it from the adapter and turns preview off if it is edge",
        ]);
      }
    });

    it('reads an adapter nested in previewBuild.config as no previewBuild.adapter', () => {
      const text = config(
        `${SITE} adapter: vercel(),`,
        IMPORTS.vercel,
        "{ previewBuild: { config: { adapter: 'x' } } }",
      );
      const messages = problems(checks({ 'astro.config.mjs': text, ...VERCEL }).get('CC26'));
      expect(messages).not.toContain('error: remove previewBuild.adapter; put the adapter in astro.config');
    });

    it('errors on previewBuild.adapter', () => {
      const text = config(SITE, '', '{ previewBuild: { adapter: node() } }');
      expect(problems(checks({ 'astro.config.mjs': text }).get('CC26'))).toEqual([
        'error: remove previewBuild.adapter; put the adapter in astro.config',
      ]);
    });

    it('errors on a separate preview deploy under Vercel', () => {
      const text = config(`${SITE} adapter: vercel(),`, IMPORTS.vercel, '{ previewBuild: { separate: true } }');
      expect(problems(checks({ 'astro.config.mjs': text, ...VERCEL }).get('CC26'))[0]).toContain(
        'previewBuild.separate is not supported with @astrojs/vercel',
      );
    });

    it('warns on previewBuild options that have no effect', () => {
      const text = config(
        `${SITE} adapter: vercel(),`,
        IMPORTS.vercel,
        "{ previewBuild: { outDir: 'x', required: true } }",
      );
      expect(problems(checks({ 'astro.config.mjs': text, ...VERCEL }).get('CC26'))).toEqual([
        "warn: previewBuild.outDir has no effect: drafts render in the site's own build",
        "warn: previewBuild.required has no effect: drafts render in the site's own build",
      ]);
    });
  });

  describe('CC27 routing and host notes', () => {
    it("warns on Vercel with build.format 'file'", () => {
      expect(problems(vercelSite("adapter: vercel(), build: { format: 'file' },").get('CC27'))).toContain(
        "warn: @astrojs/vercel builds build.format 'file' as 'directory', so page addresses lose their .html",
      );
    });

    it('notes that misses run the function on a static Vercel site without a 404 page, and names the firewall rule', () => {
      const without = vercelSite('adapter: vercel(),').get('CC27')?.detail ?? '';
      expect(without).toContain(
        'misses run the preview function unless the build can restore the static 404 route; add src/pages/404.astro',
      );
      expect(without).toContain(
        'Firewall → Add rule → If Request Path starts with /_conloca/preview/ → Rate Limit, 60 requests per 10 seconds per IP → Deny',
      );
      expect(vercelSite('adapter: vercel(),', { 'src/pages/404.astro': '' }).get('CC27')?.detail).not.toContain(
        '404.astro',
      );
    });

    it('notes what a miss costs on Netlify and names its rate limit', () => {
      const text = config(`${SITE} adapter: netlify(),`, IMPORTS.netlify);
      const files = { ...ASTRO, ...installed('@astrojs/netlify', '8.2.11') };
      const detail = checks({ 'astro.config.mjs': text, ...files }).get('CC27')?.detail ?? '';
      expect(detail).toContain("every missing URL, images included, runs your site's function");
      expect(detail).toContain('Rate limiting rule: path /_conloca/preview/*, 60 requests per 60 seconds per IP');
    });

    it('warns on Vercel or Netlify without a plain site', () => {
      const text = config('adapter: vercel(),', IMPORTS.vercel);
      expect(problems(checks({ 'astro.config.mjs': text, ...VERCEL }).get('CC27'))[0]).toStartWith(
        'warn: your own (non-CMS) pages open the published page instead of staying in the preview: set site in astro.config',
      );
    });

    it('does not warn about a site astro.config computes', () => {
      const text = config('site: process.env.SITE, adapter: vercel(),', IMPORTS.vercel);
      expect(problems(checks({ 'astro.config.mjs': text, ...VERCEL }).get('CC27'))).toEqual([]);
    });

    it('names the wrangler file the site has, and accepts a "none" connect kept', () => {
      const files = { ...ASTRO, ...installed('@astrojs/cloudflare', '14.3.2', '^7.2.0') };
      const text = config(`${SITE} adapter: cloudflare(),`, IMPORTS.cloudflare);
      const [warning] = problems(checks({ 'astro.config.mjs': text, ...files, 'wrangler.json': '{}' }).get('CC27'));
      expect(warning).toStartWith('warn: wrangler.json does not route');
      const routes = ['/_conloca/preview', '/_conloca/preview/*'];
      const none = JSON.stringify({ assets: { run_worker_first: routes, not_found_handling: 'none' } });
      expect(checks({ 'astro.config.mjs': text, ...files, 'wrangler.jsonc': none }).get('CC27')?.problems).toEqual([]);
    });

    it('warns on a static Cloudflare site whose wrangler config lacks the routing, and takes the moved image endpoint from the build', () => {
      const files = { ...ASTRO, ...installed('@astrojs/cloudflare', '14.3.2', '^7.2.0') };
      const text = config(`${SITE} adapter: cloudflare(),`, IMPORTS.cloudflare);
      expect(
        problems(checks({ 'astro.config.mjs': text, ...files, 'wrangler.jsonc': '{ "name": "s" }' }).get('CC27')),
      ).toEqual([
        'warn: wrangler.jsonc does not route the preview to the Cloudflare Worker: add /_conloca/preview, /_conloca/preview/* to assets.run_worker_first and set assets.not_found_handling to "404-page" — run `conloca connect --update --yes`',
      ]);
      // The build moved the image endpoint under the preview route, so its list has no /_image entry.
      const built = ['/_conloca/preview', '/_conloca/preview/*', '/_server-islands/*'];
      const routed = JSON.stringify({ name: 's', assets: { run_worker_first: built, not_found_handling: '404-page' } });
      const fine = checks({
        'astro.config.mjs': text,
        ...files,
        'wrangler.jsonc': routed,
        '.conloca/dispatcher/run_worker_first.json': JSON.stringify(built),
      });
      expect(fine.get('CC27')?.problems).toEqual([]);
    });

    it('wants the /_image entry the build listed when the image endpoint stayed', () => {
      const files = { ...ASTRO, ...installed('@astrojs/cloudflare', '14.3.2', '^7.2.0') };
      const text = config(`${SITE} adapter: cloudflare(),`, IMPORTS.cloudflare);
      const built = ['/_conloca/preview', '/_conloca/preview/*', '/_image'];
      const wrangler = JSON.stringify({
        name: 's',
        assets: { run_worker_first: ['/_conloca/preview', '/_conloca/preview/*'], not_found_handling: '404-page' },
      });
      const outcome = checks({
        'astro.config.mjs': text,
        ...files,
        'wrangler.jsonc': wrangler,
        '.conloca/dispatcher/run_worker_first.json': JSON.stringify(built),
      }).get('CC27');
      expect(problems(outcome)[0]).toContain('add /_image to assets.run_worker_first');
    });

    it('asks to convert a wrangler.toml for the Cloudflare adapter', () => {
      const files = { ...ASTRO, ...installed('@astrojs/cloudflare', '14.3.2', '^7.2.0') };
      const text = config(`${SITE} adapter: cloudflare(),`, IMPORTS.cloudflare);
      expect(
        problems(checks({ 'astro.config.mjs': text, ...files, 'wrangler.toml': 'name = "s"\n' }).get('CC27')),
      ).toEqual(['warn: convert wrangler.toml to wrangler.jsonc, then run conloca connect --update --yes']);
    });

    it('takes any src/pages/404 page as the static 404 route', () => {
      expect(vercelSite('adapter: vercel(),', { 'src/pages/404.md': '# 404' }).get('CC27')?.detail).not.toContain(
        '404.astro',
      );
    });
  });

  describe('CC28 Node', () => {
    it('errors without security.allowedDomains, and passes with it', () => {
      const files = { ...ASTRO, ...installed('@astrojs/node', '11.1.9', '^7.2.1') };
      const without = config(`${SITE} adapter: node({ mode: 'standalone' }),`, IMPORTS.node);
      expect(problems(checks({ 'astro.config.mjs': without, ...files }).get('CC28'))).toEqual([
        'error: add security.allowedDomains with your domains (connect writes it): without it every preview entry fails behind a TLS proxy',
      ]);
      const allowed = config(
        `${SITE} adapter: node({ mode: 'standalone' }), security: { allowedDomains: [{ hostname: 'www.acme.test' }] },`,
        IMPORTS.node,
      );
      expect(checks({ 'astro.config.mjs': allowed, ...files }).get('CC28')?.problems).toEqual([]);
    });
    it('warns on an empty allowedDomains', () => {
      const files = { ...ASTRO, ...installed('@astrojs/node', '11.1.9', '^7.2.1') };
      const empty = config(
        `${SITE} adapter: node({ mode: 'standalone' }), security: { allowedDomains: [] },`,
        IMPORTS.node,
      );
      expect(problems(checks({ 'astro.config.mjs': empty, ...files }).get('CC28'))).toEqual([
        'warn: security.allowedDomains is empty: add your domains, or every preview entry fails behind a TLS proxy',
      ]);
    });
  });

  describe('installed packages', () => {
    it('finds an adapter installed further up a monorepo', () => {
      const dir = '/repo/apps/sites/web';
      const files = {
        'astro.config.mjs': config(`${SITE} adapter: vercel(),`, IMPORTS.vercel),
        '../../../node_modules/astro/package.json': '{"version":"7.3.1"}',
        '../../../node_modules/@astrojs/vercel/package.json': JSON.stringify({ version: '11.0.18' }),
      };
      expect(checks(files, dir).get('CC25')?.detail).toBe('@astrojs/vercel 11.0.18');
    });
  });
});
