import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import type { SitesConfig } from '@conloca/content-api';
import type { EditorPageInfo } from '@conloca/content-api/editor-host';
import { runDoctor } from '../doctor/run.js';
import type { CheckOutcome, DoctorDeps } from '../doctor/types.js';

const PROJECT = '/proj';
const CONTENT = join(PROJECT, 'content');
const CONFIG = join(PROJECT, 'astro.config.mjs');
const ADDRESS = 'https://www.acme.test/';
const INFO_URL = `${ADDRESS}_conloca/editor/conloca.json`;
const PAGE_URL = `${ADDRESS}_conloca/editor/`;
const PROTOCOLS_URL = 'https://app.conloca.com/host/protocols.json';
const HEAD = 'a'.repeat(40);
const LIVE_IDS = ['CC11', 'CC12', 'CC13'];

/** A config with both integrations wired and conlocaCloud(<options>). */
const config = (options: string) =>
  [
    "import { conlocaCMS } from '@conloca/astro-cms/node';",
    "import { conlocaCloud } from '@conloca/cloud-astro';",
    `export default { integrations: [conlocaCMS({}), conlocaCloud(${options})] };`,
  ].join('\n');

const sitesJson = (site: Partial<SitesConfig['sites'][string]> = { domains: { en: 'www.acme.test' } }) =>
  JSON.stringify({
    siteId: 'marketing',
    sites: { default: { locales: ['en'], defaultLocale: 'en', ...site } },
    globalLocales: ['en'],
  });

const FILES = { [CONFIG]: config('{}'), [join(CONTENT, 'sites.json')]: sitesJson() };

/** The checkout: its remote names acme/site and HEAD is the deployed commit. No environment needed. */
const GIT = new Map([
  ['config --get remote.origin.url', 'git@github.com:acme/site.git'],
  ['rev-parse HEAD', HEAD],
]);

const info = (overrides: Partial<EditorPageInfo> = {}): EditorPageInfo => ({
  protocol: 1,
  repo: 'acme/site',
  siteId: 'marketing',
  commit: HEAD,
  branch: 'main',
  builtWith: '@conloca/cloud-astro@1.2.3',
  componentManifest: null,
  ...overrides,
});

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' }, ...init });

type Routes = Record<string, () => Response>;

const ROUTES = {
  [INFO_URL]: () => json(info()),
  [PAGE_URL]: () => new Response('<!doctype html>', { headers: { 'content-type': 'text/html' } }),
  [PROTOCOLS_URL]: () => json({ min: 1, max: 1 }),
} satisfies Routes;

/** The editor page with these response headers. */
const page = (headers: Record<string, string>) => () => new Response('<!doctype html>', { headers });

interface Call {
  url: string;
  authorization: string | null;
  cookie: string | null;
  credentials: RequestInit['credentials'];
  redirect: RequestInit['redirect'];
  /** Every doctor request must be bounded by a timeout signal. */
  timed: boolean;
}

async function runLive(routes: Routes = ROUTES, files = FILES, env: Record<string, string | undefined> = {}) {
  const calls: Call[] = [];
  const gitDirs: (string | undefined)[] = [];
  const fetchFn: DoctorDeps['fetch'] = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const headers = new Headers(init?.headers);
    calls.push({
      url,
      authorization: headers.get('authorization'),
      cookie: headers.get('cookie'),
      credentials: init?.credentials,
      redirect: init?.redirect,
      timed: init?.signal instanceof AbortSignal,
    });
    const responder = routes[url];
    if (!responder) throw new Error(`ECONNREFUSED ${url}`);
    return responder();
  };
  const result = await runDoctor(
    { contractVersion: 1, projectDir: PROJECT, contentRoot: CONTENT, live: true },
    {
      env,
      exists: (p) => p in files,
      readFile: (p) => {
        const t = files[p];
        if (t === undefined) throw new Error('ENOENT');
        return t;
      },
      git: (args, cwd) => {
        gitDirs.push(cwd);
        return GIT.get(args.join(' '));
      },
      fetch: fetchFn,
    },
  );
  const check = (id: string): CheckOutcome => {
    const c = result.checks.find((x) => x.id === id);
    if (!c) throw new Error(id);
    return c;
  };
  return {
    result,
    check,
    calls,
    gitDirs,
    messages: (id: string) => check(id).problems.map((p) => `${p.level}: ${p.message}`),
  };
}

describe('doctor --live — the deployed editor page', () => {
  it('runs every live check with no token and no environment', async () => {
    const { check, calls } = await runLive();
    for (const id of LIVE_IDS) {
      expect(check(id).skipped).toBeUndefined();
      expect(check(id).problems).toEqual([]);
    }
    expect(check('CC11').detail).toBe(`${PAGE_URL} serves site "marketing" of acme/site at ${HEAD.slice(0, 7)}`);
    expect(check('CC12').detail).toBe(`${PAGE_URL} may be framed by https://*.conloca.com`);
    expect(check('CC13').detail).toBe('protocol 1, the editor speaks 1–1');
    // Only the site's own address and the editor's public file; never a credential; never a followed redirect.
    expect(calls.map((c) => c.url)).toHaveLength(3);
    expect(calls.map((c) => c.url)).toEqual(expect.arrayContaining([PAGE_URL, INFO_URL, PROTOCOLS_URL]));
    for (const call of calls) {
      expect(call).toMatchObject({ authorization: null, cookie: null, redirect: 'manual', timed: true });
      expect(call.credentials === undefined || call.credentials === 'omit').toBe(true);
    }
  });

  it('no longer reports CC2–CC7 or CC4', async () => {
    const { result } = await runLive();
    expect(result.checks.map((c) => c.id)).toEqual(['CC1', 'CC9', 'CC10', 'CC14', 'CC8', 'CC11', 'CC12', 'CC13']);
  });

  it('asks every git question in the project directory', async () => {
    const { gitDirs } = await runLive();
    // The remote (CC1, CC11), HEAD (CC11) and the tracked workflows (CC14).
    expect(gitDirs).toHaveLength(3);
    expect(new Set(gitDirs)).toEqual(new Set([PROJECT]));
  });

  it('skips the live checks with a reason when CC9 fails', async () => {
    const { check, calls } = await runLive(ROUTES, { ...FILES, [join(CONTENT, 'sites.json')]: sitesJson({}) });
    for (const id of LIVE_IDS) expect(check(id).skipped).toBe('no site domain (see CC9)');
    expect(calls).toEqual([]);
  });

  it('skips the live checks when conlocaCloud is not called', async () => {
    const cmsOnly =
      "import { conlocaCMS } from '@conloca/astro-cms/node';\nexport default { integrations: [conlocaCMS({})] };";
    const { check, calls } = await runLive(ROUTES, { ...FILES, [CONFIG]: cmsOnly });
    for (const id of LIVE_IDS) expect(check(id).skipped).toBe('conlocaCloud(...) is not called in the astro config');
    expect(calls).toEqual([]);
  });
});

describe('CC11 — the deployed editor page answers', () => {
  it('CC11 errors per status with its own message', async () => {
    const table: [string, () => Response, string][] = [
      [
        '404',
        () => new Response('nope', { status: 404 }),
        `error: ${INFO_URL} is not deployed — deploy the commit that adds conlocaCloud() to astro.config`,
      ],
      [
        'text/html 200',
        () => new Response('<!doctype html>', { headers: { 'content-type': 'text/html' } }),
        `error: ${INFO_URL} is not deployed — deploy the commit that adds conlocaCloud() to astro.config`,
      ],
      [
        '401',
        () => new Response('', { status: 401 }),
        `error: ${INFO_URL} asks visitors to sign in — put the public production address in sites.json, or let visitors through`,
      ],
      [
        'Vercel sign-in',
        () => new Response('', { status: 307, headers: { location: 'https://vercel.com/login?next=x' } }),
        `error: ${INFO_URL} asks visitors to sign in (Vercel Deployment Protection) — put the public production address in sites.json, or let visitors through`,
      ],
      [
        '503',
        () => new Response('', { status: 503 }),
        `error: ${INFO_URL} answers HTTP 503 — the site is down or limiting requests; try again later`,
      ],
      [
        'wrong repo',
        () => json(info({ repo: 'other/site' })),
        `error: ${ADDRESS} serves the editor page of other/site, not acme/site — check domains in sites.json`,
      ],
      [
        'wrong site',
        () => json(info({ siteId: 'docs' })),
        `error: ${ADDRESS} serves site "docs", not "marketing" — check siteId in sites.json`,
      ],
      [
        'bad JSON',
        () => json({ protocol: 'one' }),
        `error: ${INFO_URL} is not a conloca.json the editor can read — check that the host serves the built file unchanged`,
      ],
    ];
    const results = await Promise.all(table.map(([, responder]) => runLive({ ...ROUTES, [INFO_URL]: responder })));
    expect(results.map((run) => run.messages('CC11'))).toEqual(table.map(([, , message]) => [message]));
  });

  it('errors when the address cannot be reached', async () => {
    const { [INFO_URL]: _gone, ...routes } = ROUTES;
    const { messages } = await runLive(routes);
    expect(messages('CC11')).toEqual([`error: ${INFO_URL} could not be reached (ECONNREFUSED ${INFO_URL})`]);
  });

  it('CC11 errors on a page without repo', async () => {
    const { messages } = await runLive({ ...ROUTES, [INFO_URL]: () => json(info({ repo: null })) });
    expect(messages('CC11')).toEqual([
      `error: ${INFO_URL} names no repository because the build could not read the git remote — set repoUri in conlocaCloud(...)`,
    ]);
  });

  it('CC11 warns when the deployed commit is behind the checkout', async () => {
    const deployed = 'b'.repeat(40);
    const { messages } = await runLive({ ...ROUTES, [INFO_URL]: () => json(info({ commit: deployed })) });
    expect(messages('CC11')).toEqual([
      `warn: ${ADDRESS} is serving ${deployed.slice(0, 7)}, your checkout is at ${HEAD.slice(0, 7)} — deploy to see your latest components in the editor`,
    ]);
  });

  it('reads at most 16 KiB of conloca.json, counted in bytes', async () => {
    // 9000 two-byte characters: under 16 KiB of characters, over 16 KiB of bytes.
    const { messages } = await runLive({
      ...ROUTES,
      [INFO_URL]: () => json({ ...info(), note: 'é'.repeat(9000) }),
    });
    expect(messages('CC11')).toEqual([
      `error: ${INFO_URL} is not a conloca.json the editor can read — check that the host serves the built file unchanged`,
    ]);
  });
});

describe('CC12 — the deployed editor page may be framed', () => {
  it('CC12 errors naming X-Frame-Options or frame-ancestors', async () => {
    const xfo = await runLive({ ...ROUTES, [PAGE_URL]: page({ 'x-frame-options': 'DENY' }) });
    expect(xfo.messages('CC12')).toEqual([
      `error: ${PAGE_URL} sends X-Frame-Options: DENY, so the workspace editor cannot frame it — run conloca connect again, or exempt /_conloca/editor/ in your host settings`,
    ]);
    const csp = await runLive({
      ...ROUTES,
      [PAGE_URL]: page({ 'content-security-policy': "frame-ancestors 'self'" }),
    });
    expect(csp.messages('CC12')).toEqual([
      `error: ${PAGE_URL} sends a Content-Security-Policy whose frame-ancestors excludes https://*.conloca.com, so the workspace editor cannot frame it — run conloca connect again, or exempt /_conloca/editor/ in your host settings`,
    ]);
  });

  it('passes the frame-ancestors rule connect writes, and errors when script-src excludes the editor UI', async () => {
    const allowed = "frame-ancestors 'self' https://*.conloca.com";
    const ok = await runLive({ ...ROUTES, [PAGE_URL]: page({ 'content-security-policy': allowed }) });
    expect(ok.check('CC12').problems).toEqual([]);
    const scripts = await runLive({
      ...ROUTES,
      [PAGE_URL]: page({ 'content-security-policy': `${allowed}; script-src 'self'` }),
    });
    expect(scripts.messages('CC12')).toEqual([
      `error: ${PAGE_URL} sends a Content-Security-Policy whose script-src does not allow https://app.conloca.com, so the editor page cannot load the editor — add https://app.conloca.com to script-src for /_conloca/editor/`,
    ]);
  });

  it('accepts script-src sources that allow the editor UI, wildcards and paths included', async () => {
    const allowing = [
      "script-src 'self' https://*.conloca.com",
      "script-src 'self' https://app.conloca.com/host/",
      "script-src 'self' app.conloca.com",
      "script-src 'self' https://app.conloca.com:443",
      "script-src 'self' https:",
      "default-src 'self' *",
    ];
    const runs = await Promise.all(
      allowing.map((csp) => runLive({ ...ROUTES, [PAGE_URL]: page({ 'content-security-policy': csp }) })),
    );
    expect(runs.map((run) => run.check('CC12').problems)).toEqual(allowing.map(() => []));
  });

  it('errors on script-src sources that miss the editor UI, and lets script-src-elem decide', async () => {
    const blocking = [
      "script-src 'self' https://app.conloca.com/other/",
      "script-src 'self' https://*.app.conloca.com",
      "script-src 'self' http://app.conloca.com:8080",
      "default-src 'none'",
      "script-src https://app.conloca.com; script-src-elem 'self'",
    ];
    const runs = await Promise.all(
      blocking.map((csp) => runLive({ ...ROUTES, [PAGE_URL]: page({ 'content-security-policy': csp }) })),
    );
    expect(runs.map((run) => run.check('CC12').problems.length)).toEqual(blocking.map(() => 1));
  });

  it('CC12 errors, not passes, when the page answers 404 or a redirect', async () => {
    const notFound = await runLive({ ...ROUTES, [PAGE_URL]: () => new Response('nope', { status: 404 }) });
    expect(notFound.messages('CC12')).toEqual([
      `error: ${PAGE_URL} answers HTTP 404, not the editor page, so its headers say nothing yet — deploy it first (see CC11)`,
    ]);
    const moved = await runLive({
      ...ROUTES,
      [PAGE_URL]: () => new Response('', { status: 302, headers: { location: 'https://www.acme.test/login' } }),
    });
    expect(moved.messages('CC12')).toEqual([
      `error: ${PAGE_URL} answers HTTP 302, not the editor page, so its headers say nothing yet — deploy it first (see CC11)`,
    ]);
    expect(moved.check('CC12').detail).toBeUndefined();
  });

  it('skips CC12 with a reason when the endpoint has no editor UI origin', async () => {
    const { check, calls } = await runLive(ROUTES, {
      ...FILES,
      [CONFIG]: config("{ endpoint: 'https://cms.example.test' }"),
    });
    expect(check('CC12').skipped).toBe('no editor UI origin');
    expect(check('CC13').skipped).toBe('no editor UI origin');
    expect(calls.map((c) => c.url)).toEqual([INFO_URL]);
  });
});

describe('CC13 — the editor speaks this page’s protocol', () => {
  it('CC13 errors below the published minimum and above the maximum', async () => {
    const below = await runLive({ ...ROUTES, [PROTOCOLS_URL]: () => json({ min: 2, max: 3 }) });
    expect(below.messages('CC13')).toEqual([
      'error: the editor page speaks protocol 1 and the editor speaks 2–3 — rebuild with a newer @conloca/cloud-astro and deploy',
    ]);
    expect(below.check('CC11').problems).toEqual([]);
    const above = await runLive({ ...ROUTES, [INFO_URL]: () => json(info({ protocol: 4 })) });
    expect(above.messages('CC13')).toEqual([
      'error: the editor page speaks protocol 4 and the editor speaks 1–1 — the editor does not speak this version yet',
    ]);
    expect(above.check('CC11').problems).toEqual([]);
  });

  it('errors naming the URL when protocols.json is not JSON', async () => {
    const { messages } = await runLive({ ...ROUTES, [PROTOCOLS_URL]: () => new Response('<!doctype html>') });
    expect(messages('CC13')).toEqual([
      `error: ${PROTOCOLS_URL} did not answer the editor's protocol range as JSON (HTTP 200)`,
    ]);
  });

  it('skips when CC11 read no conloca.json', async () => {
    const { check } = await runLive({ ...ROUTES, [INFO_URL]: () => new Response('', { status: 404 }) });
    expect(check('CC13').skipped).toBe('no conloca.json to read (see CC11)');
  });
});
