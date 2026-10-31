import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { runPreviewLimitChecks } from '../doctor/checks-preview-limits.js';
import { scanAstroConfig } from '../doctor/config-scan.js';
import type { CheckOutcome } from '../doctor/types.js';

const P = '/proj';
const D3 =
  "import { conlocaCloud } from '@conloca/cloud-astro';\nexport default { integrations: [conlocaCloud({ previewBuild: {} })] };";
const D4 =
  "import { conlocaCloud } from '@conloca/cloud-astro';\nexport default { integrations: [conlocaCloud({ previewBuild: { separate: true } })] };";
const LIMIT = { name: 'conlocaPreviewLimit', namespace_id: '1234', simple: { limit: 60, period: 10 } };
interface EnvBlock {
  name: string;
  ratelimits?: (typeof LIMIT)[];
}
/** The top-level keys a test adds; named, since anti-slop refuses `object` and open dictionaries as parameters. */
interface WranglerExtra {
  env?: { production?: EnvBlock; staging?: EnvBlock };
}
const wrangler = (extra: WranglerExtra = {}) => JSON.stringify({ name: 'site', ratelimits: [LIMIT], ...extra });
const manifest = (plan?: string) =>
  JSON.stringify({ name: 'site', ...(plan === undefined ? {} : { conloca: { cfPlan: plan } }) });
const ROUTES = (...extra: string[]) =>
  JSON.stringify(['/_conloca/preview', '/_conloca/preview/*', '/_image', ...extra]);

function checks(files: Record<string, string>, config = D3): Map<string, CheckOutcome> {
  const all = Object.fromEntries(
    Object.entries({ 'astro.config.mjs': config, ...files }).map(([path, text]) => [join(P, path), text]),
  );
  const deps = {
    exists: (path: string) => path in all,
    readFile: (path: string) => {
      const text = all[path];
      if (text === undefined) throw new Error(`ENOENT ${path}`);
      return text;
    },
  };
  return new Map(runPreviewLimitChecks(scanAstroConfig(P, deps), P, deps).map((outcome) => [outcome.id, outcome]));
}
const messages = (outcome: CheckOutcome | undefined) => outcome?.problems.map((p) => `${p.level}: ${p.message}`) ?? [];

describe('CC22 — the preview route is rate-limited on the Paid plan', () => {
  it('passes on the binding connect writes', () => {
    const outcome = checks({ 'wrangler.jsonc': wrangler(), 'package.json': manifest('paid') }).get('CC22');
    expect(outcome?.problems).toEqual([]);
    expect(outcome?.detail).toBe('60 preview requests per 10 s per visitor');
  });

  it('errors on a missing binding on the Paid plan, and when no plan is recorded, naming the fix', () => {
    for (const files of [{ 'package.json': manifest('paid') }, { 'package.json': manifest() }]) {
      expect(messages(checks({ 'wrangler.jsonc': '{"name":"site"}', ...files }).get('CC22'))).toEqual([
        'error: wrangler.jsonc has no conlocaPreviewLimit rate-limit binding, so nothing limits preview requests — run `conloca connect --update --yes`',
      ]);
    }
  });

  it('expects none on the Free plan, and notes one that is there without failing', () => {
    // On Free a blocked request still counts against the quota, so connect writes no binding.
    const none = checks({ 'wrangler.jsonc': '{"name":"site"}', 'package.json': manifest('free') }).get('CC22');
    expect(none?.problems).toEqual([]);
    expect(none?.detail).toBe('no rate limit on the Cloudflare Workers Free plan, as expected');
    const present = checks({ 'wrangler.jsonc': wrangler(), 'package.json': manifest('free') }).get('CC22');
    expect(present?.problems).toEqual([]);
    expect(present?.detail).toBe(
      'a conlocaPreviewLimit binding is there; the Free plan needs none, and `conloca connect --update --yes` removes it',
    );
  });

  it('errors on other numbers or a malformed namespace', () => {
    const loose = { ...LIMIT, simple: { limit: 1000, period: 60 } };
    expect(
      messages(
        checks({
          'wrangler.jsonc': JSON.stringify({ name: 's', ratelimits: [loose] }),
          'package.json': manifest('paid'),
        }).get('CC22'),
      ),
    ).toEqual([
      'error: wrangler.jsonc limits previews to 1000 requests per 60 s; previews use 60 per 10 s — run `conloca connect --update --yes`',
    ]);
    const unnamed = { ...LIMIT, namespace_id: 'abc' };
    expect(
      messages(
        checks({
          'wrangler.jsonc': JSON.stringify({ name: 's', ratelimits: [unnamed] }),
          'package.json': manifest('paid'),
        }).get('CC22'),
      )[0],
    ).toContain('namespace_id must be a positive integer');
  });

  it('checks every env block on the Paid plan, since Wrangler does not inherit bindings', () => {
    const config = wrangler({
      env: { production: { name: 'site', ratelimits: [LIMIT] }, staging: { name: 'site-staging' } },
    });
    expect(messages(checks({ 'wrangler.jsonc': config, 'package.json': manifest('paid') }).get('CC22'))).toEqual([
      'error: wrangler.jsonc env.staging has no conlocaPreviewLimit rate-limit binding, so nothing limits preview requests — run `conloca connect --update --yes`',
    ]);
  });

  it('skips a separate preview deploy and a project with no wrangler config', () => {
    expect(checks({ 'wrangler.jsonc': '{"name":"s"}' }, D4).get('CC22')?.skipped).toBeDefined();
    expect(checks({}).get('CC22')?.skipped).toBe('no wrangler.jsonc (see CC15)');
  });
});

describe('CC23 — the recorded Cloudflare plan fits draft previews', () => {
  it('passes on the Paid plan', () => {
    expect(checks({ 'package.json': manifest('paid') }).get('CC23')?.detail).toBe(
      'the Cloudflare Workers Paid plan, recorded in package.json',
    );
  });

  it('errors when no plan is recorded, naming both ways to record it', () => {
    expect(messages(checks({ 'package.json': manifest() }).get('CC23'))).toEqual([
      'error: package.json records no Cloudflare plan (conloca.cfPlan) — run `conloca connect`, or `conloca connect --yes --cf-plan paid` (or `free`)',
    ]);
  });

  it('on the Free plan, warns that previews and the on-demand routes share one daily quota, and sends nothing to D4', () => {
    const outcome = checks({
      'package.json': manifest('free'),
      '.conloca/dispatcher/run_worker_first.json': ROUTES('/api/*', '/mcp'),
    }).get('CC23');
    expect(messages(outcome)).toEqual([
      'warn: On the Free plan, previews and your on-demand routes (/api/*, /mcp) share one daily request quota; a flood of preview requests can stop those routes until 00:00 UTC. Cloudflare Workers Paid removes the daily limit.',
    ]);
  });

  it('on the Free plan without on-demand routes, warns about CPU and the daily quota', () => {
    const outcome = checks({
      'package.json': manifest('free'),
      '.conloca/dispatcher/run_worker_first.json': ROUTES(),
    }).get('CC23');
    expect(outcome?.problems).toEqual([expect.objectContaining({ level: 'warn' })]);
    expect(messages(outcome)[0]).toContain('never the published pages');
  });

  it('skips a separate preview deploy', () => {
    expect(checks({ 'package.json': manifest() }, D4).get('CC23')?.skipped).toBeDefined();
  });
});
