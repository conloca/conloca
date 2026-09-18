import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { runDoctor } from '../doctor/run.js';
import type { CheckOutcome, DoctorDeps } from '../doctor/types.js';

const PROJECT = '/proj';
const CONTENT = join(PROJECT, 'content');
const CONFIG = join(PROJECT, 'astro.config.mjs');
const ENDPOINT = 'https://cms.example.test';
const TOKEN = `cbt_github:99.${'A'.repeat(43)}`;
const STATUS_URL = `${ENDPOINT}/api/v1/registrations/status?repoUri=acme%2Fsite`;
const BUNDLE = 'https://site.acme.test/_conloca/editor-bundle.aaaa.js';
const DEFAULT_BUNDLE = 'https://site.acme.test/_conloca/editor-bundle.dddd.js';

/** A config with both integrations wired and conlocaCloud(<options>). */
const config = (options: string) =>
  [
    "import { conlocaCMS } from '@conloca/astro-cms/node';",
    "import { conlocaCloud } from '@conloca/cloud-astro';",
    `export default { integrations: [conlocaCMS({}), conlocaCloud(${options})] };`,
  ].join('\n');

const FILES: Record<string, string> = {
  [CONFIG]: config(`{ endpoint: '${ENDPOINT}' }`),
  [join(CONTENT, 'sites.json')]: JSON.stringify({ siteId: 'marketing', sites: {}, globalLocales: ['en'] }),
};

const ENV = {
  CONLOCA_BUILD_TOKEN: TOKEN,
  GITHUB_REPOSITORY: 'acme/site',
  CF_PAGES_BRANCH: 'feat/x',
  CF_PAGES_COMMIT_SHA: 'feat-sha',
};

interface Call {
  url: string;
  method: string;
  authorization: string | undefined;
  range: string | undefined;
  /** Every doctor request must be bounded by a timeout signal. */
  timed: boolean;
}

/** Fetch fake: URL → responder; records every call. Unknown URLs reject like an unreachable host. */
function fakeFetch(routes: Record<string, (method: string) => Response>) {
  const calls: Call[] = [];
  const fetchFn: DoctorDeps['fetch'] = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const headers = new Headers(init?.headers);
    const method = init?.method ?? 'GET';
    calls.push({
      url,
      method,
      authorization: headers.get('authorization') ?? undefined,
      range: headers.get('range') ?? undefined,
      timed: init?.signal instanceof AbortSignal,
    });
    const responder = routes[url];
    if (!responder) throw new Error(`ECONNREFUSED ${url}`);
    return responder(method);
  };
  return { fetchFn, calls };
}

const registration = (
  branch: string,
  editorBundleUrl: string,
  gitSha = 'feat-sha',
  extra: Record<string, unknown> = {},
) => ({
  branch,
  siteId: 'marketing',
  gitSha,
  registeredAt: 1000,
  editorBundleUrl,
  bundleHash: 'h',
  deploymentUrl: null,
  ...extra,
});

/** An older row that is not active yet (`parked`): no siteId until the editor's next open reads the branch's tree. */
const parkedRegistration = (branch: string) => ({
  parked: true,
  branch,
  siteId: null,
  gitSha: 'old',
  registeredAt: 1,
  editorBundleUrl: 'https://site.acme.test/legacy.js',
  bundleHash: null,
  deploymentUrl: null,
});

function statusBody(registrations: unknown[], defaultBranch: string | null = 'main'): Response {
  return new Response(JSON.stringify({ orgId: 'github:99', repoUri: 'acme/site', defaultBranch, registrations }), {
    status: 200,
  });
}

async function runLive(
  routes: Record<string, (method: string) => Response>,
  env: Record<string, string | undefined> = ENV,
  files = FILES,
  git: DoctorDeps['git'] = () => undefined,
) {
  const { fetchFn, calls } = fakeFetch(routes);
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
      git,
      fetch: fetchFn,
    },
  );
  const check = (id: string): CheckOutcome => {
    const c = result.checks.find((x) => x.id === id);
    if (!c) throw new Error(id);
    return c;
  };
  return { check, calls, messages: (id: string) => check(id).problems.map((p) => `${p.level}: ${p.message}`) };
}

describe('CC5 — the endpoint answers the token', () => {
  it('sends the token ONLY to the configured endpoint, bounds every request, and reports reachability', async () => {
    const { check, calls } = await runLive({
      [STATUS_URL]: () => statusBody([registration('feat/x', BUNDLE)]),
      [BUNDLE]: () => new Response(null, { status: 200 }),
    });
    expect(check('CC5').problems).toEqual([]);
    expect(check('CC5').detail).toBe(`${ENDPOINT} reachable — 1 registration(s) for acme/site`);
    expect(calls.find((c) => c.url === STATUS_URL)?.authorization).toBe(`Bearer ${TOKEN}`);
    for (const call of calls.filter((c) => c.url !== STATUS_URL)) expect(call.authorization).toBeUndefined();
    for (const call of calls) expect(call.timed).toBe(true);
  });

  it('a 401 names the rotation gotcha and an endpoint without the status route; CC6/CC7 are skipped', async () => {
    const { messages, check } = await runLive({ [STATUS_URL]: () => new Response('{}', { status: 401 }) });
    expect(messages('CC5')).toEqual([
      'error: the build token is rejected by the endpoint — most likely rotated (a new token invalidates the old one); create a new token and update the CI secret — or the endpoint predates the registration status route, in which case update the endpoint first',
    ]);
    expect(check('CC6').skipped).toBe('the endpoint rejected the build token');
    expect(check('CC7').skipped).toBe('the endpoint rejected the build token');
  });

  it('a 403 names repository coverage; an unreachable endpoint is an error naming it', async () => {
    const forbidden = await runLive({ [STATUS_URL]: () => new Response('{}', { status: 403 }) });
    expect(forbidden.messages('CC5')).toEqual([
      'error: the token does not cover acme/site — give the endpoint access to that repository or fix repoUri',
    ]);
    expect(forbidden.check('CC6').skipped).toBe('the repository is not covered by the token');
    expect(forbidden.check('CC7').skipped).toBe('the repository is not covered by the token');
    const down = await runLive({});
    expect(down.messages('CC5')).toEqual([
      `error: endpoint ${ENDPOINT} is unreachable (ECONNREFUSED ${STATUS_URL}) — check the endpoint option and network access from this machine`,
    ]);
    expect(down.check('CC6').skipped).toBe('the endpoint is unreachable');
    expect(down.check('CC7').skipped).toBe('the endpoint is unreachable');
  });

  it('any other status is an error carrying the code; CC6/CC7 are skipped with it', async () => {
    const { messages, check } = await runLive({ [STATUS_URL]: () => new Response('boom', { status: 500 }) });
    expect(messages('CC5')).toEqual([
      'error: endpoint answered HTTP 500 for the registration status — the endpoint may predate this check; update it or retry',
    ]);
    expect(check('CC6').skipped).toBe('the status route answered HTTP 500');
    expect(check('CC7').skipped).toBe('the status route answered HTTP 500');
  });

  it('a 200 that is not JSON points at a misconfigured endpoint; JSON of the wrong shape names the contract', async () => {
    const html = await runLive({
      [STATUS_URL]: () => new Response('<!doctype html><title>Acme</title>', { status: 200 }),
    });
    expect(html.messages('CC5')).toEqual([
      'error: the endpoint answered 200 but not with JSON — does endpoint point at the site itself instead of the editor endpoint?',
    ]);
    expect(html.check('CC6').skipped).toBe('the endpoint did not answer with JSON');
    const shape = await runLive({
      [STATUS_URL]: () =>
        new Response(JSON.stringify({ defaultBranch: 'main', registrations: [{ branch: 'feat/x' }] }), { status: 200 }),
    });
    expect(shape.messages('CC5')).toEqual([
      'error: the registration status response has an unexpected shape — update the endpoint or this package',
    ]);
    expect(shape.check('CC6').skipped).toBe('the status response was unreadable');
  });

  it('skips the live trio without a token, an endpoint, or a repository identity', async () => {
    const noToken = await runLive({}, { ...ENV, CONLOCA_BUILD_TOKEN: undefined });
    expect(noToken.check('CC5').skipped).toBe('no build token — set CONLOCA_BUILD_TOKEN');
    const noRepo = await runLive({}, { ...ENV, GITHUB_REPOSITORY: undefined });
    expect(noRepo.check('CC5').skipped).toBe(
      'repository identity could not be determined — build in a CI environment or Git checkout, or set repoUri',
    );
    const noEndpoint = await runLive({}, ENV, { ...FILES, [CONFIG]: config('{ endpoint: X }') });
    expect(noEndpoint.check('CC5').skipped).toBe('endpoint could not be determined — set CONLOCA_ENDPOINT');
  });

  it('skips the live trio when conlocaCloud is not called, without networking', async () => {
    const cmsOnly =
      "import { conlocaCMS } from '@conloca/astro-cms/node';\nexport default { integrations: [conlocaCMS({})] };";
    const { check, calls } = await runLive({}, ENV, { ...FILES, [CONFIG]: cmsOnly });
    for (const id of ['CC5', 'CC6', 'CC7']) {
      expect(check(id).skipped).toBe('conlocaCloud(...) is not called in the astro config');
    }
    expect(calls).toEqual([]);
  });

  it('a supplied but malformed token defers to CC2 instead of asking for one', async () => {
    const fromEnv = await runLive({}, { ...ENV, CONLOCA_BUILD_TOKEN: 'cbt_nope' });
    expect(fromEnv.check('CC5').skipped).toBe('no usable build token (see CC2)');
    expect(fromEnv.check('CC7').skipped).toBe('no usable build token (see CC2)');
    const committed = await runLive(
      {},
      { ...ENV, CONLOCA_BUILD_TOKEN: undefined },
      { ...FILES, [CONFIG]: config(`{ endpoint: '${ENDPOINT}', buildToken: 'cbt_nope' }`) },
    );
    expect(committed.check('CC5').skipped).toBe('no usable build token (see CC2)');
  });

  it('a supplied but unusable endpoint defers to CC3 instead of asking for one', async () => {
    const slashed = await runLive({}, ENV, { ...FILES, [CONFIG]: config(`{ endpoint: '${ENDPOINT}/' }`) });
    expect(slashed.check('CC5').skipped).toBe('no usable endpoint (see CC3)');
    expect(slashed.calls).toEqual([]);
    const invalid = await runLive({}, ENV, { ...FILES, [CONFIG]: config("{ endpoint: 'not a url' }") });
    expect(invalid.check('CC5').skipped).toBe('no usable endpoint (see CC3)');
    const fromEnv = await runLive(
      {},
      { ...ENV, CONLOCA_ENDPOINT: `${ENDPOINT}/` },
      { ...FILES, [CONFIG]: config('{ endpoint: X }') },
    );
    expect(fromEnv.check('CC5').skipped).toBe('no usable endpoint (see CC3)');
    expect(fromEnv.calls).toEqual([]);
  });
});

describe('CC6 — three-state registration diagnosis', () => {
  it('own row: continues to CC7 and notes it', async () => {
    const { check } = await runLive({
      [STATUS_URL]: () => statusBody([registration('feat/x', BUNDLE)]),
      [BUNDLE]: () => new Response(null, { status: 200 }),
    });
    expect(check('CC6').problems).toEqual([]);
    expect(check('CC6').detail).toBe('site "marketing": own registration feat-sha');
  });

  it('no own row but the default branch has one: warn, preview degraded, CC7 probes the inherited bundle', async () => {
    const { messages, calls } = await runLive({
      [STATUS_URL]: () => statusBody([registration('main', DEFAULT_BUNDLE, 'main-sha')]),
      [DEFAULT_BUNDLE]: () => new Response(null, { status: 200 }),
    });
    expect(messages('CC6')).toEqual([
      'warn: site "marketing": no registration for branch feat/x — the editor inherits the default branch\'s (main) registration; it works, preview is degraded. Build feat/x with the token to register it',
    ]);
    expect(calls.some((c) => c.url === DEFAULT_BUNDLE)).toBe(true);
  });

  it('neither: error, the editor will not load; CC7 skipped', async () => {
    const { messages, check } = await runLive({ [STATUS_URL]: () => statusBody([registration('other', BUNDLE)]) });
    expect(messages('CC6')).toEqual([
      'error: site "marketing": no registration serves branch feat/x (nor the default branch main) — the editor will not load; build feat/x with CONLOCA_BUILD_TOKEN set',
    ]);
    expect(check('CC7').skipped).toBe('no registration to probe');
  });

  it('on the default branch, or without one, the "neither" error names this branch only', async () => {
    const onMain = await runLive(
      { [STATUS_URL]: () => statusBody([registration('other', BUNDLE)], 'main') },
      { ...ENV, CF_PAGES_BRANCH: 'main' },
    );
    expect(onMain.messages('CC6')).toEqual([
      'error: site "marketing": no registration serves branch main — the editor will not load; build main with CONLOCA_BUILD_TOKEN set',
    ]);
    const noDefault = await runLive({ [STATUS_URL]: () => statusBody([], null) });
    expect(noDefault.messages('CC6')).toEqual([
      'error: site "marketing": no registration serves branch feat/x — the editor will not load; build feat/x with CONLOCA_BUILD_TOKEN set',
    ]);
  });

  it('an empty default branch is no default branch: the "neither" error names this branch only and nothing is inherited', async () => {
    // The row keyed by the empty branch is what an unguarded '' would inherit from.
    const { messages, check, calls } = await runLive({
      [STATUS_URL]: () => statusBody([registration('', DEFAULT_BUNDLE, 'main-sha')], ''),
    });
    expect(messages('CC6')).toEqual([
      'error: site "marketing": no registration serves branch feat/x — the editor will not load; build feat/x with CONLOCA_BUILD_TOKEN set',
    ]);
    expect(check('CC7').skipped).toBe('no registration to probe');
    expect(calls.map((c) => c.url)).toEqual([STATUS_URL]);
  });

  it('rows that are not active yet count as pending, never as missing or broken', async () => {
    const { check, messages } = await runLive({
      [STATUS_URL]: () => statusBody([registration('feat/x', BUNDLE), parkedRegistration('feat/x')]),
      [BUNDLE]: () => new Response(null, { status: 200 }),
    });
    expect(messages('CC6')).toEqual([]);
    expect(check('CC6').detail).toContain(
      '1 older registration(s) not active yet — they become active the next time the editor opens',
    );
  });

  it('a branch served only by rows that are not active yet is pending, not the hard "will not load" error', async () => {
    const { check, messages } = await runLive({ [STATUS_URL]: () => statusBody([parkedRegistration('feat/x')]) });
    expect(messages('CC6')).toEqual([
      'warn: site "marketing": no active registration serves branch feat/x — 1 older registration(s) for it become active the next time the editor opens, unless this branch now declares more than one site (the editor answers 409 then). Build feat/x with CONLOCA_BUILD_TOKEN set to replace them',
    ]);
    // The parked row's bundle may point at assets a later deploy has replaced: probing it would
    // manufacture a fresh false error.
    expect(check('CC7').skipped).toBe('no registration to probe');
  });

  it("parked rows on another branch neither soften this branch's error nor colour its detail", async () => {
    // Activation is branch-scoped (the endpoint only activates rows parked on the same repository and branch), so a
    // row parked on `other` does nothing for `feat/x`.
    const { messages, check } = await runLive({ [STATUS_URL]: () => statusBody([parkedRegistration('other')]) });
    expect(messages('CC6')).toEqual([
      'error: site "marketing": no registration serves branch feat/x (nor the default branch main) — the editor will not load; build feat/x with CONLOCA_BUILD_TOKEN set',
    ]);
    expect(check('CC6').detail).toBeUndefined();
  });

  it('uses the newest row per (branch, site) whatever order the route returns', async () => {
    const older = registration('feat/x', 'https://site.acme.test/old.js', 'old-sha', { registeredAt: 1 });
    const newer = registration('feat/x', BUNDLE, 'feat-sha', { registeredAt: 2 });
    const { calls } = await runLive({
      [STATUS_URL]: () => statusBody([older, newer]),
      [BUNDLE]: () => new Response(null, { status: 200 }),
    });
    expect(calls.map((c) => c.url)).toEqual([STATUS_URL, BUNDLE]);
  });

  it('warns when the branch cannot be determined', async () => {
    const { messages } = await runLive({ [STATUS_URL]: () => statusBody([]) }, { ...ENV, CF_PAGES_BRANCH: undefined });
    expect(messages('CC6')).toEqual([
      'warn: could not determine the current branch (detached HEAD?) — set CF_PAGES_BRANCH or GITHUB_REF_NAME, or check out a branch',
    ]);
  });

  it('a malformed sites.json is a CC6 error and CC7 is skipped', async () => {
    const files = { ...FILES, [join(CONTENT, 'sites.json')]: '{not json' };
    const { messages, check } = await runLive({ [STATUS_URL]: () => statusBody([]) }, ENV, files);
    expect(messages('CC6')[0]).toMatch(/^error: @conloca\/cloud-astro: could not parse .*sites\.json as JSON$/);
    expect(check('CC7').skipped).toBe('the site id could not be resolved');
  });
});

describe('CC7 — the bundle a registration names must still be deployed', () => {
  it("a 404 on the registration's bundle is the deleted-assets error naming the fix", async () => {
    const { messages } = await runLive({
      [STATUS_URL]: () => statusBody([registration('feat/x', BUNDLE)]),
      [BUNDLE]: () => new Response(null, { status: 404 }),
    });
    expect(messages('CC7')).toEqual([
      `error: site "marketing": the registration for feat/x points at deleted editor assets — ${BUNDLE} answers HTTP 404 (a later deploy replaced them); rebuild and deploy from feat/x`,
    ]);
  });

  it('an unreachable bundle host is the same error class', async () => {
    const { messages } = await runLive({ [STATUS_URL]: () => statusBody([registration('feat/x', BUNDLE)]) });
    expect(messages('CC7')[0]).toMatch(/points at deleted editor assets — .* answers unreachable \(ECONNREFUSED/);
  });

  it('probes with HEAD and falls back to GET on 405', async () => {
    const { check, calls } = await runLive({
      [STATUS_URL]: () => statusBody([registration('feat/x', BUNDLE)]),
      [BUNDLE]: (method) => new Response(null, { status: method === 'HEAD' ? 405 : 200 }),
    });
    expect(check('CC7').problems).toEqual([]);
    expect(calls.filter((c) => c.url === BUNDLE).map((c) => c.method)).toEqual(['HEAD', 'GET']);
  });

  it('the GET fallback asks for a single byte and accepts the 206', async () => {
    const { check, calls } = await runLive({
      [STATUS_URL]: () => statusBody([registration('feat/x', BUNDLE)]),
      [BUNDLE]: (method) => new Response(null, { status: method === 'HEAD' ? 501 : 206 }),
    });
    expect(check('CC7').problems).toEqual([]);
    expect(calls.filter((c) => c.url === BUNDLE).map((c) => c.range)).toEqual([undefined, 'bytes=0-0']);
  });

  it('a reachable bundle from another sha is an info-level staleness note', async () => {
    const { check } = await runLive({
      [STATUS_URL]: () => statusBody([registration('feat/x', BUNDLE, 'older-sha')]),
      [BUNDLE]: () => new Response(null, { status: 200 }),
    });
    expect(check('CC7').problems).toEqual([]);
    expect(check('CC7').detail).toBe(
      'site "marketing": registered older-s, local HEAD feat-sh — the editor at the endpoint lags this checkout',
    );
  });

  it('an empty local sha is treated as unresolved, not as a mismatch', async () => {
    const { check } = await runLive(
      {
        [STATUS_URL]: () => statusBody([registration('feat/x', BUNDLE)]),
        [BUNDLE]: () => new Response(null, { status: 200 }),
      },
      { ...ENV, CF_PAGES_COMMIT_SHA: '' },
    );
    expect(check('CC7').problems).toEqual([]);
    expect(check('CC7').detail).toBe(`site "marketing": ${BUNDLE} reachable`);
  });
});

describe('the git seam runs inside the project directory', () => {
  /** No CI metadata, so repository and ref both have to come from git. */
  const NO_CI_ENV = {
    CONLOCA_BUILD_TOKEN: TOKEN,
    GITHUB_REPOSITORY: undefined,
    CF_PAGES_BRANCH: undefined,
    CF_PAGES_COMMIT_SHA: undefined,
  };
  /** Answers as the project's checkout only when git is run inside it; anywhere else is a different repository. */
  const gitOutsideIsAnotherRepo = (args: string[], cwd?: string): string | undefined =>
    ({
      'rev-parse HEAD': cwd === PROJECT ? 'feat-sha' : 'wrapper-sha',
      'rev-parse --abbrev-ref HEAD': cwd === PROJECT ? 'feat/x' : 'wrapper-branch',
      'config --get remote.origin.url': 'git@github.com:acme/site.git',
    })[args.join(' ')];

  it('asks every git question in projectDir, not in the directory the CLI was invoked from', async () => {
    const cwds: (string | undefined)[] = [];
    await runLive(
      {
        [STATUS_URL]: () => statusBody([registration('feat/x', BUNDLE)]),
        [BUNDLE]: () => new Response(null, { status: 200 }),
      },
      NO_CI_ENV,
      FILES,
      (args, cwd) => {
        cwds.push(cwd);
        return gitOutsideIsAnotherRepo(args, cwd);
      },
    );
    expect(cwds.length).toBeGreaterThan(0);
    expect(cwds.every((cwd) => cwd === PROJECT)).toBe(true);
  });

  it('diagnoses the project, so a checkout of another repository around it cannot fake a missing registration', async () => {
    const { messages, check } = await runLive(
      {
        [STATUS_URL]: () => statusBody([registration('feat/x', BUNDLE)]),
        [BUNDLE]: () => new Response(null, { status: 200 }),
      },
      NO_CI_ENV,
      FILES,
      gitOutsideIsAnotherRepo,
    );
    expect(messages('CC6')).toEqual([]);
    expect(check('CC6').detail).toBe('site "marketing": own registration feat-sha');
  });
});
