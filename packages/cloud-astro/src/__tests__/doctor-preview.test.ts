import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { runPreviewChecks } from '../doctor/checks-preview.js';
import { scanAstroConfig } from '../doctor/config-scan.js';
import type { CheckOutcome } from '../doctor/types.js';

const P = '/proj';
const D3 =
  "import { conlocaCloud } from '@conloca/cloud-astro';\nexport default { integrations: [conlocaCloud({ previewBuild: {} })] };";
const D4 =
  "import { conlocaCloud } from '@conloca/cloud-astro';\nexport default { integrations: [conlocaCloud({ previewBuild: { separate: true } })] };";
const LIMIT = [{ name: 'conlocaPreviewLimit', namespace_id: '1001', simple: { limit: 60, period: 10 } }];
const GOOD = JSON.stringify({
  name: 'site',
  main: '.conloca/dispatcher/index.mjs',
  compatibility_flags: ['nodejs_compat'],
  ratelimits: LIMIT,
  assets: {
    binding: 'ASSETS',
    not_found_handling: '404-page',
    run_worker_first: ['/_conloca/preview', '/_conloca/preview/*', '/api/*'],
  },
});
/** The assets keys a test overrides; a named type, since anti-slop refuses `object` and open dictionaries as parameters. */
interface AssetsPatch {
  run_worker_first?: string[] | true;
  not_found_handling?: string;
}
const withAssets = (assets: AssetsPatch) =>
  JSON.stringify({ ...JSON.parse(GOOD), assets: { ...JSON.parse(GOOD).assets, ...assets } });

function checks(files: Record<string, string>, tracked: string[] = []): Map<string, CheckOutcome> {
  const all = {
    [join(P, 'astro.config.mjs')]: D3,
    ...Object.fromEntries(Object.entries(files).map(([k, v]) => [join(P, k), v])),
  };
  const deps = {
    exists: (path: string) => path in all,
    readFile: (path: string) => {
      const text = all[path];
      if (text === undefined) throw new Error(`ENOENT ${path}`);
      return text;
    },
    git: (args: string[]) => (args[0] === 'ls-files' ? tracked.join('\n') : undefined),
  };
  return new Map(runPreviewChecks(scanAstroConfig(P, deps), P, deps).map((outcome) => [outcome.id, outcome]));
}
const errors = (outcome: CheckOutcome | undefined) => outcome?.problems.map((p) => `${p.level}: ${p.message}`) ?? [];
const WRANGLER_436 = { 'node_modules/wrangler/package.json': '{"version":"4.141.0"}' };
const NOT_FOUND_PAGE = { 'src/pages/404.astro': '<h1>404</h1>' };
/** CC17 for a D4 site with this wrangler.jsonc. */
const d4 = (wrangler: string) => checks({ 'astro.config.mjs': D4, 'wrangler.jsonc': wrangler }).get('CC17');
/** Why CC17 skipped for these files, if it did. */
const skippedOf = (files: Record<string, string>) => checks(files).get('CC17')?.skipped;

describe('runPreviewChecks', () => {
  it('skips every check when previewBuild is off', () => {
    const all = checks({ 'astro.config.mjs': 'export default { integrations: [conlocaCloud({})] };' });
    expect([...all.values()].every((outcome) => outcome.skipped !== undefined)).toBe(true);
  });

  it('skips every check when the build refuses separate: true under Vercel', () => {
    const config = [
      "import vercel from '@astrojs/vercel';",
      "import { conlocaCloud } from '@conloca/cloud-astro';",
      'export default { adapter: vercel(), integrations: [conlocaCloud({ previewBuild: { separate: true } })] };',
    ].join('\n');
    const all = checks({ 'astro.config.mjs': config, 'wrangler.jsonc': GOOD });
    expect([...all.values()].every((outcome) => outcome.skipped !== undefined)).toBe(true);
    expect(all.get('CC15')?.skipped).toBe('the build refuses separate: true under @astrojs/vercel (see CC26)');
  });

  it('CC15 errors without a wrangler config, on a TOML one and on a Pages one', () => {
    expect(errors(checks({}).get('CC15'))).toEqual([
      'error: no wrangler.jsonc: draft previews of a static site deploy to Cloudflare Workers — run `conloca connect --yes`',
    ]);
    expect(errors(checks({ 'wrangler.toml': 'name = "s"\n' }).get('CC15'))).toEqual([
      "error: wrangler.toml can't carry the preview settings: convert it to wrangler.jsonc, then run `conloca connect --update --yes`",
    ]);
    expect(
      errors(checks({ 'wrangler.jsonc': '{"name":"s","pages_build_output_dir":"./dist"}' }).get('CC15'))[0],
    ).toContain('Cloudflare Pages');
    expect(checks({ 'wrangler.jsonc': GOOD }).get('CC15')?.problems).toEqual([]);
  });

  it('CC16 needs Wrangler 4.36 or newer under D3, warns when it is not installed, and skips under D4', () => {
    expect(checks({ 'wrangler.jsonc': GOOD, ...WRANGLER_436 }).get('CC16')?.problems).toEqual([]);
    expect(
      errors(
        checks({ 'wrangler.jsonc': GOOD, 'node_modules/wrangler/package.json': '{"version":"4.35.0"}' }).get('CC16'),
      ),
    ).toEqual([
      'error: wrangler 4.35.0 cannot deploy the preview settings: run_worker_first patterns and the ratelimits binding need wrangler 4.36 or newer',
    ]);
    expect(errors(checks({ 'wrangler.jsonc': GOOD }).get('CC16'))[0]).toStartWith('warn:');
    expect(checks({ 'astro.config.mjs': D4, 'wrangler.jsonc': '{"name":"s"}' }).get('CC16')?.skipped).toBeDefined();
  });

  it('CC17 names each missing dispatcher setting', () => {
    const outcome = checks({
      'wrangler.jsonc': JSON.stringify({ name: 's', assets: { not_found_handling: 'single-page-application' } }),
    }).get('CC17');
    expect(errors(outcome)).toEqual([
      'error: main is not .conloca/dispatcher/index.mjs — run `conloca connect --update --yes`',
      'error: compatibility_flags lacks nodejs_compat — run `conloca connect --update --yes`',
      'error: assets.binding is not ASSETS — run `conloca connect --update --yes`',
      'error: run_worker_first lacks /_conloca/preview, /_conloca/preview/* — run `conloca connect --update --yes`',
      'error: not_found_handling is single-page-application; previews need "404-page" or "none" — run `conloca connect --update --yes`',
    ]);
    expect(checks({ 'wrangler.jsonc': GOOD }).get('CC17')?.problems).toEqual([]);
  });

  it('CC17 flags an env block that replaces main or assets, an exclusion of the prefix, and a list past 100', () => {
    const env = JSON.stringify({ ...JSON.parse(GOOD), env: { staging: { assets: { directory: './dist' } } } });
    expect(errors(checks({ 'wrangler.jsonc': env }).get('CC17'))).toContain(
      "error: env.staging sets main or assets, which replaces the dispatcher's — remove them from the env block",
    );
    const excluded = withAssets({
      run_worker_first: ['/_conloca/preview', '/_conloca/preview/*', '!/_conloca/preview/*'],
    });
    expect(errors(checks({ 'wrangler.jsonc': excluded }).get('CC17'))).toContain(
      'error: run_worker_first excludes the preview route (!/_conloca/preview/*) — remove that entry',
    );
    const long = withAssets({
      run_worker_first: ['/_conloca/preview', '/_conloca/preview/*', ...Array.from({ length: 99 }, (_, i) => `/r${i}`)],
    });
    expect(errors(checks({ 'wrangler.jsonc': long }).get('CC17'))).toContain(
      "error: run_worker_first has 101 entries, past Cloudflare's cap of 100 — merge some into wider patterns",
    );
    expect(checks({ 'wrangler.jsonc': withAssets({ run_worker_first: true }) }).get('CC17')?.problems).toEqual([]);
  });

  it('CC17 under D4 reports a main that still names the D3 dispatcher', () => {
    const left = JSON.stringify({ name: 's', main: '.conloca/dispatcher/index.mjs' });
    expect(errors(checks({ 'astro.config.mjs': D4, 'wrangler.jsonc': left }).get('CC17'))).toEqual([
      'error: main is the D3 dispatcher, which a separate preview deploy (D4) inherits and its main deploy no longer builds — run `conloca connect --update --yes`',
    ]);
    expect(checks({ 'astro.config.mjs': D4, 'wrangler.jsonc': '{"name":"s"}' }).get('CC17')?.problems).toEqual([]);
  });

  it('CC17 under D4 says what it checks, and flags a binding or run_worker_first left without a script', () => {
    expect(d4('{"name":"s"}')?.label).toBe('wrangler.jsonc keeps no D3 dispatcher settings');
    expect(
      errors(d4(JSON.stringify({ name: 's', assets: { binding: 'ASSETS', run_worker_first: ['/mcp'] } }))),
    ).toEqual([
      'error: assets.binding without main: Wrangler refuses an assets binding on a deploy with no script — run `conloca connect --update --yes`',
      'error: run_worker_first without main: Wrangler refuses it on a deploy with no script — remove it, or set main to a script of your own',
    ]);
    expect(
      errors(
        d4(
          JSON.stringify({
            name: 's',
            main: 'src/entry.ts',
            assets: { binding: 'ASSETS', run_worker_first: ['/mcp'] },
          }),
        ),
      ),
    ).toEqual([]);
  });

  it('CC17 under D4 suggests connect only for what connect removes, and the manual fix otherwise', () => {
    const own = ['/_conloca/preview', '/_conloca/preview/*', '/_image'];
    expect(errors(d4(JSON.stringify({ name: 's', assets: { run_worker_first: own } })))).toEqual([
      'error: run_worker_first without main: Wrangler refuses it on a deploy with no script — run `conloca connect --update --yes`',
    ]);
    expect(errors(d4(JSON.stringify({ name: 's', assets: { binding: 'STATIC', run_worker_first: [] } })))).toEqual([
      'error: assets.binding without main: Wrangler refuses an assets binding on a deploy with no script — remove assets.binding',
      'error: run_worker_first without main: Wrangler refuses it on a deploy with no script — remove it, or set main to a script of your own',
    ]);
  });

  it('CC17 is skipped, not green, without a wrangler.jsonc', () => {
    const toml = 'name = "s"\n';
    expect(skippedOf({})).toBe('no wrangler.jsonc (see CC15)');
    expect(skippedOf({ 'wrangler.toml': toml })).toBe('no wrangler.jsonc (see CC15)');
    expect(skippedOf({ 'astro.config.mjs': D4 })).toBe('no wrangler.jsonc (see CC15)');
    expect(skippedOf({ 'astro.config.mjs': D4, 'wrangler.toml': toml })).toBe('no wrangler.jsonc (see CC15)');
  });

  it('CC18 holds run_worker_first against the routes the last build reported', () => {
    const built = {
      '.conloca/dispatcher/run_worker_first.json': '["/_conloca/preview","/_conloca/preview/*","/api/*","/mcp"]',
    };
    expect(errors(checks({ 'wrangler.jsonc': GOOD, ...built }).get('CC18'))).toEqual([
      'error: run_worker_first lacks /mcp, which the last build renders on demand — run `conloca connect --update --yes`',
    ]);
    expect(checks({ 'wrangler.jsonc': GOOD }).get('CC18')?.skipped).toBe(
      'no build yet: build the site, then run doctor',
    );
  });

  it('CC19 errors on a deploy redirect that would ship the preview server', () => {
    const redirect = {
      '.wrangler/deploy/config.json': '{"configPath":"../../.conloca/preview-server/server/wrangler.json"}',
    };
    expect(errors(checks({ 'wrangler.jsonc': GOOD, ...redirect }).get('CC19'))[0]).toContain(
      'a plain `wrangler deploy` would ship the preview server',
    );
    expect(checks({ 'wrangler.jsonc': GOOD }).get('CC19')?.problems).toEqual([]);
  });

  it('CC20 warns about a missing 404 page, reading the built one when there is a build', () => {
    expect(errors(checks({ 'wrangler.jsonc': GOOD }).get('CC20'))).toEqual([
      'warn: no 404 page: with not_found_handling "404-page" Cloudflare answers a miss with an empty 404 and never starts the dispatcher — add src/pages/404.astro',
    ]);
    expect(checks({ 'wrangler.jsonc': GOOD, ...NOT_FOUND_PAGE }).get('CC20')?.problems).toEqual([]);
    // A CMS-rendered or [lang] 404 page shows only in the build.
    expect(
      checks({ 'wrangler.jsonc': GOOD, 'dist/index.html': '<p>home</p>', 'dist/404.html': '<h1>404</h1>' }).get('CC20')
        ?.problems,
    ).toEqual([]);
  });

  it('CC20 detects negotiation by heuristic, only warning: a negotiating middleware gets the flag for "none", or static pages', () => {
    const negotiating = {
      'src/middleware.ts':
        "export const onRequest = (c, next) => c.request.headers.get('accept')?.includes('text/markdown') ? md() : next();",
    };
    expect(errors(checks({ 'wrangler.jsonc': GOOD, ...NOT_FOUND_PAGE, ...negotiating }).get('CC20'))).toEqual([
      'warn: the middleware negotiates responses: either (a) run `conloca connect --update --yes --negotiate-404` (not_found_handling "none") and list the negotiated paths in run_worker_first, or (b) keep "404-page" and accept static responses',
    ]);
    const none = withAssets({ not_found_handling: 'none' });
    expect(checks({ 'wrangler.jsonc': none, ...negotiating }).get('CC20')?.detail).toBe(
      'not_found_handling is "none": every miss reaches the dispatcher, so the middleware negotiates them; its negotiated pages need run_worker_first entries too',
    );
  });

  it('CC21 warns when a tracked file loads a tag manager, and skips under D4', () => {
    const gtm = { 'src/layouts/Base.astro': '<script src="https://www.googletagmanager.com/gtm.js?id=X"></script>' };
    expect(errors(checks({ 'wrangler.jsonc': GOOD, ...gtm }, ['src/layouts/Base.astro']).get('CC21'))).toEqual([
      'warn: src/layouts/Base.astro loads a tag manager (googletagmanager.com): it runs on draft pages and can read them — previewBuild: { separate: true } keeps drafts on a deploy no tag reads',
    ]);
    expect(
      checks({ 'astro.config.mjs': D4, 'wrangler.jsonc': '{"name":"s"}', ...gtm }, ['src/layouts/Base.astro']).get(
        'CC21',
      )?.skipped,
    ).toBeDefined();
  });
});
