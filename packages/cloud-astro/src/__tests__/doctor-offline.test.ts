import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import type { ScanFs } from '../doctor/config-scan.js';
import { runDoctor } from '../doctor/run.js';
import type { CheckOutcome } from '../doctor/types.js';

const PROJECT = '/proj';
const CONTENT = join(PROJECT, 'content');
const CONFIG = join(PROJECT, 'astro.config.mjs');
const TS_CONFIG = join(PROJECT, 'astro.config.ts');
const TOKEN = `cbt_github:99.${'A'.repeat(43)}`;
const CMS_ONLY =
  "import { conlocaCMS } from '@conloca/astro-cms/node';\nexport default { integrations: [conlocaCMS({})] };";
const WITHOUT_CMS =
  "import { conlocaCloud } from '@conloca/cloud-astro';\nexport default { integrations: [conlocaCloud({ endpoint: 'https://x.test' })] };";
const URL_HINT = 'set it to an absolute URL such as https://cms.example.com';

function fakeFs(files: Record<string, string>): ScanFs {
  return {
    exists: (path: string) => path in files,
    readFile: (path: string) => {
      const text = files[path];
      if (text === undefined) throw new Error(`ENOENT ${path}`);
      return text;
    },
  };
}

/** A config that exists but cannot be read (permissions). */
const unreadableFs: ScanFs = {
  exists: () => true,
  readFile: () => {
    throw new Error('EACCES');
  },
};

/** A config with react + conlocaCMS wired and conlocaCloud(<options>). */
function config(
  options: string,
  cms = "conlocaCMS({ contentRoot: './content', puckConfigPath: './src/puck.config.tsx' })",
): string {
  return [
    "import { conlocaCMS } from '@conloca/astro-cms/node';",
    "import { conlocaCloud } from '@conloca/cloud-astro';",
    `export default { integrations: [react(), ${cms}, conlocaCloud(${options})] };`,
  ].join('\n');
}

/** Offline doctor must neither network nor shell out: the fakes throw so a regression fails loudly. */
async function runWith(fs: ScanFs, env: Record<string, string | undefined>) {
  return runDoctor(
    { contractVersion: 1, projectDir: PROJECT, contentRoot: CONTENT, live: false },
    {
      ...fs,
      env,
      git: () => {
        throw new Error('offline doctor must not run git');
      },
      fetch: () => {
        throw new Error('offline doctor must not fetch');
      },
    },
  );
}

async function run(files: Record<string, string>, env: Record<string, string | undefined> = {}) {
  return runWith(fakeFs(files), env);
}

function check(result: { checks: CheckOutcome[] }, id: string): CheckOutcome {
  const found = result.checks.find((c) => c.id === id);
  if (!found) throw new Error(`no check ${id}`);
  return found;
}

const messages = (outcome: CheckOutcome) => outcome.problems.map((p) => `${p.level}: ${p.message}`);

describe('doctor extension — contract', () => {
  it('answers contract 1 with CC1–CC7 in order and skips the live trio without --live', async () => {
    const result = await run({
      [CONFIG]: config("{ endpoint: 'https://cms.example.com', puckConfigPath: './src/puck.config.tsx' }"),
    });
    expect(result.contractVersion).toBe(1);
    expect(result.checks.map((c) => c.id)).toEqual(['CC1', 'CC2', 'CC3', 'CC4', 'CC5', 'CC6', 'CC7']);
    for (const id of ['CC5', 'CC6', 'CC7']) expect(check(result, id).skipped).toBe('live checks run only with --live');
  });

  it('reads astro.config.mjs when astro.config.ts exists too', async () => {
    const outcome = check(
      await run({ [CONFIG]: config("{ endpoint: 'https://x.test' }"), [TS_CONFIG]: WITHOUT_CMS }),
      'CC1',
    );
    expect(outcome.problems).toEqual([]);
    expect(outcome.detail).toBe('conlocaCloud(...) is called');
  });
});

describe('CC1 — conlocaCloud next to conlocaCMS', () => {
  it('reports the call when it is visible', async () => {
    const result = await run({ [CONFIG]: config("{ endpoint: 'https://cms.example.com' }") });
    expect(check(result, 'CC1').problems).toEqual([]);
    expect(check(result, 'CC1').detail).toBe('conlocaCloud(...) is called');
  });

  it('notes when the call is there but its options are not a literal', async () => {
    const outcome = check(await run({ [CONFIG]: config('options') }), 'CC1');
    expect(outcome.problems).toEqual([]);
    expect(outcome.detail).toBe(
      'conlocaCloud(...) is called with options doctor cannot read as a plain object literal',
    );
  });

  it('is an info when the dependency is installed but the call is not visible (gated off / spread)', async () => {
    const outcome = check(await run({ [CONFIG]: CMS_ONLY }), 'CC1');
    expect(outcome.problems).toEqual([]);
    expect(outcome.detail).toBe(
      '@conloca/cloud-astro is installed but conlocaCloud(...) is not detectably called — fine when it is gated off or conditionally spread',
    );
  });

  it('errors when conlocaCMS is absent entirely — the both-integrations rule', async () => {
    expect(messages(check(await run({ [CONFIG]: WITHOUT_CMS }), 'CC1'))).toEqual([
      'error: conlocaCMS(...) is not called in the astro config — conlocaCloud is an add-on to conlocaCMS, keep both in integrations',
    ]);
  });

  it('skips without an astro config, warns on an unreadable one', async () => {
    expect(check(await run({}), 'CC1').skipped).toBe('no astro.config found');
    const outcome = check(await runWith(unreadableFs, {}), 'CC1');
    expect(outcome.problems).toEqual([
      {
        check: 'CC1',
        level: 'warn',
        message: 'doctor could not read /proj/astro.config.mjs — check its file permissions',
        path: '/proj/astro.config.mjs',
      },
    ]);
  });
});

describe('CC2 — build token', () => {
  const files = { [CONFIG]: config("{ endpoint: 'https://cms.example.com' }") };
  const committedWarn =
    'warn: buildToken is written into the astro config — move it to the CONLOCA_BUILD_TOKEN environment variable so the secret is never committed';

  it('is an info locally and an error under CI when the token is missing', async () => {
    const local = check(await run(files, {}), 'CC2');
    expect(local.problems).toEqual([]);
    expect(local.detail).toBe('no build token — a CI secret, not expected locally');
    const ci = check(await run(files, { CI: 'true' }), 'CC2');
    expect(messages(ci)).toEqual([
      'error: no build token — set the CONLOCA_BUILD_TOKEN secret in CI (the endpoint issues it); without it the build skips registration and the editor at the endpoint never updates',
    ]);
  });

  it.each(['', '0', 'false', 'FALSE'])('treats CI=%j as not CI', async (value) => {
    const outcome = check(await run(files, { CI: value }), 'CC2');
    expect(outcome.problems).toEqual([]);
    expect(outcome.detail).toBe('no build token — a CI secret, not expected locally');
  });

  it('parses a well-formed token and names the id it carries', async () => {
    const outcome = check(await run(files, { CONLOCA_BUILD_TOKEN: TOKEN }), 'CC2');
    expect(outcome.problems).toEqual([]);
    expect(outcome.detail).toBe('token for github:99');
  });

  it('errors on a malformed token', async () => {
    expect(messages(check(await run(files, { CONLOCA_BUILD_TOKEN: 'cbt_nope' }), 'CC2'))).toEqual([
      'error: the build token is malformed — expected cbt_<id>.<43-character secret>; create a new token at the endpoint',
    ]);
  });

  it('asks for only the part after "=" when the whole NAME=value line went into the value, not for a new token', async () => {
    const outcome = check(await run(files, { CONLOCA_BUILD_TOKEN: `CONLOCA_BUILD_TOKEN=${TOKEN}` }), 'CC2');
    expect(messages(outcome)).toEqual([
      'error: the build token value starts with "CONLOCA_BUILD_TOKEN=" — the whole NAME=value line went into the value; store only the part after "=", which starts with cbt_',
    ]);
  });

  it('warns when the token is committed in the config', async () => {
    const committed = { [CONFIG]: config(`{ endpoint: 'https://cms.example.com', buildToken: '${TOKEN}' }`) };
    const outcome = check(await run(committed, {}), 'CC2');
    expect(messages(outcome)).toEqual([committedWarn]);
    expect(outcome.detail).toBe('token for github:99');
  });

  it('still warns about the committed token when the environment variable is set as well', async () => {
    const committed = { [CONFIG]: config(`{ endpoint: 'https://cms.example.com', buildToken: '${TOKEN}' }`) };
    const outcome = check(await run(committed, { CONLOCA_BUILD_TOKEN: TOKEN }), 'CC2');
    expect(messages(outcome)).toEqual([committedWarn]);
    expect(outcome.detail).toBe('token for github:99');
  });

  it('skips when conlocaCloud is not called, even under CI', async () => {
    const outcome = check(await run({ [CONFIG]: CMS_ONLY }, { CI: '1' }), 'CC2');
    expect(outcome.problems).toEqual([]);
    expect(outcome.skipped).toBe('conlocaCloud(...) is not called in the astro config');
  });
});

describe('CC3 — endpoint and public base URL', () => {
  it('accepts an https endpoint literal', async () => {
    const outcome = check(await run({ [CONFIG]: config("{ endpoint: 'https://cms.example.com' }") }), 'CC3');
    expect(outcome.problems).toEqual([]);
    expect(outcome.detail).toContain('endpoint https://cms.example.com');
  });

  it('skips without a config, on an unreadable one, and when conlocaCloud is not called', async () => {
    expect(check(await run({}), 'CC3').skipped).toBe('no astro.config found');
    expect(check(await runWith(unreadableFs, {}), 'CC3').skipped).toBe('astro config could not be read');
    expect(check(await run({ [CONFIG]: CMS_ONLY }), 'CC3').skipped).toBe(
      'conlocaCloud(...) is not called in the astro config',
    );
  });

  it('warns on a non-https endpoint and errors on a malformed one', async () => {
    expect(messages(check(await run({ [CONFIG]: config("{ endpoint: 'http://localhost:8787' }") }), 'CC3'))).toEqual([
      'warn: endpoint http://localhost:8787 is not https — fine for a local backend, wrong for production',
    ]);
    expect(messages(check(await run({ [CONFIG]: config("{ endpoint: 'not a url' }") }), 'CC3'))).toEqual([
      `error: endpoint "not a url" is not a valid URL — ${URL_HINT}`,
    ]);
  });

  it('reads a computed endpoint from CONLOCA_ENDPOINT and warns without it', async () => {
    const dynamic = { [CONFIG]: config('{ endpoint: CONLOCA_ENDPOINT }') };
    expect(messages(check(await run(dynamic, {}), 'CC3'))).toEqual([
      'warn: endpoint is not a plain string literal in conlocaCloud(...) — set CONLOCA_ENDPOINT so doctor can read it (live checks need it)',
    ]);
    const withEnv = check(await run(dynamic, { CONLOCA_ENDPOINT: 'https://cms.example.com' }), 'CC3');
    expect(withEnv.problems).toEqual([]);
    expect(withEnv.detail).toContain('endpoint https://cms.example.com (from CONLOCA_ENDPOINT)');
  });

  it('rejects a trailing slash on the endpoint, from the config literal and from CONLOCA_ENDPOINT alike', async () => {
    const slashError = (value: string) =>
      `error: endpoint "${value}" must not end with a slash — the build joins /api/v1/registrations verbatim and the endpoint answers 404, which fails the build; remove the trailing slash`;
    expect(messages(check(await run({ [CONFIG]: config("{ endpoint: 'https://cms.example.com/' }") }), 'CC3'))).toEqual(
      [slashError('https://cms.example.com/')],
    );
    const dynamic = { [CONFIG]: config('{ endpoint: CONLOCA_ENDPOINT }') };
    expect(messages(check(await run(dynamic, { CONLOCA_ENDPOINT: 'https://cms.example.com/' }), 'CC3'))).toEqual([
      slashError('https://cms.example.com/'),
    ]);
  });

  it('names the options, not the endpoint, when conlocaCloud(...) takes no object literal', async () => {
    const opaque = { [CONFIG]: config('sharedOpts') };
    expect(messages(check(await run(opaque, {}), 'CC3'))).toEqual([
      'warn: conlocaCloud(...) options are not a plain object literal — set CONLOCA_ENDPOINT so doctor can read the endpoint (live checks need it)',
    ]);
    const underCi = check(await run(opaque, { CI: '1', CONLOCA_ENDPOINT: 'https://x.test' }), 'CC3');
    expect(underCi.problems).toEqual([]);
    expect(underCi.detail).toBe(
      'endpoint https://x.test (from CONLOCA_ENDPOINT); public base URL not verified — the conlocaCloud options are not a plain object literal',
    );
  });

  it('does not demand a public base URL under CI when the options use a spread', async () => {
    const spread = { [CONFIG]: config("{ ...base, endpoint: 'https://x.test' }") };
    const outcome = check(await run(spread, { CI: '1' }), 'CC3');
    expect(outcome.problems).toEqual([]);
    expect(outcome.detail).toBe(
      'endpoint https://x.test; public base URL not verified — the conlocaCloud options use a spread',
    );
  });

  it('checks publicBaseUrl when set, and only under CI when absent', async () => {
    expect(
      messages(check(await run({ [CONFIG]: config("{ endpoint: 'https://x.test', publicBaseUrl: 'nope' }") }), 'CC3')),
    ).toEqual([`error: publicBaseUrl "nope" is not a valid URL — ${URL_HINT}`]);
    const absent = { [CONFIG]: config("{ endpoint: 'https://x.test' }") };
    expect(check(await run(absent, {}), 'CC3').problems).toEqual([]);
    expect(messages(check(await run(absent, { CI: '1' }), 'CC3'))).toEqual([
      'warn: no public base URL under CI — set publicBaseUrl or previewDomain (or CF_PAGES_URL); without one the build skips registration',
    ]);
    expect(check(await run(absent, { CI: '1', CF_PAGES_URL: 'https://site.pages.dev' }), 'CC3').problems).toEqual([]);
    const dynamic = { [CONFIG]: config("{ endpoint: 'https://x.test', publicBaseUrl: PUBLIC }") };
    expect(check(await run(dynamic, { CI: '1' }), 'CC3').problems).toEqual([]);
  });

  it('says in the detail where the public base URL comes from', async () => {
    const absent = { [CONFIG]: config("{ endpoint: 'https://x.test' }") };
    expect(check(await run(absent, {}), 'CC3').detail).toBe(
      'endpoint https://x.test; publicBaseUrl not set (checked under CI only)',
    );
    expect(check(await run(absent, { CI: '1', CF_PAGES_URL: 'https://site.pages.dev' }), 'CC3').detail).toContain(
      'public base URL from CF_PAGES_URL (https://site.pages.dev)',
    );
    const dynamic = { [CONFIG]: config("{ endpoint: 'https://x.test', publicBaseUrl: PUBLIC }") };
    expect(check(await run(dynamic, { CI: '1' }), 'CC3').detail).toContain(
      'public base URL is set dynamically — not verified',
    );
  });

  it('accepts a bare previewDomain hostname and rejects one that is not a hostname', async () => {
    expect(
      check(
        await run({ [CONFIG]: config("{ endpoint: 'https://x.test', previewDomain: 'preview.acme.test' }") }),
        'CC3',
      ).problems,
    ).toEqual([]);
    expect(
      messages(
        check(
          await run({ [CONFIG]: config("{ endpoint: 'https://x.test', previewDomain: 'not a host name' }") }),
          'CC3',
        ),
      ),
    ).toEqual([
      'error: previewDomain "not a host name" is not a hostname or URL — set it to a hostname such as preview.acme.com or an absolute URL',
    ]);
  });
});

describe("CC4 — conlocaCMS options the endpoint's editor ignores", () => {
  it('warns for editorStyles and editorCSS, stays silent for templates (it travels via the descriptors channel)', async () => {
    const cms = "conlocaCMS({ contentRoot: './content', templates: {}, editorStyles: './e.css', editorCSS: 'body{}' })";
    const outcome = check(await run({ [CONFIG]: config("{ endpoint: 'https://x.test' }", cms) }), 'CC4');
    expect(messages(outcome)).toEqual([
      "warn: editorStyles has no effect on the editor at the endpoint — it styles the local dev editor only; the endpoint's editor takes its canvas styles from conlocaCloud's siteStyles",
      "warn: editorCSS has no effect on the editor at the endpoint — it styles the local dev editor only; the endpoint's editor takes its canvas styles from conlocaCloud's siteStyles",
    ]);
    expect(outcome.problems[0].path).toBe('/proj/astro.config.mjs');
  });

  it('notes, without warning, when the options are not a literal', async () => {
    const outcome = check(
      await run({ [CONFIG]: config("{ endpoint: 'https://x.test' }", 'conlocaCMS(cmsOptions)') }),
      'CC4',
    );
    expect(outcome.problems).toEqual([]);
    expect(outcome.detail).toBe(
      'conlocaCMS options are not a plain object literal — editorStyles/editorCSS not checked',
    );
  });

  it('skips without a config, on an unreadable one, and when conlocaCMS is not called', async () => {
    expect(check(await run({}), 'CC4').skipped).toBe('no astro.config found');
    expect(check(await runWith(unreadableFs, {}), 'CC4').skipped).toBe('astro config could not be read');
    expect(check(await run({ [CONFIG]: WITHOUT_CMS }), 'CC4').skipped).toBe(
      'conlocaCMS is not called in the astro config',
    );
  });
});
